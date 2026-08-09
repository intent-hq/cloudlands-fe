/**
 * Workspace Event System
 *
 * Pure utilities and Redux-based event infrastructure.
 * EventBus singletons removed during Redux migration (Wave 6).
 */

export { EventFilterEngine, EventFilterBuilder } from '../event-filter-engine';
export {
  agentSubscribe,
  agentSubscribeToGroup,
  agentUnsubscribe,
  agentUnsubscribeAll,
  updateAgentStatus,
  markAgentAsDeleted,
  type AgentEventFilter,
  type AgentSubscriptionRecord as AgentSubscription,
} from './agent-subscription-ops';
export type { AgentStatus as AgentEventStatus } from '../../../store/main/slices/agent-subscriptions/types';

export * from '../types';

// Re-export commonly used types for convenience
export type {
  WorkspaceEvent,
  WorkspaceEventType,
  EventActor,
  ActorType,
  EventFilter,
  FilterOperator,
  EventSubscription,
  SubscribeOptions,
  FileChangedEvent,
  AgentToolCallEvent,
  AgentMessageEvent,
  GitOperationEvent,
  NoteChangedEvent,
} from '../types';
