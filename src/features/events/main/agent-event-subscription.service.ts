/**
 * Agent Event Subscription Service
 *
 * Manages event subscriptions for agents, including:
 * - Event filtering and matching
 * - Event queuing when agents are busy
 * - Batched event delivery when agents become idle
 * - Priority handling for urgent events
 */

import * as path from 'path';
import { promises as fsPromises, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../../shared/logger';
import { WorkspaceEvent, WorkspaceEventType, createWorkspaceEvent } from '../types';
import { WorkspaceEventBus, EventFilterBuilder, getWorkspaceEventBus } from './workspace-event-bus';
import { WorkspaceConfig } from '../../../shared/main/config';

const logger = new Logger('AgentEventSubscriptionService');

// ============================================================================
// Types
// ============================================================================

/**
 * Delegation group configuration for "wait for all" behavior
 */
export interface DelegationGroup {
  /** Unique group ID for this set of delegations */
  groupId: string;
  /**
   * When to deliver the notification:
   * - 'any': Deliver when any agent in the group completes (default)
   * - 'all': Deliver only when ALL agents in the group have completed
   */
  awaitMode: 'any' | 'all';
  /** IDs of all agents in this delegation group */
  expectedAgentIds: string[];
}

/**
 * Filter configuration for agent event subscriptions
 */
export interface AgentEventFilter {
  /** Event type patterns (supports wildcards like 'agent:*') */
  eventTypes?: string[];
  /** Only receive events from specific actor types */
  actorTypes?: ('user' | 'agent' | 'system' | 'external' | 'tool')[];
  /** Only receive events from specific actor IDs */
  actorIds?: string[];
  /** Exclude events from specific actor IDs (typically self) */
  excludeActorIds?: string[];
  /** Data field matchers */
  dataMatchers?: DataMatcher[];
  /** Only receive events since this timestamp */
  since?: string;
  /** Batching window in milliseconds (0 = no batching) */
  batchWindow?: number;
  /** Maximum events before force delivery */
  batchMaxEvents?: number;
  /** Priority level - high priority events skip batching */
  priority?: 'high' | 'normal' | 'low';
  /** Delegation group for "wait for all" behavior */
  delegationGroup?: DelegationGroup;
  /** If true, automatically unsubscribe after the first matching event is delivered */
  oneShot?: boolean;
}

export interface DataMatcher {
  field: string;
  operator: 'equals' | 'contains' | 'starts_with' | 'ends_with' | 'matches';
  value: string | number | boolean | RegExp;
}

/**
 * A queued event waiting for delivery
 */
export interface QueuedEvent {
  event: WorkspaceEvent;
  queuedAt: string;
  priority: 'high' | 'normal' | 'low';
  /** Subscription ID that matched this event (for oneShot cleanup) */
  subscriptionId?: string;
  /** Whether to unsubscribe after delivery (oneShot subscriptions) */
  oneShot?: boolean;
}

/**
 * An agent's subscription to events
 */
export interface AgentSubscription {
  id: string;
  agentId: string;
  agentName: string;
  workspaceId: string;
  filter: AgentEventFilter;
  createdAt: string;
  /** Internal: event bus subscription ID */
  eventBusSubscriptionId?: string;
}

/**
 * Agent status for event delivery decisions
 */
export type AgentStatus = 'idle' | 'responding' | 'waiting' | 'completed' | 'failed';

/**
 * Callback for delivering events to an agent
 */
export type DeliveryResult =
  | { status: 'success' }
  | { status: 'failed'; error: string }
  | { status: 'timeout'; error: string; timeoutMs?: number }
  | { status: 'suppressed'; reason: 'loop' }
  | { status: 'no-callback' };

export type EventDeliveryCallback = (
  agentId: string,
  events: WorkspaceEvent[],
) => void | DeliveryResult | Promise<void | DeliveryResult>;

// ============================================================================
// Service Implementation
// ============================================================================

/**
 * Tracks completion status for a delegation group
 */
interface DelegationGroupTracker {
  groupId: string;
  parentAgentId: string;
  parentAgentName: string;
  awaitMode: 'any' | 'all';
  expectedAgentIds: Set<string>;
  completedAgentIds: Set<string>;
  deletedAgentIds: Set<string>; // Track agents that were deleted (vs normally completed)
  events: WorkspaceEvent[]; // Accumulate events from completed agents
  subscriptionId: string;
  /** Guards against double-delivery when multiple events arrive before async cleanup runs */
  delivered?: boolean;
}

export class AgentEventSubscriptionService {
  private subscriptions: Map<string, AgentSubscription> = new Map();
  private agentQueues: Map<string, QueuedEvent[]> = new Map();
  private agentStatuses: Map<string, AgentStatus> = new Map();
  private batchTimers: Map<string, NodeJS.Timeout> = new Map();
  private eventBusSubscriptions: Map<string, () => void> = new Map();
  private deliveryCallback: EventDeliveryCallback | null = null;
  /** Tracks delegation groups for "wait for all" behavior */
  private delegationGroups: Map<string, DelegationGroupTracker> = new Map();
  /** Guards against double-delivery of oneShot subscriptions */
  private firedOneShotSubscriptions: Set<string> = new Set();
  /** Monotonically increasing version counter — increments on every subscribe/unsubscribe/group change */
  private _version: number = 0;

  /**
   * SAFETY NET: Tracks recent delivery timestamps per agent to detect rapid-fire
   * loops. If an agent receives more than MAX_DELIVERIES_IN_WINDOW deliveries
   * within LOOP_DETECTION_WINDOW_MS, further deliveries are suppressed.
   */
  private recentDeliveries: Map<string, number[]> = new Map();
  /** Set to true once dispose() is called to prevent post-dispose work */
  private disposed = false;
  private static readonly LOOP_DETECTION_WINDOW_MS = 30_000; // 30 seconds
  private static readonly MAX_DELIVERIES_IN_WINDOW = 15;

  /**
   * SAFETY NET: Bounds the delegation-group delivery polling loop.
   * If delivery keeps failing or the agent never becomes idle, the loop
   * terminates after MAX_DELEGATION_POLL_DURATION_MS or MAX_DELEGATION_POLL_ATTEMPTS,
   * whichever comes first.
   */
  static readonly MAX_DELEGATION_POLL_DURATION_MS = 5 * 60 * 1000; // 5 minutes
  static readonly MAX_DELEGATION_POLL_ATTEMPTS = 200;

  // ROBUSTNESS: Health monitoring for event delivery
  private deliveryStats = {
    totalDeliveries: 0,
    successfulDeliveries: 0,
    failedDeliveries: 0,
    timeoutDeliveries: 0, // Deliveries that timed out (status unknown)
    droppedEvents: 0, // Events dropped due to missing callback
    lastDeliveryTime: null as string | null,
    lastFailureTime: null as string | null,
  };
  private healthReportInterval: NodeJS.Timeout | null = null;
  /** Timer for debounced persistence writes */
  private persistDebounceTimer: NodeJS.Timeout | null = null;

  /**
   * Tracks recently deleted agents to prevent re-subscription and event delivery
   * after deletion. Maps agentId → deletedAt timestamp (Date.now()).
   * Entries older than DELETED_AGENT_EVICTION_MS are evicted on each markAgentDeleted call.
   */
  private deletedAgents: Map<string, number> = new Map();
  private static readonly DELETED_AGENT_EVICTION_MS = 60 * 60 * 1000; // 1 hour
  private static readonly MAX_DELETED_AGENTS = 1000; // Hard cap to prevent unbounded growth

  constructor(
    private eventBus: WorkspaceEventBus,
    private workspaceId: string,
  ) {
    logger.info('AgentEventSubscriptionService initialized', { workspaceId });
    this.startHealthReporting();
  }

  /**
   * Current subscription version — monotonically increasing counter that
   * increments on every subscribe/unsubscribe/group change. Used by the
   * frontend to detect and discard stale IPC responses.
   */
  get version(): number {
    return this._version;
  }

  /**
   * Bump version and emit a single invalidation event so renderers can refetch a
   * snapshot and converge even if they missed legacy hint events.
   */
  private bumpVersionAndEmit(agentId: string, reason: string): number {
    this._version++;
    try {
      const event = createWorkspaceEvent(
        'agent:subscriptions-changed',
        this.workspaceId,
        { type: 'system', id: 'subscription-service', name: 'Subscription Service' },
        {
          agentId,
          subscriptionVersion: this._version,
          reason,
        },
      );
      this.eventBus.emitEvent(event);
    } catch {
      // Best-effort: invalidation hint should never break delivery/subscription logic.
    }
    return this._version;
  }

  /**
   * Set the callback for delivering events to agents
   */
  setDeliveryCallback(callback: EventDeliveryCallback): void {
    this.deliveryCallback = callback;
  }

  /**
   * Get current delivery health statistics
   */
  getDeliveryHealth(): {
    totalDeliveries: number;
    successfulDeliveries: number;
    failedDeliveries: number;
    timeoutDeliveries: number;
    droppedEvents: number;
    successRate: number;
    lastDeliveryTime: string | null;
    lastFailureTime: string | null;
    } {
    const successRate =
      this.deliveryStats.totalDeliveries > 0
        ? this.deliveryStats.successfulDeliveries / this.deliveryStats.totalDeliveries
        : 1;
    return {
      ...this.deliveryStats,
      successRate,
    };
  }

  /**
   * Start periodic health reporting (every 5 minutes)
   */
  private startHealthReporting(): void {
    // Report health every 5 minutes if there have been any deliveries
    this.healthReportInterval = setInterval(() => {
      if (this.deliveryStats.totalDeliveries > 0) {
        const health = this.getDeliveryHealth();
        logger.info('Event delivery health report', {
          workspaceId: this.workspaceId,
          ...health,
        });

        // Warn if success rate drops below 80%
        if (health.successRate < 0.8 && health.totalDeliveries >= 5) {
          logger.warn('Event delivery success rate is below 80%', {
            workspaceId: this.workspaceId,
            successRate: `${(health.successRate * 100).toFixed(1)}%`,
            failed: health.failedDeliveries,
            total: health.totalDeliveries,
          });
        }
      }
    }, 5 * 60 * 1000); // 5 minutes
  }

  /**
   * Record a successful delivery
   */
  recordDeliverySuccess(agentId: string, eventCount: number): void {
    this.deliveryStats.totalDeliveries++;
    this.deliveryStats.successfulDeliveries++;
    this.deliveryStats.lastDeliveryTime = new Date().toISOString();
    logger.debug('Recorded successful delivery', { agentId, eventCount });
  }

  /**
   * Record a failed delivery
   */
  recordDeliveryFailure(agentId: string, eventCount: number, error: string): void {
    this.deliveryStats.totalDeliveries++;
    this.deliveryStats.failedDeliveries++;
    this.deliveryStats.lastFailureTime = new Date().toISOString();
    logger.warn('Recorded failed delivery', { agentId, eventCount, error });
  }

  /**
   * Record a delivery timeout (status unknown)
   * Timeouts are treated separately from successes/failures because the message
   * may have been delivered but we couldn't confirm completion within the timeout window.
   */
  recordDeliveryTimeout(agentId: string, eventCount: number): void {
    this.deliveryStats.totalDeliveries++;
    this.deliveryStats.timeoutDeliveries++;
    this.deliveryStats.lastDeliveryTime = new Date().toISOString();
    logger.warn('Recorded delivery timeout - status unknown', { agentId, eventCount });
  }

  // ============================================================================
  // Subscription Persistence
  // ============================================================================

  private getSubscriptionsFilePath(): string {
    return path.join(WorkspaceConfig.paths.metadata(this.workspaceId), 'subscriptions.json');
  }

  /**
   * Serialize the current state for persistence.
   * Used by both persistSubscriptions() and the synchronous flush in dispose().
   */
  private serializeState(): {
    version: number;
    timestamp: string;
    subscriptions: Array<{
      id: string; agentId: string; agentName: string;
      workspaceId: string; filter: AgentEventFilter; createdAt: string;
    }>;
    delegationGroups: Array<Record<string, unknown>>;
    firedOneShotSubscriptions: string[];
  } {
    return {
      version: 1,
      timestamp: new Date().toISOString(),
      subscriptions: Array.from(this.subscriptions.values()).map(sub => ({
        id: sub.id,
        agentId: sub.agentId,
        agentName: sub.agentName,
        workspaceId: sub.workspaceId,
        filter: sub.filter,
        createdAt: sub.createdAt,
      })),
      delegationGroups: Array.from(this.delegationGroups.values()).map(t => ({
        groupId: t.groupId,
        parentAgentId: t.parentAgentId,
        parentAgentName: t.parentAgentName,
        awaitMode: t.awaitMode,
        expectedAgentIds: Array.from(t.expectedAgentIds),
        completedAgentIds: Array.from(t.completedAgentIds),
        deletedAgentIds: Array.from(t.deletedAgentIds),
        events: t.events,
        subscriptionId: t.subscriptionId,
        delivered: t.delivered ?? false,
      })),
      firedOneShotSubscriptions: Array.from(this.firedOneShotSubscriptions),
    };
  }

  /**
   * Restore state from parsed persistence data.
   * Used by both restoreSubscriptions() and restoreSubscriptionsSync()
   * to eliminate duplicate restoration logic.
   */
  private restoreFromParsedData(data: Record<string, unknown>): number {
    if (data.version !== 1) {
      logger.warn('Unknown subscription persistence version', { version: data.version });
      return 0;
    }

    // Restore fired oneShot subscriptions first (to avoid re-delivering)
    if (Array.isArray(data.firedOneShotSubscriptions)) {
      for (const id of data.firedOneShotSubscriptions) {
        this.firedOneShotSubscriptions.add(id);
      }
    }

    // Restore delegation groups before subscriptions
    // so that event handlers find the existing trackers
    let skippedCorrupted = 0;
    if (Array.isArray(data.delegationGroups)) {
      for (const g of data.delegationGroups as Record<string, unknown>[]) {
        try {
          this.delegationGroups.set(g.groupId as string, {
            groupId: g.groupId as string,
            parentAgentId: g.parentAgentId as string,
            parentAgentName: g.parentAgentName as string,
            awaitMode: g.awaitMode as 'any' | 'all',
            expectedAgentIds: new Set(g.expectedAgentIds as string[]),
            completedAgentIds: new Set(g.completedAgentIds as string[]),
            deletedAgentIds: new Set(g.deletedAgentIds as string[] || []),
            events: Array.isArray(g.events) ? g.events : [],
            subscriptionId: g.subscriptionId as string,
            delivered: !!(g.delivered),
          });
        } catch (err) {
          logger.warn('Skipping corrupted delegation group entry during restore', { error: String(err), groupId: g?.groupId });
          skippedCorrupted++;
        }
      }
    }

    // Restore subscriptions
    let restored = 0;
    let skippedDeleted = 0;
    if (Array.isArray(data.subscriptions)) {
      for (const subData of data.subscriptions as Record<string, unknown>[]) {
        try {
          const filter = subData.filter as AgentEventFilter | undefined;
          if (filter?.oneShot && this.firedOneShotSubscriptions.has(subData.id as string)) {
            continue;
          }
          // Skip subscriptions for agents known to be deleted in this session
          const agentId = subData.agentId as string;
          if (agentId && this.deletedAgents.has(agentId)) {
            skippedDeleted++;
            logger.warn('Skipping restore of subscription for deleted agent', {
              subscriptionId: subData.id,
              agentId,
              agentName: subData.agentName,
            });
            continue;
          }
          this.restoreSubscriptionInternal(subData as {
            id: string; agentId: string; agentName: string;
            workspaceId: string; filter: AgentEventFilter; createdAt: string;
          });
          restored++;
        } catch (err) {
          logger.warn('Skipping corrupted subscription entry during restore', { error: String(err), subscriptionId: subData?.id });
          skippedCorrupted++;
        }
      }
    }

    if (skippedDeleted > 0 || skippedCorrupted > 0) {
      logger.info('Skipped entries during restore', {
        skippedDeleted,
        skippedCorrupted,
        restored,
      });
    }

    // Clean up already-completed delegation groups that were persisted before
    // cleanup could run (e.g., app crashed between completion and cleanup).
    // Without this, the "Waiting for all (n/n)" UI lingers after restart.
    this.cleanupCompletedDelegationGroups();

    return restored;
  }

  /**
   * Remove delegation groups where all expected agents have already completed.
   * This handles the case where a group was persisted to disk after completion
   * was detected but before cleanup could run (e.g., app crash or restart).
   */
  private cleanupCompletedDelegationGroups(): void {
    const completedGroupIds: string[] = [];
    for (const tracker of this.delegationGroups.values()) {
      if (tracker.completedAgentIds.size >= tracker.expectedAgentIds.size) {
        completedGroupIds.push(tracker.groupId);
      }
    }

    for (const groupId of completedGroupIds) {
      const tracker = this.delegationGroups.get(groupId);
      if (!tracker) continue;

      // Delete tracker first, then unsubscribe (same ordering as cleanupDelegationGroup)
      this.delegationGroups.delete(groupId);

      if (tracker.subscriptionId && this.subscriptions.has(tracker.subscriptionId)) {
        this.unsubscribe(tracker.subscriptionId, 'delegation-complete', groupId);
      }

      logger.info('Cleaned up already-completed delegation group on restore', {
        groupId,
        parentAgentId: tracker.parentAgentId,
        completed: tracker.completedAgentIds.size,
        expected: tracker.expectedAgentIds.size,
      });
    }

    if (completedGroupIds.length > 0) {
      this.schedulePersist();
    }
  }


  /** Schedule a debounced persistence write */
  private schedulePersist(): void {
    if (this.persistDebounceTimer) {
      clearTimeout(this.persistDebounceTimer);
    }
    this.persistDebounceTimer = setTimeout(() => {
      this.persistDebounceTimer = null;
      this.persistSubscriptions().catch(err => {
        logger.warn('Failed to persist subscriptions', { error: String(err) });
      });
    }, 500);
  }

  /** Persist current subscriptions to disk */
  private async persistSubscriptions(): Promise<void> {
    try {
      const data = this.serializeState();
      const filePath = this.getSubscriptionsFilePath();
      await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
      await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');

      logger.info('Persisted subscriptions to disk', {
        subscriptionCount: data.subscriptions.length,
        delegationGroupCount: data.delegationGroups.length,
      });
    } catch (err) {
      logger.warn('Failed to persist subscriptions', { error: String(err) });
    }
  }

  /** Restore subscriptions from disk. Returns number restored. */
  async restoreSubscriptions(): Promise<number> {
    try {
      const filePath = this.getSubscriptionsFilePath();
      const raw = await fsPromises.readFile(filePath, 'utf-8');
      const data = JSON.parse(raw);

      const restored = this.restoreFromParsedData(data);

      logger.info('Restored subscriptions from disk', {
        restored,
        delegationGroups: (data.delegationGroups as unknown[])?.length || 0,
        firedOneShots: (data.firedOneShotSubscriptions as unknown[])?.length || 0,
      });

      return restored;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        // No persisted subscriptions yet — not an error
        return 0;
      }
      logger.warn('Failed to restore subscriptions from disk', { error: String(err) });
      return 0;
    }
  }

  /**
   * Restore subscriptions synchronously. Used during service creation to
   * eliminate the race window where events can arrive before persisted
   * subscriptions are registered with the event bus.
   */
  restoreSubscriptionsSync(): number {
    try {
      const filePath = this.getSubscriptionsFilePath();
      let raw: string;
      try {
        raw = readFileSync(filePath, 'utf-8');
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          return 0; // No persisted subscriptions yet
        }
        throw err;
      }

      const data = JSON.parse(raw);
      const restored = this.restoreFromParsedData(data);

      logger.info('Restored subscriptions from disk (sync)', {
        restored,
        delegationGroups: (data.delegationGroups as unknown[])?.length || 0,
        firedOneShots: (data.firedOneShotSubscriptions as unknown[])?.length || 0,
      });

      // Emit batch agent:subscriptions-restored event after ALL subscriptions are restored
      if (restored > 0) {
        this.emitSubscriptionsRestoredEvent(restored);
      }

      return restored;
    } catch (err) {
      logger.warn('Failed to restore subscriptions from disk (sync)', { error: String(err) });
      return 0;
    }
  }

  /**
   * Async post-validation pass: checks if agents with restored subscriptions
   * still exist in persistence. Removes subscriptions for non-existent agents.
   *
   * Called after restoreSubscriptionsSync() to clean up stale subscriptions
   * from agents that were deleted while the app was not running (e.g., crash
   * between deletion and subscription persist).
   *
   * The brief window between sync restore and this validation is safe because
   * the deletedAgents guard in sendBackendInitiatedMessage (Fix 2) catches
   * any delivery attempts to deleted agents during this window.
   */
  async validateRestoredSubscriptions(): Promise<void> {
    if (this.disposed) return;
    // Collect unique agent IDs from all current subscriptions
    const agentIds = new Set<string>();
    for (const sub of this.subscriptions.values()) {
      agentIds.add(sub.agentId);
    }

    if (agentIds.size === 0) {
      return;
    }

    logger.info('Starting async validation of restored subscriptions', {
      uniqueAgentIds: agentIds.size,
      totalSubscriptions: this.subscriptions.size,
    });

    // Check each agent's existence via persistence
    let removedCount = 0;
    try {
      const { agentPersistence } = await import('../../agent/main/agent-persistence');
      const existingAgentIds = await agentPersistence.listAgents(this.workspaceId);
      const existingSet = new Set(existingAgentIds);

      for (const agentId of agentIds) {
        // Skip agents already known to be deleted (handled during sync restore)
        if (this.deletedAgents.has(agentId)) {
          continue;
        }

        if (!existingSet.has(agentId)) {
          logger.warn('Removing stale subscriptions for non-existent agent', {
            agentId,
            workspaceId: this.workspaceId,
          });
          // Mark as deleted (with eviction) to prevent re-subscription during the cleanup window
          const beforeCount = this.subscriptions.size;
          this.markAgentDeleted(agentId);
          removedCount += beforeCount - this.subscriptions.size;
        }
      }
    } catch (err) {
      logger.warn('Failed to validate restored subscriptions', {
        error: String(err),
        workspaceId: this.workspaceId,
      });
      return;
    }

    if (removedCount > 0) {
      logger.info('Async validation removed stale subscriptions', {
        removedSubscriptions: removedCount,
        remainingSubscriptions: this.subscriptions.size,
        workspaceId: this.workspaceId,
      });
      // Persist the cleaned-up state
      if (this.disposed) return;
      this.schedulePersist();
    } else {
      logger.info('Async validation complete — no stale subscriptions found', {
        workspaceId: this.workspaceId,
      });
    }
  }

  /** Re-create a subscription from persisted data (no agent:subscribed event emitted). */
  private restoreSubscriptionInternal(subData: {
    id: string; agentId: string; agentName: string;
    workspaceId: string; filter: AgentEventFilter; createdAt: string;
  }): void {
    const subscription: AgentSubscription = {
      id: subData.id,
      agentId: subData.agentId,
      agentName: subData.agentName,
      workspaceId: subData.workspaceId,
      filter: subData.filter,
      createdAt: subData.createdAt,
    };

    const eventBusSub = this.eventBus.subscribe({
      filters: this.buildEventBusFilters(subscription.filter),
      callback: (event) => this.handleEvent(subscription, event),
    });

    subscription.eventBusSubscriptionId = eventBusSub.id;
    this.subscriptions.set(subscription.id, subscription);

    if (eventBusSub.unsubscribe) {
      this.eventBusSubscriptions.set(subscription.id, eventBusSub.unsubscribe);
    }

    if (!this.agentQueues.has(subscription.agentId)) {
      this.agentQueues.set(subscription.agentId, []);
    }
  }

  /**
   * Subscribe an agent to workspace events
   */
  subscribe(agentId: string, agentName: string, filter: AgentEventFilter): string {
    // Guard: reject subscriptions for deleted agents
    if (this.deletedAgents.has(agentId)) {
      logger.warn('Rejecting subscription for deleted agent', {
        agentId,
        agentName,
        eventTypes: filter.eventTypes,
      });
      // Return empty string to indicate rejection — callers should handle gracefully
      return '';
    }

    const subscriptionId = uuidv4();

    const subscription: AgentSubscription = {
      id: subscriptionId,
      agentId,
      agentName,
      workspaceId: this.workspaceId,
      filter,
      createdAt: new Date().toISOString(),
    };

    // Create event bus subscription
    const eventBusSub = this.eventBus.subscribe({
      filters: this.buildEventBusFilters(filter),
      callback: (event) => this.handleEvent(subscription, event),
    });

    subscription.eventBusSubscriptionId = eventBusSub.id;
    this.subscriptions.set(subscriptionId, subscription);

    // Store unsubscribe function
    if (eventBusSub.unsubscribe) {
      this.eventBusSubscriptions.set(subscriptionId, eventBusSub.unsubscribe);
    }

    // Initialize queue for this agent if not exists
    if (!this.agentQueues.has(agentId)) {
      this.agentQueues.set(agentId, []);
    }

    // Create delegation group tracker immediately if this is a delegation subscription
    // This ensures the frontend can see the delegation group status before any events are received
    if (filter.delegationGroup) {
      const group = filter.delegationGroup;
      if (!this.delegationGroups.has(group.groupId)) {
        this.delegationGroups.set(group.groupId, {
          groupId: group.groupId,
          parentAgentId: agentId,
          parentAgentName: agentName,
          awaitMode: group.awaitMode,
          expectedAgentIds: new Set(group.expectedAgentIds),
          completedAgentIds: new Set(),
          deletedAgentIds: new Set(),
          events: [],
          subscriptionId,
        });
        logger.info('Created delegation group tracker on subscribe', {
          groupId: group.groupId,
          parentAgentId: agentId,
          expectedAgentIds: group.expectedAgentIds,
        });
      }
    }

    // Registry changed (snapshot now includes this subscription)
    this.bumpVersionAndEmit(agentId, 'subscribe');

    // Emit subscription event
    this.emitSubscriptionEvent(agentId, agentName, subscriptionId, filter);

    logger.info('Agent subscribed to events', {
      subscriptionId,
      agentId,
      agentName,
      filter,
    });

    this.schedulePersist();
    return subscriptionId;
  }

  /**
   * Subscribe to a delegation group with "wait for all" behavior.
   * If the group already exists, adds the new agent to it.
   * Returns the subscription ID for the group.
   */
  subscribeToGroup(
    parentAgentId: string,
    parentAgentName: string,
    groupId: string,
    delegatedAgentId: string,
  ): string {
    // Check if we already have a subscription for this group
    let existingSubscription: AgentSubscription | undefined;
    for (const sub of this.subscriptions.values()) {
      if (sub.agentId === parentAgentId && sub.filter.delegationGroup?.groupId === groupId) {
        existingSubscription = sub;
        break;
      }
    }

    if (existingSubscription) {
      // Add the new agent to the existing group
      const group = existingSubscription.filter.delegationGroup!;
      if (!group.expectedAgentIds.includes(delegatedAgentId)) {
        group.expectedAgentIds.push(delegatedAgentId);
      }

      // Also update the actorIds filter
      if (!existingSubscription.filter.actorIds?.includes(delegatedAgentId)) {
        existingSubscription.filter.actorIds = [
          ...(existingSubscription.filter.actorIds || []),
          delegatedAgentId,
        ];
      }

      // Update the delegation group tracker as well
      const tracker = this.delegationGroups.get(groupId);
      if (tracker) {
        // SAFETY: Warn if adding to a group that has already been delivered.
        // This can happen if a new delegation is created in the brief window
        // between delivery and async cleanup. The new agent won't trigger
        // delivery again because tracker.delivered is already true.
        if (tracker.delivered) {
          logger.warn('Adding agent to a delegation group that has already been delivered', {
            groupId,
            parentAgentId,
            delegatedAgentId,
            completedCount: tracker.completedAgentIds.size,
            expectedCount: tracker.expectedAgentIds.size,
          });
        }
        tracker.expectedAgentIds.add(delegatedAgentId);
      }

      logger.info('Added agent to existing delegation group', {
        groupId,
        parentAgentId,
        delegatedAgentId,
        totalAgents: group.expectedAgentIds.length,
      });

      // IMPORTANT: Emit agent:subscribed event so UI can update
      // This was missing - the UI only got notified on the first subscription

      // Registry changed (group expanded)
      this.bumpVersionAndEmit(parentAgentId, 'group-expand');

      this.emitSubscriptionEvent(
        parentAgentId,
        parentAgentName,
        existingSubscription.id,
        existingSubscription.filter,
      );

      this.schedulePersist();
      return existingSubscription.id;
    }

    // Create a new subscription for this group
    // Include agent:deleted so parent is notified if child is deleted while waiting
    const filter: AgentEventFilter = {
      eventTypes: ['agent:idle', 'agent:completed', 'agent:failed', 'agent:deleted'],
      actorIds: [delegatedAgentId],
      priority: 'high',
      delegationGroup: {
        groupId,
        awaitMode: 'all',
        expectedAgentIds: [delegatedAgentId],
      },
    };

    const subscriptionId = this.subscribe(parentAgentId, parentAgentName, filter);

    logger.info('Created new delegation group subscription', {
      groupId,
      parentAgentId,
      delegatedAgentId,
      subscriptionId,
    });

    return subscriptionId;
  }

  /**
   * Check the status of a delegation group
   */
  getDelegationGroupStatus(
    groupId: string,
  ): { completed: number; expected: number; isComplete: boolean } | null {
    const tracker = this.delegationGroups.get(groupId);
    if (!tracker) {
      return null;
    }

    return {
      completed: tracker.completedAgentIds.size,
      expected: tracker.expectedAgentIds.size,
      isComplete: tracker.completedAgentIds.size >= tracker.expectedAgentIds.size,
    };
  }

  /**
   * Get all delegation groups where the given agent is the parent
   */
  getDelegationGroupsForParent(parentAgentId: string): Array<{
    groupId: string;
    awaitMode: 'any' | 'all';
    expectedAgentIds: string[];
    completedAgentIds: string[];
    deletedAgentIds: string[];
    agentStatuses: Record<string, AgentStatus>;
  }> {
    const result: Array<{
      groupId: string;
      awaitMode: 'any' | 'all';
      expectedAgentIds: string[];
      completedAgentIds: string[];
      deletedAgentIds: string[];
      agentStatuses: Record<string, AgentStatus>;
    }> = [];

    for (const tracker of this.delegationGroups.values()) {
      if (tracker.parentAgentId === parentAgentId) {
        // Skip completed groups that are pending async cleanup.
        // Without this filter, sequential delegations accumulate completed
        // agents into subsequent totals (e.g., 2nd delegation shows 4 instead of 2).
        if (tracker.completedAgentIds.size >= tracker.expectedAgentIds.size) {
          continue;
        }

        const agentStatuses: Record<string, AgentStatus> = {};
        for (const agentId of tracker.expectedAgentIds) {
          // If the agent is in completedAgentIds, mark as 'completed'
          // Otherwise, use the real-time status
          if (tracker.completedAgentIds.has(agentId)) {
            agentStatuses[agentId] = 'completed';
          } else {
            agentStatuses[agentId] = this.getAgentStatus(agentId);
          }
        }

        result.push({
          groupId: tracker.groupId,
          awaitMode: tracker.awaitMode,
          expectedAgentIds: Array.from(tracker.expectedAgentIds),
          completedAgentIds: Array.from(tracker.completedAgentIds),
          deletedAgentIds: Array.from(tracker.deletedAgentIds),
          agentStatuses,
        });
      }
    }

    return result;
  }

  /**
   * Unsubscribe an agent from events
   */
  unsubscribe(
    subscriptionId: string,
    reason?: 'manual-unsubscribe' | 'oneshot-fired' | 'delegation-complete',
    groupId?: string,
  ): boolean {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      return false;
    }

    // Unsubscribe from event bus
    const unsubFn = this.eventBusSubscriptions.get(subscriptionId);
    if (unsubFn) {
      unsubFn();
      this.eventBusSubscriptions.delete(subscriptionId);
    }

    this.subscriptions.delete(subscriptionId);
    // Clean up oneShot guard
    this.firedOneShotSubscriptions.delete(subscriptionId);

    // Registry changed (snapshot no longer includes this subscription)
    this.bumpVersionAndEmit(subscription.agentId, 'unsubscribe');

    // Emit unsubscription event with reason and groupId
    this.emitUnsubscriptionEvent(subscription.agentId, subscription.agentName, subscriptionId, reason, groupId);

    logger.info('Agent unsubscribed from events', {
      subscriptionId,
      agentId: subscription.agentId,
      reason,
      groupId,
    });

    this.schedulePersist();
    return true;
  }

  /**
   * Unsubscribe all subscriptions for an agent.
   * Also cleans up per-agent maps (queues, statuses, delivery tracking)
   * and orphaned delegation group trackers to prevent memory leaks and
   * stale "Waiting for all" UI after cancellation.
   */
  unsubscribeAll(agentId: string): number {
    // Collect IDs first to avoid modifying map during iteration
    const idsToUnsubscribe: string[] = [];
    for (const [subId, sub] of this.subscriptions) {
      if (sub.agentId === agentId) {
        idsToUnsubscribe.push(subId);
      }
    }
    // Now unsubscribe from the collected IDs
    for (const subId of idsToUnsubscribe) {
      this.unsubscribe(subId);
    }

    // Clean up orphaned delegation group trackers where this agent is the parent.
    // Without this, cancelling subscriptions leaves trackers in the map, causing
    // getDelegationGroupsForParent() to return stale groups and the "Waiting for all"
    // UI to persist or reappear.
    const orphanedGroupIds: string[] = [];
    for (const tracker of this.delegationGroups.values()) {
      if (tracker.parentAgentId === agentId) {
        orphanedGroupIds.push(tracker.groupId);
      }
    }
    for (const groupId of orphanedGroupIds) {
      this.delegationGroups.delete(groupId);
      logger.info('Cleaned up orphaned delegation group tracker on unsubscribeAll', {
        groupId,
        agentId,
      });
    }

    // Clean up per-agent maps to prevent unbounded growth in long-running workspaces.
    // These maps accumulate entries for every agent that ever subscribed/delivered but
    // are only cleared on dispose(). After unsubscribeAll, the agent has no active
    // subscriptions and these entries serve no purpose.
    this.agentQueues.delete(agentId);
    this.agentStatuses.delete(agentId);
    this.recentDeliveries.delete(agentId);

    if (orphanedGroupIds.length > 0) {
      // Bump version so renderer converges to the clean state
      this.bumpVersionAndEmit(agentId, 'unsubscribe-all-cleanup');
      this.schedulePersist();
    }

    return idsToUnsubscribe.length;
  }

  /**
   * Mark an agent as deleted. This:
   * 1. Adds the agent to the deletedAgents set (prevents re-subscription and event delivery)
   * 2. Calls unsubscribeAll to remove all existing subscriptions
   * 3. Evicts stale entries from the deletedAgents set
   *
   * Must be called BEFORE emitAgentDeletedEvent to close the race window.
   */
  markAgentDeleted(agentId: string): void {
    // Evict stale entries first
    this.evictStaleDeletedAgents();

    this.deletedAgents.set(agentId, Date.now());

    logger.info('Agent marked as deleted in subscription service', {
      agentId,
      deletedAgentsCount: this.deletedAgents.size,
    });

    // Remove all subscriptions for this agent
    const removedCount = this.unsubscribeAll(agentId);

    logger.info('Cleaned up subscriptions for deleted agent', {
      agentId,
      removedSubscriptions: removedCount,
    });
  }

  /**
   * Check if an agent has been marked as deleted.
   */
  isAgentDeleted(agentId: string): boolean {
    return this.deletedAgents.has(agentId);
  }

  /**
   * Evict entries from deletedAgents that are older than DELETED_AGENT_EVICTION_MS.
   * Also enforces MAX_DELETED_AGENTS hard cap by removing oldest entries.
   */
  private evictStaleDeletedAgents(): void {
    const now = Date.now();
    for (const [id, deletedAt] of this.deletedAgents) {
      if (now - deletedAt > AgentEventSubscriptionService.DELETED_AGENT_EVICTION_MS) {
        this.deletedAgents.delete(id);
      }
    }

    // Hard cap: if still over limit, remove oldest entries
    if (this.deletedAgents.size > AgentEventSubscriptionService.MAX_DELETED_AGENTS) {
      const entries = [...this.deletedAgents.entries()].sort((a, b) => a[1] - b[1]);
      const toRemove = entries.slice(0, entries.length - AgentEventSubscriptionService.MAX_DELETED_AGENTS);
      for (const [id] of toRemove) {
        this.deletedAgents.delete(id);
      }
    }
  }

  /**
   * Update agent status (called when agent starts/stops responding)
   */
  setAgentStatus(agentId: string, status: AgentStatus): void {
    const previousStatus = this.agentStatuses.get(agentId);
    this.agentStatuses.set(agentId, status);

    logger.debug('Agent status updated', { agentId, previousStatus, status });

    // Emit status change event so UI can update (e.g., AgentSubscriptions component)
    // Use WorkspaceEventBus which forwards to UnifiedEventBus automatically
    if (previousStatus !== status) {
      const event = createWorkspaceEvent(
        'agent:status-changed',
        this.workspaceId,
        { type: 'agent', id: agentId },
        {
          agentId,
          previousStatus: previousStatus || 'idle',
          status,
        },
      );
      this.eventBus.emitEvent(event);
    }

    // If agent became idle (from ANY previous state), deliver queued events.
    // Previously this only triggered on 'responding' → 'idle', which meant
    // queued events were silently lost if the agent transitioned from other
    // states (e.g. undefined, 'waiting', 'completed', 'failed') to 'idle'.
    if (status === 'idle' && previousStatus !== 'idle') {
      // Fire-and-forget: events are re-queued internally on failure
      this.deliverQueuedEvents(agentId)?.catch(() => {});
    }
  }

  /**
   * Get agent's real-time status.
   *
   * NOTE: Previously this also checked delegation group completedAgentIds,
   * returning 'completed' if the agent appeared in ANY group. That was wrong
   * because it leaked child-delegation completion status into the real-time
   * status used by handleEvent() for delivery decisions. If an agent completed
   * as a child in one delegation and later acted as a parent, its status was
   * permanently stuck at 'completed', preventing immediate event delivery.
   *
   * Delegation group completion status is now only used in
   * getDelegationGroupsForParent() which already checks completedAgentIds directly.
   */
  getAgentStatus(agentId: string): AgentStatus {
    return this.agentStatuses.get(agentId) || 'idle';
  }

  /**
   * Check if agent has pending events
   */
  hasPendingEvents(agentId: string): boolean {
    const queue = this.agentQueues.get(agentId);
    return queue ? queue.length > 0 : false;
  }

  /**
   * Get pending event count for an agent
   */
  getPendingEventCount(agentId: string): number {
    const queue = this.agentQueues.get(agentId);
    return queue ? queue.length : 0;
  }

  /**
   * Get all subscriptions for an agent
   */
  getAgentSubscriptions(agentId: string): AgentSubscription[] {
    return Array.from(this.subscriptions.values()).filter(
      (sub) =>
        sub.agentId === agentId &&
        !(sub.filter.oneShot && this.firedOneShotSubscriptions.has(sub.id))
    );
  }

  /**
   * Check if an agent has active delegation subscriptions — i.e., it is waiting
   * for one or more child agents to complete.  This is used to suppress premature
   * `agent:idle` wake-ups: when Agent B goes idle after delegating to Agent C,
   * Agent A (B's parent) should NOT be woken because B is not truly done yet.
   *
   * Only delegation-related subscriptions count (those watching for agent:idle,
   * agent:failed, agent:deleted, or agent:completed on other agents).
   */
  private hasActiveDelegationSubscriptions(agentId: string): boolean {
    const subs = this.getAgentSubscriptions(agentId);
    return subs.some((sub) => {
      // Delegation group subscriptions are always delegation-related
      if (sub.filter.delegationGroup) {
        return true;
      }
      // Subscriptions watching for agent completion events on specific actors
      // (i.e., actorIds is set and eventTypes include delegation-completion signals)
      const types = sub.filter.eventTypes;
      if (types && sub.filter.actorIds?.length) {
        const delegationEventTypes = ['agent:idle', 'agent:completed', 'agent:failed', 'agent:deleted'];
        return types.some((t) => delegationEventTypes.includes(t));
      }
      return false;
    });
  }

  /**
   * Get all active subscriptions
   */
  getAllSubscriptions(): AgentSubscription[] {
    return Array.from(this.subscriptions.values());
  }

  /**
   * Event types that are infrastructure/system events about an agent's own state.
   * These should never be delivered back to the agent they describe, as doing so
   * creates an infinite self-wake loop:
   *   agent goes idle → emits events → subscription matches → delivery emits
   *   agent:woken-by-subscription → matches wildcard subscription → queued →
   *   agent goes idle → repeat forever.
   *
   * The actor for these events is often 'subscription-service' (system), not the
   * agent itself, so excludeActorIds doesn't catch them.
   */
  /**
   * Agent lifecycle events that should only be delivered from DIRECT children
   * when using broad subscriptions (no actorIds filter). Without this guard,
   * a Coordinator subscribed to "agent:*" would wake up when a grandchild
   * (e.g., Implementor in a Coord→Shepherd→Implementor chain) goes idle.
   */
  private static readonly AGENT_LIFECYCLE_EVENTS = new Set([
    'agent:idle',
    'agent:failed',
    'agent:deleted',
    'agent:completed',
  ]);

  private static readonly SELF_REFERENTIAL_EVENT_TYPES = new Set([
    'agent:woken-by-subscription',
    'agent:status-changed',
    'agent:subscribed',
    'agent:unsubscribed',
    'agent:event-delivery-failed',
    'agent:event-delivery-timeout',
    'agent:subscriptions-changed',
    'agent:subscriptions-restored',
  ]);

  /**
   * Handle an incoming event for a subscription
   */
  private handleEvent(subscription: AgentSubscription, event: WorkspaceEvent): void {
    if (this.disposed) return;

    const { agentId, filter } = subscription;
    const isOneShot = filter.oneShot === true;

    // Guard: skip events for deleted agents.
    // This catches the race window between agent deletion and event bus unsubscription.
    if (this.deletedAgents.has(agentId)) {
      logger.warn('Skipping event delivery for deleted agent', {
        subscriptionId: subscription.id,
        agentId,
        eventType: event.type,
      });
      return;
    }

    // Guard: skip oneShot subscriptions that have already fired.
    // This prevents double-delivery when the event bus callback fires
    // before the synchronous unsubscribe takes effect.
    if (isOneShot && this.firedOneShotSubscriptions.has(subscription.id)) {
      logger.debug('OneShot subscription already fired, skipping', {
        subscriptionId: subscription.id,
        agentId,
        eventType: event.type,
      });
      return;
    }

    // Check exclusions
    if (filter.excludeActorIds?.includes(event.actor.id || '')) {
      return;
    }

    // CRITICAL: Prevent self-referential wake loops.
    // Infrastructure events about the subscribing agent itself (e.g.
    // agent:woken-by-subscription, agent:status-changed) must not be
    // delivered back to that agent. These events are emitted with actor
    // 'subscription-service' (system), so excludeActorIds won't catch them.
    // Without this guard, broad subscriptions (e.g. 'agent:*') can create an infinite loop:
    //   delivery → emits agent:woken-by-subscription → matches subscription →
    //   queued → delivered on idle → emits agent:woken-by-subscription → ...
    if (AgentEventSubscriptionService.SELF_REFERENTIAL_EVENT_TYPES.has(event.type)) {
      const data = event.data as Record<string, unknown>;
      // Check both `agentId` (most events) and `targetAgentId` (delivery-failed events)
      const eventAgentId = data?.agentId ?? data?.targetAgentId;
      if (eventAgentId === agentId) {
        logger.debug('Skipping self-referential infrastructure event', {
          subscriptionId: subscription.id,
          agentId,
          eventType: event.type,
        });
        return;
      }
    }

    // Check if event matches additional filters
    if (!this.matchesFilter(event, filter)) {
      return;
    }

    // SCOPING: For broad subscriptions (no actorIds filter, not oneShot), only deliver
    // agent lifecycle events from DIRECT children of the subscribing agent.
    // Without this, a Coordinator subscribed to "agent:*" would wake up
    // when a grandchild (Implementor) goes idle in a Coord→Shepherd→Implementor chain.
    if (
      AgentEventSubscriptionService.AGENT_LIFECYCLE_EVENTS.has(event.type) &&
      (!filter.actorIds || filter.actorIds.length === 0) &&
      !isOneShot
    ) {
      const eventParentAgentId = (event.data as Record<string, unknown>)?.parentAgentId;
      // If the event has a parentAgentId and it's NOT the subscribing agent, skip it.
      // Events without parentAgentId (e.g., user-created agents) are still delivered.
      if (eventParentAgentId && eventParentAgentId !== agentId) {
        logger.debug('Skipping grandchild agent lifecycle event for broad subscription', {
          subscriptionId: subscription.id,
          agentId,
          eventActorId: event.actor.id,
          eventParentAgentId,
          eventType: event.type,
        });
        return;
      }
    }

    // Suppress agent:idle events when the idle agent still has active delegation
    // subscriptions (i.e., it delegated to sub-agents and is waiting for them).
    // The parent should not be woken until the child is truly done.
    // agent:failed and agent:deleted are terminal — always deliver those immediately.
    if (event.type === 'agent:idle' && event.actor.id) {
      if (this.hasActiveDelegationSubscriptions(event.actor.id)) {
        logger.info('Suppressing agent:idle event — idle agent has active delegation subscriptions', {
          subscriptionId: subscription.id,
          parentAgentId: agentId,
          idleAgentId: event.actor.id,
        });
        return;
      }
    }

    const priority = filter.priority || 'normal';
    const status = this.getAgentStatus(agentId);

    logger.debug('Event matched subscription', {
      subscriptionId: subscription.id,
      agentId,
      eventType: event.type,
      agentStatus: status,
      priority,
      oneShot: isOneShot,
    });

    // Handle delegation group "wait for all" logic
    if (filter.delegationGroup?.awaitMode === 'all') {
      this.handleDelegationGroupEvent(subscription, event);
      return;
    }

    // High priority events are delivered immediately if agent is idle
    if (priority === 'high' && status === 'idle') {
      // Mark oneShot as fired BEFORE delivery to prevent any re-entrant delivery
      if (isOneShot) {
        this.firedOneShotSubscriptions.add(subscription.id);
      }
      // IMPORTANT: Cleanup (oneShot unsubscribe) only happens on known success or timeout.
      // Timeout means the message was sent but completion couldn't be confirmed — retrying
      // would send duplicate notifications. On other non-success, rollback the fired guard
      // so future matching events can retry.
      this.deliverEvents(agentId, [event])
        .then((result) => {
          if (result.status === 'success' || result.status === 'timeout') {
            if (isOneShot) {
              this.unsubscribe(subscription.id, 'oneshot-fired');
              logger.info('OneShot subscription: unsubscribed after immediate delivery', {
                subscriptionId: subscription.id,
                agentId,
                eventType: event.type,
                deliveryStatus: result.status,
              });
            }
            return;
          }

          // Non-success (failed, suppressed, no-callback): allow the subscription to fire again
          if (isOneShot) {
            this.firedOneShotSubscriptions.delete(subscription.id);
          }

          // Re-queue for retry (these non-success outcomes are retriable)
          this.queueEvent(agentId, event, priority, filter, isOneShot ? subscription.id : undefined);

          logger.warn('Immediate delivery was not successful; event re-queued for retry', {
            agentId,
            subscriptionId: subscription.id,
            eventType: event.type,
            deliveryStatus: result.status,
          });
        })
        .catch((err) => {
          // Should be rare: deliverEvents normalizes to DeliveryResult.
          if (isOneShot) {
            this.firedOneShotSubscriptions.delete(subscription.id);
          }
          this.queueEvent(agentId, event, priority, filter, isOneShot ? subscription.id : undefined);
          logger.warn('Immediate delivery threw; event re-queued for retry', {
            agentId,
            subscriptionId: subscription.id,
            eventType: event.type,
            error: String(err),
          });
        });
      return;
    }

    // Mark oneShot as fired when queuing too, to prevent duplicate queuing
    if (isOneShot) {
      this.firedOneShotSubscriptions.add(subscription.id);
    }

    // Queue the event with subscription info for oneShot cleanup
    this.queueEvent(agentId, event, priority, filter, isOneShot ? subscription.id : undefined);
  }

  /**
   * Handle event for a "wait for all" delegation group
   * Only delivers notification when ALL agents in the group have completed
   */
  private handleDelegationGroupEvent(subscription: AgentSubscription, event: WorkspaceEvent): void {
    const { agentId, agentName, filter } = subscription;
    const group = filter.delegationGroup!;

    // Get or create tracker for this group
    let tracker = this.delegationGroups.get(group.groupId);
    if (!tracker) {
      tracker = {
        groupId: group.groupId,
        parentAgentId: agentId,
        parentAgentName: agentName,
        awaitMode: group.awaitMode,
        expectedAgentIds: new Set(group.expectedAgentIds),
        completedAgentIds: new Set(),
        deletedAgentIds: new Set(),
        events: [],
        subscriptionId: subscription.id,
      };
      this.delegationGroups.set(group.groupId, tracker);
    }

    // Mark the event's actor as completed
    const completedAgentId = event.actor.id;
    if (completedAgentId && tracker.expectedAgentIds.has(completedAgentId)) {
      // Suppress agent:idle when the idle agent still has active delegation
      // subscriptions (it delegated to sub-agents and is waiting for them).
      // agent:failed and agent:deleted are terminal — always count those.
      if (event.type === 'agent:idle' && this.hasActiveDelegationSubscriptions(completedAgentId)) {
        logger.info('Delegation group: suppressing agent:idle — agent has active delegation subscriptions', {
          groupId: group.groupId,
          parentAgentId: agentId,
          idleAgentId: completedAgentId,
        });
        return;
      }

      tracker.completedAgentIds.add(completedAgentId);

      // Track if this agent was deleted (vs normally completed)
      if (event.type === 'agent:deleted') {
        tracker.deletedAgentIds.add(completedAgentId);
      }

      tracker.events.push(event);
      this.schedulePersist();

      logger.info('Delegation group: agent completed', {
        groupId: group.groupId,
        completedAgentId,
        eventType: event.type,
        completed: tracker.completedAgentIds.size,
        expected: tracker.expectedAgentIds.size,
        deleted: tracker.deletedAgentIds.size,
      });

      // Check if all agents have completed
      if (tracker.completedAgentIds.size >= tracker.expectedAgentIds.size) {
        // Guard against double-delivery: if delivery was already triggered for
        // this group (e.g., a second matching event arrived before the async
        // cleanup deleted the tracker and unsubscribed), skip the duplicate.
        if (tracker.delivered) {
          logger.info('Delegation group: all agents completed but delivery already triggered, skipping duplicate', {
            groupId: group.groupId,
            parentAgentId: agentId,
            eventType: event.type,
          });
          return;
        }
        tracker.delivered = true;

        logger.info('Delegation group: all agents completed, delivering events', {
          groupId: group.groupId,
          parentAgentId: agentId,
          eventCount: tracker.events.length,
          subscriptionId: tracker.subscriptionId,
        });

        // Deliver all accumulated events
        const status = this.getAgentStatus(agentId);
        const groupIdForCleanup = group.groupId;
        const subscriptionIdForCleanup = tracker.subscriptionId;

        const cleanupDelegationGroup = () => {
          // IMPORTANT: Delete the tracker BEFORE unsubscribing.
          // unsubscribe() calls bumpVersionAndEmit() which triggers the renderer
          // to refetch via getDelegationGroupsForParent(). If the tracker still
          // exists at that point, the renderer will re-show the "Waiting for" UI.
          this.delegationGroups.delete(groupIdForCleanup);

          // Unsubscribe from the delegation group subscription
          if (subscriptionIdForCleanup) {
            this.unsubscribe(subscriptionIdForCleanup, 'delegation-complete', groupIdForCleanup);
            logger.info('Delegation group: unsubscribed after completion', {
              groupId: groupIdForCleanup,
              subscriptionId: subscriptionIdForCleanup,
            });
          } else {
            // No subscription to unsubscribe — still bump version so renderer converges
            this.bumpVersionAndEmit(agentId, 'delegation-group-cleanup');
          }
        };

        // Add completion status metadata to events
        const completionStatus = tracker.deletedAgentIds.size > 0 ? 'partial' : 'completed';
        const eventsWithMetadata = tracker.events.map((e) => ({
          ...e,
          metadata: {
            ...e.metadata,
            delegationGroupId: group.groupId,
            completionStatus,
            deletedAgentCount: tracker.deletedAgentIds.size,
          },
        }));

        if (status === 'idle') {
          // Bounded retry for idle-path delivery failure.
          // Without this, a failed/suppressed/no-callback delivery leaves the
          // delegation group tracker and subscription lingering forever with no
          // retry mechanism (the busy-path has queueDelegationGroupEvents with
          // bounded polling, but the idle-path had none).
          const MAX_IDLE_RETRIES = 3;
          const IDLE_RETRY_DELAY_MS = 2000;

          const attemptIdleDelivery = (attempt: number) => {
            this.deliverEvents(agentId, eventsWithMetadata)
              .then((result) => {
                if (result.status === 'success' || result.status === 'timeout') {
                  // Timeout means the message was sent but we couldn't confirm completion.
                  // Treat as terminal to avoid lingering group tracker + subscription (Bug: "Waiting for all n/n" forever).
                  cleanupDelegationGroup();
                } else if (attempt < MAX_IDLE_RETRIES) {
                  logger.warn('Delegation group: idle delivery not successful, retrying', {
                    groupId: groupIdForCleanup,
                    deliveryStatus: result.status,
                    attempt,
                    maxRetries: MAX_IDLE_RETRIES,
                  });
                  setTimeout(() => attemptIdleDelivery(attempt + 1), IDLE_RETRY_DELAY_MS * attempt);
                } else {
                  // Exhausted retries — clean up to prevent lingering UI
                  logger.warn('Delegation group: idle delivery failed after all retries, cleaning up', {
                    groupId: groupIdForCleanup,
                    deliveryStatus: result.status,
                    attempts: attempt,
                  });
                  cleanupDelegationGroup();
                }
              })
              .catch((err) => {
                if (attempt < MAX_IDLE_RETRIES) {
                  logger.warn('Delegation group: idle delivery threw, retrying', {
                    groupId: groupIdForCleanup,
                    error: String(err),
                    attempt,
                    maxRetries: MAX_IDLE_RETRIES,
                  });
                  setTimeout(() => attemptIdleDelivery(attempt + 1), IDLE_RETRY_DELAY_MS * attempt);
                } else {
                  logger.warn('Delegation group: idle delivery threw after all retries, cleaning up', {
                    groupId: groupIdForCleanup,
                    error: String(err),
                    attempts: attempt,
                  });
                  cleanupDelegationGroup();
                }
              });
          };

          attemptIdleDelivery(1);
        } else {
          // Parent is busy — queue events as a batch to preserve delegation group context
          // Keep the tracker alive until the queued delivery succeeds
          const queuedDeliveryPromise = this.queueDelegationGroupEvents(
            agentId,
            eventsWithMetadata,
            filter.priority || 'high',
            filter,
            tracker,
          );

          // Defer cleanup until the queued delivery completes
          if (queuedDeliveryPromise) {
            queuedDeliveryPromise
              .then((result) => {
                if (result.status === 'success' || result.status === 'timeout') {
                  // Timeout means the message was sent but we couldn't confirm completion.
                  // Treat as terminal to avoid lingering group tracker + subscription.
                  cleanupDelegationGroup();
                } else {
                  // FIX: Clean up on failure to prevent lingering "Waiting for all (n/n)" UI.
                  // Previously this kept the subscription "for retry", but since
                  // tracker.delivered is already true, no new events can re-trigger
                  // delivery — the group would linger forever.
                  logger.warn('Delegation group: queued delivery failed after polling budget exhausted, cleaning up', {
                    groupId: groupIdForCleanup,
                    deliveryStatus: result.status,
                  });
                  cleanupDelegationGroup();
                }
              })
              .catch((err) => {
                // FIX: Same as above — clean up to prevent lingering group.
                logger.warn('Delegation group: queued delivery threw after polling budget exhausted, cleaning up', {
                  groupId: groupIdForCleanup,
                  error: String(err),
                });
                cleanupDelegationGroup();
              });
          } else {
            // No queued promise means there was nothing to queue/deliver
            // (empty events array). This shouldn't happen if all agents completed,
            // but clean up defensively to prevent a lingering group.
            logger.warn('Delegation group: nothing queued for delivery, cleaning up defensively', {
              groupId: groupIdForCleanup,
            });
            cleanupDelegationGroup();
          }
        }
      }
    }
  }

  /**
   * Queue an event for later delivery
   * @param oneShotSubscriptionId - If provided, this subscription will be cleaned up after delivery
   */
  private queueEvent(
    agentId: string,
    event: WorkspaceEvent,
    priority: 'high' | 'normal' | 'low',
    filter: AgentEventFilter,
    oneShotSubscriptionId?: string,
  ): void {
    const queue = this.agentQueues.get(agentId) || [];
    queue.push({
      event,
      queuedAt: new Date().toISOString(),
      priority,
      subscriptionId: oneShotSubscriptionId,
      oneShot: !!oneShotSubscriptionId,
    });
    this.agentQueues.set(agentId, queue);

    // Check if we should force delivery due to batch size
    const batchMaxEvents = filter.batchMaxEvents || 50;
    if (queue.length >= batchMaxEvents) {
      // Fire-and-forget: events are re-queued internally on failure
      this.deliverQueuedEvents(agentId)?.catch(() => {});
      return;
    }

    // Set up batch timer if not already running
    const batchWindow = filter.batchWindow || 500;
    if (batchWindow > 0 && !this.batchTimers.has(agentId)) {
      const timer = setTimeout(() => {
        if (this.disposed) return;
        this.batchTimers.delete(agentId);
        const status = this.getAgentStatus(agentId);
        if (status === 'idle') {
          // Fire-and-forget: events are re-queued internally on failure
          this.deliverQueuedEvents(agentId)?.catch(() => {});
        }
      }, batchWindow);
      this.batchTimers.set(agentId, timer);
    }
  }

  /**
   * Queue delegation group events as a batch for later delivery.
   * This preserves batch semantics by keeping the tracker alive until delivery succeeds.
   * Returns a promise that resolves when the batch is delivered.
   */
  private queueDelegationGroupEvents(
    agentId: string,
    events: WorkspaceEvent[],
    priority: 'high' | 'normal' | 'low',
    filter: AgentEventFilter,
    tracker: DelegationGroupTracker,
  ): Promise<DeliveryResult> | undefined {
    if (events.length === 0) return undefined;

    // Create a synthetic event that wraps the batch with completion status
    const completionStatus = tracker.deletedAgentIds.size > 0 ? 'partial' : 'completed';

    logger.info('Delegation group: queuing batch for later delivery', {
      groupId: tracker.groupId,
      eventCount: events.length,
      completionStatus,
      deletedCount: tracker.deletedAgentIds.size,
    });

    // Queue all events individually but track that they're part of a delegation group batch
    for (const e of events) {
      this.queueEvent(agentId, e, priority, filter);
    }

    // Return a promise that resolves only after the agent becomes idle AND
    // delivery is confirmed. This keeps the tracker alive until delivery succeeds.
    // SAFETY: Bounded by max duration and max attempts to prevent infinite loops.
    return new Promise<DeliveryResult>((resolve) => {
      const startTime = Date.now();
      let attempts = 0;

      const checkAndDeliver = () => {
        if (this.disposed) {
          resolve({ status: 'failed', error: 'Service disposed' });
          return;
        }
        attempts++;

        // SAFETY NET: Check if we've exceeded the polling budget.
        const elapsed = Date.now() - startTime;
        if (
          elapsed >= AgentEventSubscriptionService.MAX_DELEGATION_POLL_DURATION_MS ||
          attempts > AgentEventSubscriptionService.MAX_DELEGATION_POLL_ATTEMPTS
        ) {
          logger.warn('Delegation group: polling budget exhausted, terminating with failure', {
            groupId: tracker.groupId,
            agentId,
            elapsedMs: elapsed,
            attempts,
            maxDurationMs: AgentEventSubscriptionService.MAX_DELEGATION_POLL_DURATION_MS,
            maxAttempts: AgentEventSubscriptionService.MAX_DELEGATION_POLL_ATTEMPTS,
          });
          // Bump version so the UI converges to the terminal state
          this.bumpVersionAndEmit(agentId, 'delegation-poll-exhausted');
          resolve({ status: 'failed', error: `Delegation group polling exhausted after ${attempts} attempts / ${elapsed}ms` });
          return;
        }

        // If the tracker has been cleaned up externally, stop waiting.
        if (!this.delegationGroups.has(tracker.groupId)) {
          resolve({ status: 'failed', error: 'Delegation group tracker was removed before delivery' });
          return;
        }

        const status = this.getAgentStatus(agentId);
        if (status === 'idle') {
          // Agent is now idle, deliver the queued events and await the result
          const deliveryResult = this.deliverQueuedEvents(agentId);
          if (deliveryResult) {
            deliveryResult
              .then((result) => {
                if (result.status === 'success' || result.status === 'timeout') {
                  // Timeout means the message was sent but we couldn't confirm completion.
                  // Treat as terminal to avoid infinite polling loop.
                  resolve(result);
                } else {
                  // Keep waiting for a future successful delivery attempt.
                  setTimeout(checkAndDeliver, 1000);
                }
              })
              .catch((err) => {
                logger.warn('Delegation group: delivery threw during polling', {
                  groupId: tracker.groupId,
                  error: String(err),
                  attempts,
                });
                // Keep polling — the budget check above will eventually terminate.
                setTimeout(checkAndDeliver, 1000);
              });
          } else {
            // Nothing to deliver — keep waiting.
            setTimeout(checkAndDeliver, 1000);
          }
        } else {
          // Still busy, check again soon
          setTimeout(checkAndDeliver, 500); // Reduced from 100ms — agent status is event-driven
        }
      };

      // Start checking if agent becomes idle
      checkAndDeliver();
    });
  }

  /**
   * Deliver queued events to an agent.
   * Returns a promise that resolves when delivery is confirmed, or undefined
   * if there is nothing to deliver. On failure, events are re-queued so they
   * are not lost.
   */
  private deliverQueuedEvents(agentId: string): Promise<DeliveryResult> | undefined {
    if (this.disposed) return undefined;
    const queue = this.agentQueues.get(agentId);
    if (!queue || queue.length === 0) {
      return undefined;
    }

    if (this.deletedAgents.has(agentId)) {
      this.agentQueues.delete(agentId);
      return undefined;
    }

    // Snapshot the current queue and replace it with an empty array so new
    // events arriving during delivery are queued separately.
    const snapshot = [...queue];
    this.agentQueues.set(agentId, []);

    // Clear any pending batch timer
    const timer = this.batchTimers.get(agentId);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(agentId);
    }

    // Collect oneShot subscription IDs to clean up after delivery
    const oneShotSubscriptionIds = new Set<string>();
    for (const queuedEvent of snapshot) {
      if (queuedEvent.oneShot && queuedEvent.subscriptionId) {
        oneShotSubscriptionIds.add(queuedEvent.subscriptionId);
      }
    }

    // Sort by priority (high first) then by time
    const sortedEvents = snapshot
      .sort((a, b) => {
        const priorityOrder = { high: 0, normal: 1, low: 2 };
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return new Date(a.queuedAt).getTime() - new Date(b.queuedAt).getTime();
      })
      .map((q) => q.event);

    const deliveryPromise = this.deliverEvents(agentId, sortedEvents);

    // Build a result promise that resolves only after delivery is confirmed.
    // On failure, re-queue the events so they are not lost.
    const requeue = () => {
      if (this.disposed) return;
      const currentQueue = this.agentQueues.get(agentId) || [];
      // Prepend the failed events so they are retried first
      this.agentQueues.set(agentId, [...snapshot, ...currentQueue]);
      logger.warn('deliverQueuedEvents: delivery failed, events re-queued', {
        agentId,
        requeuedCount: snapshot.length,
      });
    };

    const cleanupOneShots = () => {
      for (const subscriptionId of oneShotSubscriptionIds) {
        this.unsubscribe(subscriptionId, 'oneshot-fired');
        logger.info('OneShot subscription: unsubscribed after queued delivery', {
          subscriptionId,
          agentId,
        });
      }
    };

    const rollbackOneShots = () => {
      for (const subscriptionId of oneShotSubscriptionIds) {
        // Delivery failed — allow the subscription to fire again
        this.firedOneShotSubscriptions.delete(subscriptionId);
        logger.warn('OneShot subscription: queued delivery failed, allowing retry', {
          subscriptionId,
          agentId,
        });
      }
    };

    return deliveryPromise
      .then((result) => {
        if (result.status === 'success' || result.status === 'timeout') {
          // Known success or timeout (message was sent but completion unconfirmed).
          // Timeout is terminal: retrying would send duplicate notifications.
          // Clean up oneShot subscriptions in both cases.
          if (oneShotSubscriptionIds.size > 0) {
            cleanupOneShots();
          }
          return result;
        }

        // Non-success (failed, suppressed, no-callback) — re-queue events and rollback oneShots so retries are possible
        requeue();
        if (oneShotSubscriptionIds.size > 0) {
          rollbackOneShots();
        }
        return result;
      })
      .catch((err) => {
        // Unexpected throw — treat as failed and retry later
        requeue();
        if (oneShotSubscriptionIds.size > 0) {
          rollbackOneShots();
        }
        return { status: 'failed', error: String(err) } as DeliveryResult;
      });
  }

  /**
   * Gather diagnostic information about subscriptions for an agent
   * Used for enriching loop detection logs
   */
  private getSubscriptionDiagnostics(agentId: string): {
    subscriptionCount: number;
    subscriptionTypes: string[];
    delegationGroupIds: string[];
  } {
    const subscriptionTypes = new Set<string>();
    const delegationGroupIds = new Set<string>();
    let subscriptionCount = 0;

    // Find all subscriptions for this agent
    for (const sub of this.subscriptions.values()) {
      if (sub.agentId === agentId) {
        subscriptionCount++;
        // Determine subscription type
        if (sub.filter.oneShot) {
          subscriptionTypes.add('oneShot');
        } else {
          subscriptionTypes.add('persistent');
        }
        // Collect delegation group IDs if any
        if (sub.filter.delegationGroup?.groupId) {
          delegationGroupIds.add(sub.filter.delegationGroup.groupId);
        }
      }
    }

    return {
      subscriptionCount,
      subscriptionTypes: Array.from(subscriptionTypes),
      delegationGroupIds: Array.from(delegationGroupIds),
    };
  }

  /**
   * Deliver events to an agent
   */
  private async deliverEvents(agentId: string, events: WorkspaceEvent[]): Promise<DeliveryResult> {
    if (this.disposed) return { status: 'no-callback' };
    if (events.length === 0) return { status: 'success' };

    // Bump version for delivery attempt so renderer can converge even if it missed
    // any of the legacy hint events.
    this.bumpVersionAndEmit(agentId, 'delivery-attempt');

    // SAFETY NET: Detect rapid-fire delivery loops.
    // If an agent is receiving deliveries faster than expected, something is
    // likely causing a self-wake loop. Suppress further deliveries to prevent
    // runaway API calls and wasted tokens.
    const now = Date.now();
    const recentTimestamps = this.recentDeliveries.get(agentId) || [];
    const windowStart = now - AgentEventSubscriptionService.LOOP_DETECTION_WINDOW_MS;
    const recentInWindow = recentTimestamps.filter(t => t > windowStart);
    recentInWindow.push(now);
    this.recentDeliveries.set(agentId, recentInWindow);

    if (recentInWindow.length > AgentEventSubscriptionService.MAX_DELIVERIES_IN_WINDOW) {
      // Gather diagnostic information for the log
      const diagnostics = this.getSubscriptionDiagnostics(agentId);
      const eventTypes = [...new Set(events.map((e) => e.type))];

      logger.error('Rapid-fire delivery loop detected — suppressing delivery', {
        agentId,
        deliveriesInWindow: recentInWindow.length,
        windowMs: AgentEventSubscriptionService.LOOP_DETECTION_WINDOW_MS,
        maxAllowed: AgentEventSubscriptionService.MAX_DELIVERIES_IN_WINDOW,
        eventCount: events.length,
        eventTypes,
        subscriptionCount: diagnostics.subscriptionCount,
        subscriptionTypes: diagnostics.subscriptionTypes,
        delegationGroupIds: diagnostics.delegationGroupIds,
      });

      // Bump version for outcome transition
      this.bumpVersionAndEmit(agentId, 'delivery-outcome');
      return { status: 'suppressed', reason: 'loop' };
    }

    logger.info('Delivering events to agent', {
      agentId,
      eventCount: events.length,
      eventTypes: events.map((e) => e.type),
    });

    if (!this.deliveryCallback) {
      // Log warning when events are dropped due to missing callback
      // This helps debug issues where agents don't receive expected events
      logger.warn('Events dropped: no delivery callback registered', {
        agentId,
        eventCount: events.length,
        eventTypes: events.map((e) => e.type),
      });
      // ROBUSTNESS: Track dropped events in health monitoring
      this.deliveryStats.droppedEvents += events.length;
      // Bump version for outcome transition
      this.bumpVersionAndEmit(agentId, 'delivery-outcome');
      return { status: 'no-callback' };
    }

    const normalize = (value: unknown): DeliveryResult => {
      if (!value) return { status: 'success' };
      if (typeof value === 'object' && value && 'status' in (value as any)) {
        return value as DeliveryResult;
      }
      return { status: 'success' };
    };

    try {
      const result = this.deliveryCallback(agentId, events);
      const normalized =
        result && typeof (result as Promise<unknown>).then === 'function'
          ? normalize(await (result as Promise<unknown>))
          : normalize(result);

      // Bump version for outcome transition
      this.bumpVersionAndEmit(agentId, 'delivery-outcome');
      return normalized;
    } catch (err) {
      // Bump version for outcome transition
      this.bumpVersionAndEmit(agentId, 'delivery-outcome');
      return { status: 'failed', error: String(err) };
    }
  }

  /**
   * Check if an event matches the filter criteria
   */
  private matchesFilter(event: WorkspaceEvent, filter: AgentEventFilter): boolean {
    // Check event type patterns
    if (filter.eventTypes && filter.eventTypes.length > 0) {
      const matches = filter.eventTypes.some((pattern) => this.matchEventType(event.type, pattern));
      if (!matches) return false;
    }

    // Check actor types
    if (filter.actorTypes && filter.actorTypes.length > 0) {
      if (!filter.actorTypes.includes(event.actor.type)) {
        return false;
      }
    }

    // Check actor IDs
    if (filter.actorIds && filter.actorIds.length > 0) {
      if (!event.actor.id || !filter.actorIds.includes(event.actor.id)) {
        return false;
      }
    }

    // Check data matchers
    if (filter.dataMatchers && filter.dataMatchers.length > 0) {
      for (const matcher of filter.dataMatchers) {
        if (!this.matchData(event, matcher)) {
          return false;
        }
      }
    }

    // Check since timestamp
    if (filter.since) {
      if (new Date(event.timestamp) < new Date(filter.since)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Match event type against a pattern (supports category wildcards like 'agent:*').
   * Bare '*' is no longer supported — the tool layer expands it to category wildcards
   * before it reaches here. If a bare '*' somehow slips through (e.g. from a persisted
   * subscription), we log a warning and reject the match to prevent loops.
   */
  private matchEventType(eventType: string, pattern: string): boolean {
    if (pattern === '*') {
      logger.warn('Bare "*" wildcard in subscription filter is deprecated and ignored', {
        eventType,
      });
      return false;
    }
    if (pattern.endsWith(':*')) {
      const prefix = pattern.slice(0, -1);
      return eventType.startsWith(prefix);
    }
    return eventType === pattern;
  }

  /**
   * Match event data against a data matcher
   */
  private matchData(event: WorkspaceEvent, matcher: DataMatcher): boolean {
    const value = this.getNestedValue(event, matcher.field);
    if (value === undefined) return false;

    switch (matcher.operator) {
      case 'equals':
        return value === matcher.value;
      case 'contains':
        return String(value).includes(String(matcher.value));
      case 'starts_with':
        return String(value).startsWith(String(matcher.value));
      case 'ends_with':
        return String(value).endsWith(String(matcher.value));
      case 'matches':
        if (matcher.value instanceof RegExp) {
          return matcher.value.test(String(value));
        }
        return new RegExp(String(matcher.value)).test(String(value));
      default:
        return false;
    }
  }

  /**
   * Get a nested value from an object using dot notation
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * Build event bus filters from agent filter
   */
  private buildEventBusFilters(filter: AgentEventFilter): any[] {
    const builder = new EventFilterBuilder();

    // Add type filter if specific types are requested.
    // Previously this only handled single-type filters, which meant
    // completion subscriptions (with 4 event types) got NO bus-level
    // type filters, causing ALL workspace events to flow through to
    // handleEvent for manual filtering. Now uses 'in' operator for
    // multiple types.
    if (filter.eventTypes && filter.eventTypes.length > 0) {
      const nonWildcard = filter.eventTypes.filter((t) => !t.includes('*'));
      if (nonWildcard.length > 0) {
        builder.ofTypes(nonWildcard as WorkspaceEventType[]);
      }
    }

    // Add actor type filter
    if (filter.actorTypes && filter.actorTypes.length === 1) {
      builder.byActor(filter.actorTypes[0]);
    }

    // Add since filter
    if (filter.since) {
      builder.since(filter.since);
    }

    return builder.build();
  }

  /**
   * Emit a subscription event
   */
  private emitSubscriptionEvent(
    agentId: string,
    agentName: string,
    subscriptionId: string,
    filter: AgentEventFilter,
  ): void {
    const filterDescription = this.describeFilter(filter);

    logger.info('Emitting agent:subscribed event', {
      agentId,
      subscriptionId,
      filterDescription,
      actorIds: filter.actorIds,
      actorIdsCount: filter.actorIds?.length,
    });

    const event = createWorkspaceEvent(
      'agent:subscribed',
      this.workspaceId,
      { type: 'agent', id: agentId, name: agentName },
      {
        agentId,
        agentName,
        subscriptionId,
        eventTypes: filter.eventTypes || [],
        filterDescription,
      },
    );
    // Use WorkspaceEventBus which forwards to UnifiedEventBus automatically
    this.eventBus.emitEvent(event);
  }

  /**
   * Emit an unsubscription event
   */
  private emitUnsubscriptionEvent(
    agentId: string,
    agentName: string,
    subscriptionId: string,
    reason?: 'manual-unsubscribe' | 'oneshot-fired' | 'delegation-complete',
    groupId?: string,
  ): void {
    const event = createWorkspaceEvent(
      'agent:unsubscribed',
      this.workspaceId,
      { type: 'agent', id: agentId, name: agentName },
      {
        agentId,
        agentName,
        subscriptionId,
        reason,
        groupId,
      },
    );
    // Use WorkspaceEventBus which forwards to UnifiedEventBus automatically
    this.eventBus.emitEvent(event);
  }

  /**
   * Emit a batch subscriptions-restored event after restoration completes
   */
  private emitSubscriptionsRestoredEvent(count: number): void {
    // Collect unique agent IDs from restored subscriptions
    const agentIds = new Set<string>();
    for (const sub of this.subscriptions.values()) {
      agentIds.add(sub.agentId);
    }

    logger.info('Emitting agent:subscriptions-restored event', {
      count,
      uniqueAgentIds: agentIds.size,
      agentIds: Array.from(agentIds),
    });

    const event = createWorkspaceEvent(
      'agent:subscriptions-restored',
      this.workspaceId,
      { type: 'system', id: 'subscription-service' },
      {
        count,
        agentIds: Array.from(agentIds),
      },
    );
    // Use WorkspaceEventBus which forwards to UnifiedEventBus automatically
    this.eventBus.emitEvent(event);
  }

  /**
   * Create a human-readable description of a filter
   * IMPORTANT: Include actorIds to ensure deduplication can distinguish
   * when new agents are added to a delegation group
   */
  private describeFilter(filter: AgentEventFilter): string {
    const parts: string[] = [];

    if (filter.eventTypes && filter.eventTypes.length > 0) {
      parts.push(`types: ${filter.eventTypes.join(', ')}`);
    }
    if (filter.actorIds && filter.actorIds.length > 0) {
      // Include actorIds to make each subscription update unique for deduplication
      parts.push(`watching: ${filter.actorIds.join(', ')}`);
    }
    if (filter.actorTypes && filter.actorTypes.length > 0) {
      parts.push(`actors: ${filter.actorTypes.join(', ')}`);
    }
    if (filter.excludeActorIds && filter.excludeActorIds.length > 0) {
      parts.push(`excluding: ${filter.excludeActorIds.length} actors`);
    }

    return parts.length > 0 ? parts.join('; ') : 'all events';
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.disposed = true;

    // Flush any pending persist BEFORE clearing data.
    // Without this, subscription changes queued by schedulePersist()
    // but not yet written to disk are lost when dispose() clears the maps.
    if (this.persistDebounceTimer) {
      clearTimeout(this.persistDebounceTimer);
      this.persistDebounceTimer = null;
    }
    // Synchronous final persist — use writeFileSync so we don't lose data
    try {
      if (this.subscriptions.size > 0 || this.delegationGroups.size > 0) {
        const data = this.serializeState();
        const filePath = this.getSubscriptionsFilePath();
        mkdirSync(path.dirname(filePath), { recursive: true });
        writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        logger.info('Flushed subscriptions to disk on dispose', {
          subscriptionCount: data.subscriptions.length,
          delegationGroupCount: data.delegationGroups.length,
        });
      }
    } catch (err) {
      logger.warn('Failed to flush subscriptions on dispose', { error: String(err) });
    }

    // Clear all batch timers
    for (const timer of this.batchTimers.values()) {
      clearTimeout(timer);
    }
    this.batchTimers.clear();

    // ROBUSTNESS: Clear health report interval
    if (this.healthReportInterval) {
      clearInterval(this.healthReportInterval);
      this.healthReportInterval = null;
    }

    // Log final health report before disposing
    if (this.deliveryStats.totalDeliveries > 0) {
      logger.info('Final event delivery health report before dispose', {
        workspaceId: this.workspaceId,
        ...this.getDeliveryHealth(),
      });
    }

    // Unsubscribe all
    for (const unsubFn of this.eventBusSubscriptions.values()) {
      unsubFn();
    }
    this.eventBusSubscriptions.clear();
    this.subscriptions.clear();
    this.agentQueues.clear();
    this.agentStatuses.clear();
    this.delegationGroups.clear();
    this.firedOneShotSubscriptions.clear();
    this.recentDeliveries.clear();
    this.deletedAgents.clear();

    logger.info('AgentEventSubscriptionService disposed');
  }
}

// ============================================================================
// Singleton Management
// ============================================================================

const instances: Map<string, AgentEventSubscriptionService> = new Map();

/**
 * Get or create an AgentEventSubscriptionService for a workspace.
 * If eventBus is not provided, it will be obtained from getWorkspaceEventBus.
 */
export function getAgentEventSubscriptionService(
  workspaceId: string,
  eventBus?: WorkspaceEventBus,
): AgentEventSubscriptionService {
  let service = instances.get(workspaceId);
  if (!service) {
    // Get event bus if not provided
    const bus = eventBus || getWorkspaceEventBus(workspaceId);
    service = new AgentEventSubscriptionService(bus, workspaceId);
    instances.set(workspaceId, service);

    // Set up the delivery callback to send events to agents
    // Pass service reference for health monitoring
    service.setDeliveryCallback(createEventDeliveryCallback(workspaceId, service));

    // Restore persisted subscriptions synchronously so that event bus
    // subscriptions are active BEFORE any events can arrive. The async
    // version had a race window where events emitted during restoration
    // would be silently missed by persisted subscriptions.
    service.restoreSubscriptionsSync();

    // Schedule async validation to remove subscriptions for agents that
    // no longer exist in persistence (e.g., deleted while app was closed).
    // The brief window between sync restore and validation is safe because
    // the deletedAgents guard in sendBackendInitiatedMessage catches any
    // delivery attempts to deleted agents during this window.
    service.validateRestoredSubscriptions().catch((err) => {
      logger.warn('Async subscription validation failed', {
        workspaceId,
        error: String(err),
      });
    });
  }
  return service;
}

/**
 * Create a callback that delivers events to an agent by sending a message
 *
 * ROBUSTNESS: This function now includes retry logic and better error handling
 * to address the bug where controllers don't receive completion notifications.
 * Also records delivery health statistics for monitoring.
 */
function createEventDeliveryCallback(
  workspaceId: string,
  service: AgentEventSubscriptionService,
): EventDeliveryCallback {
  // Timeout for delivery attempts — prevents a hung ACP connection from blocking indefinitely.
  // This should be generous enough for the agent to start streaming but short enough
  // that the retry loop gets another chance with a potentially fresh provider.
  const DELIVERY_TIMEOUT_MS = 120_000; // 2 minutes per attempt

  return async (agentId: string, events: WorkspaceEvent[]) => {
    if (events.length === 0) return { status: 'success' };

    const maxRetries = 3;
    const retryDelayMs = 2000; // Slightly longer base delay to give provider cleanup time
    let lastError: Error | null = null;

    // Format events once outside the retry loop (idempotent)
    const { formatEventNotification } = await import('./event-notification-formatter');
    const notification = formatEventNotification(events);

    if (!notification) {
      logger.warn('Event notification formatter returned empty notification', {
        agentId,
        workspaceId,
        eventCount: events.length,
        eventTypes: events.map((e) => e.type),
      });
      return { status: 'failed', error: 'Event notification formatter returned empty notification' };
    }

    const eventTypes = [...new Set(events.map((e) => e.type))];
    const eventsData = events.map((event) => ({
      type: event.type,
      data: event.data,
      timestamp: event.timestamp,
    }));

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Send the notification as a system message to the agent
        const { AgentBackendHandler } =
          await import('../../agent/main/agent-backend-handler.service');
        const backend = AgentBackendHandler.getInstance();

        logger.info('Delivering event notification to agent', {
          agentId,
          workspaceId,
          eventCount: events.length,
          notificationLength: notification.length,
          attempt,
        });

        // RESILIENCE: Wrap sendBackendInitiatedMessage with a timeout so a hung ACP
        // connection doesn't block forever. The health check in sendBackendInitiatedMessage
        // handles dead processes; this timeout catches stuck-but-alive connections.
        const deliveryPromise = backend.sendBackendInitiatedMessage({
          sessionId: agentId,
          message: notification,
          workspaceId,
          messageMetadata: {
            type: 'event_notification',
            eventCount: events.length,
            eventTypes,
            events: eventsData,
          },
        });

        let timeoutTimer: NodeJS.Timeout;
        const timeoutPromise = new Promise<{ success: false; error: string; errorCode?: string }>((resolve) => {
          timeoutTimer = setTimeout(
            () => resolve({ success: false, error: `Delivery timed out after ${DELIVERY_TIMEOUT_MS}ms` }),
            DELIVERY_TIMEOUT_MS,
          );
        });

        const result = await Promise.race([deliveryPromise, timeoutPromise]);

        // Clear the timeout timer to prevent leaking a 2-minute timer on every
        // successful delivery. Without this, each delivery that completes before
        // the timeout still leaves a dangling setTimeout running in the background.
        clearTimeout(timeoutTimer!);

        // Check if the delivery was actually successful
        if (!result.success) {
          const isTimeout = result.error?.startsWith('Delivery timed out');
          if (isTimeout) {
            // CRITICAL FIX: Do NOT retry on timeout. When the timeout fires, it means
            // sendBackendInitiatedMessage was called and the agent likely received the
            // message and started processing it — it just hasn't finished within the
            // timeout window. Retrying would send the SAME notification as a new message,
            // causing the agent to process it multiple times (Bug: duplicate idle notifications).
            // Instead, treat timeout as a "fire and forget" — the message was delivered,
            // but we can't wait for the agent to finish processing it.
            logger.warn('Delivery timeout - status unknown', {
              agentId,
              workspaceId,
              eventCount: events.length,
              attempt,
              timeoutMs: DELIVERY_TIMEOUT_MS,
            });
            // Record as a timeout — the message was sent, but we couldn't confirm completion
            service.recordDeliveryTimeout(agentId, events.length);

            // Emit a distinct timeout event so the UI can handle it differently from failure.
            // Timeout ≠ failure: the message was sent but we couldn't confirm completion.
            // This prevents the wake indicator from persisting permanently.
            try {
              const bus = getWorkspaceEventBus(workspaceId);
              bus.emitEvent(createWorkspaceEvent(
                'agent:event-delivery-timeout',
                workspaceId,
                { type: 'system', id: 'subscription-service', name: 'Subscription Service' },
                {
                  targetAgentId: agentId,
                  eventCount: events.length,
                  eventTypes: events.map((e) => e.type),
                  timeoutMs: DELIVERY_TIMEOUT_MS,
                },
              ));
            } catch {
              // Ignore errors emitting the timeout event
            }
            return {
              status: 'timeout',
              error: result.error || `Delivery timed out after ${DELIVERY_TIMEOUT_MS}ms`,
              timeoutMs: DELIVERY_TIMEOUT_MS,
            };
          }

          // AGENT_DELETED: The agent was deleted — bail immediately without retrying.
          // Retrying would just hit the same guard. Also clean up any remaining
          // subscriptions that triggered this delivery.
          if (result.errorCode === 'AGENT_DELETED') {
            logger.warn('Delivery aborted: agent has been deleted', {
              agentId,
              workspaceId,
              eventCount: events.length,
              attempt,
            });
            service.unsubscribeAll(agentId);
            service.recordDeliveryFailure(agentId, events.length, 'Agent has been deleted');
            return { status: 'failed', error: 'Agent has been deleted' };
          }

          throw new Error(result.error || 'sendBackendInitiatedMessage returned success=false');
        }

        logger.info('Successfully delivered event notification to agent', {
          agentId,
          workspaceId,
          eventCount: events.length,
          attempt,
        });

        // ROBUSTNESS: Record successful delivery for health monitoring
        service.recordDeliverySuccess(agentId, events.length);

        // Emit agent:woken-by-subscription AFTER confirming delivery success.
        // This ensures the UI wake indicator is only shown when the agent actually
        // received and started processing the message (not on mere attempt).
        // Only emit on first successful attempt to avoid duplicate UI banners.
        if (attempt === 1) {
          try {
            const bus = getWorkspaceEventBus(workspaceId);
            bus.emitEvent(createWorkspaceEvent(
              'agent:woken-by-subscription',
              workspaceId,
              { type: 'system', id: 'subscription-service', name: 'Subscription Service' },
              {
                agentId,
                eventCount: events.length,
                eventTypes,
                subscriptionVersion: service.version,
              },
            ));

            logger.info('Emitted agent:woken-by-subscription event (after delivery success)', {
              agentId,
              workspaceId,
              eventCount: events.length,
              eventTypes,
            });
          } catch {
            // Ignore errors emitting the woken event — delivery already succeeded
          }
        }

        // Success - exit the retry loop
        return { status: 'success' };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn('Failed to deliver events to agent', {
          agentId,
          workspaceId,
          eventCount: events.length,
          attempt,
          maxRetries,
          error: lastError.message,
          willRetry: attempt < maxRetries,
        });

        // Wait before retrying (except on last attempt)
        // The health checks in sendBackendInitiatedMessage and handleSendMessage will
        // automatically clean up dead providers, so the next retry can create a fresh one.
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
        }
      }
    }

    // All retries failed - log error with full details
    logger.error('Failed to deliver events to agent after all retries', {
      agentId,
      workspaceId,
      eventCount: events.length,
      eventTypes: events.map((e) => e.type),
      maxRetries,
      error: lastError?.message || 'Unknown error',
    });

    // ROBUSTNESS: Record failed delivery for health monitoring
    service.recordDeliveryFailure(
      agentId,
      events.length,
      lastError?.message || 'Unknown error',
    );

    // CRITICAL: Reset agent status to 'idle' after all delivery attempts fail.
    // Without this, the agent can get stuck in 'responding' state permanently
    // when the delivery timeout fires (Promise.race resolves to the timeout)
    // but the actual stream continues running in the background without cleanup.
    // The stuck 'responding' status prevents future event deliveries to this agent.
    try {
      service.setAgentStatus(agentId, 'idle');
      logger.info('Reset agent status to idle after delivery failure', { agentId });
    } catch {
      // Ignore - best effort cleanup
    }

    // Emit a delivery failure event so the system can potentially recover
    // This allows monitoring and debugging of delivery issues
    try {
      const bus = getWorkspaceEventBus(workspaceId);
      bus.emitEvent(createWorkspaceEvent(
        'agent:event-delivery-failed',
        workspaceId,
        { type: 'system', id: 'subscription-service', name: 'Subscription Service' },
        {
          targetAgentId: agentId,
          eventCount: events.length,
          eventTypes: events.map((e) => e.type),
          error: lastError?.message || 'Unknown error',
        },
      ));
    } catch {
      // Ignore errors emitting the failure event
    }

    return { status: 'failed', error: lastError?.message || 'Unknown error' };
  };
}

/**
 * Dispose of a workspace's subscription service
 */
export function disposeAgentEventSubscriptionService(workspaceId: string): void {
  const service = instances.get(workspaceId);
  if (service) {
    service.dispose();
    instances.delete(workspaceId);
  }
}
