/**
 * Unified Event Bus
 *
 * A cross-workspace pub/sub hub for event subscriptions and broadcasting.
 *
 * ARCHITECTURE NOTE:
 * This is a pure pub/sub hub - it does NOT own any EventStore instances.
 * Persistence is handled exclusively by WorkspaceEventBus (one per workspace).
 * UnifiedEventBus responsibilities:
 * - Cross-workspace event subscriptions
 * - IPC broadcasting to renderer windows
 * - STDIO broadcasting for MCP
 * - Domain event support (terminal, notes, comments, etc.)
 *
 * For event persistence and queries, use WorkspaceEventBus via:
 *   getWorkspaceEventBus(workspaceId)
 *
 * Event Flow:
 * 1. Events are emitted via WorkspaceEventBus.emitEvent() (which persists them)
 * 2. WorkspaceEventBus forwards to UnifiedEventBus.emit() for cross-workspace subscribers
 * 3. UnifiedEventBus broadcasts to renderer windows and notifies subscribers
 */

import { BrowserWindow } from 'electron';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../../shared/logger';
import type { WorkspaceId } from '../../../shared/types';
import { getDeduplicationService } from '../event-deduplication.service';
import { EventFilterEngine } from '../event-filter-engine';
import { getWindowIdsForWorkspace } from '../../system/main/system.ipc';
import type {
  EventFilter,
  EventSubscription,
  SubscribeOptions,
  WorkspaceEvent,
  WorkspaceEventType,
} from '../types';

const logger = new Logger('UnifiedEventBus');

// ============================================================================
// Domain Event Types (from legacy EventBus)
// ============================================================================

/**
 * Domain events that can be emitted (simple broadcast events)
 */
export type DomainEvent =
  // Workspace events
  | 'workspace:created'
  | 'workspace:updated'
  | 'workspace:deleting'
  | 'workspace:deleted'
  | 'workspace:archived'
  | 'workspace:file-changes'

  // Note events
  | 'note:created'
  | 'note:updated'
  | 'note:deleted'
  | 'line-attribution:updated'

  // Comment events
  | 'comment:added'
  | 'comment:updated'
  | 'comment:deleted'
  | 'comment:resolved'
  | 'comment:status-changed'
  | 'comment:updated-batch'

  // Agent events
  | 'agent:session-created'
  | 'agent:session-updated'
  | 'agent:session-completed'

  // Git events
  | 'git:commit-created'
  | 'git:branch-changed'
  | 'git:auth-required'
  | 'github:auth-required'
  | 'git:status-changed'

  // Agent events
  | 'agent:auth-required'
  | 'agent:remote-error'
  | 'agent:plan-required'

  // Terminal events
  | 'terminal:created'
  | 'terminal:data'
  | 'terminal:exit'
  | 'terminal:error'
  | 'terminal:disposed'

  // Professional Terminal events
  | 'terminal:professional:data'
  | 'terminal:professional:exit'
  | 'terminal:professional:command:start'
  | 'terminal:professional:command:executed'
  | 'terminal:professional:command:finished'
  | 'terminal:professional:cwd:changed'

  // Source events
  | 'source:created'
  | 'source:updated'
  | 'source:deleted'

  // Auto-commit events
  | 'git:auto-commit-started'
  | 'git:auto-commit-succeeded'
  | 'git:auto-commit-hook-failure'

  // Background git operations events
  | 'git:op-started'
  | 'git:op-progress'
  | 'git:op-completed'
  | 'git:op-failed'

  // Log events
  | 'log:events-updated';

/**
 * Domain event data payloads
 */
export interface DomainEventPayloads {
  'workspace:created': { workspaceId: WorkspaceId; workspace: any; initialAgent?: any };
  'workspace:updated': { workspaceId: WorkspaceId; changes: any };
  'workspace:deleting': { workspaceId: WorkspaceId };
  'workspace:deleted': { workspaceId: WorkspaceId };
  'workspace:archived': { workspaceId: WorkspaceId };
  'workspace:file-changes': { workspaceId: WorkspaceId; changes?: any; diffChunk?: any };

  'note:created': { workspaceId: WorkspaceId; noteId: string; note: any; actor?: any };
  'note:updated': {
    workspaceId: WorkspaceId;
    noteId: string;
    title?: string;
    changes: any;
    actor?: { type: string; id: string; name: string; turnNumber?: number; messageId?: string };
    sessionId?: string;
  };
  'note:deleted': { workspaceId: WorkspaceId; noteId: string; actor?: any };
  'line-attribution:updated': {
    workspaceId: WorkspaceId;
    noteId: string;
    attributions: Record<
      number,
      {
        timestamp: number;
        author?: { id: string; name: string; type: 'user' | 'agent' | 'system' };
      }
    >;
  };

  'comment:added': { workspaceId: WorkspaceId; noteId: string; comment: any };
  'comment:updated': { workspaceId: WorkspaceId; noteId: string; commentId: string; changes: any };
  'comment:deleted': { workspaceId: WorkspaceId; noteId: string; commentId: string };
  'comment:resolved': { workspaceId: WorkspaceId; noteId: string; commentId: string };
  'comment:status-changed': {
    workspaceId: WorkspaceId;
    noteId: string;
    commentId: string;
    status: string;
  };
  'comment:updated-batch': {
    workspaceId: WorkspaceId;
    noteId: string;
    action?: 'added' | 'updated' | 'resolved' | 'deleted';
    comment?: any;
    comments?: any;
  };

  'agent:session-created': { workspaceId: WorkspaceId; sessionId: string };
  'agent:session-updated': { workspaceId: WorkspaceId; sessionId: string };
  'agent:session-completed': { workspaceId: WorkspaceId; sessionId: string };

  'git:commit-created': {
    workspaceId: WorkspaceId;
    commitSha: string;
    /** If true, handlePostCommit was already called - listener should skip redundant work */
    postCommitHandled?: boolean;
  };
  'git:branch-changed': { workspaceId: WorkspaceId; branch: string };
  'git:auth-required': {
    workspaceId?: WorkspaceId;
    operation: string;
    remote?: string;
    message: string;
    /** The raw error output from git (stderr) for debugging */
    rawError?: string;
    /** The git command that failed */
    command?: string;
    /** The working directory where the command was run */
    cwd?: string;
  };
  'github:auth-required': {
    workspaceId?: WorkspaceId;
    operation?: string;
    message: string;
  };
  'git:status-changed': { workspaceId: WorkspaceId };

  // Agent events
  'agent:auth-required': {
    workspaceId?: WorkspaceId;
    agentId?: string;
    isRemote: boolean;
    host?: string;
    message: string;
  };
  'agent:remote-error': {
    workspaceId?: WorkspaceId;
    agentId?: string;
    errorType: 'connection' | 'authentication' | 'command-not-found' | 'unknown';
    message: string;
    details?: string;
  };
  'agent:plan-required': {
    workspaceId?: WorkspaceId;
    agentId?: string;
    message: string;
    /** Help URL for upgrading plan */
    helpUrl?: string;
  };

  'terminal:created': {
    terminalId: string;
    workspaceId: WorkspaceId;
    title: string;
    cwd: string;
    createdAt: string;
  };
  'terminal:data': { terminalId: string; data: string };
  'terminal:exit': { terminalId: string; code: number | null; signal: string | null };
  'terminal:error': { terminalId: string; error: string };
  'terminal:disposed': { terminalId: string; workspaceId: WorkspaceId };

  // Professional Terminal events
  'terminal:professional:data': { terminalId: string; data: string };
  'terminal:professional:exit': {
    terminalId: string;
    exitCode: number | null;
    signal: string | null;
  };
  'terminal:professional:command:start': { terminalId: string };
  'terminal:professional:command:executed': { terminalId: string; command: string };
  'terminal:professional:command:finished': { terminalId: string };
  'terminal:professional:cwd:changed': { terminalId: string; cwd: string };

  // Source events
  'source:created': { workspaceId: WorkspaceId; sourceId: string; source: any };
  'source:updated': { workspaceId: WorkspaceId; sourceId: string; source: any };
  'source:deleted': { workspaceId: WorkspaceId; sourceId: string };

  'git:auto-commit-started': {
    workspaceId: WorkspaceId;
    agentId: string;
    agentName?: string;
  };
  'git:auto-commit-succeeded': {
    workspaceId: WorkspaceId;
    agentId: string;
    agentName?: string;
    hash: string;
    message: string;
    fileCount: number;
  };

  'git:auto-commit-hook-failure': {
    workspaceId: WorkspaceId;
    agentId: string;
    agentName?: string;
    /** 'waking-agent' = agent is being woken to fix, 'retries-exhausted' = gave up */
    status: 'waking-agent' | 'retries-exhausted';
    /** The pre-commit hook error output */
    hookOutput: string;
    /** Current retry attempt number */
    retryCount: number;
  };

  // Background git operations events
  'git:op-started': {
    operationId: string;
    workspaceId: WorkspaceId;
    operationType: 'commit' | 'push' | 'create-pr' | 'auto-commit';
    metadata?: {
      message?: string;
      prTitle?: string;
      agentId?: string;
      agentName?: string;
    };
  };
  'git:op-progress': {
    operationId: string;
    workspaceId: WorkspaceId;
    operationType: 'commit' | 'push' | 'create-pr' | 'auto-commit';
    step: string;
    metadata?: {
      message?: string;
      prTitle?: string;
    };
  };
  'git:op-completed': {
    operationId: string;
    workspaceId: WorkspaceId;
    operationType: 'commit' | 'push' | 'create-pr' | 'auto-commit';
    result?: {
      commitHash?: string;
      prNumber?: number;
      prUrl?: string;
      noChanges?: boolean;
      reason?: string;
      fileCount?: number;
    };
    metadata?: {
      message?: string;
      prTitle?: string;
      agentId?: string;
      agentName?: string;
    };
  };
  'git:op-failed': {
    operationId: string;
    workspaceId: WorkspaceId;
    operationType: 'commit' | 'push' | 'create-pr' | 'auto-commit';
    error: string;
    metadata?: {
      message?: string;
      prTitle?: string;
      agentId?: string;
      agentName?: string;
    };
  };

  'log:events-updated': { workspaceId: WorkspaceId; events: any };
}

// Global STDIO connection for MCP
let stdioConnection: NodeJS.WriteStream | null = null;

export function setStdioConnection(stream: NodeJS.WriteStream | null) {
  stdioConnection = stream;
}

// Migration flag: Disable renderer broadcast from UnifiedEventBus
// The WorkspaceEventBus now handles renderer broadcasts, so we only need STDIO here
// This fixes the duplicate event bug where both buses were sending to 'events:new'
let disableRendererBroadcast = true;

/**
 * Control whether UnifiedEventBus broadcasts to renderer windows.
 * During migration, this should be disabled since WorkspaceEventBus handles it.
 */
export function setRendererBroadcastEnabled(enabled: boolean): void {
  disableRendererBroadcast = !enabled;
}

/**
 * Event context for scoping events to workspaces
 */
export interface EventContext {
  workspaceId?: string;
  broadcast?: boolean;
  persist?: boolean;
}

/**
 * Unified Event Bus
 *
 * Cross-workspace pub/sub hub for event subscriptions and broadcasting.
 * Does NOT own EventStore instances - persistence is handled by WorkspaceEventBus.
 */
export class UnifiedEventBus extends EventEmitter {
  private static instance: UnifiedEventBus;

  // Core services (no EventStore - that's owned by WorkspaceEventBus)
  private filterEngine: EventFilterEngine;
  private deduplicationService = getDeduplicationService();

  // Subscriptions
  private subscribers: Map<string, EventSubscription> = new Map();

  // Last events cache for replay (WorkspaceEvents)
  private lastEvents: Map<string, WorkspaceEvent> = new Map();

  // Last domain events cache (simple events like terminal, notes, etc.)
  private lastDomainEvents: Map<DomainEvent, any> = new Map();

  // Track recently notified event IDs to prevent double notification
  // This is needed because emitEvent() calls notifySubscribers() and then emit(),
  // and emit() also calls notifySubscribers() for events forwarded from WorkspaceEventBus
  private recentlyNotifiedEvents: Set<string> = new Set();
  private readonly NOTIFICATION_CACHE_SIZE = 1000;

  // Map original domain event listeners to their wrapped versions.
  // onDomainEvent wraps listeners to filter out re-forwarded WorkspaceEvents.
  // This map allows offDomainEvent to find and remove the correct wrapper.
  // Uses WeakMap to avoid memory leaks — when original listener is GC'd, entry is removed.
  private domainListenerWrappers: WeakMap<Function, Function> = new WeakMap();

  private constructor() {
    super();
    this.setMaxListeners(100); // Support many listeners
    this.filterEngine = new EventFilterEngine();
    this.setupBroadcasters();

    logger.info('UnifiedEventBus initialized (pub/sub hub only, no persistence)');
  }

  /**
   * Get singleton instance
   */
  static getInstance(): UnifiedEventBus {
    if (!UnifiedEventBus.instance) {
      UnifiedEventBus.instance = new UnifiedEventBus();
    }
    return UnifiedEventBus.instance;
  }

  // NOTE: EventStore methods removed - persistence is handled by WorkspaceEventBus
  // Use getWorkspaceEventBus(workspaceId) for event persistence and queries

  /**
   * Emit a workspace event (broadcast only, no persistence)
   *
   * NOTE: For events that need persistence, use WorkspaceEventBus.emitEvent() instead.
   * This method is primarily used for:
   * - Events forwarded from WorkspaceEventBus (already persisted)
   * - Global events without a workspaceId (no persistence needed)
   */
  emitEvent(event: WorkspaceEvent, context?: EventContext): void {
    try {
      // Ensure event has required fields
      if (!event.id) event.id = uuidv4();
      if (!event.timestamp) event.timestamp = new Date().toISOString();
      if (context?.workspaceId && !event.workspaceId) {
        event.workspaceId = context.workspaceId;
      }

      // Check for duplicates
      if (this.deduplicationService.isDuplicate(event)) {
        logger.debug('Duplicate event ignored', {
          eventId: event.id,
          eventType: event.type,
        });
        return;
      }

      // NOTE: Persistence removed - handled by WorkspaceEventBus
      // If you need persistence, use getWorkspaceEventBus(workspaceId).emitEvent()

      // Cache last event
      const eventKey = `${event.type}:${event.workspaceId || 'global'}`;
      this.lastEvents.set(eventKey, event);

      // Notify subscribers with matching filters
      this.notifySubscribers(event);

      // Emit to Node.js listeners
      this.emit(event.type, event);
      this.emit('event', event);

      // Broadcast if enabled
      if (context?.broadcast !== false) {
        this.broadcastEvent(event);
      }

      logger.debug('Event emitted (broadcast only)', {
        eventId: event.id,
        eventType: event.type,
        workspaceId: event.workspaceId,
      });
    } catch (error) {
      logger.error('Failed to emit event', { event, error });
    }
  }

  // ============================================================================
  // Domain Event API (for simple broadcast events like terminal, notes, etc.)
  // ============================================================================

  /**
   * Emit a typed domain event (broadcasts to all renderer windows and STDIO)
   * This is a simpler API for events that don't need persistence or deduplication.
   */
  emitDomainEvent<E extends DomainEvent>(event: E, data: DomainEventPayloads[E]): void {
    // Store as last event
    this.lastDomainEvents.set(event, data);

    // Emit to Node.js listeners
    this.emit(event, data);

    // Broadcast to renderer windows
    this.broadcastDomainEvent(event, data);
  }

  /**
   * Get the last domain event of a specific type
   */
  getLastDomainEvent<E extends DomainEvent>(event: E): DomainEventPayloads[E] | undefined {
    return this.lastDomainEvents.get(event) as DomainEventPayloads[E] | undefined;
  }

  /**
   * Listen to a typed domain event
   *
   * IMPORTANT: This wraps the listener to filter out re-forwarded WorkspaceEvent objects.
   * When WorkspaceEventBus.emitEvent() persists and broadcasts a WorkspaceEvent, it also
   * calls unifiedEventBus.emit(event.type, event). Since onDomainEvent is just this.on(),
   * domain event listeners would receive the full WorkspaceEvent object instead of the
   * expected domain event payload. The WorkspaceEvent has a different structure (e.g.,
   * noteId is inside event.data.noteId instead of event.noteId), causing ghost events
   * and data mismatches. This guard prevents that by rejecting objects that look like
   * WorkspaceEvents (have id, type, timestamp, and actor at the top level).
   */
  onDomainEvent<E extends DomainEvent>(
    event: E,
    listener: (data: DomainEventPayloads[E]) => void,
  ): void {
    // Wrap the listener to filter out re-forwarded WorkspaceEvents
    const wrapper = (data: any) => {
      if (this.isWorkspaceEvent(data)) {
        return;
      }
      listener(data);
    };
    // Store mapping so offDomainEvent can find the wrapper to remove
    this.domainListenerWrappers.set(listener, wrapper);
    this.on(event, wrapper);
  }

  /**
   * Listen to a domain event once
   *
   * Implementation: Uses onDomainEvent + self-removal instead of the
   * Node.js `once()` pattern. The previous approach re-registered via
   * `this.once(event, wrapper)` every time a WorkspaceEvent arrived,
   * causing infinite re-registration since WorkspaceEventBus forwards
   * ALL events through UnifiedEventBus.emit().
   */
  onceDomainEvent<E extends DomainEvent>(
    event: E,
    listener: (data: DomainEventPayloads[E]) => void,
  ): void {
    const onceWrapper = (data: DomainEventPayloads[E]) => {
      // Remove ourselves after the first real domain event delivery
      this.offDomainEvent(event, onceWrapper);
      listener(data);
    };
    this.onDomainEvent(event, onceWrapper);
  }

  /**
   * Remove domain event listener
   */
  offDomainEvent<E extends DomainEvent>(
    event: E,
    listener: (data: DomainEventPayloads[E]) => void,
  ): void {
    // Look up the wrapper that was registered in onDomainEvent
    const wrapper = this.domainListenerWrappers.get(listener);
    if (wrapper) {
      this.off(event, wrapper as (...args: any[]) => void);
      this.domainListenerWrappers.delete(listener);
    } else {
      // Fallback: try removing the original listener directly
      this.off(event, listener);
    }
  }

  /**
   * Broadcast a domain event to renderer windows and STDIO.
   * Uses workspace-scoped targeting when the event data contains a workspaceId,
   * so that events are only sent to windows viewing the relevant workspace.
   * Falls back to broadcasting to all windows for events without workspace context.
   */
  private broadcastDomainEvent<E extends DomainEvent>(
    eventName: E,
    data: DomainEventPayloads[E],
  ): void {
    // Ensure data is not undefined before broadcasting
    const safeData = data !== undefined ? data : {};

    // Determine workspace-scoped target windows
    try {
      const workspaceId = (safeData as any)?.workspaceId;
      let targetWindows: BrowserWindow[];

      if (workspaceId) {
        const windowIds = getWindowIdsForWorkspace(workspaceId);
        if (windowIds.length > 0) {
          targetWindows = windowIds
            .map((id) => BrowserWindow.fromId(id))
            .filter((w): w is BrowserWindow => w !== null && !w.isDestroyed());
        } else {
          // No windows found for workspace - fall back to all windows
          targetWindows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
        }
      } else {
        // No workspace context - broadcast to all windows
        targetWindows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
      }

      for (const window of targetWindows) {
        window.webContents.send(eventName, safeData);
      }
    } catch (error) {
      logger.error('Failed to broadcast domain event to renderer windows', {
        eventName,
        error,
      });
    }

    // Broadcast to STDIO connection (if active)
    if (stdioConnection && !stdioConnection.destroyed) {
      try {
        const message = `${JSON.stringify({
          type: 'event',
          event: eventName,
          data: safeData,
        })}\n`;
        stdioConnection.write(message);
      } catch (error) {
        logger.error('Failed to broadcast domain event to STDIO', { eventName, error });
      }
    }
  }

  // ============================================================================
  // WorkspaceEvent Subscription API
  // ============================================================================

  /**
   * Subscribe to events with filters
   */
  subscribe<T extends WorkspaceEvent = WorkspaceEvent>(
    options: SubscribeOptions<T>,
  ): EventSubscription {
    const subscription: EventSubscription = {
      id: uuidv4(),
      filters: options.filters || [],
      callback: options.callback as (event: WorkspaceEvent) => void,
      includeHistorical: options.includeHistorical || false,
    };

    this.subscribers.set(subscription.id, subscription);

    logger.debug('Subscription created', {
      subscriptionId: subscription.id,
      filterCount: subscription.filters.length,
    });

    // Send historical events if requested
    if (options.includeHistorical && options.historicalLimit) {
      this.sendHistoricalEvents(subscription, options.historicalLimit);
    }

    return subscription;
  }

  /**
   * Unsubscribe from events
   */
  unsubscribe(subscriptionId: string): void {
    if (this.subscribers.delete(subscriptionId)) {
      logger.debug('Subscription removed', { subscriptionId });
    }
  }

  /**
   * Query events with filters
   *
   * NOTE: This delegates to WorkspaceEventBus which owns the EventStore.
   * Consider using getWorkspaceEventBus(workspaceId).queryEvents() directly.
   */
  async query(
    workspaceId: string,
    filters: EventFilter[],
    limit?: number,
  ): Promise<WorkspaceEvent[]> {
    // Lazy import to avoid circular dependency
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getWorkspaceEventBus } = require('./workspace-event-bus');
    const workspaceBus = getWorkspaceEventBus(workspaceId);
    const events = await workspaceBus.queryEvents(filters);
    return limit ? events.slice(0, limit) : events;
  }

  /**
   * Get the last event of a specific type
   */
  getLastEvent(type: WorkspaceEventType, workspaceId?: string): WorkspaceEvent | undefined {
    const eventKey = `${type}:${workspaceId || 'global'}`;
    return this.lastEvents.get(eventKey);
  }

  /**
   * Notify subscribers of an event
   * Uses deduplication to prevent double notification when events flow through
   * both emitEvent() and emit() paths
   */
  private notifySubscribers(event: WorkspaceEvent): void {
    // Check if we've already notified for this event
    if (this.recentlyNotifiedEvents.has(event.id)) {
      return;
    }

    // Mark as notified
    this.recentlyNotifiedEvents.add(event.id);

    // Prune cache if it gets too large
    if (this.recentlyNotifiedEvents.size > this.NOTIFICATION_CACHE_SIZE) {
      const toDelete = Array.from(this.recentlyNotifiedEvents).slice(
        0,
        this.NOTIFICATION_CACHE_SIZE / 2,
      );
      for (const id of toDelete) {
        this.recentlyNotifiedEvents.delete(id);
      }
    }

    for (const subscription of this.subscribers.values()) {
      try {
        // Check if event matches filters
        if (this.filterEngine.matches(event, subscription.filters)) {
          subscription.callback(event);
        }
      } catch (error) {
        logger.error('Subscriber callback error', {
          subscriptionId: subscription.id,
          error,
        });
      }
    }
  }

  /**
   * Send historical events to a new subscriber
   */
  private async sendHistoricalEvents(
    subscription: EventSubscription,
    limit: number,
  ): Promise<void> {
    // This would need workspace context to work properly
    // For now, just send cached last events
    const historicalEvents = Array.from(this.lastEvents.values())
      .filter((event) => this.filterEngine.matches(event, subscription.filters))
      .slice(-limit);

    for (const event of historicalEvents) {
      try {
        subscription.callback(event);
      } catch (error) {
        logger.error('Failed to send historical event', {
          subscriptionId: subscription.id,
          error,
        });
      }
    }
  }

  /**
   * Setup automatic broadcasting to renderer windows and STDIO
   */
  private setupBroadcasters(): void {
    // Override emit to add broadcasting and subscriber notification
    const originalEmit = this.emit.bind(this);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.emit = (event: string | symbol, ...args: any[]): boolean => {
      // Call original emit
      const result = originalEmit(event, ...args);

      // Don't broadcast internal events
      if (event === 'removeListener' || event === 'newListener') {
        return result;
      }

      // Broadcast to renderer windows and STDIO
      const eventData = args[0];
      if (eventData && typeof eventData === 'object') {
        this.broadcastEvent(eventData);

        // Also notify subscribers (for events forwarded from WorkspaceEventBus)
        // This ensures EventHandlerRegistry receives events emitted via WorkspaceEventBus
        if (this.isWorkspaceEvent(eventData)) {
          this.notifySubscribers(eventData);
        }
      }

      return result;
    };
  }

  /**
   * Type guard to check if an object is a WorkspaceEvent
   */
  private isWorkspaceEvent(data: unknown): data is WorkspaceEvent {
    return (
      typeof data === 'object' &&
      data !== null &&
      'id' in data &&
      'type' in data &&
      'timestamp' in data &&
      'actor' in data
    );
  }

  /**
   * Broadcast event to all renderer windows and STDIO
   *
   * MIGRATION NOTE: Renderer broadcasting is now disabled by default.
   * WorkspaceEventBus handles renderer broadcasts to prevent duplicate events.
   * UnifiedEventBus continues to handle STDIO broadcasting for MCP clients.
   */
  private broadcastEvent(event: any): void {
    const eventName = event.type || 'unknown';

    // Broadcast to renderer windows (disabled during migration)
    // WorkspaceEventBus now handles renderer broadcasting to prevent duplicates
    if (!disableRendererBroadcast) {
      try {
        const windows = BrowserWindow.getAllWindows();
        windows.forEach((window) => {
          if (!window.isDestroyed()) {
            // Send on specific event type channel for backwards compatibility
            window.webContents.send(eventName, event);
            // Also send on 'events:new' channel which the ActivityTimeline listens to
            if (event.workspaceId) {
              window.webContents.send('events:new', {
                workspaceId: event.workspaceId,
                event,
              });
            }
          }
        });
      } catch (error) {
        logger.error('Failed to broadcast to renderer windows', { error });
      }
    }

    // Broadcast to STDIO if connected (always enabled for MCP clients)
    if (stdioConnection && !stdioConnection.destroyed) {
      try {
        stdioConnection.write(`${JSON.stringify({ event: eventName, data: event })}\n`);
      } catch (error) {
        logger.error('Failed to broadcast to STDIO', { error });
      }
    }
  }

  /**
   * Clean up resources for a workspace
   *
   * NOTE: EventStore cleanup is handled by WorkspaceEventBus.dispose()
   */
  async cleanupWorkspace(workspaceId: string): Promise<void> {
    // Remove cached events for this workspace
    for (const [key, event] of this.lastEvents.entries()) {
      if (event.workspaceId === workspaceId) {
        this.lastEvents.delete(key);
      }
    }

    logger.info('Workspace cleaned up from UnifiedEventBus cache', { workspaceId });
  }

  /**
   * Get statistics
   */
  getStatistics(): {
    subscriberCount: number;
    cachedEventCount: number;
  } {
    return {
      subscriberCount: this.subscribers.size,
      cachedEventCount: this.lastEvents.size,
    };
  }

  /**
   * Get count of listeners for debugging
   */
  getListenerCount(event?: DomainEvent): number {
    if (event) {
      return this.listenerCount(event);
    }
    return this.eventNames().reduce((count, name) => count + this.listenerCount(name), 0);
  }

  /**
   * Get all event names for debugging
   */
  getEventNames(): (string | symbol)[] {
    return this.eventNames();
  }

  /**
   * Clear all listeners (for testing)
   */
  clearAllListeners(): void {
    this.removeAllListeners();
    this.lastDomainEvents.clear();
  }
}

// Export singleton instance
export const unifiedEventBus = UnifiedEventBus.getInstance();

// Backward-compatible alias for old EventBus usage
export const eventBus = unifiedEventBus;
export { UnifiedEventBus as EventBus };
