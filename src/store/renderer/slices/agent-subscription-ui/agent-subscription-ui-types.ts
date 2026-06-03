/**
 * Types for the agent-subscription-ui Redux slice.
 *
 * These types describe the renderer-side UI state for agent event subscriptions,
 * delegation groups, and woken-up indicators. Safe to import from any process.
 */

export type AgentStatus = 'idle' | 'responding' | 'waiting' | 'completed' | 'failed';

export interface DelegationGroupInfo {
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
}

export interface AgentSubscriptionUIState {
  /** Keyed by composite key `${workspaceId}:${agentId}` */
  entries: Record<string, AgentSubscriptionUIEntry>;
}
