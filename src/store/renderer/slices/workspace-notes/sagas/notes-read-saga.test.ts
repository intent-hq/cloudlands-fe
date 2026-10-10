import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appClient } from '$lib/client';
import { SPEC_NOTE_ID } from '$shared/constants/notes';
import { ContentType, NoteVisibility, type Note } from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { paletteNoteSearchRequested, paletteReducer } from '../../palette/palette-slice';
import { selectPaletteNoteSearch } from '../../palette/palette-selectors';
import { selectNoteAttributionView } from '../workspace-notes-selectors';
import {
  applyNoteCreated,
  applyNoteDeleted,
  applyNoteUpdated,
  commentEventReceived,
  ensureNoteContentLoadedRequested,
  loadNoteCommentsRequested,
  loadWorkspaceNotesFailed,
  loadWorkspaceNotesSucceeded,
  noteEventReceived,
  noteAttributionInvalidated,
  noteAttributionViewRequested,
  readNoteRequested,
  refreshNoteFromEventRequested,
  searchNotesRequested,
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
  let windowBackendId = 'backend-a';
  let subscriptionPending = false;
  let workspaceNotes = workspaceNotesReducer(
    undefined,
    seed.length > 0
      ? loadWorkspaceNotesSucceeded([WS], { [WS]: seed })
      : ({ type: '@@init' } as never),
  );
  let palette = paletteReducer(undefined, { type: '@@init' });
  const state = () => ({
    workspaceNotes,
    palette,
    connections: { hasReceivedList: true, windowBackendId },
    daemonHealth: { health: 'up', connectionGeneration: 1 },
    workspaceEvents: { subscriptionGeneration: 1, subscriptionPending },
  });
  const dispatch = (action: any) => {
    workspaceNotes = workspaceNotesReducer(workspaceNotes, action);
    palette = paletteReducer(palette, action);
    channel.put(action);
    if (
      action.type !== readNoteRequested.type &&
      action.type !== readNoteRequested.success.type &&
      action.type !== readNoteRequested.failure.type &&
      action.type !== refreshNoteFromEventRequested.type
    ) {
      actions.push(action);
    }
    return action;
  };
  const task = runSaga({ channel, dispatch, getState: state }, notesReadSaga);
  return {
    actions,
    channel,
    dispatch,
    task,
    state,
    setConnectionContext(context: string | null) {
      subscriptionPending = context === null;
      if (context) windowBackendId = context;
    },
  };
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

  it('settles every concurrent full-content request through one shared transport read', async () => {
    const pending = deferred<Note>();
    const get = vi.spyOn(appClient.notes, 'get').mockReturnValue(pending.promise);
    const run = harness([note('note-1', { content: '', contentLength: 4 })]);
    const first = ensureNoteContentLoadedRequested(WS, 'note-1');
    const second = ensureNoteContentLoadedRequested(WS, 'note-1');
    const third = ensureNoteContentLoadedRequested(WS, 'note-1');

    run.channel.put(first);
    run.channel.put(second);
    run.channel.put(third);
    await settle();
    expect(get.mock.calls).toEqual([['note-1', WS]]);

    pending.resolve(note('note-1', { content: 'body', contentLength: 4 }));
    await expect(Promise.all([first.promise, second.promise, third.promise])).resolves.toEqual([
      true,
      true,
      true,
    ]);
    expect(run.actions.filter((action) => action.type === applyNoteUpdated.type)).toEqual([
      applyNoteUpdated(WS, 'note-1', note('note-1', { content: 'body', contentLength: 4 })),
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('joins same-resource explicit reads while settling each originating action', async () => {
    const pending = deferred<Note>();
    const get = vi.spyOn(appClient.notes, 'get').mockReturnValue(pending.promise);
    const run = harness([note('note-1')]);
    const first = readNoteRequested(WS, 'note-1');
    const second = readNoteRequested(WS, 'note-1');

    run.channel.put(first);
    run.channel.put(second);
    await settle();
    expect(get.mock.calls).toEqual([['note-1', WS]]);
    pending.resolve(note('note-1', { title: 'Shared' }));
    await expect(Promise.all([first.promise, second.promise])).resolves.toEqual([
      note('note-1', { title: 'Shared' }),
      note('note-1', { title: 'Shared' }),
    ]);

    expect(run.actions).toEqual([
      applyNoteUpdated(WS, 'note-1', note('note-1', { title: 'Shared' })),
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('uses seq to keep event refreshes newer than an overlapping content read', async () => {
    const first = deferred<Note>();
    const get = vi
      .spyOn(appClient.notes, 'get')
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(note('note-1', { content: 'final', contentLength: 5, rev: 6 }));
    const run = harness([note('note-1', { content: '', contentLength: 4, rev: 4 })]);
    const ensure = ensureNoteContentLoadedRequested(WS, 'note-1');

    run.channel.put(ensure);
    await settle();
    run.channel.put(noteEventReceived(WS, 'note-1', 'note:updated'));
    run.channel.put(noteEventReceived(WS, 'note-1', 'note:updated'));
    run.channel.put(noteEventReceived(WS, 'note-1', 'note:updated'));
    await settle();
    expect(get.mock.calls).toEqual([['note-1', WS]]);

    first.resolve(note('note-1', { content: 'intermediate', contentLength: 12, rev: 5 }));
    await expect(ensure.promise).resolves.toBe(true);
    await settle();
    expect(get.mock.calls).toHaveLength(2);
    expect(run.actions.filter((action) => action.type === applyNoteUpdated.type).at(-1)).toEqual(
      applyNoteUpdated(
        WS,
        'note-1',
        note('note-1', { content: 'final', contentLength: 5, rev: 6 }),
      ),
    );
    run.task.cancel();
    await run.task.toPromise();
  });

  it('keeps a successful leading note refresh when its trailing read fails', async () => {
    const first = deferred<Note>();
    const get = vi
      .spyOn(appClient.notes, 'get')
      .mockReturnValueOnce(first.promise)
      .mockRejectedValueOnce(new Error('offline'));
    const run = harness([note('note-1')]);

    run.channel.put(noteEventReceived(WS, 'note-1', 'note:updated'));
    await settle();
    run.channel.put(noteEventReceived(WS, 'note-1', 'note:updated'));
    first.resolve(note('note-1', { title: 'Leading result' }));

    await vi.waitFor(() => {
      expect(get).toHaveBeenCalledTimes(2);
      expect(run.actions).toEqual([
        applyNoteUpdated(WS, 'note-1', note('note-1', { title: 'Leading result' })),
      ]);
    });
    expect(run.task.isRunning()).toBe(true);
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
    await vi.waitFor(() => {
      expect(run.actions).toEqual([
        applyNoteUpdated(WS, 'note-1', note('note-1', { title: 'Intermediate' })),
        applyNoteUpdated(WS, 'note-1', note('note-1', { title: 'Final' })),
      ]);
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('does not resurrect a deleted note when an earlier event read finishes late', async () => {
    const pending = deferred<Note>();
    vi.spyOn(appClient.notes, 'get').mockReturnValue(pending.promise);
    const run = harness([note('note-1')]);

    run.channel.put(noteEventReceived(WS, 'note-1', 'note:updated'));
    await settle();
    run.channel.put(noteEventReceived(WS, 'note-1', 'note:deleted'));
    await settle();
    expect(run.actions).toEqual([applyNoteDeleted(WS, 'note-1')]);

    pending.resolve(note('note-1', { title: 'Stale result' }));
    await settle();
    expect(run.actions).toEqual([applyNoteDeleted(WS, 'note-1')]);
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

  it('settles comment loading with the protocol rows for its live consumer to apply', async () => {
    const comments = [{ id: 'comment-1', noteId: 'note-1', workspaceId: WS }] as never;
    const list = vi.spyOn(appClient.comments, 'list').mockResolvedValue(comments);
    const run = harness();
    const action = loadNoteCommentsRequested(WS, 'note-1');

    run.channel.put(action);
    await expect(action.promise).resolves.toBe(comments);

    expect(list.mock.calls).toEqual([['note-1', WS]]);
    expect(run.actions).toEqual([action.success(comments)]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('single-flights comment event bursts with one trailing reconciliation', async () => {
    const first = deferred<never[]>();
    const list = vi
      .spyOn(appClient.comments, 'list')
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce([]);
    const run = harness();

    run.channel.put(commentEventReceived(WS, 'note-1', 'added'));
    run.channel.put(commentEventReceived(WS, 'note-1', 'resolved'));
    run.channel.put(commentEventReceived(WS, 'note-1', 'added'));
    await settle();
    expect(list).toHaveBeenCalledTimes(1);

    first.resolve([]);
    await settle();
    expect(list).toHaveBeenCalledTimes(2);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('sends the exact indexed search request and settles its correlated result', async () => {
    const transport = await import('$lib/client/live/backend-transport');
    const response = { matches: [], total: 0 };
    const request = vi.spyOn(transport, 'backendRequest').mockResolvedValue(response);
    const run = harness();
    const action = searchNotesRequested('wombat', WS);

    run.channel.put(action);
    await expect(action.promise).resolves.toBe(response);
    expect(request).toHaveBeenCalledWith('search.notes', {
      query: 'wombat',
      limit: 10,
      includeArchived: false,
      preferWorkspaceId: WS,
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('coalesces an attribution update received while the current load is pending', async () => {
    const first = deferred<any>();
    const initial = {
      workspaceId: WS,
      noteId: 'note-1',
      computedAt: 'initial',
      attributions: {},
    };
    const refreshed = { ...initial, computedAt: 'refreshed' };
    const load = vi
      .spyOn(appClient.notes.lineAttribution, 'load')
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(refreshed);
    const run = harness();

    run.dispatch(noteAttributionViewRequested('gutter', 'request-1', WS, 'note-1'));
    await settle();
    run.channel.put(noteAttributionInvalidated(WS, 'note-1'));
    first.resolve(initial);

    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(selectNoteAttributionView.select(run.state() as never, WS, 'gutter')?.data).toEqual(
      refreshed,
    );
    run.task.cancel();
    await run.task.toPromise();
  });

  it('debounces palette note searches and stores the correlated indexed outcome', async () => {
    const transport = await import('$lib/client/live/backend-transport');
    const response = {
      indexed: true,
      requestId: 'daemon-request',
      matches: [
        {
          workspaceId: WS,
          noteId: 'note-1',
          title: 'Result',
          preview: 'body',
          score: 2,
          updatedAt: NOW,
          isArchived: false,
          workspaceArchived: false,
        },
      ],
    };
    const request = vi.spyOn(transport, 'backendRequest').mockResolvedValue(response);
    const run = harness();
    const action = paletteNoteSearchRequested('palette', 'request-1', 'wombat', WS);

    run.dispatch(action);
    await expect(action.promise).resolves.toMatchObject({ capability: 'indexed', fallback: false });
    expect(request).toHaveBeenCalledExactlyOnceWith('search.notes', {
      query: 'wombat',
      limit: 10,
      includeArchived: false,
      preferWorkspaceId: WS,
    });
    expect(selectPaletteNoteSearch.select(run.state() as never, 'palette')).toMatchObject({
      requestId: 'request-1',
      loading: false,
      items: [{ noteId: 'note-1', workspaceId: WS }],
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('settles a palette search and clears loading when its connection authority changes', async () => {
    const transport = await import('$lib/client/live/backend-transport');
    const request = vi.spyOn(transport, 'backendRequest');
    const run = harness();
    const action = paletteNoteSearchRequested('palette', 'request-1', 'wombat', WS);

    run.dispatch(action);
    await settle();
    run.setConnectionContext(null);

    await expect(action.promise).resolves.toMatchObject({ capability: 'unknown', loading: false });
    expect(request).not.toHaveBeenCalled();
    expect(selectPaletteNoteSearch.select(run.state() as never, 'palette')).toMatchObject({
      requestId: 'request-1',
      loading: false,
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('cancels an obsolete palette debounce and settles both callers', async () => {
    const transport = await import('$lib/client/live/backend-transport');
    const request = vi.spyOn(transport, 'backendRequest').mockResolvedValue({
      indexed: true,
      requestId: 'daemon-request',
      matches: [],
    });
    const run = harness();
    const first = paletteNoteSearchRequested('palette', 'request-1', 'old', WS);
    const second = paletteNoteSearchRequested('palette', 'request-2', 'new', WS);

    run.dispatch(first);
    run.dispatch(second);
    await expect(first.promise).resolves.toMatchObject({ capability: 'unknown' });
    await expect(second.promise).resolves.toMatchObject({ capability: 'indexed' });
    expect(request).toHaveBeenCalledExactlyOnceWith('search.notes', {
      query: 'new',
      limit: 10,
      includeArchived: false,
      preferWorkspaceId: WS,
    });
    expect(selectPaletteNoteSearch.select(run.state() as never, 'palette')).toMatchObject({
      requestId: 'request-2',
      capability: 'indexed',
    });
    run.task.cancel();
    await run.task.toPromise();
  });
});
