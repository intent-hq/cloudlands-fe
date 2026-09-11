import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appClient } from '$lib/client';
import { SPEC_NOTE_ID } from '$shared/constants/notes';
import { ContentType, NoteVisibility, type Note } from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  applyNoteCreated,
  applyNoteDeleted,
  applyNoteUpdated,
  loadWorkspaceNotesFailed,
  loadWorkspaceNotesSucceeded,
  noteEventReceived,
  selectNote,
  workspaceNotesReducer,
  workspaceNotesHydrationRequested,
} from '../workspace-notes-slice';
import { notesReadSaga } from './notes-read-saga';

const WS = 'ws-notes-read';
const NOW = '2026-01-01T00:00:00.000Z';
const workspaceMounted = (workspaceId: string) =>
  workspaceNotesHydrationRequested(workspaceId, 1, false);
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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
  const task = runSaga({ channel, dispatch, getState: () => ({ workspaceNotes }) }, notesReadSaga);
  return { actions, channel, task };
}

describe('notesReadSaga', () => {
  afterEach(() => vi.restoreAllMocks());

  it('hydrates with the slim-list + full-spec requests and maps the protocol note field by field', async () => {
    const spec = {
      ...note(SPEC_NOTE_ID),
      is_pinned: true,
      is_archived: true,
      created_at: 'wire-created',
      updated_at: 'wire-updated',
      wireOnly: 'drop',
    } as Note;
    const list = vi.spyOn(appClient.notes, 'list').mockResolvedValue([spec]);
    const get = vi.spyOn(appClient.notes, 'get').mockResolvedValue(spec);
    const run = harness();

    run.channel.put(workspaceMounted(WS));
    await settle();

    expect(list.mock.calls).toEqual([[WS, { projection: 'slim' }]]);
    expect(get.mock.calls).toEqual([[SPEC_NOTE_ID, WS]]);
    expect(run.actions).toEqual([
      loadWorkspaceNotesSucceeded([WS], { [WS]: [note(SPEC_NOTE_ID)] }),
      selectNote(WS, SPEC_NOTE_ID),
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('hydrate replaces the slim spec row with the full-spec fetch result', async () => {
    const slimSpec = note(SPEC_NOTE_ID, { content: '', contentPreview: 'pre', contentLength: 9 });
    const fullSpec = note(SPEC_NOTE_ID, { content: 'full body' });
    vi.spyOn(appClient.notes, 'list').mockResolvedValue([slimSpec, note('other', { content: '' })]);
    vi.spyOn(appClient.notes, 'get').mockResolvedValue(fullSpec);
    const run = harness();

    run.channel.put(workspaceMounted(WS));
    await settle();

    expect(run.actions).toEqual([
      loadWorkspaceNotesSucceeded([WS], {
        [WS]: [note(SPEC_NOTE_ID, { content: 'full body' }), note('other', { content: '' })],
      }),
      selectNote(WS, SPEC_NOTE_ID),
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('hydrate stays fail-soft when the spec fetch rejects — slim rows land as-is', async () => {
    const slimSpec = note(SPEC_NOTE_ID, { content: '', contentPreview: 'pre', contentLength: 9 });
    vi.spyOn(appClient.notes, 'list').mockResolvedValue([slimSpec]);
    vi.spyOn(appClient.notes, 'get').mockRejectedValue(new Error('no spec'));
    const run = harness();

    run.channel.put(workspaceMounted(WS));
    await settle();

    expect(run.actions).toEqual([
      loadWorkspaceNotesSucceeded([WS], { [WS]: [slimSpec] }),
      selectNote(WS, SPEC_NOTE_ID),
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('hydrates distinct mounted workspaces concurrently with workspace-scoped spec selection', async () => {
    const secondWorkspaceId = 'ws-notes-read-second';
    const first = deferred<Note[]>();
    const second = deferred<Note[]>();
    const firstSpec = note(SPEC_NOTE_ID);
    const secondSpec = note(SPEC_NOTE_ID, { workspaceId: WorkspaceId(secondWorkspaceId) });
    const list = vi
      .spyOn(appClient.notes, 'list')
      .mockImplementation((workspaceId) => (workspaceId === WS ? first.promise : second.promise));
    vi.spyOn(appClient.notes, 'get').mockImplementation((_noteId, workspaceId) =>
      Promise.resolve(workspaceId === WS ? firstSpec : secondSpec),
    );
    const run = harness();

    run.channel.put(workspaceMounted(WS));
    run.channel.put(workspaceMounted(secondWorkspaceId));
    await settle();

    expect(list.mock.calls).toEqual([
      [WS, { projection: 'slim' }],
      [secondWorkspaceId, { projection: 'slim' }],
    ]);
    second.resolve([secondSpec]);
    await settle();
    first.resolve([firstSpec]);
    await settle();
    expect(run.actions).toEqual([
      loadWorkspaceNotesSucceeded([secondWorkspaceId], { [secondWorkspaceId]: [secondSpec] }),
      selectNote(secondWorkspaceId, SPEC_NOTE_ID),
      loadWorkspaceNotesSucceeded([WS], { [WS]: [firstSpec] }),
      selectNote(WS, SPEC_NOTE_ID),
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('coalesces duplicate mounts for the same workspace while its read is in flight', async () => {
    const pending = deferred<Note[]>();
    const list = vi.spyOn(appClient.notes, 'list').mockReturnValue(pending.promise);
    vi.spyOn(appClient.notes, 'get').mockRejectedValue(new Error('no spec'));
    const run = harness();

    run.channel.put(workspaceMounted(WS));
    run.channel.put(workspaceMounted(WS));
    await settle();

    expect(list.mock.calls).toEqual([[WS, { projection: 'slim' }]]);
    pending.resolve([]);
    await settle();
    expect(run.actions).toEqual([loadWorkspaceNotesSucceeded([WS], { [WS]: [] })]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('isolates cleanup to one workspace, suppresses its stale result, and permits a retry', async () => {
    const secondWorkspaceId = 'ws-notes-read-second';
    const firstAttempt = deferred<Note[]>();
    const retry = deferred<Note[]>();
    const second = deferred<Note[]>();
    let firstWorkspaceCalls = 0;
    const list = vi.spyOn(appClient.notes, 'list').mockImplementation((workspaceId) => {
      if (workspaceId === secondWorkspaceId) return second.promise;
      firstWorkspaceCalls += 1;
      return firstWorkspaceCalls === 1 ? firstAttempt.promise : retry.promise;
    });
    vi.spyOn(appClient.notes, 'get').mockRejectedValue(new Error('no spec'));
    const run = harness();

    run.channel.put(workspaceMounted(WS));
    run.channel.put(workspaceMounted(secondWorkspaceId));
    await settle();
    run.channel.put(workspaceUnmounted(WS));
    await settle();
    run.channel.put(workspaceMounted(WS));
    await settle();

    expect(list.mock.calls).toEqual([
      [WS, { projection: 'slim' }],
      [secondWorkspaceId, { projection: 'slim' }],
      [WS, { projection: 'slim' }],
    ]);
    second.resolve([note('second-note', { workspaceId: WorkspaceId(secondWorkspaceId) })]);
    retry.resolve([note('retry-note')]);
    firstAttempt.resolve([note('stale-note')]);
    await settle();
    expect(run.actions).toEqual([
      loadWorkspaceNotesSucceeded([secondWorkspaceId], {
        [secondWorkspaceId]: [note('second-note', { workspaceId: WorkspaceId(secondWorkspaceId) })],
      }),
      loadWorkspaceNotesSucceeded([WS], { [WS]: [note('retry-note')] }),
    ]);
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

  it('forces an initialized workspace refresh for a reconnect generation', async () => {
    const list = vi.spyOn(appClient.notes, 'list').mockResolvedValue([]);
    vi.spyOn(appClient.notes, 'get').mockRejectedValue(new Error('no spec'));
    const run = harness([note('seeded')]);

    run.channel.put(workspaceNotesHydrationRequested(WS, 2, true));
    await settle();

    expect(list.mock.calls).toEqual([[WS, { projection: 'slim' }]]);
    expect(run.actions).toEqual([loadWorkspaceNotesSucceeded([WS], { [WS]: [] })]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('cancels stale hydration when a fresh generation arrives in flight', async () => {
    const first = deferred<Note[]>();
    const fresh = note('fresh');
    const list = vi
      .spyOn(appClient.notes, 'list')
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce([fresh]);
    vi.spyOn(appClient.notes, 'get').mockRejectedValue(new Error('no spec'));
    const run = harness();

    run.channel.put(workspaceNotesHydrationRequested(WS, 1, false));
    await settle();
    run.channel.put(workspaceNotesHydrationRequested(WS, 2, true));
    await settle();

    expect(list.mock.calls).toEqual([
      [WS, { projection: 'slim' }],
      [WS, { projection: 'slim' }],
    ]);
    expect(run.actions).toEqual([loadWorkspaceNotesSucceeded([WS], { [WS]: [fresh] })]);
    first.resolve([note('stale')]);
    await settle();
    expect(run.actions).toEqual([loadWorkspaceNotesSucceeded([WS], { [WS]: [fresh] })]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('maps a hydration rejection to the exact workspace failure action', async () => {
    const list = vi.spyOn(appClient.notes, 'list').mockRejectedValue(new Error('offline'));
    vi.spyOn(appClient.notes, 'get').mockRejectedValue(new Error('no spec'));
    const run = harness();

    run.channel.put(workspaceMounted(WS));
    await settle();

    expect(list.mock.calls).toEqual([[WS, { projection: 'slim' }]]);
    expect(run.actions).toEqual([loadWorkspaceNotesFailed([WS], 'offline')]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('runs per-note event reads concurrently and suppresses the active result after cleanup', async () => {
    const first = deferred<Note>();
    const second = deferred<Note>();
    const get = vi
      .spyOn(appClient.notes, 'get')
      .mockImplementation((noteId) => (noteId === 'note-1' ? first.promise : second.promise));
    const run = harness();

    run.channel.put(noteEventReceived(WS, 'note-1', 'note:updated'));
    await settle();
    // A DIFFERENT note's event starts its own concurrent fetch instead of
    // being dropped by a global leading take while note-1 is in flight.
    run.channel.put(noteEventReceived('ws-other', 'note-2', 'note:created'));
    await settle();
    expect(get.mock.calls).toEqual([
      ['note-1', WS],
      ['note-2', 'ws-other'],
    ]);

    run.channel.put(workspaceUnmounted(WS));
    await settle();
    first.resolve(note('note-1'));
    await settle();

    // note-1's result raced against its workspace cleanup and is suppressed.
    expect(run.actions).toEqual([]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('coalesces a same-note event burst onto one trailing refetch', async () => {
    const first = deferred<Note>();
    const get = vi
      .spyOn(appClient.notes, 'get')
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(note('note-1', { title: 'Final' }));
    const run = harness([note('note-1')]);

    run.channel.put(noteEventReceived(WS, 'note-1', 'note:updated'));
    await settle();
    run.channel.put(noteEventReceived(WS, 'note-1', 'note:updated'));
    run.channel.put(noteEventReceived(WS, 'note-1', 'note:updated'));
    await settle();
    // Single-flight: the burst rides the in-flight fetch.
    expect(get.mock.calls).toEqual([['note-1', WS]]);

    first.resolve(note('note-1', { title: 'Intermediate' }));
    await settle();

    // One trailing refetch after the leading fetch settles; the final state
    // reflects the trailing result.
    expect(get.mock.calls).toEqual([
      ['note-1', WS],
      ['note-1', WS],
    ]);
    expect(run.actions).toEqual([
      applyNoteUpdated(WS, 'note-1', note('note-1', { title: 'Intermediate' })),
      applyNoteUpdated(WS, 'note-1', note('note-1', { title: 'Final' })),
    ]);
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
    vi.spyOn(appClient.notes, 'get').mockRejectedValue(new Error('no spec'));
    const run = harness();

    run.channel.put(workspaceMounted(WS));
    await settle();
    run.channel.put(workspaceUnmounted(WS));
    await settle();
    resolve([note('late')]);
    await settle();

    expect(list.mock.calls).toEqual([[WS, { projection: 'slim' }]]);
    expect(run.actions).toEqual([]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('cancels every active workspace hydration and suppresses late results on root shutdown', async () => {
    const secondWorkspaceId = 'ws-notes-read-second';
    const first = deferred<Note[]>();
    const second = deferred<Note[]>();
    const list = vi
      .spyOn(appClient.notes, 'list')
      .mockImplementation((workspaceId) => (workspaceId === WS ? first.promise : second.promise));
    vi.spyOn(appClient.notes, 'get').mockRejectedValue(new Error('no spec'));
    const run = harness();

    run.channel.put(workspaceMounted(WS));
    run.channel.put(workspaceMounted(secondWorkspaceId));
    await settle();
    expect(list.mock.calls).toEqual([
      [WS, { projection: 'slim' }],
      [secondWorkspaceId, { projection: 'slim' }],
    ]);

    run.task.cancel();
    await run.task.toPromise();
    first.resolve([note('late-first')]);
    second.resolve([note('late-second', { workspaceId: WorkspaceId(secondWorkspaceId) })]);
    await settle();

    expect(run.actions).toEqual([]);
  });

  it('applies a deleted event without fetching', async () => {
    const get = vi.spyOn(appClient.notes, 'get');
    const run = harness([note('note-1')]);

    run.channel.put(noteEventReceived(WS, 'note-1', 'note:deleted'));
    await settle();

    expect(get.mock.calls).toEqual([]);
    expect(run.actions).toEqual([applyNoteDeleted(WS, 'note-1')]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('maps a created event to the exact created action', async () => {
    const created = note('note-created');
    const get = vi.spyOn(appClient.notes, 'get').mockResolvedValue(created);
    const run = harness([note('existing')]);

    run.channel.put(noteEventReceived(WS, 'note-created', 'note:created'));
    await settle();

    expect(get.mock.calls).toEqual([['note-created', WS]]);
    expect(run.actions).toEqual([applyNoteCreated(WS, created)]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('maps an updated event to the exact updated action', async () => {
    const updated = note('note-1', { title: 'Updated' });
    const get = vi.spyOn(appClient.notes, 'get').mockResolvedValue(updated);
    const run = harness([note('note-1')]);

    run.channel.put(noteEventReceived(WS, 'note-1', 'note:updated'));
    await settle();

    expect(get.mock.calls).toEqual([['note-1', WS]]);
    expect(run.actions).toEqual([applyNoteUpdated(WS, 'note-1', updated)]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('does not double-dispatch when an event refresh rejects', async () => {
    const get = vi.spyOn(appClient.notes, 'get').mockRejectedValue(new Error('offline'));
    const run = harness([note('note-1')]);

    run.channel.put(noteEventReceived(WS, 'note-1', 'note:updated'));
    await settle();

    expect(get.mock.calls).toEqual([['note-1', WS]]);
    expect(run.actions).toEqual([]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('ignores an event whose returned note belongs to another workspace', async () => {
    const foreign = note('note-1', { workspaceId: WorkspaceId('other-workspace') });
    const get = vi.spyOn(appClient.notes, 'get').mockResolvedValue(foreign);
    const run = harness([note('note-1')]);

    run.channel.put(noteEventReceived(WS, 'note-1', 'note:updated'));
    await settle();

    expect(get.mock.calls).toEqual([['note-1', WS]]);
    expect(run.actions).toEqual([]);
    run.task.cancel();
    await run.task.toPromise();
  });
});
