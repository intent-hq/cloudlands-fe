import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('svelte-sonner', () => ({
  toast: { error: vi.fn(), warning: vi.fn() },
}));

import { appClient } from '$lib/client';
import { ContentType, NoteVisibility, type Note } from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';
import {
  createNoteRequested,
  markNoteRead,
} from '../../note-read-tracking/note-read-tracking-slice';
import { openTab } from '../../panel-layout/panel-layout-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  addOptimisticNote,
  applyNoteUpdated,
  createNote,
  deleteNote,
  loadWorkspaceNotesSucceeded,
  updateNote,
  updateNoteContent,
  updateNoteTitle,
  workspaceNotesReducer,
} from '../workspace-notes-slice';
import { NOTE_CONTENT_SAVE_DEBOUNCE_MS, notesWriteSaga } from './notes-write-saga';

const WS = 'ws-notes-write';
const NOTE = 'note-1';
const NOW = '2026-01-01T00:00:00.000Z';
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: NoteId(NOTE),
    workspaceId: WorkspaceId(WS),
    title: 'Old',
    content: 'old body',
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Workspace,
    rev: 4,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function harness(seed = note()) {
  const channel = stdChannel();
  const actions: Parameters<typeof workspaceNotesReducer>[1][] = [];
  let workspaceNotes = workspaceNotesReducer(
    undefined,
    loadWorkspaceNotesSucceeded([WS], { [WS]: [seed] }),
  );
  const dispatch = (action: Parameters<typeof workspaceNotesReducer>[1]) => {
    workspaceNotes = workspaceNotesReducer(workspaceNotes, action);
    actions.push(action);
    return action;
  };
  const task = runSaga(
    { channel, dispatch, getState: () => ({ workspaceNotes }) },
    notesWriteSaga,
  );
  return { actions, channel, getState: () => workspaceNotes, task };
}

describe('notesWriteSaga', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('serializes content before metadata and threads the advanced revision', async () => {
    let resolveContent!: (result: { success: true }) => void;
    const setContent = vi.spyOn(appClient.notes, 'setContent').mockReturnValue(
      new Promise((resolve) => {
        resolveContent = resolve;
      }),
    );
    const updateMetadata = vi.spyOn(appClient.notes, 'updateMetadata').mockResolvedValue({
      success: true,
    });
    const run = harness();

    run.channel.put(updateNoteContent(WS, NOTE, 'new body', true));
    run.channel.put(updateNoteTitle(WS, NOTE, 'New'));
    await settle();
    expect(setContent.mock.calls).toEqual([[NOTE, 'new body', 4, WS]]);
    expect(updateMetadata.mock.calls).toEqual([]);

    resolveContent({ success: true });
    await settle();
    expect(updateMetadata.mock.calls).toEqual([[NOTE, { title: 'New' }, 5, WS]]);
    expect(run.getState().byWorkspaceId[WS]?.notes.map[NOTE]?.rev).toEqual(6);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('waits exactly 800 ms and coalesces consecutive content writes to the latest value', async () => {
    vi.useFakeTimers();
    const setContent = vi.spyOn(appClient.notes, 'setContent').mockResolvedValue({ success: true });
    const run = harness();

    run.channel.put(updateNoteContent(WS, NOTE, 'a'));
    run.channel.put(updateNoteContent(WS, NOTE, 'ab'));
    run.channel.put(updateNoteContent(WS, NOTE, 'abc'));
    await settle();

    await vi.advanceTimersByTimeAsync(NOTE_CONTENT_SAVE_DEBOUNCE_MS - 1);
    expect(setContent.mock.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(setContent.mock.calls).toEqual([[NOTE, 'abc', 4, WS]]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('creates with the exact request and reconciles the optimistic note to the canonical note', async () => {
    const created = note({ id: NoteId('note-created'), title: 'Fresh', content: '', tags: ['tag'] });
    const wireCreated = {
      ...created,
      is_pinned: true,
      is_archived: true,
      created_at: 'wire-created',
      updated_at: 'wire-updated',
    } as Note;
    const create = vi.spyOn(appClient.notes, 'create').mockResolvedValue({ success: true });
    const list = vi.spyOn(appClient.notes, 'list').mockResolvedValue([note(), wireCreated]);
    const run = harness();

    run.channel.put(createNote(WS, { title: 'Fresh', content: '', tags: ['tag'] }));
    await settle();

    expect(create.mock.calls).toEqual([[
      { workspaceId: WS, title: 'Fresh', content: '', tags: ['tag'] },
    ]]);
    expect(list.mock.calls).toEqual([[WS]]);
    expect(run.actions.slice(-2)).toEqual([
      loadWorkspaceNotesSucceeded([WS], { [WS]: [note(), created] }),
      addOptimisticNote(WS, created),
    ]);
    expect(run.getState().byWorkspaceId[WS]?.notes.ids.map(String)).toEqual([NOTE, 'note-created']);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('removes the optimistic note when creation fails without refetching', async () => {
    const create = vi.spyOn(appClient.notes, 'create').mockResolvedValue({
      success: false,
      error: 'rejected',
    });
    const list = vi.spyOn(appClient.notes, 'list');
    const run = harness();

    run.channel.put(createNote(WS, { title: 'Fresh', content: '' }));
    await settle();

    expect(create.mock.calls).toEqual([[
      { workspaceId: WS, title: 'Fresh', content: '' },
    ]]);
    expect(list.mock.calls).toEqual([]);
    expect(run.getState().byWorkspaceId[WS]?.notes.ids.map(String)).toEqual([NOTE]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('handles createNoteRequested with legacy defaults then marks read before opening the tab', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const created = note({
      id: NoteId('note-created'),
      title: 'New Note',
      content: '',
    });
    const create = vi.spyOn(appClient.notes, 'create').mockResolvedValue({ success: true });
    const list = vi.spyOn(appClient.notes, 'list').mockResolvedValue([note(), created]);
    const run = harness();

    run.channel.put(createNoteRequested(WS));
    await settle();

    expect(create.mock.calls).toEqual([[
      { workspaceId: WS, title: 'New Note', content: '', tags: [] },
    ]]);
    expect(list.mock.calls).toEqual([[WS]]);
    const orderedSuccess = run.actions.filter((action) => {
      if (action.type === addOptimisticNote.type) {
        return String((action.payload as [string, Note])[1].id) === 'note-created';
      }
      return action.type === markNoteRead.type || action.type === openTab.type;
    });
    const opened = orderedSuccess[2] as ReturnType<typeof openTab>;
    expect(orderedSuccess).toEqual([
      addOptimisticNote(WS, created),
      markNoteRead(WS, 'note-created'),
      openTab(
        WS,
        {
          type: 'note',
          title: 'New Note',
          closable: true,
          noteId: 'note-created',
          workspaceId: WS,
        },
        undefined,
        opened.payload.newTabId,
        false,
        opened.payload.timestamp,
      ),
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('refetches the canonical note after a non-conflict content failure', async () => {
    const setContent = vi.spyOn(appClient.notes, 'setContent').mockResolvedValue({
      success: false,
      error: 'rejected',
    });
    const canonical = note({ content: 'server body', rev: 8 });
    const wireCanonical = {
      ...canonical,
      is_pinned: true,
      is_archived: true,
      created_at: 'wire-created',
      updated_at: 'wire-updated',
    } as Note;
    const list = vi.spyOn(appClient.notes, 'list').mockResolvedValue([wireCanonical]);
    const run = harness();

    run.channel.put(updateNoteContent(WS, NOTE, 'mine', true));
    await settle();

    expect(setContent.mock.calls).toEqual([[NOTE, 'mine', 4, WS]]);
    expect(list.mock.calls).toEqual([[WS]]);
    expect(
      run.actions.filter((action) => action.type === loadWorkspaceNotesSucceeded.type),
    ).toEqual([loadWorkspaceNotesSucceeded([WS], { [WS]: [canonical] })]);
    expect(run.getState().byWorkspaceId[WS]?.notes.map[NOTE]).toEqual(canonical);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('applies the daemon note directly after a content conflict without a generic refetch', async () => {
    const canonical = note({ content: 'server body', rev: 8 });
    const wireCanonical = {
      ...canonical,
      is_pinned: true,
      is_archived: true,
      created_at: 'wire-created',
      updated_at: 'wire-updated',
    } as Note;
    const setContent = vi.spyOn(appClient.notes, 'setContent').mockResolvedValue({
      success: false,
      conflict: { current: wireCanonical },
    });
    const list = vi.spyOn(appClient.notes, 'list');
    const run = harness();

    run.channel.put(updateNoteContent(WS, NOTE, 'mine', true));
    await settle();

    expect(setContent.mock.calls).toEqual([[NOTE, 'mine', 4, WS]]);
    expect(list.mock.calls).toEqual([]);
    expect(run.actions.filter((action) => action.type === applyNoteUpdated.type)).toEqual([
      applyNoteUpdated(WS, NOTE, canonical),
    ]);
    expect(run.getState().byWorkspaceId[WS]?.notes.map[NOTE]).toEqual(canonical);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('rolls an optimistic title back when the daemon rejects it', async () => {
    const updateMetadata = vi.spyOn(appClient.notes, 'updateMetadata').mockResolvedValue({
      success: false,
      error: 'rejected',
    });
    const run = harness();

    run.channel.put(updateNoteTitle(WS, NOTE, 'New'));
    await settle();

    expect(updateMetadata.mock.calls).toEqual([[NOTE, { title: 'New' }, 4, WS]]);
    expect(run.getState().byWorkspaceId[WS]?.notes.map[NOTE]?.title).toEqual('Old');
    run.task.cancel();
    await run.task.toPromise();
  });

  it('rolls optimistic metadata back when the daemon rejects it', async () => {
    const updateMetadata = vi.spyOn(appClient.notes, 'updateMetadata').mockResolvedValue({
      success: false,
      error: 'rejected',
    });
    const run = harness(note({ tags: ['old'] }));

    run.channel.put(updateNote(WS, NOTE, { tags: ['new'] }));
    await settle();

    expect(updateMetadata.mock.calls).toEqual([[NOTE, { tags: ['new'] }, 4, WS]]);
    expect(run.getState().byWorkspaceId[WS]?.notes.map[NOTE]?.tags).toEqual(['old']);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('restores the deleted snapshot when the daemon rejects deletion', async () => {
    const remove = vi.spyOn(appClient.notes, 'delete').mockResolvedValue({
      success: false,
      error: 'rejected',
    });
    const snapshot = note();
    const run = harness(snapshot);

    run.channel.put(deleteNote(WS, NOTE));
    await settle();

    expect(remove.mock.calls).toEqual([[NOTE, 4, WS]]);
    expect(run.getState().byWorkspaceId[WS]?.notes.map[NOTE]).toEqual(snapshot);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('cancels a pending content debounce on workspace cleanup', async () => {
    vi.useFakeTimers();
    const setContent = vi.spyOn(appClient.notes, 'setContent').mockResolvedValue({ success: true });
    const run = harness();

    run.channel.put(updateNoteContent(WS, NOTE, 'never saved'));
    run.channel.put(workspaceUnmounted(WS));
    await vi.advanceTimersByTimeAsync(NOTE_CONTENT_SAVE_DEBOUNCE_MS);

    expect(setContent.mock.calls).toEqual([]);
    run.task.cancel();
    await run.task.toPromise();
  });
});