import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock(
  '$lib/electron-bridge',
  async () => await import('$store/renderer/utils/test-helpers/electron-bridge-mock'),
);
vi.mock(
  '$lib/utils/client-logger',
  async () => await import('$store/renderer/utils/test-helpers/client-logger-mock'),
);

import { invoke } from '$lib/electron-bridge';
import { USER_ACTIVITY_CHANNELS } from '$shared/ipc/channels';
import { selectUnreadNoteIds } from '../note-read-tracking-selectors';
import {
  initialState,
  markNoteRead,
  noteReadTrackingReducer,
  refreshUnreadNotes,
  type NoteReadTrackingState,
} from '../note-read-tracking-slice';
import { COMPUTE_DEBOUNCE_MS, noteReadTrackingSaga } from './note-read-tracking-saga';

const NOTES = [
  { id: 'note-1', updatedAt: '2026-01-02T00:00:00.000Z' },
  { id: 'note-2', updatedAt: '2026-01-02T00:00:00.000Z' },
];

function createHarness(seed: NoteReadTrackingState = initialState) {
  let sliceState = seed;
  const channel = stdChannel();
  const dispatch = (action: unknown) => {
    sliceState = noteReadTrackingReducer(sliceState, action as { type: string });
  };
  const task = runSaga(
    { channel, dispatch, getState: () => ({ noteReadTracking: sliceState }) },
    noteReadTrackingSaga,
  );
  const put = (action: { type: string }) => {
    dispatch(action);
    channel.put(action);
  };
  const state = () => ({ noteReadTracking: sliceState });
  const finish = async () => {
    task.cancel();
    await task.toPromise();
  };
  return { put, state, finish };
}

const settle = async () => {
  await vi.advanceTimersByTimeAsync(COMPUTE_DEBOUNCE_MS);
  await vi.advanceTimersByTimeAsync(0);
};

describe('noteReadTrackingSaga', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('populates unreadNoteIds when refreshUnreadNotes is dispatched (regression)', async () => {
    vi.mocked(invoke).mockResolvedValue({ success: true, data: ['note-1', 'note-2'] });
    const harness = createHarness();

    harness.put(refreshUnreadNotes('ws-1', NOTES));
    await settle();

    expect(invoke).toHaveBeenCalledWith(USER_ACTIVITY_CHANNELS.GET_UNREAD_NOTE_IDS, {
      workspaceId: 'ws-1',
      notes: NOTES,
    });
    expect(harness.state().noteReadTracking.unreadNoteIds).toEqual({
      'note-1': true,
      'note-2': true,
    });
    expect(harness.state().noteReadTracking.isLoading).toBe(false);
    // The badge reads through this selector (NotesPanel.svelte).
    expect(selectUnreadNoteIds.select(harness.state())).toEqual(['note-1', 'note-2']);
    await harness.finish();
  });

  it('debounces rapid refreshes into one IPC call with the latest payload', async () => {
    vi.mocked(invoke).mockResolvedValue({ success: true, data: [] });
    const harness = createHarness();

    harness.put(refreshUnreadNotes('ws-1', [NOTES[0]]));
    harness.put(refreshUnreadNotes('ws-1', NOTES));
    await settle();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(USER_ACTIVITY_CHANNELS.GET_UNREAD_NOTE_IDS, {
      workspaceId: 'ws-1',
      notes: NOTES,
    });
    await harness.finish();
  });

  it('filters out notes whose local read record is newer than the update', async () => {
    vi.mocked(invoke).mockResolvedValue({ success: true, data: ['note-1', 'note-2'] });
    const harness = createHarness({
      ...initialState,
      readRecords: { 'note-1': { lastReadAt: '2026-01-03T00:00:00.000Z', readCount: 1 } },
    });

    harness.put(refreshUnreadNotes('ws-1', NOTES));
    await settle();

    expect(harness.state().noteReadTracking.unreadNoteIds).toEqual({ 'note-2': true });
    await harness.finish();
  });

  it('persists markNoteRead via IPC', async () => {
    vi.mocked(invoke).mockResolvedValue({ success: true });
    const harness = createHarness();

    harness.put(markNoteRead('ws-1', 'note-1'));
    await settle();

    expect(invoke).toHaveBeenCalledWith(USER_ACTIVITY_CHANNELS.MARK_NOTE_READ, {
      workspaceId: 'ws-1',
      noteId: 'note-1',
    });
    await harness.finish();
  });

  it('clears the loading flag when the IPC call fails', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('ipc down'));
    const harness = createHarness();

    harness.put(refreshUnreadNotes('ws-1', NOTES));
    await settle();

    expect(harness.state().noteReadTracking.isLoading).toBe(false);
    expect(harness.state().noteReadTracking.unreadNoteIds).toEqual({});
    await harness.finish();
  });
});
