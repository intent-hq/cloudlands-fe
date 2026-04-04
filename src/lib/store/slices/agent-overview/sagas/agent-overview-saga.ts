/**
 * Agent Overview Saga
 *
 * Currently a no-op because the agent overview store is purely
 * data-driven from component dispatches (processWorkspaceEvents,
 * updateAgents, addRealtimeEvent). There are no side effects
 * (no IPC, localStorage, or API calls) to handle in a saga.
 *
 * The component (AgentOverviewPanel.svelte) handles:
 * - Loading historical events via queryEvents()
 * - Subscribing to real-time events via onEventCreated()
 * - Subscribing to agent sessions via useAllAgentsSubscription()
 *
 * If any of those are migrated to sagas in the future, they would go here.
 */

import type { SagaGenerator } from "typed-redux-saga";

 
export function* agentOverviewSaga(): SagaGenerator<void> {
  // No side effects needed — all data comes from component dispatches
}

