import type { WorkspaceEvent } from '../types';
import type {
  DeliveryStats,
  WorkspaceSubscriptionState,
} from '../../../store/main/slices/agent-subscriptions/types';
import {
  getDelegationGroupCompletionSummary,
} from '../../../store/main/slices/agent-subscriptions/agent-subscriptions-selectors';

const DEFAULT_STALE_RESPONDING_AFTER_MS = 10 * 60 * 1000;
const RECENT_EVENT_LIMIT = 10;

export interface AgentDiagnosticsInputAgent {
  id: string;
  name?: string;
  status?: string;
  presentInBackend?: boolean;
  metadata?: { taskNoteId?: string } & Record<string, unknown>;
  messageCount?: number;
  messages?: unknown[];
  createdAt?: string | Date;
  updatedAt?: string | Date;
  lastActivity?: string | Date;
}

export interface AgentDiagnosticsOptions {
  agentId?: string;
  taskNoteId?: string;
  staleRespondingAfterMs?: number;
  now?: Date;
}

export interface AgentDiagnosticsSnapshot {
  workspaceId: string;
  generatedAt: string;
  filters: { agentId?: string; taskNoteId?: string };
  summary: {
    agents: number;
    subscriptions: number;
    queuedAgents: number;
    queuedEvents: number;
    delegationGroups: number;
    deletedAgents: number;
    stuckRisks: number;
  };
  agents: Array<{
    id: string;
    name?: string;
    status: string;
    sessionStatus?: string;
    taskNoteId?: string;
    messageCount?: number;
    subscriptionCount: number;
    queuedEventCount: number;
    oldestQueuedAt?: string;
    oldestQueuedAgeMs?: number;
    staleResponding: boolean;
    deleted: boolean;
    presentInBackend: boolean;
    pendingInitialResponse: boolean;
    createdAt?: string;
    lastActivity?: string;
  }>;
  subscriptions: Array<{
    id: string;
    agentId: string;
    agentName: string;
    createdAt: string;
    eventTypes: string[];
    actorIds: string[];
    priority: string;
    oneShot: boolean;
    delegationGroupId?: string;
    orphaned: boolean;
  }>;
  queues: Array<{
    agentId: string;
    eventCount: number;
    oldestQueuedAt?: string;
    oldestQueuedAgeMs?: number;
    priorities: Record<string, number>;
    subscriptionIds: string[];
  }>;
  delegationGroups: Array<{
    groupId: string;
    parentAgentId: string;
    awaitMode: string;
    expectedAgentIds: string[];
    completedAgentIds: string[];
    deletedAgentIds: string[];
    pendingAgentIds: string[];
    subscriptionId: string;
    subscriptionMissing: boolean;
    delivered: boolean;
    complete: boolean;
    eventCount: number;
  }>;
  deliveryStats: DeliveryStats;
  deletedAgentReferences: Array<{
    kind: string;
    agentId: string;
    subscriptionId?: string;
    groupId?: string;
    deletedAt?: string;
  }>;
  recentEvents: Array<{
    id?: string;
    type: string;
    timestamp?: string;
    actorType?: string;
    actorId?: string;
    source: string;
    agentId?: string;
    groupId?: string;
    subscriptionId?: string;
  }>;
  stuckRisks: Array<{
    type: string;
    severity: 'info' | 'warning' | 'critical';
    message: string;
    agentId?: string;
    subscriptionId?: string;
    groupId?: string;
    ageMs?: number;
    count?: number;
  }>;
}

function toIsoString(value: string | Date | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function ageMs(nowMs: number, timestamp: string | undefined): number | undefined {
  if (!timestamp) return undefined;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, nowMs - parsed);
}

function oldestQueuedAt(queue: WorkspaceSubscriptionState['agentQueues'][string]): string | undefined {
  return queue
    .map((item) => item.queuedAt)
    .filter(Boolean)
    .sort()[0];
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function hasAssistantMessage(messages: unknown[] | undefined): boolean {
  return Array.isArray(messages) && messages.some((message) => (message as any)?.role === 'assistant');
}

function getMessageCount(agent: AgentDiagnosticsInputAgent | undefined): number | undefined {
  if (!agent) return undefined;
  return Array.isArray(agent.messages)
    ? agent.messages.length
    : agent.messageCount ?? (agent.metadata?.messageCount as number | undefined);
}

function eventSummary(
  event: WorkspaceEvent,
  source: string,
  extra: { agentId?: string; groupId?: string; subscriptionId?: string },
): AgentDiagnosticsSnapshot['recentEvents'][number] {
  return {
    id: event.id,
    type: event.type,
    timestamp: event.timestamp,
    actorType: event.actor?.type,
    actorId: event.actor?.id,
    source,
    ...extra,
  };
}

export function buildAgentDiagnosticsSnapshot(
  workspaceId: string,
  workspaceState: WorkspaceSubscriptionState,
  agents: AgentDiagnosticsInputAgent[],
  options: AgentDiagnosticsOptions = {},
): AgentDiagnosticsSnapshot {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const staleAfterMs = options.staleRespondingAfterMs ?? DEFAULT_STALE_RESPONDING_AFTER_MS;
  const knownAgents = new Map(agents.map((agent) => [agent.id, agent]));
  const matchingAgentIds = new Set<string>();

  for (const agent of agents) {
    if (options.agentId && agent.id !== options.agentId) continue;
    if (options.taskNoteId && agent.metadata?.taskNoteId !== options.taskNoteId) continue;
    matchingAgentIds.add(agent.id);
  }
  if (options.agentId) matchingAgentIds.add(options.agentId);
  const hasFilter = Boolean(options.agentId || options.taskNoteId);
  const inScope = (agentId: string) => !hasFilter || matchingAgentIds.has(agentId);
  const intersectsScope = (ids: string[]) => !hasFilter || ids.some((id) => matchingAgentIds.has(id));

  const allAgentIds = new Set<string>();
  for (const agent of agents) allAgentIds.add(agent.id);
  for (const agentId of Object.keys(workspaceState.agentStatuses)) allAgentIds.add(agentId);
  for (const agentId of Object.keys(workspaceState.agentQueues)) allAgentIds.add(agentId);
  for (const agentId of Object.keys(workspaceState.deletedAgents)) allAgentIds.add(agentId);
  for (const sub of Object.values(workspaceState.subscriptions)) {
    allAgentIds.add(sub.agentId);
    for (const actorId of sub.filter.actorIds ?? []) allAgentIds.add(actorId);
  }
  for (const group of Object.values(workspaceState.delegationGroups)) {
    allAgentIds.add(group.parentAgentId);
    for (const id of group.expectedAgentIds) allAgentIds.add(id);
    for (const id of group.completedAgentIds) allAgentIds.add(id);
    for (const id of group.deletedAgentIds) allAgentIds.add(id);
  }

  const subscriptions = Object.values(workspaceState.subscriptions)
    .filter((sub) => inScope(sub.agentId) || intersectsScope(sub.filter.actorIds ?? []))
    .map((sub) => ({
      id: sub.id,
      agentId: sub.agentId,
      agentName: sub.agentName,
      createdAt: sub.createdAt,
      eventTypes: sub.filter.eventTypes ?? [],
      actorIds: sub.filter.actorIds ?? [],
      priority: sub.filter.priority ?? 'normal',
      oneShot: sub.filter.oneShot === true,
      delegationGroupId: sub.filter.delegationGroup?.groupId,
      orphaned: !knownAgents.has(sub.agentId) || sub.agentId in workspaceState.deletedAgents,
    }));

  const queues = Object.entries(workspaceState.agentQueues)
    .filter(([agentId, queue]) => inScope(agentId) && queue.length > 0)
    .map(([agentId, queue]) => {
      const oldest = oldestQueuedAt(queue);
      return {
        agentId,
        eventCount: queue.length,
        oldestQueuedAt: oldest,
        oldestQueuedAgeMs: ageMs(nowMs, oldest),
        priorities: countBy(queue.map((item) => item.priority)),
        subscriptionIds: [...new Set(queue.map((item) => item.subscriptionId).filter(Boolean) as string[])],
      };
    });

  const delegationGroups = Object.values(workspaceState.delegationGroups)
    .filter((group) =>
      intersectsScope([
        group.parentAgentId,
        ...group.expectedAgentIds,
        ...group.completedAgentIds,
        ...group.deletedAgentIds,
      ]),
    )
    .map((group) => {
      const expectedIds = new Set(group.expectedAgentIds);
      const doneExpectedIds = new Set(
        [...group.completedAgentIds, ...group.deletedAgentIds].filter((id) => expectedIds.has(id)),
      );
      const pendingAgentIds = [...expectedIds].filter((id) => !doneExpectedIds.has(id));
      const completionSummary = getDelegationGroupCompletionSummary(group);
      return {
        groupId: group.groupId,
        parentAgentId: group.parentAgentId,
        awaitMode: group.awaitMode,
        expectedAgentIds: group.expectedAgentIds,
        completedAgentIds: group.completedAgentIds,
        deletedAgentIds: group.deletedAgentIds,
        pendingAgentIds,
        subscriptionId: group.subscriptionId,
        subscriptionMissing: !(group.subscriptionId in workspaceState.subscriptions),
        delivered: group.delivered,
        complete: completionSummary.isComplete,
        eventCount: group.events.length,
      };
    });

  const agentRows = [...allAgentIds]
    .filter(inScope)
    .map((agentId) => {
      const agent = knownAgents.get(agentId);
      const queue = workspaceState.agentQueues[agentId] ?? [];
      const oldest = oldestQueuedAt(queue);
      const lastActivity = toIsoString(agent?.lastActivity ?? agent?.updatedAt);
      const status = workspaceState.agentStatuses[agentId] ?? agent?.status ?? 'unknown';
      const lastActivityAgeMs = ageMs(nowMs, lastActivity);
      const messageCount = getMessageCount(agent);
      const presentInBackend = agent?.presentInBackend ?? Boolean(agent);
      return {
        id: agentId,
        name: agent?.name,
        status,
        sessionStatus: agent?.status,
        taskNoteId: agent?.metadata?.taskNoteId,
        messageCount,
        subscriptionCount: subscriptions.filter((sub) => sub.agentId === agentId).length,
        queuedEventCount: queue.length,
        oldestQueuedAt: oldest,
        oldestQueuedAgeMs: ageMs(nowMs, oldest),
        staleResponding:
          status === 'responding' && (!agent || lastActivityAgeMs === undefined || lastActivityAgeMs > staleAfterMs),
        deleted: agentId in workspaceState.deletedAgents,
        presentInBackend,
        pendingInitialResponse:
          Boolean(agent) &&
          String(status).toLowerCase() === 'idle' &&
          messageCount === 1 &&
          !hasAssistantMessage(agent?.messages),
        createdAt: toIsoString(agent?.createdAt),
        lastActivity,
      };
    });

  const deletedAgentReferences: AgentDiagnosticsSnapshot['deletedAgentReferences'] = [];
  const addDeletedRef = (
    kind: string,
    agentId: string,
    extra: { subscriptionId?: string; groupId?: string } = {},
  ) => {
    if (!(agentId in workspaceState.deletedAgents)) return;
    deletedAgentReferences.push({
      kind,
      agentId,
      deletedAt: new Date(workspaceState.deletedAgents[agentId]).toISOString(),
      ...extra,
    });
  };
  for (const sub of subscriptions) {
    addDeletedRef('subscription-owner', sub.agentId, { subscriptionId: sub.id });
    for (const actorId of sub.actorIds) addDeletedRef('subscription-actor', actorId, { subscriptionId: sub.id });
  }
  for (const queue of queues) addDeletedRef('queue-owner', queue.agentId);
  for (const group of delegationGroups) {
    addDeletedRef('delegation-parent', group.parentAgentId, { groupId: group.groupId });
    for (const id of group.expectedAgentIds) addDeletedRef('delegation-expected', id, { groupId: group.groupId });
  }

  const recentEvents = [
    ...Object.entries(workspaceState.agentQueues).flatMap(([agentId, queue]) =>
      inScope(agentId)
        ? queue.map((item) =>
            eventSummary(item.event, 'queue', { agentId, subscriptionId: item.subscriptionId }),
          )
        : [],
    ),
    ...Object.values(workspaceState.delegationGroups).flatMap((group) =>
      delegationGroups.some((candidate) => candidate.groupId === group.groupId)
        ? group.events.map((event) => eventSummary(event, 'delegation-group', { groupId: group.groupId }))
        : [],
    ),
  ]
    .sort((a, b) => Date.parse(b.timestamp ?? '') - Date.parse(a.timestamp ?? ''))
    .slice(0, RECENT_EVENT_LIMIT);

  const incompleteOrUndeliveredGroups = delegationGroups.filter((group) => !group.complete || !group.delivered);
  const hasActiveDeliveryState = queues.length > 0 || incompleteOrUndeliveredGroups.length > 0;
  const lastFailureAgeMs = ageMs(nowMs, workspaceState.deliveryStats.lastFailureTime ?? undefined);
  const hasRecentDeliveryFailure = lastFailureAgeMs !== undefined && lastFailureAgeMs <= staleAfterMs;
  const shouldSurfaceDeliveryHealthRisk = hasActiveDeliveryState || hasRecentDeliveryFailure;

  const stuckRisks: AgentDiagnosticsSnapshot['stuckRisks'] = [];
  for (const queue of queues) {
    stuckRisks.push({
      type: 'queued-events',
      severity: queue.oldestQueuedAgeMs && queue.oldestQueuedAgeMs > staleAfterMs ? 'warning' : 'info',
      message: `${queue.eventCount} event(s) queued for ${queue.agentId}`,
      agentId: queue.agentId,
      ageMs: queue.oldestQueuedAgeMs,
      count: queue.eventCount,
    });
  }
  for (const agent of agentRows) {
    if (agent.staleResponding) {
      stuckRisks.push({
        type: 'stale-responding-status',
        severity: 'warning',
        message: `Agent ${agent.id} is marked responding without recent activity`,
        agentId: agent.id,
      });
    }
    if (agent.pendingInitialResponse) {
      const pendingInitialResponseAgeMs = ageMs(nowMs, agent.lastActivity);
      stuckRisks.push({
        type: 'initial-prompt-not-running',
        severity:
          pendingInitialResponseAgeMs !== undefined && pendingInitialResponseAgeMs <= staleAfterMs
            ? 'info'
            : 'warning',
        message: agent.presentInBackend
          ? `Agent ${agent.id} has an initial user message but no assistant response`
          : `Agent ${agent.id} has an initial user message but no active backend session or assistant response`,
        agentId: agent.id,
        ageMs: pendingInitialResponseAgeMs,
      });
    }
  }
  for (const sub of subscriptions) {
    if (sub.orphaned) {
      stuckRisks.push({
        type: 'orphaned-subscription',
        severity: 'warning',
        message: `Subscription ${sub.id} targets missing or deleted owner ${sub.agentId}`,
        agentId: sub.agentId,
        subscriptionId: sub.id,
      });
    }
  }
  for (const group of delegationGroups) {
    if (!group.complete && !group.delivered) {
      stuckRisks.push({
        type: 'incomplete-delegation-group',
        severity: group.subscriptionMissing ? 'critical' : 'warning',
        message: `Delegation group ${group.groupId} is waiting for ${group.pendingAgentIds.length} agent(s)`,
        groupId: group.groupId,
        count: group.pendingAgentIds.length,
      });
    }
  }
  if (workspaceState.deliveryStats.failedDeliveries > 0 && shouldSurfaceDeliveryHealthRisk) {
    stuckRisks.push({
      type: 'delivery-failures',
      severity: 'warning',
      message: `${workspaceState.deliveryStats.failedDeliveries} delivery failure(s) recorded`,
      count: workspaceState.deliveryStats.failedDeliveries,
      ageMs: lastFailureAgeMs,
    });
  }
  if (workspaceState.deliveryStats.timeoutDeliveries > 0 && shouldSurfaceDeliveryHealthRisk) {
    stuckRisks.push({
      type: 'delivery-timeouts',
      severity: 'warning',
      message: `${workspaceState.deliveryStats.timeoutDeliveries} delivery timeout(s) recorded`,
      count: workspaceState.deliveryStats.timeoutDeliveries,
      ageMs: lastFailureAgeMs,
    });
  }
  for (const ref of deletedAgentReferences) {
    stuckRisks.push({
      type: 'deleted-agent-reference',
      severity: 'warning',
      message: `${ref.kind} references deleted agent ${ref.agentId}`,
      agentId: ref.agentId,
      subscriptionId: ref.subscriptionId,
      groupId: ref.groupId,
    });
  }

  return {
    workspaceId,
    generatedAt: now.toISOString(),
    filters: { agentId: options.agentId, taskNoteId: options.taskNoteId },
    summary: {
      agents: agentRows.length,
      subscriptions: subscriptions.length,
      queuedAgents: queues.length,
      queuedEvents: queues.reduce((total, queue) => total + queue.eventCount, 0),
      delegationGroups: delegationGroups.length,
      deletedAgents: Object.keys(workspaceState.deletedAgents).filter(inScope).length,
      stuckRisks: stuckRisks.length,
    },
    agents: agentRows,
    subscriptions,
    queues,
    delegationGroups,
    deliveryStats: workspaceState.deliveryStats,
    deletedAgentReferences,
    recentEvents,
    stuckRisks,
  };
}