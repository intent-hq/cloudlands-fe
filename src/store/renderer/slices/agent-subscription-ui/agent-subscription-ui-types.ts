/**
 * Types for the agent-subscription-ui Redux slice.
 *
 * These types describe the renderer-side UI state for agent event subscriptions,
 * delegation groups, and woken-up indicators. Safe to import from any process.
 */

export type AgentStatus = 'idle' | 'responding' | 'waiting' | 'completed' | 'failed';

interface DelegationGroupInfo {
  groupId: string;
  awaitMode: 'all';
  expectedAgentIds: string[];
}

export interface Subscription {
  id: string;
  agentId: string;
  eventTypes: string[];
  actorIds: string[];
  createdAt: string;
  description: string;
  delegationGroup?: DelegationGroupInfo;
}

export interface DelegationGroupStatus {
  groupId: string;
  awaitMode: 'all';
  expectedAgentIds: string[];
  completedAgentIds: string[];
  deletedAgentIds: string[];
  agentStatuses: Record<string, AgentStatus>;
  delivered: boolean;
}

export interface WokenUpInfo {
  eventCount: number;
  eventTypes: string[];
  timestamp: number;
}

export type WaitingState = 'idle' | 'waiting' | 'woken' | 'completed';

export interface AgentSubscriptionUIEntry {
  subscriptions: Subscription[];
  delegationGroups: DelegationGroupStatus[];
  agentStatuses: Record<string, AgentStatus>;
  waitingState: WaitingState;
  wokenUpInfo: WokenUpInfo | null;
  /**
   * Utility-footer readiness latch: true once an `agent.getSubscriptions`
   * snapshot read has settled for this (workspace, agent) — success OR
   * failure (a failed read renders the same as empty, so it still counts
   * as ready). Never cleared by `resetSubscriptionUI`; dropped on
   * `markAgentAsViewed` so a switch-back's reveal gate waits for the fresh
   * view-time read instead of clearing on a cached snapshot.
   */
  snapshotFetched: boolean;
}

export interface AgentSubscriptionUIState {
  /** Keyed by composite key `${workspaceId}:${agentId}` */
  entries: Record<string, AgentSubscriptionUIEntry>;
}
