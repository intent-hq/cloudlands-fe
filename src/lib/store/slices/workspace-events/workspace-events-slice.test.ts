import { describe, expect, it } from "vitest";
import type { WorkspaceEvent } from "$features/events/types";
import {
  eventReceived,
  eventsCleared,
  eventsLoaded,
  initialState,
  setEventsLoading,
  workspaceEventsReducer,
} from "./workspace-events-slice";

const WS_1 = "ws-1";
const WS_2 = "ws-2";

function mockEvent(id: string, workspaceId = WS_1): WorkspaceEvent {
  return {
    id,
    workspaceId,
    timestamp: "2026-03-25T00:00:00.000Z",
    type: "file:changed",
    actor: { type: "system" },
  };
}

describe("workspaceEventsReducer", () => {
  it("returns the initial state", () => {
    expect(workspaceEventsReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("appends a received event", () => {
    const event = mockEvent("evt-1");
    const state = workspaceEventsReducer(initialState, eventReceived(WS_1, event));
    expect(state.byWorkspaceId[WS_1].events).toEqual([event]);
  });

  it("caps events at 100", () => {
    let state = initialState;
    for (let i = 0; i < 110; i++) {
      state = workspaceEventsReducer(state, eventReceived(WS_1, mockEvent(`evt-${i}`)));
    }
    expect(state.byWorkspaceId[WS_1].events).toHaveLength(100);
    expect(state.byWorkspaceId[WS_1].events[0].id).toBe("evt-10");
    expect(state.byWorkspaceId[WS_1].events[99].id).toBe("evt-109");
  });

  it("replaces events on eventsLoaded and clears loading", () => {
    const loadingState = workspaceEventsReducer(initialState, setEventsLoading(WS_1, true));
    expect(loadingState.byWorkspaceId[WS_1].loading).toBe(true);

    const events = [mockEvent("evt-1"), mockEvent("evt-2")];
    const state = workspaceEventsReducer(loadingState, eventsLoaded(WS_1, events));
    expect(state.byWorkspaceId[WS_1].events).toEqual(events);
    expect(state.byWorkspaceId[WS_1].loading).toBe(false);
  });

  it("clears workspace state on eventsCleared", () => {
    const loaded = workspaceEventsReducer(
      initialState,
      eventReceived(WS_1, mockEvent("evt-1"))
    );
    const cleared = workspaceEventsReducer(loaded, eventsCleared(WS_1));
    expect(cleared.byWorkspaceId[WS_1]).toBeUndefined();
  });

  it("does not affect other workspaces", () => {
    let state = workspaceEventsReducer(initialState, eventReceived(WS_1, mockEvent("evt-1")));
    state = workspaceEventsReducer(state, eventReceived(WS_2, mockEvent("evt-2", WS_2)));
    state = workspaceEventsReducer(state, eventsCleared(WS_1));
    expect(state.byWorkspaceId[WS_1]).toBeUndefined();
    expect(state.byWorkspaceId[WS_2].events).toHaveLength(1);
  });

  it("sets and clears loading flag", () => {
    const state = workspaceEventsReducer(initialState, setEventsLoading(WS_1, true));
    expect(state.byWorkspaceId[WS_1].loading).toBe(true);
    const next = workspaceEventsReducer(state, setEventsLoading(WS_1, false));
    expect(next.byWorkspaceId[WS_1].loading).toBe(false);
  });
});

