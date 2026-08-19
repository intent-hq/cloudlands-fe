import { describe, expect, it } from 'vitest';
import type { WorkspaceEvent } from '$features/events/types';
import { eventReceived, eventsLoaded, initialState, workspaceEventsReducer } from './workspace-events-slice';

const WS_1 = 'ws-1';

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
