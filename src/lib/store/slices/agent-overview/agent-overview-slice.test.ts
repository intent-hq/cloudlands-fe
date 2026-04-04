import { describe, expect, it } from "vitest";
import type { InteractionEvent } from "$lib/components/agent-overview/types";
import {
  agentOverviewReducer,
  initialState,
  processWorkspaceEvents,
  addRealtimeEvent,
  clearAgentOverview,
} from "./agent-overview-slice";

const WS = "ws-test";

describe("agentOverviewReducer", () => {
  it("returns the initial state", () => {
    expect(agentOverviewReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("stores and sorts events via processWorkspaceEvents", () => {
    const events: InteractionEvent[] = [
      { type: "file-write", timestamp: "2026-03-20T13:00:00.000Z", agentId: "a1" },
      { type: "file-read", timestamp: "2026-03-20T12:00:00.000Z", agentId: "a1" },
    ];

    const state = agentOverviewReducer(initialState, processWorkspaceEvents(WS, events));
    const ws = state.byWorkspaceId[WS];

    expect(ws.events).toHaveLength(2);
    // Events should be sorted chronologically
    expect(ws.events[0].timestamp).toBe("2026-03-20T12:00:00.000Z");
    expect(ws.events[1].timestamp).toBe("2026-03-20T13:00:00.000Z");
  });

  it("appends event and updates currentTime when live via addRealtimeEvent", () => {
    const event: InteractionEvent = {
      type: "file-write",
      timestamp: "2026-03-20T14:00:00.000Z",
      agentId: "a1",
    };

    const state = agentOverviewReducer(initialState, addRealtimeEvent(WS, event));
    const ws = state.byWorkspaceId[WS];

    expect(ws.events).toHaveLength(1);
    expect(ws.events[0]).toEqual(event);
    // isLive defaults to true, so currentTime should be updated
    expect(ws.currentTime).toBeTruthy();
    expect(ws.isLive).toBe(true);
  });

  it("clears workspace state via clearAgentOverview", () => {
    // First add some data
    const events: InteractionEvent[] = [
      { type: "file-write", timestamp: "2026-03-20T13:00:00.000Z", agentId: "a1" },
    ];
    let state = agentOverviewReducer(initialState, processWorkspaceEvents(WS, events));
    expect(state.byWorkspaceId[WS]).toBeDefined();

    // Clear it
    state = agentOverviewReducer(state, clearAgentOverview(WS));
    expect(state.byWorkspaceId[WS]).toBeUndefined();
  });
});

