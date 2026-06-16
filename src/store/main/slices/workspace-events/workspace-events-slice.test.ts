import {
  describe,
  expect,
  it,
} from "vitest";
import type { WorkspaceEvent } from "../../../../features/events/types";
import {
  workspaceEventsReducer,
  initialState,
  emitWorkspaceEvent,
  workspaceEventAccepted,
  cleanupWorkspace,
} from "./workspace-events-slice";
import { MAX_RECENT_EVENTS } from "./types";

const WS = "ws-1";
const WS2 = "ws-2";

let eventCounter = 0;

const makeEvent = (overrides: Partial<WorkspaceEvent> = {}): WorkspaceEvent => {
  const n = ++eventCounter;
  return {
    id: `evt-${n}`,
    workspaceId: WS,
    timestamp: new Date(2025, 0, 1, 0, 0, n).toISOString(),
    type: "file:changed",
    actor: { type: "system", id: "sys-1", name: "System" },
    // Each event gets a unique path by default so dedup keys differ
    data: { path: `/test-${n}.ts`, relativePath: `test-${n}.ts`, action: "modify" },
    ...overrides,
  } as WorkspaceEvent;
};

const reduce = (action: any, state = initialState) =>
  workspaceEventsReducer(state, action);

describe("workspaceEventsReducer", () => {
  it("returns initial state for unknown action", () => {
    expect(reduce({ type: "UNKNOWN" })).toBe(initialState);
  });

  it("initial state has empty byWorkspaceId", () => {
    expect(initialState).toEqual({ byWorkspaceId: {} });
  });

  // --- workspaceEventAccepted (adds accepted event to buffer) ---
  describe("workspaceEventAccepted", () => {
    it("adds an event to the workspace buffer", () => {
      const event = makeEvent();
      const state = reduce(workspaceEventAccepted(event));
      const ws = state.byWorkspaceId[WS];
      expect(ws.recentEvents).toHaveLength(1);
      expect(ws.recentEvents[0]).toBe(event);
      expect(ws.eventCount).toBe(1);
      expect(ws.lastEventTimestamp).toBe(event.timestamp);
    });

    it("appends to existing events", () => {
      const e1 = makeEvent();
      const e2 = makeEvent();
      let state = reduce(workspaceEventAccepted(e1));
      state = reduce(workspaceEventAccepted(e2), state);
      const ws = state.byWorkspaceId[WS];
      expect(ws.recentEvents).toHaveLength(2);
      expect(ws.eventCount).toBe(2);
      expect(ws.lastEventTimestamp).toBe(e2.timestamp);
    });

    it("caps buffer at MAX_RECENT_EVENTS", () => {
      let state = initialState;
      for (let i = 0; i < MAX_RECENT_EVENTS + 10; i++) {
        state = reduce(workspaceEventAccepted(makeEvent()), state);
      }
      const ws = state.byWorkspaceId[WS];
      expect(ws.recentEvents).toHaveLength(MAX_RECENT_EVENTS);
      expect(ws.eventCount).toBe(MAX_RECENT_EVENTS + 10);
    });

    it("creates separate state per workspace", () => {
      const e1 = makeEvent({ workspaceId: WS });
      const e2 = makeEvent({ workspaceId: WS2 });
      let state = reduce(workspaceEventAccepted(e1));
      state = reduce(workspaceEventAccepted(e2), state);
      expect(state.byWorkspaceId[WS].recentEvents).toHaveLength(1);
      expect(state.byWorkspaceId[WS2].recentEvents).toHaveLength(1);
    });

    it("emitWorkspaceEvent does not modify state (dedup handled in saga)", () => {
      const event = makeEvent();
      const state = reduce(emitWorkspaceEvent(event));
      expect(state).toBe(initialState);
    });
  });

  // --- cleanupWorkspace ---
  describe("cleanupWorkspace", () => {
    it("removes workspace state entirely", () => {
      const e = makeEvent();
      let state = reduce(workspaceEventAccepted(e));
      expect(state.byWorkspaceId[WS]).toBeDefined();
      state = reduce(cleanupWorkspace(WS), state);
      expect(state.byWorkspaceId[WS]).toBeUndefined();
    });

    it("returns same state if workspace not present", () => {
      const state = reduce(cleanupWorkspace("nonexistent"));
      expect(state).toBe(initialState);
    });
  });

  // --- dedup is now handled in saga, not reducer ---
  // Dedup tests are in workspace-events-saga.test.ts
  // The reducer just adds events unconditionally via workspaceEventAccepted
});

