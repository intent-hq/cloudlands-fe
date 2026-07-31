import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appClient } from '$lib/client';
import { SPEC_NOTE_ID } from '$shared/constants/notes';
import { ContentType, NoteVisibility, type Note } from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';
import {
  workspaceMounted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  applyNoteCreated,
  applyNoteDeleted,
  applyNoteUpdated,
  loadWorkspaceNotesFailed,
  loadWorkspaceNotesSucceeded,
  selectNote,
  workspaceNotesReducer,
} from '../workspace-notes-slice';
import { noteEventReceived, notesReadSaga } from './notes-read-saga';

const WS = 'ws-notes-read';
const NOW = '2026-01-01T00:00:00.000Z';
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function note(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id: NoteId(id),
    workspaceId: WorkspaceId(WS),
    title: `Note ${id}`,
    content: 'body',
    contentType: ContentType.Markdown,
    tags: ['one'],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Workspace,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function harness(seed: Note[] = []) {
  const channel = stdChannel();
  const actions: Parameters<typeof workspaceNotesReducer>[1][] = [];
  let workspaceNotes = workspaceNotesReducer(
    undefined,
    seed.length > 0
      ? loadWorkspaceNotesSucceeded([WS], { [WS]: seed })
      : ({ type: '@@init' } as never),
  );
  const dispatch = (action: Parameters<typeof workspaceNotesReducer>[1]) => {
    workspaceNotes = workspaceNotesReducer(workspaceNotes, action);
    actions.push(action);
    return action;
  };
  const task = runSaga(
    { channel, dispatch, getState: () => ({ workspaceNotes }) },
    notesReadSaga,
  );
  return { actions, channel, task };
}

describe('notesReadSaga', () => {
  afterEach(() => vi.restoreAllMocks());

  it('hydrates with the exact request and maps the protocol note field by field', async () => {
    const spec = {
      ...note(SPEC_NOTE_ID),
      is_pinned: true,
      is_archived: true,
      created_at: 'wire-created',
      updated_at: 'wire-updated',
      wireOnly: 'drop',
    } as Note;
    const list = vi.spyOn(appClient.notes, 'list').mockResolvedValue([spec]);
    const run = harness();

    run.channel.put(workspaceMounted(WS));
    await settle();

    expect(list.mock.calls).toEqual([[WS]]);
    expect(run.actions).toEqual([
      loadWorkspaceNotesSucceeded([WS], { [WS]: [note(SPEC_NOTE_ID)] }),
      selectNote(WS, SPEC_NOTE_ID),
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('coalesces rapid workspace hydration requests while the first fetch is in flight', async () => {
    let resolve!: (notes: Note[]) => void;
    const list = vi.spyOn(appClient.notes, 'list').mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const run = harness();

    run.channel.put(workspaceMounted(WS));
    run.channel.put(workspaceMounted(WS));
    run.channel.put(workspaceMounted(WS));
    await settle();

    expect(list.mock.calls).toEqual([[WS]]);
    resolve([]);
    await settle();
    expect(run.actions).toEqual([loadWorkspaceNotesSucceeded([WS], { [WS]: [] })]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('does not rehydrate an already initialized workspace', async () => {
    const list = vi.spyOn(appClient.notes, 'list');
    const run = harness([note('seeded')]);

    run.channel.put(workspaceMounted(WS));
    await settle();

    expect(list.mock.calls).toEqual([]);
    expect(run.actions).toEqual([]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('maps a hydration rejection to the exact workspace failure action', async () => {
    const list = vi.spyOn(appClient.notes, 'list').mockRejectedValue(new Error('offline'));
    const run = harness();

    run.channel.put(workspaceMounted(WS));
    await settle();

    expect(list.mock.calls).toEqual([[WS]]);
    expect(run.actions).toEqual([loadWorkspaceNotesFailed([WS], 'offline')]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('coalesces a keyed event read and suppresses its late result after cleanup', async () => {
    let resolve!: (notes: Note[]) => void;
    const list = vi.spyOn(appClient.notes, 'list').mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const run = harness();
    const event = noteEventReceived(WS, 'note-1', 'note:updated');

    run.channel.put(event);
    await settle();
    run.channel.put(event);
    run.channel.put(workspaceUnmounted(WS));
    await settle();
    resolve([note('note-1')]);
    await settle();

    expect(list.mock.calls).toEqual([[WS]]);
    expect(run.actions).toEqual([]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('cancels an in-flight workspace hydration and suppresses its late result on cleanup', async () => {
    let resolve!: (notes: Note[]) => void;
    const list = vi.spyOn(appClient.notes, 'list').mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const run = harness();

    run.channel.put(workspaceMounted(WS));
    await settle();
    run.channel.put(workspaceUnmounted(WS));
    await settle();
    resolve([note('late')]);
    await settle();

    expect(list.mock.calls).toEqual([[WS]]);
    expect(run.actions).toEqual([]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('applies a deleted event without fetching', async () => {
    const list = vi.spyOn(appClient.notes, 'list');
    const run = harness([note('note-1')]);

    run.channel.put(noteEventReceived(WS, 'note-1', 'note:deleted'));
    await settle();

    expect(list.mock.calls).toEqual([]);
    expect(run.actions).toEqual([applyNoteDeleted(WS, 'note-1')]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('maps a created event to the exact created action', async () => {
    const created = note('note-created');
    const list = vi.spyOn(appClient.notes, 'list').mockResolvedValue([created]);
    const run = harness([note('existing')]);

    run.channel.put(noteEventReceived(WS, 'note-created', 'note:created'));
    await settle();

    expect(list.mock.calls).toEqual([[WS]]);
    expect(run.actions).toEqual([applyNoteCreated(WS, created)]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('maps an updated event to the exact updated action', async () => {
    const updated = note('note-1', { title: 'Updated' });
    const list = vi.spyOn(appClient.notes, 'list').mockResolvedValue([updated]);
    const run = harness([note('note-1')]);

    run.channel.put(noteEventReceived(WS, 'note-1', 'note:updated'));
    await settle();

    expect(list.mock.calls).toEqual([[WS]]);
    expect(run.actions).toEqual([applyNoteUpdated(WS, 'note-1', updated)]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('does not double-dispatch when an event refresh rejects', async () => {
    const list = vi.spyOn(appClient.notes, 'list').mockRejectedValue(new Error('offline'));
    const run = harness([note('note-1')]);

    run.channel.put(noteEventReceived(WS, 'note-1', 'note:updated'));
    await settle();

    expect(list.mock.calls).toEqual([[WS]]);
    expect(run.actions).toEqual([]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('ignores an event whose returned note belongs to another workspace', async () => {
    const foreign = note('note-1', { workspaceId: WorkspaceId('other-workspace') });
    const list = vi.spyOn(appClient.notes, 'list').mockResolvedValue([foreign]);
    const run = harness([note('note-1')]);

    run.channel.put(noteEventReceived(WS, 'note-1', 'note:updated'));
    await settle();

    expect(list.mock.calls).toEqual([[WS]]);
    expect(run.actions).toEqual([]);
    run.task.cancel();
    await run.task.toPromise();
  });
});