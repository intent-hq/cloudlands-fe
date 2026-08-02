/**
 * Serializable types for the agent-subscriptions Redux slice.
 *
 * All types are JSON-safe — no Map, Set, Date, RegExp, or functions.
 * DataMatcher RegExp values are stored as { pattern: string; flags: string }.
 */

import type { WorkspaceEvent } from "../../../../features/events/types";

export type AgentStatus = "idle" | "responding" | "waiting" | "completed" | "failed";

/** Serializable version of DataMatcher — RegExp stored as { pattern, flags } */
export interface SerializableDataMatcher {
  field: string;
  operator: "equals" | "contains" | "starts_with" | "ends_with" | "matches";
  value: string | number | boolean | { pattern: string; flags: string };
}

/** Delegation group configuration */
export interface DelegationGroup {
  groupId: string;
  awaitMode: "any" | "all";
  expectedAgentIds: string[];
}

/** Filter configuration for agent event subscriptions */
export interface AgentEventFilter {
  eventTypes?: string[];
  actorTypes?: ("user" | "agent" | "system" | "external" | "tool")[];
  actorIds?: string[];
  excludeActorIds?: string[];
  dataMatchers?: SerializableDataMatcher[];
  since?: string;
  batchWindow?: number;
  batchMaxEvents?: number;
  priority?: "high" | "normal" | "low";
  delegationGroup?: DelegationGroup;
}

/** Serializable agent subscription */
export interface AgentSubscriptionRecord {
  id: string;
  agentId: string;
  agentName: string;
  workspaceId: string;
  filter: AgentEventFilter;
  createdAt: string;
}

/** Serializable queued event */
export interface QueuedEventRecord {
  event: WorkspaceEvent;
  queuedAt: string;
  priority: "high" | "normal" | "low";
  subscriptionId?: string;
}

/** Serializable delegation group tracker */
export interface DelegationGroupTrackerRecord {
  groupId: string;
  parentAgentId: string;
  parentAgentName: string;
  awaitMode: "any" | "all";
  expectedAgentIds: string[];
  completedAgentIds: string[];
  deletedAgentIds: string[];
  events: WorkspaceEvent[];
  subscriptionId: string;
  delivered: boolean;
}

/** Delivery health statistics */
export interface DeliveryStats {
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  timeoutDeliveries: number;
  droppedEvents: number;
  lastDeliveryTime: string | null;
  lastFailureTime: string | null;
}

/** Per-workspace subscription state */
export interface WorkspaceSubscriptionState {
  /** Subscription registry: subscriptionId → subscription */
  subscriptions: Record<string, AgentSubscriptionRecord>;
  /** Event queues per agent: agentId → queued events */
  agentQueues: Record<string, QueuedEventRecord[]>;
  /** Agent statuses: agentId → status */
  agentStatuses: Record<string, AgentStatus>;
  /** Delegation group trackers: groupId → tracker */
  delegationGroups: Record<string, DelegationGroupTrackerRecord>;
  /** Delivery health statistics */
  deliveryStats: DeliveryStats;
  /** Recently deleted agents: agentId → deletedAt timestamp (ms) */
  deletedAgents: Record<string, number>;
}

/** Root state shape for the agent-subscriptions slice */
export interface AgentSubscriptionsState {
  byWorkspaceId: Record<string, WorkspaceSubscriptionState>;
}

export const emptyDeliveryStats: DeliveryStats = {
  totalDeliveries: 0,
  successfulDeliveries: 0,
  failedDeliveries: 0,
  timeoutDeliveries: 0,
  droppedEvents: 0,
  lastDeliveryTime: null,
  lastFailureTime: null,
};

/** Empty workspace state used as default by createWorkspaceScopedHelpers */
export const emptyWorkspaceSubscriptionState: WorkspaceSubscriptionState = {
  subscriptions: {},
  agentQueues: {},
  agentStatuses: {},
  delegationGroups: {},
  deliveryStats: { ...emptyDeliveryStats },
  deletedAgents: {},
};

export const initialState: AgentSubscriptionsState = {
  byWorkspaceId: {},
};

