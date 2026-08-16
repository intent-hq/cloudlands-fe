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
import { addOptimisticNote, createNote, loadWorkspaceNotesSucceeded, updateNote, workspaceNotesReducer } from '../workspace-notes-slice';
import { notesWriteSaga } from './notes-write-saga';

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

function harness(seed: Note | Note[] = note()) {
  const channel = stdChannel();
  const actions: Parameters<typeof workspaceNotesReducer>[1][] = [];
  const notesByWorkspace: Record<string, Note[]> = {};
  for (const item of Array.isArray(seed) ? seed : [seed]) {
    const workspaceId = String(item.workspaceId);
    (notesByWorkspace[workspaceId] ??= []).push(item);
  }
  let workspaceNotes = workspaceNotesReducer(
    undefined,
    loadWorkspaceNotesSucceeded(Object.keys(notesByWorkspace), notesByWorkspace),
  );
  const dispatch = (action: Parameters<typeof workspaceNotesReducer>[1]) => {
    workspaceNotes = workspaceNotesReducer(workspaceNotes, action);
    actions.push(action);
    return action;
  };
  const task = runSaga({ channel, dispatch, getState: () => ({ workspaceNotes }) }, notesWriteSaga);
  return { actions, channel, getState: () => workspaceNotes, task };
}

describe('notesWriteSaga', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates with the exact request and reconciles the optimistic note to the canonical note', async () => {
    const created = note({
      id: NoteId('note-created'),
      title: 'Fresh',
      content: '',
      tags: ['tag'],
    });
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

    expect(create.mock.calls).toEqual([
      [{ workspaceId: WS, title: 'Fresh', content: '', tags: ['tag'] }],
    ]);
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

    expect(create.mock.calls).toEqual([[{ workspaceId: WS, title: 'Fresh', content: '' }]]);
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

    expect(create.mock.calls).toEqual([
      [{ workspaceId: WS, title: 'New Note', content: '', tags: [] }],
    ]);
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
});
