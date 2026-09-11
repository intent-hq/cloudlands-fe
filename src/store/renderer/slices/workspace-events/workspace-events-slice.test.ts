import { describe, expect, it } from 'vitest';
import type { WorkspaceEvent } from '$features/events/types';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import {
  bulkEventsReceived,
  eventReceived,
  eventsCleared,
  eventsLoaded,
  eventsLoadFailed,
  initialState,
  loadEventsRequested,
  loadOlderEventsRequested,
  olderEventsLoaded,
  olderEventsLoadFailed,
  setEventsLoading,
  workspaceEventsReducer,
} from './workspace-events-slice';

const WS_1 = 'ws-1';
const WS_2 = 'ws-2';

function mockEvent(id: string, workspaceId = WS_1, timestampOverride?: string): WorkspaceEvent {
  return {
    id,
    workspaceId,
    timestamp: timestampOverride ?? '2026-03-25T00:00:00.000Z',
    type: 'file:changed',
    actor: { type: 'system' },
  };
}

describe('workspaceEventsReducer', () => {
  it('returns the initial state', () => {
    expect(workspaceEventsReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('appends a single eventReceived into the workspace buffer', () => {
    const state = workspaceEventsReducer(initialState, eventReceived(WS_1, mockEvent('evt-1')));
    expect(state.byWorkspaceId[WS_1].events.map((event) => event.id)).toEqual(['evt-1']);
  });

  it('dedups eventReceived against the existing buffer by id', () => {
    let state = workspaceEventsReducer(initialState, eventReceived(WS_1, mockEvent('evt-1')));
    state = workspaceEventsReducer(state, eventReceived(WS_1, mockEvent('evt-1')));
    state = workspaceEventsReducer(state, eventReceived(WS_1, mockEvent('evt-2')));
    expect(state.byWorkspaceId[WS_1].events.map((event) => event.id)).toEqual(['evt-1', 'evt-2']);
  });

  it('drops eventReceived payloads that fail sanitization', () => {
    const state = workspaceEventsReducer(
      initialState,
      eventReceived(WS_1, { not: 'an event' } as any),
    );
    expect(state).toBe(initialState);
  });

  it('caps eventReceived events at 300', () => {
    let state = initialState;
    for (let i = 0; i < 310; i++) {
      state = workspaceEventsReducer(state, eventReceived(WS_1, mockEvent(`evt-${i}`)));
    }
    expect(state.byWorkspaceId[WS_1].events).toHaveLength(300);
    expect(state.byWorkspaceId[WS_1].events[0].id).toBe('evt-10');
    expect(state.byWorkspaceId[WS_1].events[299].id).toBe('evt-309');
  });

  it('dedups bulkEventsReceived against the existing buffer by id', () => {
    let state = workspaceEventsReducer(
      initialState,
      bulkEventsReceived(WS_1, [mockEvent('evt-1'), mockEvent('evt-2')]),
    );
    state = workspaceEventsReducer(
      state,
      bulkEventsReceived(WS_1, [mockEvent('evt-2'), mockEvent('evt-3')]),
    );
    expect(state.byWorkspaceId[WS_1].events.map((event) => event.id)).toEqual([
      'evt-1',
      'evt-2',
      'evt-3',
    ]);
  });

  it('appends bulk received events in arrival order', () => {
    const events = [mockEvent('evt-1'), mockEvent('evt-2')];
    let state = workspaceEventsReducer(initialState, bulkEventsReceived(WS_1, events));
    state = workspaceEventsReducer(state, bulkEventsReceived(WS_1, [mockEvent('evt-3')]));
    expect(state.byWorkspaceId[WS_1].events.map((event) => event.id)).toEqual([
      'evt-1',
      'evt-2',
      'evt-3',
    ]);
  });

  it('caps events at 300', () => {
    let state = initialState;
    for (let i = 0; i < 310; i++) {
      state = workspaceEventsReducer(state, bulkEventsReceived(WS_1, [mockEvent(`evt-${i}`)]));
    }
    expect(state.byWorkspaceId[WS_1].events).toHaveLength(300);
    expect(state.byWorkspaceId[WS_1].events[0].id).toBe('evt-10');
    expect(state.byWorkspaceId[WS_1].events[299].id).toBe('evt-309');
  });

  it('replaces events on eventsLoaded and clears loading', () => {
    const loadingState = workspaceEventsReducer(initialState, setEventsLoading(WS_1, true));
    expect(loadingState.byWorkspaceId[WS_1].loading).toBe(true);

    const events = [mockEvent('evt-1'), mockEvent('evt-2')];
    const state = workspaceEventsReducer(loadingState, eventsLoaded(WS_1, events));
    expect(state.byWorkspaceId[WS_1].events).toEqual(events);
    expect(state.byWorkspaceId[WS_1].loading).toBe(false);
  });

  it('tracks initial loading and failure state', () => {
    let state = workspaceEventsReducer(initialState, loadEventsRequested(WS_1));
    expect(state.byWorkspaceId[WS_1]).toMatchObject({ loading: true, error: null });
    state = workspaceEventsReducer(state, eventReceived(WS_1, mockEvent('evt-live')));

    state = workspaceEventsReducer(state, eventsLoadFailed(WS_1, 'offline'));
    expect(state.byWorkspaceId[WS_1]).toMatchObject({
      pendingLiveEventIds: null,
      loading: false,
      error: 'offline',
    });
  });

  it('deduplicates an older page at its boundary and records the end state', () => {
    let state = workspaceEventsReducer(
      initialState,
      eventsLoaded(
        WS_1,
        [
          mockEvent('evt-2', WS_1, '2026-01-02T00:00:00.000Z'),
          mockEvent('evt-3', WS_1, '2026-01-03T00:00:00.000Z'),
        ],
        'older-1',
      ),
    );
    state = workspaceEventsReducer(state, loadOlderEventsRequested(WS_1));
    state = workspaceEventsReducer(
      state,
      olderEventsLoaded(
        WS_1,
        [
          mockEvent('evt-1', WS_1, '2026-01-01T00:00:00.000Z'),
          mockEvent('evt-2', WS_1, '2026-01-02T00:00:00.000Z'),
        ],
        null,
      ),
    );

    expect(state.byWorkspaceId[WS_1]).toMatchObject({
      loadingOlder: false,
      olderError: null,
      nextToken: null,
      endReached: true,
    });
    expect(state.byWorkspaceId[WS_1].events.map((event) => event.id)).toEqual([
      'evt-1',
      'evt-2',
      'evt-3',
    ]);
  });

  it('retains an explicitly requested older page beyond the live-event cap', () => {
    const recent = Array.from({ length: 300 }, (_, index) =>
      mockEvent(`recent-${index}`, WS_1, new Date(Date.UTC(2026, 0, 2, 0, 0, index)).toISOString()),
    );
    const older = Array.from({ length: 100 }, (_, index) =>
      mockEvent(`older-${index}`, WS_1, new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()),
    );
    let state = workspaceEventsReducer(initialState, eventsLoaded(WS_1, recent, 'older-1'));

    state = workspaceEventsReducer(state, olderEventsLoaded(WS_1, older, null));

    expect(state.byWorkspaceId[WS_1].events).toHaveLength(400);
    expect(state.byWorkspaceId[WS_1].events[0].id).toBe('older-0');
    expect(state.byWorkspaceId[WS_1].events[399].id).toBe('recent-299');
    expect(state.byWorkspaceId[WS_1]).toMatchObject({ nextToken: null, endReached: true });
  });

  it('retains expanded history when a live event arrives', () => {
    const recent = Array.from({ length: 300 }, (_, index) =>
      mockEvent(`recent-${index}`, WS_1, new Date(Date.UTC(2026, 0, 2, 0, 0, index)).toISOString()),
    );
    const older = Array.from({ length: 100 }, (_, index) =>
      mockEvent(`older-${index}`, WS_1, new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()),
    );
    let state = workspaceEventsReducer(initialState, eventsLoaded(WS_1, recent, 'older-1'));
    state = workspaceEventsReducer(state, olderEventsLoaded(WS_1, older, null));

    state = workspaceEventsReducer(
      state,
      eventReceived(WS_1, mockEvent('live', WS_1, '2026-01-03T00:00:00.000Z')),
    );

    expect(state.byWorkspaceId[WS_1].events).toHaveLength(401);
    expect(state.byWorkspaceId[WS_1].events[0].id).toBe('older-0');
    expect(state.byWorkspaceId[WS_1].events[400].id).toBe('live');
    expect(state.byWorkspaceId[WS_1]).toMatchObject({ nextToken: null, endReached: true });
  });

  it('retains expanded history when bulk live events arrive', () => {
    const recent = Array.from({ length: 300 }, (_, index) => mockEvent(`recent-${index}`));
    const older = Array.from({ length: 100 }, (_, index) => mockEvent(`older-${index}`));
    let state = workspaceEventsReducer(initialState, eventsLoaded(WS_1, recent, 'older-1'));
    state = workspaceEventsReducer(state, olderEventsLoaded(WS_1, older, null));

    state = workspaceEventsReducer(
      state,
      bulkEventsReceived(WS_1, [mockEvent('live-1'), mockEvent('live-2')]),
    );

    expect(state.byWorkspaceId[WS_1].events).toHaveLength(402);
    expect(state.byWorkspaceId[WS_1].events.map((event) => event.id)).toEqual(
      expect.arrayContaining(['older-0', 'live-1', 'live-2']),
    );
  });

  it('does not advance the older cursor when the returned page cannot be retained', () => {
    let state = workspaceEventsReducer(
      initialState,
      eventsLoaded(WS_1, [mockEvent('evt-1')], 'older-1'),
    );
    state = workspaceEventsReducer(state, loadOlderEventsRequested(WS_1));

    state = workspaceEventsReducer(
      state,
      olderEventsLoaded(WS_1, [{ not: 'an event' }] as any, null),
    );

    expect(state.byWorkspaceId[WS_1].events.map((event) => event.id)).toEqual(['evt-1']);
    expect(state.byWorkspaceId[WS_1]).toMatchObject({
      loadingOlder: false,
      nextToken: 'older-1',
      endReached: false,
    });
  });

  it('marks an empty initial page as the end without dropping a live event', () => {
    let state = workspaceEventsReducer(initialState, loadEventsRequested(WS_1));
    state = workspaceEventsReducer(state, eventReceived(WS_1, mockEvent('evt-live')));
    state = workspaceEventsReducer(state, eventsLoaded(WS_1, [], null));

    expect(state.byWorkspaceId[WS_1].events.map((event) => event.id)).toEqual(['evt-live']);
    expect(state.byWorkspaceId[WS_1]).toMatchObject({
      loading: false,
      nextToken: null,
      endReached: true,
    });
  });

  it('preserves a live event interleaved with the initial page and deduplicates its echo', () => {
    let state = workspaceEventsReducer(initialState, loadEventsRequested(WS_1));
    state = workspaceEventsReducer(
      state,
      eventReceived(WS_1, mockEvent('evt-live', WS_1, '2026-01-03T00:00:00.000Z')),
    );
    state = workspaceEventsReducer(
      state,
      eventsLoaded(
        WS_1,
        [
          mockEvent('evt-old', WS_1, '2026-01-01T00:00:00.000Z'),
          mockEvent('evt-live', WS_1, '2026-01-03T00:00:00.000Z'),
        ],
        'older-1',
      ),
    );

    expect(state.byWorkspaceId[WS_1].events.map((event) => event.id)).toEqual([
      'evt-old',
      'evt-live',
    ]);
    expect(state.byWorkspaceId[WS_1].nextToken).toBe('older-1');
  });

  it('preserves bulk live events interleaved with a fresh page', () => {
    let state = workspaceEventsReducer(initialState, loadEventsRequested(WS_1));
    state = workspaceEventsReducer(
      state,
      bulkEventsReceived(WS_1, [mockEvent('live-1'), mockEvent('live-2')]),
    );
    state = workspaceEventsReducer(state, eventsLoaded(WS_1, [mockEvent('page')], null));

    expect(state.byWorkspaceId[WS_1].events.map((event) => event.id)).toEqual([
      'live-1',
      'live-2',
      'page',
    ]);
  });

  it('retains an oversized initial page merge before advancing its cursor', () => {
    const page = Array.from({ length: 100 }, (_, index) =>
      mockEvent(`page-${index}`, WS_1, new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()),
    );
    const live = Array.from({ length: 250 }, (_, index) =>
      mockEvent(`live-${index}`, WS_1, new Date(Date.UTC(2026, 0, 2, 0, 0, index)).toISOString()),
    );
    let state = workspaceEventsReducer(initialState, loadEventsRequested(WS_1));
    state = workspaceEventsReducer(state, bulkEventsReceived(WS_1, live));

    state = workspaceEventsReducer(state, eventsLoaded(WS_1, page, 'older-1'));

    expect(state.byWorkspaceId[WS_1].events).toHaveLength(350);
    expect(state.byWorkspaceId[WS_1].events.map((event) => event.id)).toEqual([
      ...page.map((event) => event.id),
      ...live.map((event) => event.id),
    ]);
    expect(state.byWorkspaceId[WS_1]).toMatchObject({
      historyExpanded: true,
      nextToken: 'older-1',
      endReached: false,
    });
  });

  it('keeps a below-cap initial page merge bounded', () => {
    const page = Array.from({ length: 100 }, (_, index) => mockEvent(`page-${index}`));
    const live = Array.from({ length: 50 }, (_, index) => mockEvent(`live-${index}`));
    let state = workspaceEventsReducer(initialState, loadEventsRequested(WS_1));
    state = workspaceEventsReducer(state, bulkEventsReceived(WS_1, live));

    state = workspaceEventsReducer(state, eventsLoaded(WS_1, page, 'older-1'));

    expect(state.byWorkspaceId[WS_1].events).toHaveLength(150);
    expect(state.byWorkspaceId[WS_1]).toMatchObject({
      historyExpanded: false,
      nextToken: 'older-1',
      endReached: false,
    });
  });

  it('keeps the retained cursor until a fresh page atomically replaces it', () => {
    let state = workspaceEventsReducer(
      initialState,
      eventsLoaded(WS_1, [mockEvent('evt-recent')], 'older-1'),
    );
    state = workspaceEventsReducer(
      state,
      olderEventsLoaded(WS_1, [mockEvent('evt-old')], 'older-2'),
    );
    expect(state.byWorkspaceId[WS_1].historyExpanded).toBe(true);

    state = workspaceEventsReducer(state, loadEventsRequested(WS_1));
    state = workspaceEventsReducer(
      state,
      eventReceived(WS_1, mockEvent('evt-live', WS_1, '2026-01-03T00:00:00.000Z')),
    );
    expect(state.byWorkspaceId[WS_1]).toMatchObject({ nextToken: 'older-2', endReached: false });

    state = workspaceEventsReducer(
      state,
      eventsLoaded(WS_1, [mockEvent('evt-fresh', WS_1, '2026-01-02T00:00:00.000Z')], null),
    );

    expect(state.byWorkspaceId[WS_1].events.map((event) => event.id)).toEqual([
      'evt-fresh',
      'evt-live',
    ]);
    expect(state.byWorkspaceId[WS_1]).toMatchObject({
      historyExpanded: false,
      nextToken: null,
      endReached: true,
    });
  });

  it('tracks an older-page failure without losing its cursor', () => {
    let state = workspaceEventsReducer(
      initialState,
      eventsLoaded(WS_1, [mockEvent('evt-2')], 'older-1'),
    );
    state = workspaceEventsReducer(state, loadOlderEventsRequested(WS_1));
    state = workspaceEventsReducer(state, olderEventsLoadFailed(WS_1, 'retry later'));

    expect(state.byWorkspaceId[WS_1]).toMatchObject({
      loadingOlder: false,
      olderError: 'retry later',
      nextToken: 'older-1',
      endReached: false,
    });
  });

  it('does not crash when eventsLoaded receives a malformed list', () => {
    const loadingState = workspaceEventsReducer(initialState, setEventsLoading(WS_1, true));
    const state = workspaceEventsReducer(
      loadingState,
      eventsLoaded(WS_1, { not: 'an array' } as any),
    );
    expect(state.byWorkspaceId[WS_1].events).toEqual([]);
    expect(state.byWorkspaceId[WS_1].loading).toBe(false);
  });

  it('drops or normalizes malformed events from bulk batches before storing', () => {
    const event = {
      ...mockEvent('evt-1'),
      actor: { type: 'agent', name: { bad: true }, id: 123 },
      description: false,
      data: { message: { bad: true }, command: 123 },
    };
    const state = workspaceEventsReducer(initialState, bulkEventsReceived(WS_1, [event as any]));
    expect(state.byWorkspaceId[WS_1].events).toEqual([
      {
        ...mockEvent('evt-1'),
        actor: { type: 'agent', id: '123' },
        description: 'false',
        data: { command: '123' },
      },
    ]);
  });

  it('drops cyclic nested event data before storing', () => {
    const data: any = { command: 'pnpm test' };
    data.self = data;
    const event = { ...mockEvent('evt-cycle'), data };

    const state = workspaceEventsReducer(initialState, bulkEventsReceived(WS_1, [event as any]));

    expect(state.byWorkspaceId[WS_1].events[0]).toEqual({
      ...mockEvent('evt-cycle'),
      data: { command: 'pnpm test' },
    });
    expect(() => JSON.stringify(state.byWorkspaceId[WS_1].events[0])).not.toThrow();
  });

  it('drops cyclic nested event data from loaded event lists before storing', () => {
    const data: any = { command: 'pnpm test' };
    data.self = data;
    const event = { ...mockEvent('evt-loaded-cycle'), data };

    const state = workspaceEventsReducer(initialState, eventsLoaded(WS_1, [event as any]));

    expect(state.byWorkspaceId[WS_1].events[0]).toEqual({
      ...mockEvent('evt-loaded-cycle'),
      data: { command: 'pnpm test' },
    });
    expect(() => JSON.stringify(state.byWorkspaceId[WS_1].events[0])).not.toThrow();
  });

  it('clears workspace state on eventsCleared', () => {
    const loaded = workspaceEventsReducer(
      initialState,
      bulkEventsReceived(WS_1, [mockEvent('evt-1')]),
    );
    const cleared = workspaceEventsReducer(loaded, eventsCleared(WS_1));
    expect(cleared.byWorkspaceId[WS_1]).toBeUndefined();
  });

  it('returns expanded history to the bounded buffer on workspace unmount', () => {
    const recent = Array.from({ length: 300 }, (_, index) =>
      mockEvent(`recent-${index}`, WS_1, new Date(Date.UTC(2026, 0, 2, 0, 0, index)).toISOString()),
    );
    const older = Array.from({ length: 100 }, (_, index) =>
      mockEvent(`older-${index}`, WS_1, new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()),
    );
    let state = workspaceEventsReducer(initialState, eventsLoaded(WS_1, recent, 'older-1'));
    state = workspaceEventsReducer(state, olderEventsLoaded(WS_1, older, null));

    state = workspaceEventsReducer(state, workspaceUnmounted(WS_1));

    expect(state.byWorkspaceId[WS_1].events).toHaveLength(300);
    expect(state.byWorkspaceId[WS_1].events[0].id).toBe('recent-0');
    expect(state.byWorkspaceId[WS_1]).toMatchObject({
      historyExpanded: false,
      pendingLiveEventIds: null,
      nextToken: null,
      endReached: false,
    });
  });

  it('does not affect other workspaces', () => {
    let state = workspaceEventsReducer(
      initialState,
      bulkEventsReceived(WS_1, [mockEvent('evt-1')]),
    );
    state = workspaceEventsReducer(state, bulkEventsReceived(WS_2, [mockEvent('evt-2', WS_2)]));
    state = workspaceEventsReducer(state, eventsCleared(WS_1));
    expect(state.byWorkspaceId[WS_1]).toBeUndefined();
    expect(state.byWorkspaceId[WS_2].events).toHaveLength(1);
  });

  it('sets and clears loading flag', () => {
    const state = workspaceEventsReducer(initialState, setEventsLoading(WS_1, true));
    expect(state.byWorkspaceId[WS_1].loading).toBe(true);
    const next = workspaceEventsReducer(state, setEventsLoading(WS_1, false));
    expect(next.byWorkspaceId[WS_1].loading).toBe(false);
  });

  // STAB-2 regression: live events must be inserted in timestamp-sorted order
  it('inserts eventReceived in chronological order (oldest→newest)', () => {
    // Simulate initial load with 3 events in chronological order
    const initialEvents = [
      mockEvent('evt-1', WS_1, '2026-01-01T10:00:00.000Z'),
      mockEvent('evt-2', WS_1, '2026-01-01T11:00:00.000Z'),
      mockEvent('evt-3', WS_1, '2026-01-01T12:00:00.000Z'),
    ];
    let state = workspaceEventsReducer(initialState, eventsLoaded(WS_1, initialEvents));

    // Receive a new event with a timestamp between evt-1 and evt-2
    const newEvent = mockEvent('evt-mid', WS_1, '2026-01-01T10:30:00.000Z');
    state = workspaceEventsReducer(state, eventReceived(WS_1, newEvent));

    // Verify the event was inserted in the correct chronological position
    expect(state.byWorkspaceId[WS_1].events.map((e) => e.id)).toEqual([
      'evt-1',
      'evt-mid',
      'evt-2',
      'evt-3',
    ]);
  });

  it('inserts bulkEventsReceived in chronological order', () => {
    // Simulate initial load
    const initialEvents = [
      mockEvent('evt-1', WS_1, '2026-01-01T10:00:00.000Z'),
      mockEvent('evt-4', WS_1, '2026-01-01T13:00:00.000Z'),
    ];
    let state = workspaceEventsReducer(initialState, eventsLoaded(WS_1, initialEvents));

    // Receive bulk events with timestamps that should interleave
    const newEvents = [
      mockEvent('evt-2', WS_1, '2026-01-01T11:00:00.000Z'),
      mockEvent('evt-3', WS_1, '2026-01-01T12:00:00.000Z'),
      mockEvent('evt-5', WS_1, '2026-01-01T14:00:00.000Z'),
    ];
    state = workspaceEventsReducer(state, bulkEventsReceived(WS_1, newEvents));

    // Verify all events are in chronological order
    expect(state.byWorkspaceId[WS_1].events.map((e) => e.id)).toEqual([
      'evt-1',
      'evt-2',
      'evt-3',
      'evt-4',
      'evt-5',
    ]);
  });

  it('maintains chronological order when newest event arrives first', () => {
    // Start with older events
    const initialEvents = [
      mockEvent('evt-old-1', WS_1, '2026-01-01T10:00:00.000Z'),
      mockEvent('evt-old-2', WS_1, '2026-01-01T11:00:00.000Z'),
    ];
    let state = workspaceEventsReducer(initialState, eventsLoaded(WS_1, initialEvents));

    // Receive a very recent event (should go at the end)
    const recentEvent = mockEvent('evt-new', WS_1, '2026-01-02T10:00:00.000Z');
    state = workspaceEventsReducer(state, eventReceived(WS_1, recentEvent));

    // Verify newest event is at the end
    expect(state.byWorkspaceId[WS_1].events.map((e) => e.id)).toEqual([
      'evt-old-1',
      'evt-old-2',
      'evt-new',
    ]);
  });
});
