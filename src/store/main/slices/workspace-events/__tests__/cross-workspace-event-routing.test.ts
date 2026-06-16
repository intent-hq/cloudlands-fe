/**
 * Regression tests for cross-workspace event routing.
 *
 * Previously covered by workspace-event-bus-integration.test.ts:
 * 1. Events are routed to the correct workspace buffer only
 * 2. Events from multiple workspaces maintain isolated state
 * 3. Cleanup of one workspace does not affect others
 * 4. Event type filtering works across workspace boundaries
 * 5. Buffer rollover in one workspace does not affect another
 */

import {
  describe,
  expect,
  it,
  beforeEach,
} from "vitest";
import type { WorkspaceEvent } from "../../../../../features/events/types";
import {
  workspaceEventsReducer,
  initialState,
  workspaceEventAccepted,
  cleanupWorkspace,
} from "../workspace-events-slice";
import {
  selectRecentEvents,
  selectEventCount,
  selectEventsByType,
} from "../workspace-events-selectors";
import { MAX_RECENT_EVENTS } from "../types";
import type { WorkspaceEventsState } from "../types";

const WS_A = "ws-alpha";
const WS_B = "ws-beta";
const WS_C = "ws-gamma";

let counter = 0;

function makeEvent(overrides: Partial<WorkspaceEvent> = {}): WorkspaceEvent {
  const n = ++counter;
  return {
    id: `cross-evt-${n}`,
    workspaceId: WS_A,
    timestamp: new Date(2025, 0, 1, 0, 0, n).toISOString(),
    type: "file:changed",
    actor: { type: "system", id: "sys-1", name: "System" },
    data: { path: `/cross-${n}.ts`, relativePath: `cross-${n}.ts`, action: "modify" },
    ...overrides,
  } as WorkspaceEvent;
}

function asMainState(wsEventsState: WorkspaceEventsState): any {
  return { workspaceEvents: wsEventsState };
}

function reduce(action: any, state: WorkspaceEventsState = initialState) {
  return workspaceEventsReducer(state, action);
}

beforeEach(() => {
  counter = 0;
});

describe("cross-workspace event routing", () => {
  it("events route to the correct workspace only — no cross-contamination", () => {
    let state = initialState;
    const eA = makeEvent({ workspaceId: WS_A });
    const eB = makeEvent({ workspaceId: WS_B });
    const eC = makeEvent({ workspaceId: WS_C });

    state = reduce(workspaceEventAccepted(eA), state);
    state = reduce(workspaceEventAccepted(eB), state);
    state = reduce(workspaceEventAccepted(eC), state);

    expect(selectRecentEvents.select(asMainState(state), WS_A)).toEqual([eA]);
    expect(selectRecentEvents.select(asMainState(state), WS_B)).toEqual([eB]);
    expect(selectRecentEvents.select(asMainState(state), WS_C)).toEqual([eC]);
  });

  it("event counts accumulate independently per workspace", () => {
    let state = initialState;
    for (let i = 0; i < 5; i++) {
      state = reduce(workspaceEventAccepted(makeEvent({ workspaceId: WS_A })), state);
    }
    for (let i = 0; i < 3; i++) {
      state = reduce(workspaceEventAccepted(makeEvent({ workspaceId: WS_B })), state);
    }

    expect(selectEventCount.select(asMainState(state), WS_A)).toBe(5);
    expect(selectEventCount.select(asMainState(state), WS_B)).toBe(3);
    expect(selectEventCount.select(asMainState(state), WS_C)).toBe(0);
  });

  it("cleanup (removal) of one workspace does not affect others", () => {
    let state = initialState;
    state = reduce(workspaceEventAccepted(makeEvent({ workspaceId: WS_A })), state);
    state = reduce(workspaceEventAccepted(makeEvent({ workspaceId: WS_B })), state);

    state = reduce(cleanupWorkspace(WS_A), state);

    expect(state.byWorkspaceId[WS_A]).toBeUndefined();
    expect(selectRecentEvents.select(asMainState(state), WS_B)).toHaveLength(1);
    expect(selectEventCount.select(asMainState(state), WS_B)).toBe(1);
  });

  it("type-filtered selector works across independent workspace buffers", () => {
    let state = initialState;
    state = reduce(workspaceEventAccepted(makeEvent({ workspaceId: WS_A, type: "file:changed" })), state);
    state = reduce(workspaceEventAccepted(makeEvent({ workspaceId: WS_A, type: "agent:started" as any })), state);
    state = reduce(workspaceEventAccepted(makeEvent({ workspaceId: WS_B, type: "file:changed" })), state);

    const fileEventsA = selectEventsByType.select(asMainState(state), WS_A, "file:changed");
    const agentEventsA = selectEventsByType.select(asMainState(state), WS_A, "agent:started");
    const fileEventsB = selectEventsByType.select(asMainState(state), WS_B, "file:changed");

    expect(fileEventsA).toHaveLength(1);
    expect(agentEventsA).toHaveLength(1);
    expect(fileEventsB).toHaveLength(1);
  });

  it("buffer rollover in one workspace does not affect another", () => {
    let state = initialState;
    // Fill WS_A beyond max
    for (let i = 0; i < MAX_RECENT_EVENTS + 10; i++) {
      state = reduce(workspaceEventAccepted(makeEvent({ workspaceId: WS_A })), state);
    }
    // Add a few to WS_B
    const wsB_events: WorkspaceEvent[] = [];
    for (let i = 0; i < 3; i++) {
      const e = makeEvent({ workspaceId: WS_B });
      wsB_events.push(e);
      state = reduce(workspaceEventAccepted(e), state);
    }

    // WS_A capped at MAX_RECENT_EVENTS
    expect(selectRecentEvents.select(asMainState(state), WS_A)).toHaveLength(MAX_RECENT_EVENTS);
    expect(selectEventCount.select(asMainState(state), WS_A)).toBe(MAX_RECENT_EVENTS + 10);
    // WS_B unaffected
    expect(selectRecentEvents.select(asMainState(state), WS_B)).toHaveLength(3);
    expect(selectRecentEvents.select(asMainState(state), WS_B)).toEqual(wsB_events);
  });
});

