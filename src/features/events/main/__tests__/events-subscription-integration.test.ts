/**
 * Integration tests for Redux-based event subscription semantics.
 *
 * These tests verify the interplay between the Redux store and the
 * cursor-based subscription logic used in events.ipc.ts (lines 77-170).
 *
 * Covers three scenarios requested in PR review:
 * 1. Live-only subscribe doesn't replay existing events
 * 2. Delivery continues after MAX_RECENT_EVENTS buffer rollover
 * 3. All accepted events (post-dedup) are delivered to subscribers
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { WorkspaceEvent } from "../../types";
import {
  workspaceEventsReducer,
  initialState,
  workspaceEventAccepted,
} from "../../../../store/main/slices/workspace-events/workspace-events-slice";
import {
  selectRecentEvents,
  selectEventCount,
} from "../../../../store/main/slices/workspace-events/workspace-events-selectors";
import {
  MAX_RECENT_EVENTS,
  type WorkspaceEventsState,
} from "../../../../store/main/slices/workspace-events/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WS = "ws-test";

let counter = 0;

function makeEvent(overrides: Partial<WorkspaceEvent> = {}): WorkspaceEvent {
  counter++;
  return {
    id: `evt-${counter}`,
    workspaceId: WS,
    timestamp: new Date(2025, 0, 1, 0, 0, counter).toISOString(),
    type: "file:changed",
    actor: { type: "system", id: "sys-1", name: "System" },
    data: {
      path: `/file-${counter}.ts`,
      relativePath: `file-${counter}.ts`,
      action: "modify",
    },
    ...overrides,
  } as WorkspaceEvent;
}

/** Minimal store wrapper around the reducer (same pattern as the unit test). */
function createTestStore() {
  let state: WorkspaceEventsState = initialState;
  return {
    dispatch(action: any) {
      state = workspaceEventsReducer(state, action);
    },
    getState() {
      return { workspaceEvents: state } as any;
    },
  };
}

/**
 * Simulates the cursor-based extraction logic from events.ipc.ts (lines 121-147).
 * Given a Redux state snapshot and a mutable cursor map, returns only the events
 * that have been added since the cursor was last advanced.
 */
function getNewEvents(
  state: any,
  lastSeenCount: Map<string, number>,
): WorkspaceEvent[] {
  const wsSlice = state.workspaceEvents?.byWorkspaceId ?? {};
  const newEvents: WorkspaceEvent[] = [];

  for (const wsId of Object.keys(wsSlice)) {
    const currentCount = selectEventCount.select(state, wsId);
    const lastSeen = lastSeenCount.get(wsId) ?? 0;

    if (currentCount <= lastSeen) continue;

    const recentEvents = selectRecentEvents.select(state, wsId);
    const newCount = Math.min(currentCount - lastSeen, recentEvents.length);
    newEvents.push(...recentEvents.slice(-newCount));

    lastSeenCount.set(wsId, currentCount);
  }

  return newEvents;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Event subscription integration", () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    counter = 0;
    store = createTestStore();
  });

  it("live-only subscriber does not replay existing events", () => {
    // Emit 5 events before subscription
    for (let i = 0; i < 5; i++) {
      store.dispatch(workspaceEventAccepted(makeEvent()));
    }

    // Initialize cursor at current eventCount (simulates subscriber init)
    const cursor = new Map<string, number>();
    const initState = store.getState();
    cursor.set(WS, selectEventCount.select(initState, WS));

    // Emit 3 more events after subscription
    for (let i = 0; i < 3; i++) {
      store.dispatch(workspaceEventAccepted(makeEvent()));
    }

    const delivered = getNewEvents(store.getState(), cursor);

    expect(delivered).toHaveLength(3);
    // Verify they are the 3 newest events, not the original 5
    expect(delivered.map((e) => e.id)).toEqual(["evt-6", "evt-7", "evt-8"]);
  });

  it("delivery continues after MAX_RECENT_EVENTS buffer rollover", () => {
    // Fill the buffer past its capacity
    for (let i = 0; i < MAX_RECENT_EVENTS + 50; i++) {
      store.dispatch(workspaceEventAccepted(makeEvent()));
    }

    // Subscribe after rollover
    const cursor = new Map<string, number>();
    cursor.set(WS, selectEventCount.select(store.getState(), WS));

    // Emit 20 more events
    for (let i = 0; i < 20; i++) {
      store.dispatch(workspaceEventAccepted(makeEvent()));
    }

    const delivered = getNewEvents(store.getState(), cursor);

    // All 20 new events must be delivered even though buffer has rolled over
    expect(delivered).toHaveLength(20);

    // Verify monotonic eventCount keeps growing past buffer size
    const totalCount = selectEventCount.select(store.getState(), WS);
    expect(totalCount).toBe(MAX_RECENT_EVENTS + 70);
  });

  it("all accepted events are delivered to subscribers", () => {
    // Emit an initial event via workspaceEventAccepted (dedup already passed in saga)
    const sharedData = {
      path: "/dup.ts",
      relativePath: "dup.ts",
      action: "modify",
    };
    store.dispatch(
      workspaceEventAccepted(
        makeEvent({
          timestamp: new Date(2025, 0, 1, 0, 0, 0).toISOString(),
          data: sharedData,
        }),
      ),
    );

    // Subscribe
    const cursor = new Map<string, number>();
    cursor.set(WS, selectEventCount.select(store.getState(), WS));

    // Emit another accepted event (saga already verified it's not a duplicate)
    store.dispatch(
      workspaceEventAccepted(
        makeEvent({
          id: "accepted-2",
          timestamp: new Date(2025, 0, 1, 0, 0, 1).toISOString(),
          data: sharedData,
        }),
      ),
    );

    const delivered = getNewEvents(store.getState(), cursor);

    // Both events were accepted by the saga (dedup passed) so the new one should appear
    expect(delivered).toHaveLength(1);
    // eventCount should be 2 (both accepted events)
    expect(selectEventCount.select(store.getState(), WS)).toBe(2);
  });
});

