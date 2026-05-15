/**
 * Integration tests for event subscription semantics.
 *
 * Covers:
 * 1. Live-only subscribe vs historical replay — selectors see only buffer contents
 * 2. MAX_RECENT_EVENTS rollover — new events still accepted after buffer caps
 * 3. Duplicate event visibility — dedup rejects duplicates within window
 *
 * These tests exercise the reducer + selectors together to validate the
 * subscription contract that replaced the old eventBus system.
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
  clearWorkspaceEvents,
} from "../workspace-events-slice";
import {
  selectRecentEvents,
  selectEventCount,
  selectLastEvent,
  selectEventsByType,
} from "../workspace-events-selectors";
import { MAX_RECENT_EVENTS } from "../types";
import type { WorkspaceEventsState } from "../types";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const WS = "ws-integration";

let counter = 0;

function makeEvent(overrides: Partial<WorkspaceEvent> = {}): WorkspaceEvent {
  const n = ++counter;
  return {
    id: `int-evt-${n}`,
    workspaceId: WS,
    timestamp: new Date(2025, 0, 1, 0, 0, n).toISOString(),
    type: "file:changed",
    actor: { type: "system", id: "sys-1", name: "System" },
    data: { path: `/int-${n}.ts`, relativePath: `int-${n}.ts`, action: "modify" },
    ...overrides,
  } as WorkspaceEvent;
}

/** Wrap workspace-events state to look like MainStoreState for selectors */
function asMainState(wsEventsState: WorkspaceEventsState): any {
  return { workspaceEvents: wsEventsState };
}

function reduce(action: any, state: WorkspaceEventsState = initialState) {
  return workspaceEventsReducer(state, action);
}

beforeEach(() => {
  counter = 0;
});

// ===========================================================================
// 1. Live-only subscribe vs historical replay
// ===========================================================================

describe("subscription semantics: live-only vs historical", () => {
  it("a new subscriber sees all events already in the buffer (historical replay)", () => {
    // Emit several events before any "subscriber" reads
    let state = initialState;
    const events: WorkspaceEvent[] = [];
    for (let i = 0; i < 5; i++) {
      const e = makeEvent();
      events.push(e);
      state = reduce(workspaceEventAccepted(e), state);
    }

    // A subscriber reading now gets the full historical buffer
    const visible = selectRecentEvents.select(asMainState(state), WS);
    expect(visible).toHaveLength(5);
    expect(visible).toEqual(events);
  });

  it("a subscriber only sees events from their workspace (workspace-scoped)", () => {
    const OTHER_WS = "ws-other";
    let state = initialState;

    // Emit to two workspaces
    state = reduce(workspaceEventAccepted(makeEvent({ workspaceId: WS })), state);
    state = reduce(workspaceEventAccepted(makeEvent({ workspaceId: OTHER_WS })), state);
    state = reduce(workspaceEventAccepted(makeEvent({ workspaceId: WS })), state);

    const wsEvents = selectRecentEvents.select(asMainState(state), WS);
    const otherEvents = selectRecentEvents.select(asMainState(state), OTHER_WS);

    expect(wsEvents).toHaveLength(2);
    expect(otherEvents).toHaveLength(1);
  });

  it("live events appear immediately to selector reads after dispatch", () => {
    let state = initialState;

    // Before: empty
    expect(selectRecentEvents.select(asMainState(state), WS)).toHaveLength(0);
    expect(selectEventCount.select(asMainState(state), WS)).toBe(0);

    // Emit one event
    const e1 = makeEvent();
    state = reduce(workspaceEventAccepted(e1), state);

    // After: visible immediately
    expect(selectRecentEvents.select(asMainState(state), WS)).toHaveLength(1);
    expect(selectLastEvent.select(asMainState(state), WS)).toBe(e1);
    expect(selectEventCount.select(asMainState(state), WS)).toBe(1);
  });

  it("clearing events resets the buffer but preserves count (no historical replay after clear)", () => {
    let state = initialState;
    for (let i = 0; i < 3; i++) {
      state = reduce(workspaceEventAccepted(makeEvent()), state);
    }
    expect(selectRecentEvents.select(asMainState(state), WS)).toHaveLength(3);

    // Clear buffer
    state = reduce(clearWorkspaceEvents(WS), state);

    // No historical events visible
    expect(selectRecentEvents.select(asMainState(state), WS)).toHaveLength(0);
    // But count is preserved (events were emitted)
    expect(selectEventCount.select(asMainState(state), WS)).toBe(3);

    // New events after clear are visible
    const newEvent = makeEvent();
    state = reduce(workspaceEventAccepted(newEvent), state);
    expect(selectRecentEvents.select(asMainState(state), WS)).toHaveLength(1);
    expect(selectRecentEvents.select(asMainState(state), WS)[0]).toBe(newEvent);
  });

  it("type-filtered subscriptions only see matching event types", () => {
    let state = initialState;
    state = reduce(workspaceEventAccepted(makeEvent({ type: "file:changed" })), state);
    state = reduce(workspaceEventAccepted(makeEvent({ type: "agent:started" as any })), state);
    state = reduce(workspaceEventAccepted(makeEvent({ type: "file:changed" })), state);

    const fileEvents = selectEventsByType.select(asMainState(state), WS, "file:changed");
    const agentEvents = selectEventsByType.select(asMainState(state), WS, "agent:started");

    expect(fileEvents).toHaveLength(2);
    expect(agentEvents).toHaveLength(1);
  });
});

// ===========================================================================
// 2. MAX_RECENT_EVENTS buffer rollover
// ===========================================================================

describe("subscription semantics: buffer rollover at MAX_RECENT_EVENTS", () => {
  it("buffer never exceeds MAX_RECENT_EVENTS", () => {
    let state = initialState;
    const total = MAX_RECENT_EVENTS + 50;
    for (let i = 0; i < total; i++) {
      state = reduce(workspaceEventAccepted(makeEvent()), state);
    }

    const visible = selectRecentEvents.select(asMainState(state), WS);
    expect(visible).toHaveLength(MAX_RECENT_EVENTS);
    expect(selectEventCount.select(asMainState(state), WS)).toBe(total);
  });

  it("new events are still accepted and visible after rollover", () => {
    let state = initialState;
    // Fill the buffer exactly
    for (let i = 0; i < MAX_RECENT_EVENTS; i++) {
      state = reduce(workspaceEventAccepted(makeEvent()), state);
    }
    expect(selectRecentEvents.select(asMainState(state), WS)).toHaveLength(MAX_RECENT_EVENTS);

    // Add one more — should still be accepted
    const overflow = makeEvent({ type: "git:commit" as any });
    state = reduce(workspaceEventAccepted(overflow), state);

    const visible = selectRecentEvents.select(asMainState(state), WS);
    expect(visible).toHaveLength(MAX_RECENT_EVENTS);
    // The newest event should be at the end
    expect(visible[visible.length - 1]).toBe(overflow);
    // The oldest event should have been evicted
    expect(selectEventCount.select(asMainState(state), WS)).toBe(MAX_RECENT_EVENTS + 1);
  });

  it("oldest events are evicted first (FIFO)", () => {
    let state = initialState;
    const allEvents: WorkspaceEvent[] = [];
    const total = MAX_RECENT_EVENTS + 20;
    for (let i = 0; i < total; i++) {
      const e = makeEvent();
      allEvents.push(e);
      state = reduce(workspaceEventAccepted(e), state);
    }

    const visible = selectRecentEvents.select(asMainState(state), WS);
    // Should contain the last MAX_RECENT_EVENTS events
    const expected = allEvents.slice(total - MAX_RECENT_EVENTS);
    expect(visible).toEqual(expected);
    // First 20 events should have been evicted
    for (let i = 0; i < 20; i++) {
      expect(visible).not.toContain(allEvents[i]);
    }
  });

  it("lastEvent selector tracks the newest event even after rollover", () => {
    let state = initialState;
    for (let i = 0; i < MAX_RECENT_EVENTS + 5; i++) {
      state = reduce(workspaceEventAccepted(makeEvent()), state);
    }
    const finalEvent = makeEvent();
    state = reduce(workspaceEventAccepted(finalEvent), state);

    expect(selectLastEvent.select(asMainState(state), WS)).toBe(finalEvent);
  });
});

// ===========================================================================
// 3. Duplicate event visibility to subscribers
// ===========================================================================

describe("subscription semantics: reducer accepts all workspaceEventAccepted events", () => {
  // Note: Dedup is now handled in the coordinating saga (dedup-cache.ts),
  // not the reducer. The reducer unconditionally buffers workspaceEventAccepted events.
  // Dedup cache tests are in workspace-events-saga.test.ts.

  it("reducer buffers all accepted events regardless of content similarity", () => {
    const sharedData = { path: "/dup.ts", relativePath: "dup.ts", action: "modify" };
    const baseTs = new Date(2025, 5, 1, 12, 0, 0);

    const e1 = makeEvent({
      timestamp: baseTs.toISOString(),
      data: sharedData,
    });
    const e2 = makeEvent({
      id: "dup-id-2",
      timestamp: new Date(baseTs.getTime() + 500).toISOString(),
      data: sharedData,
    });

    let state = reduce(workspaceEventAccepted(e1));
    state = reduce(workspaceEventAccepted(e2), state);

    // Both events are buffered — dedup happens before workspaceEventAccepted is dispatched
    const visible = selectRecentEvents.select(asMainState(state), WS);
    expect(visible).toHaveLength(2);
    expect(selectEventCount.select(asMainState(state), WS)).toBe(2);
  });

  it("events with different content keys at same timestamp are both visible", () => {
    const ts = new Date(2025, 5, 1, 12, 0, 0).toISOString();

    const e1 = makeEvent({
      timestamp: ts,
      data: { path: "/x.ts", relativePath: "x.ts", action: "modify" },
    });
    const e2 = makeEvent({
      id: "diff-key-2",
      timestamp: ts,
      data: { path: "/y.ts", relativePath: "y.ts", action: "modify" },
    });

    let state = reduce(workspaceEventAccepted(e1));
    state = reduce(workspaceEventAccepted(e2), state);

    const visible = selectRecentEvents.select(asMainState(state), WS);
    expect(visible).toHaveLength(2);
  });

  it("multiple accepted events all appear in buffer", () => {
    let state = initialState;
    const events: WorkspaceEvent[] = [];
    for (let i = 0; i < 10; i++) {
      const e = makeEvent({
        id: `batch-${i}`,
        timestamp: new Date(2025, 5, 1, 12, 0, i).toISOString(),
      });
      events.push(e);
      state = reduce(workspaceEventAccepted(e), state);
    }

    const visible = selectRecentEvents.select(asMainState(state), WS);
    expect(visible).toHaveLength(10);
    expect(visible).toEqual(events);
  });
});

