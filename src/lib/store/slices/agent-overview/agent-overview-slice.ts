/**
 * Agent Overview Slice
 *
 * Actions and reducer for the agent overview visualization state.
 * Manages per-workspace interaction events and time scrubbing.
 * Agent sessions are derived from the canonical agent-session slice via selectors.
 */

import { createAction } from "svelte-redux-toolkit/utils/store/create-action";
import { createReducer } from "svelte-redux-toolkit/utils/store/create-reducer";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import type { AgentOverviewState, AgentOverviewWorkspaceState } from "./agent-overview-types";
import type { InteractionEvent } from "$lib/components/agent-overview/types";

// ============================================================================
// Empty workspace state
// ============================================================================

const emptyWorkspaceState: AgentOverviewWorkspaceState = {
  events: [],
  currentTime: "",
  isLive: true,
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceState);

// ============================================================================
// Initial state
// ============================================================================

export const initialState: AgentOverviewState = {
  byWorkspaceId: {},
};

// ============================================================================
// Actions
// ============================================================================

/** Process workspace events into interaction events for a workspace */
export const processWorkspaceEvents = createAction(
  "agentOverview/processWorkspaceEvents",
  (workspaceId: string, events: InteractionEvent[]) => ({ workspaceId, events }),
);

/** Add a single real-time interaction event */
export const addRealtimeEvent = createAction(
  "agentOverview/addRealtimeEvent",
  (workspaceId: string, event: InteractionEvent) => ({ workspaceId, event, now: new Date().toISOString() }),
);

/** Clear workspace state on unmount */
export const clearAgentOverview = createAction<[workspaceId: string]>(
  "agentOverview/clear",
);

// ============================================================================
// Reducer
// ============================================================================

export const agentOverviewReducer = createReducer<AgentOverviewState>(initialState)
  .with(processWorkspaceEvents, (state, { payload }) => {
    const { workspaceId, events } = payload;
    const ws = getWorkspaceState(state, workspaceId);
    // Sort events by timestamp
    const sorted = [...events].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    return setWorkspaceState(state, workspaceId, { ...ws, events: sorted });
  })
  .with(addRealtimeEvent, (state, { payload }) => {
    const { workspaceId, event, now } = payload;
    const ws = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      events: [...ws.events, event],
      currentTime: ws.isLive ? now : ws.currentTime,
    });
  })
  .with(clearAgentOverview, (state, { payload: [workspaceId] }) => {
    return clearWorkspaceState(state, workspaceId);
  });

