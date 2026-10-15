import { runSaga, stdChannel, type Task } from 'redux-saga';
import { select, call, fork, type SagaGenerator } from 'typed-redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { createNoteSetContent } from '../../../../../lib/client/live/backend-note-set-content';
import type { NoteSetContentOptions } from '../../../../../lib/client/app-client';
import { ContentType, NoteVisibility, type Note } from '../../../../../shared/types';
import { NoteId, WorkspaceId } from '../../../../../shared/types/branded-ids';
import {
  workspaceUnmounted,
  workspaceDeleted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import * as projections from '../workspace-notes-projections';
import * as actions from '../workspace-notes-slice';
import { createNotesWriteSaga } from './notes-write-saga-factory';
import type { ExplicitNoteEditorIdentity } from '../workspace-notes-types';

const identity: ExplicitNoteEditorIdentity = {
  workspaceId: 'ws',
  noteId: 'note',
  viewId: 'view',
  authority: 'principal',
  context: 'connection-1',
};
const tasks: Task[] = [];
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function note(overrides: Partial<Note> = {}): Note {
  return {
    id: NoteId('note'),
    workspaceId: WorkspaceId('ws'),
    title: 'Ordinary note',
    content: 'one\ntwo\n',
    rev: 4,
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Workspace,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}
function harness(
  seed = note(),
  transport?: (
    options: Pick<NoteSetContentOptions, 'onDispatch'>,
    params: unknown,
  ) => Promise<unknown>,
  blocking?: Promise<unknown>,
) {
  const channel = stdChannel();
  let workspaceNotes = actions.workspaceNotesReducer(
    undefined,
    actions.loadWorkspaceNotesSucceeded(['ws'], { ws: [seed] }),
  );
  let authority = 'principal';
  let context = 'connection-1';
  let ready = true;
  const getState = () => ({ workspaceNotes });
  const dispatched: Parameters<typeof actions.workspaceNotesReducer>[1][] = [];
  let observe: ((action: Parameters<typeof actions.workspaceNotesReducer>[1]) => void) | undefined;
  const dispatch = (action: Parameters<typeof actions.workspaceNotesReducer>[1]) => {
    workspaceNotes = actions.workspaceNotesReducer(workspaceNotes, action);
    dispatched.push(action);
    observe?.(action);
    channel.put(action);
    return action;
  };
  const wire = vi.fn(async (_method: string, params: unknown) => ({
    ok: true,
    noteId: 'note',
    newContent: (params as { content: string }).content,
    rev: 5,
  }));
  const backendRequest = vi.fn(
    async <T>(
      _method: string,
      params?: unknown,
      options?: Partial<Pick<NoteSetContentOptions, 'onDispatch'>>,
    ): Promise<T> => {
      const guarded = { onDispatch: options?.onDispatch ?? (() => {}) };
      if (transport) return (await transport(guarded, params)) as T;
      guarded.onDispatch();
      return (await wire(_method, params)) as T;
    },
  );
  const notes = { setContent: createNoteSetContent({ backendRequest }) };
  const selector = <A extends unknown[], R>(
    project: (state: ReturnType<typeof getState>, ...args: A) => R,
  ) => ({
    *effect(...args: A): SagaGenerator<R> {
      return yield* select(project, ...args);
    },
  });
  const saga = createNotesWriteSaga({
    notes,
    ...(blocking
      ? {
          source: {
            *register(queue: import('../workspace-notes-types').NotesWriteQueue) {
              yield* fork(queue.enqueue, 'ws', 'note', function* () {
                return yield* call(() => blocking);
              });
            },
            *onContentFailure() {},
          },
        }
      : {}),
    selectNoteById: selector(projections.getNoteById),
    explicit: {
      selectEditor: selector(projections.getExplicitNoteEditor),
      selectOperations: selector(projections.getExplicitNoteSaveOperations),
      isCurrent: (request) =>
        ready &&
        request.authority === authority &&
        request.context === context &&
        projections.getExplicitNoteEditorCurrent(getState(), request),
      canPublish: (request) => request.authority === authority,
      dispatch,
    },
  });
  const task = runSaga({ channel, dispatch, getState }, saga);
  tasks.push(task);
  const open = (value = identity) => dispatch(actions.explicitNoteEditorOpened(value));
  const edit = (content: string, viewId = 'view') =>
    dispatch(actions.explicitNoteDraftChanged(viewId, content));
  const save = (requestId = 'save', value = identity) =>
    dispatch(
      actions.explicitNoteSaveRequested({
        ...value,
        requestId,
        draftSeq: projections.getExplicitNoteEditor(getState(), value.viewId)?.draftSeq ?? 0,
      }),
    );
  const editor = (viewId = 'view') => projections.getExplicitNoteEditor(getState(), viewId);
  const ops = () => projections.getExplicitNoteSaveOperations(getState(), 'ws', 'note');
  return {
    open,
    edit,
    save,
    editor,
    ops,
    wire,
    backendRequest,
    task,
    dispatch,
    getState,
    dispatched,
    setReady: (value: boolean) => {
      ready = value;
    },
    setAuthority: (value: string) => {
      authority = value;
    },
    setContext: (value: string) => {
      context = value;
    },
    observe: (fn: typeof observe) => {
      observe = fn;
    },
  };
}
afterEach(async () => {
  for (const task of tasks.splice(0)) {
    task.cancel();
    await task.toPromise();
  }
  vi.useRealTimers();
});

describe('shared explicit note writer', () => {
  it('writes only on Save, deduplicates repeated clicks, and requires actual merged content/revision', async () => {
    const pending = deferred<unknown>();
    const run = harness(note(), async (options) => {
      options.onDispatch();
      return pending.promise;
    });
    run.open();
    run.edit('one edited\ntwo\n');
    await settle();
    expect(run.backendRequest).not.toHaveBeenCalled();
    expect(projections.getNoteById(run.getState(), 'ws', 'note')?.content).toBe('one\ntwo\n');
    run.save();
    run.save();
    run.save('another');
    await settle();
    expect(run.backendRequest).toHaveBeenCalledTimes(1);
    expect(run.backendRequest).toHaveBeenCalledWith(
      'note.setContent',
      { workspaceId: 'ws', noteId: 'note', content: 'one edited\ntwo\n', expectedVersion: 4 },
      { onDispatch: expect.any(Function) },
    );
    pending.resolve({ ok: true, noteId: 'note', newContent: 'one edited\ntwo remote\n', rev: 7 });
    await settle();
    expect(run.ops()).toMatchObject([{ requestId: 'save', status: 'confirmed', echoedRev: 7 }]);
    expect(run.editor()).toMatchObject({
      content: 'one edited\ntwo remote\n',
      baseContent: 'one edited\ntwo remote\n',
      baseRev: 7,
    });
    expect(projections.getNoteById(run.getState(), 'ws', 'note')).toMatchObject({
      content: 'one edited\ntwo remote\n',
      rev: 7,
    });
    run.save('clean');
    await settle();
    expect(run.backendRequest).toHaveBeenCalledTimes(1);
  });

  it('rebases edits made during Save and sends them only on the next explicit Save', async () => {
    const pending = deferred<unknown>();
    let count = 0;
    const run = harness(note(), async (options, params) => {
      options.onDispatch();
      return ++count === 1
        ? pending.promise
        : { ok: true, noteId: 'note', newContent: (params as { content: string }).content, rev: 9 };
    });
    run.open();
    run.edit('one edited\ntwo\n');
    run.save();
    await settle();
    run.edit('one edited more\ntwo\n');
    pending.resolve({ ok: true, noteId: 'note', newContent: 'one edited\ntwo remote\n', rev: 8 });
    await settle();
    expect(run.editor()).toMatchObject({
      content: 'one edited more\ntwo remote\n',
      baseContent: 'one edited\ntwo remote\n',
      baseRev: 8,
    });
    expect(run.backendRequest).toHaveBeenCalledTimes(1);
    run.save('next');
    await settle();
    expect(run.backendRequest.mock.calls[1]?.[1]).toEqual({
      workspaceId: 'ws',
      noteId: 'note',
      content: 'one edited more\ntwo remote\n',
      expectedVersion: 8,
    });
  });

  it('keeps a later authoritative event and rebases the newer draft onto it', async () => {
    const pending = deferred<unknown>();
    const run = harness(note(), async (options) => {
      options.onDispatch();
      return pending.promise;
    });
    run.open();
    run.edit('one edited\ntwo\n');
    run.save();
    await settle();
    run.edit('one edited more\ntwo\n');
    run.dispatch(
      actions.applyNoteUpdated(
        'ws',
        'note',
        note({ content: 'one edited\ntwo latest\n', rev: 12 }),
      ),
    );
    pending.resolve({ ok: true, noteId: 'note', newContent: 'one edited\ntwo remote\n', rev: 8 });
    await settle();
    expect(projections.getNoteById(run.getState(), 'ws', 'note')).toMatchObject({
      content: 'one edited\ntwo latest\n',
      rev: 12,
    });
    expect(run.editor()).toMatchObject({
      content: 'one edited more\ntwo latest\n',
      baseContent: 'one edited\ntwo latest\n',
      baseRev: 12,
    });
  });

  it.each([
    { name: 'slim', patch: { content: '', contentLength: 10 } },
    { name: 'missing revision', patch: { rev: undefined } },
    { name: 'task', patch: { metadata: { task: { status: 'todo' as never } } } },
    { name: 'spec', patch: { id: NoteId('spec') } },
    { name: 'other content type', patch: { contentType: ContentType.Json } },
    { name: 'wrong workspace', patch: { workspaceId: WorkspaceId('elsewhere') } },
  ])('does not admit $name notes', async ({ patch }) => {
    const run = harness(note(patch));
    run.open();
    run.edit('draft');
    run.save();
    await settle();
    expect(run.editor()).toBeUndefined();
    expect(run.backendRequest).not.toHaveBeenCalled();
  });

  it('rejects a stale captured view at the final transport boundary and never revives its ID', async () => {
    const prepared = deferred<void>();
    const sent = vi.fn();
    const run = harness(note(), async (options) => {
      await prepared.promise;
      options.onDispatch();
      sent();
      return { ok: true, noteId: 'note', newContent: 'saved', rev: 5 };
    });
    run.open();
    run.edit('draft');
    run.save();
    await settle();
    run.dispatch(actions.explicitNoteEditorReleased('view'));
    run.open();
    prepared.resolve();
    await settle();
    expect(sent).not.toHaveBeenCalled();
    expect(run.editor()).toBeUndefined();
    expect(run.getState().workspaceNotes.revokedEditorViews.view).toBe(true);
    expect(run.ops()).toMatchObject([{ status: 'failed' }]);
    run.save('again');
    await settle();
    expect(run.backendRequest).toHaveBeenCalledTimes(1);
  });

  it('checks authority again after the running marker before any wire dispatch', async () => {
    const run = harness();
    run.open();
    run.edit('draft');
    run.observe((action) => {
      if (action.type === actions.explicitNoteSaveStarted.type) run.setContext('new-context');
    });
    run.save();
    await settle();
    expect(run.wire).not.toHaveBeenCalled();
    expect(run.ops()).toMatchObject([{ status: 'failed' }]);
  });

  it('retains an unknown receipt after workspace departure and blocks resending after reentry', async () => {
    const pending = deferred<unknown>();
    const run = harness(note(), async (options) => {
      options.onDispatch();
      return pending.promise;
    });
    run.open();
    run.edit('draft');
    run.save();
    await settle();
    run.dispatch(workspaceUnmounted('ws'));
    await settle();
    expect(run.ops()).toMatchObject([{ status: 'unknown' }]);
    run.dispatch(
      actions.loadWorkspaceNotesSucceeded(['ws'], {
        ws: [note({ content: 'new owner', rev: 14 })],
      }),
    );
    const fresh = { ...identity, viewId: 'fresh' };
    run.open(fresh);
    run.edit('fresh draft', 'fresh');
    run.save('new-save', fresh);
    await settle();
    expect(run.backendRequest).toHaveBeenCalledTimes(1);
    pending.resolve({ ok: true, noteId: 'note', newContent: 'old save result', rev: 5 });
    await settle();
    expect(run.ops()).toMatchObject([{ status: 'confirmed' }]);
    expect(projections.getNoteById(run.getState(), 'ws', 'note')?.content).toBe('new owner');
    expect(run.editor('fresh')?.content).toBe('fresh draft');
  });

  it('retains post-dispatch uncertainty through owner cancellation and accepts only its late receipt', async () => {
    const pending = deferred<unknown>();
    const run = harness(note(), async (options) => {
      options.onDispatch();
      return pending.promise;
    });
    run.open();
    run.edit('draft');
    run.save();
    await settle();
    run.task.cancel();
    await run.task.toPromise();
    expect(run.ops()).toMatchObject([{ status: 'unknown' }]);
    pending.resolve({ ok: true, noteId: 'note', newContent: 'late confirmed', rev: 6 });
    await settle();
    expect(run.ops()).toMatchObject([{ status: 'confirmed', echoedRev: 6 }]);
    expect(projections.getNoteById(run.getState(), 'ws', 'note')?.content).toBe('one\ntwo\n');
  });

  it.each([
    () => actions.explicitNoteEditorsRetired(),
    () => workspaceDeleted('ws'),
    () => actions.applyNoteDeleted('ws', 'note'),
  ])('revokes views on lifecycle retirement', async (retire) => {
    const run = harness();
    run.open();
    run.edit('draft');
    run.dispatch(retire());
    run.open();
    run.save();
    await settle();
    expect(run.editor()).toBeUndefined();
    expect(run.getState().workspaceNotes.revokedEditorViews.view).toBe(true);
    expect(run.backendRequest).not.toHaveBeenCalled();
  });

  it('requires a new explicit request after a definite failure and never resends unknown writes', async () => {
    let count = 0;
    const run = harness(note(), async (options) => {
      options.onDispatch();
      if (++count === 1) throw Object.assign(new Error('forbidden'), { rpcCode: -32003 });
      throw new Error('socket closed');
    });
    run.open();
    run.edit('draft');
    run.save();
    await settle();
    expect(run.ops()[0]?.status).toBe('failed');
    run.save();
    await settle();
    expect(run.backendRequest).toHaveBeenCalledTimes(1);
    run.save('retry');
    await settle();
    expect(run.ops()[1]?.status).toBe('unknown');
    run.save('unsafe-retry');
    await settle();
    expect(run.backendRequest).toHaveBeenCalledTimes(2);
  });

  it('preserves one draft through reconnect and permanently revokes its old context', async () => {
    const run = harness();
    run.open();
    run.edit('draft λ');
    const draft = run.editor();
    run.setContext('connection-2');
    const rebound = { ...identity, context: 'connection-2' };
    run.dispatch(actions.explicitNoteEditorRebound(rebound));
    expect(run.editor()).toMatchObject({
      content: draft?.content,
      baseContent: draft?.baseContent,
      baseRev: 4,
      draftSeq: 1,
      context: 'connection-2',
      retiredContexts: ['connection-1'],
    });
    run.save('stale', identity);
    await settle();
    expect(run.backendRequest).not.toHaveBeenCalled();
    run.dispatch(actions.explicitNoteEditorRebound(identity));
    expect(run.editor()?.context).toBe('connection-2');
    run.save('fresh', rebound);
    await settle();
    expect(run.ops()).toMatchObject([{ requestId: 'fresh', status: 'confirmed' }]);
    expect(run.backendRequest.mock.calls[0]?.[1]).toMatchObject({
      content: 'draft λ',
      expectedVersion: 4,
    });
  });

  it('rebases the surviving draft when an already-dispatched save replies after reconnect', async () => {
    const pending = deferred<unknown>();
    const run = harness(note(), async (options) => {
      options.onDispatch();
      return pending.promise;
    });
    run.open();
    run.edit('one edited\ntwo\n');
    run.save();
    await settle();
    run.setContext('connection-2');
    run.dispatch(actions.explicitNoteEditorRebound({ ...identity, context: 'connection-2' }));
    run.edit('one edited more\ntwo\n');
    pending.resolve({ ok: true, noteId: 'note', newContent: 'one edited\ntwo remote\n', rev: 8 });
    await settle();
    expect(run.editor()).toMatchObject({
      context: 'connection-2',
      content: 'one edited more\ntwo remote\n',
      baseRev: 8,
    });
    expect(run.ops()[0]?.status).toBe('confirmed');
    expect(run.backendRequest).toHaveBeenCalledTimes(1);
  });

  it.each([
    '@@@task\n# Do something\n@@@',
    'inline @@@tasks key=a\n# Task\n@@@',
    'bad' + String.fromCharCode(0),
    '\uD800',
    '界'.repeat(180000),
  ])('does not send unsupported draft content', async (content) => {
    const run = harness();
    run.open();
    run.edit(content);
    run.save();
    await settle();
    expect(run.backendRequest).not.toHaveBeenCalled();
    expect(run.editor()?.content).toBe(content);
  });

  it('does not report saved or definitely failed when the transport skipped its guard', async () => {
    const run = harness(note(), async () => ({
      ok: true,
      noteId: 'note',
      newContent: 'draft',
      rev: 5,
    }));
    run.open();
    run.edit('draft');
    run.save();
    await settle();
    expect(run.ops()[0]?.status).toBe('unknown');
    expect(run.editor()?.baseRev).toBe(4);
  });

  it('finishes rebasing before publishing confirmation to reentrant Save observers', async () => {
    let count = 0;
    const run = harness(note(), async (options, params) => {
      options.onDispatch();
      return {
        ok: true,
        noteId: 'note',
        newContent: (params as { content: string }).content,
        rev: 5 + count++,
      };
    });
    run.open();
    run.edit('draft');
    run.observe((action) => {
      if (action.type === actions.explicitNoteSaveSettled.type) run.save('reentrant');
    });
    run.save();
    await settle();
    expect(run.backendRequest).toHaveBeenCalledTimes(1);
    expect(run.editor()?.baseContent).toBe('draft');
  });

  it('marks a retired queued save failed while the shared FIFO is still blocked', async () => {
    const blocker = deferred<void>();
    const run = harness(note(), undefined, blocker.promise);
    run.open();
    run.edit('queued draft');
    run.save();
    await settle();
    expect(run.ops()[0]?.status).toBe('queued');
    expect(run.backendRequest).not.toHaveBeenCalled();
    run.dispatch(actions.explicitNoteEditorReleased('view'));
    expect(run.ops()[0]?.status).toBe('failed');
    blocker.resolve();
    await settle();
    expect(run.backendRequest).not.toHaveBeenCalled();
  });

  it('drains an unsent explicit save behind a source sibling on owner cancellation', async () => {
    const blocker = deferred<void>();
    const run = harness(note(), undefined, blocker.promise);
    run.open();
    run.edit('queued draft');
    run.save();
    await settle();
    run.task.cancel();
    await run.task.toPromise();
    expect(run.ops()[0]?.status).toBe('failed');
    expect(run.backendRequest).not.toHaveBeenCalled();
    blocker.resolve();
    await settle();
    expect(run.backendRequest).not.toHaveBeenCalled();
  });

  it('retains a confirmed echo during disconnected authority and reconciles it before any further Save', async () => {
    const pending = deferred<unknown>();
    const run = harness(note(), async (options) => {
      options.onDispatch();
      return pending.promise;
    });
    run.open();
    run.edit('one edited\ntwo\n');
    run.save();
    await settle();
    run.edit('one edited more\ntwo\n');
    run.setAuthority('');
    run.setContext('');
    pending.resolve({ ok: true, noteId: 'note', newContent: 'one edited\ntwo remote\n', rev: 8 });
    await settle();
    expect(run.ops()[0]).toMatchObject({ status: 'confirmed', deferredRebase: { rev: 8 } });
    expect(run.editor()?.baseRev).toBe(4);
    run.setAuthority('principal');
    run.setContext('connection-2');
    run.dispatch(actions.explicitNoteEditorRebound({ ...identity, context: 'connection-2' }));
    await settle();
    expect(run.editor()).toMatchObject({
      content: 'one edited more\ntwo remote\n',
      baseContent: 'one edited\ntwo remote\n',
      baseRev: 8,
    });
    expect(run.ops()[0]?.deferredRebase).toBeUndefined();
    expect(run.backendRequest).toHaveBeenCalledTimes(1);
  });

  it('drops departed draft bodies and compacts known receipts without reviving old views', async () => {
    let revision = 4;
    const run = harness(note(), async (options, params) => {
      options.onDispatch();
      if (++revision === 7) throw Object.assign(new Error('forbidden'), { rpcCode: -32003 });
      return {
        ok: true,
        noteId: 'note',
        newContent: (params as { content: string }).content,
        rev: revision,
      };
    });
    for (const viewId of ['first', 'second', 'third']) {
      const view = { ...identity, viewId };
      run.open(view);
      run.edit(`draft from ${viewId}`, viewId);
      run.save(`save-${viewId}`, view);
      await settle();
      run.dispatch(actions.explicitNoteEditorReleased(viewId));
      expect(getItems(run.getState().workspaceNotes.explicitEditors)).toEqual([]);
      expect(run.ops()).toHaveLength(1);
      expect(run.ops()[0]?.requestId).toBe(`save-${viewId}`);
      run.open(view);
      run.save(`stale-${viewId}`, view);
      await settle();
      expect(run.editor(viewId)).toBeUndefined();
    }
    expect(run.ops()[0]?.status).toBe('failed');
    expect(run.getState().workspaceNotes.revokedEditorViews).toEqual({
      first: true,
      second: true,
      third: true,
    });
    expect(run.backendRequest).toHaveBeenCalledTimes(3);
  });

  it('retains an unknown departed save and late receipt without retaining its rebase bodies', async () => {
    const pending = deferred<unknown>();
    const run = harness(note(), async (options) => {
      options.onDispatch();
      return pending.promise;
    });
    run.open();
    run.edit('departed draft');
    run.save();
    await settle();
    run.dispatch(actions.explicitNoteEditorReleased('view'));
    expect(run.editor()).toBeUndefined();
    expect(run.ops()).toMatchObject([{ status: 'unknown' }]);
    const nextView = { ...identity, viewId: 'next' };
    run.open(nextView);
    run.edit('new view draft', 'next');
    run.save('blocked', nextView);
    await settle();
    expect(run.backendRequest).toHaveBeenCalledTimes(1);
    pending.resolve({ ok: true, noteId: 'note', newContent: 'departed merged', rev: 8 });
    await settle();
    expect(run.ops()).toMatchObject([{ status: 'confirmed', echoedRev: 8 }]);
    expect(run.ops()[0]?.deferredRebase).toBeUndefined();
    expect(run.editor('next')?.content).toBe('new view draft');
    expect(run.editor()).toBeUndefined();
  });

  it('discards deferred merge history on genuine departure after a disconnected receipt', async () => {
    const pending = deferred<unknown>();
    const run = harness(note(), async (options) => {
      options.onDispatch();
      return pending.promise;
    });
    run.open();
    run.edit('draft');
    run.save();
    await settle();
    run.setAuthority('');
    pending.resolve({ ok: true, noteId: 'note', newContent: 'merged draft', rev: 8 });
    await settle();
    expect(run.ops()[0]?.deferredRebase?.content).toBe('merged draft');
    run.dispatch(actions.explicitNoteEditorReleased('view'));
    expect(run.editor()).toBeUndefined();
    expect(run.ops()).toMatchObject([{ status: 'confirmed', echoedRev: 8 }]);
    expect(run.ops()[0]?.deferredRebase).toBeUndefined();
    const retired = run.getState().workspaceNotes;
    run.dispatch(actions.explicitNoteEditorReleased('view'));
    expect(run.getState().workspaceNotes).toBe(retired);
  });

  it('preserves an edit and authoritative revision arriving while the accepted content is observed', async () => {
    const pending = deferred<unknown>();
    const run = harness(note(), async (options) => {
      options.onDispatch();
      return pending.promise;
    });
    run.open();
    run.edit('one edited\ntwo\n');
    run.save();
    await settle();
    run.observe((action) => {
      if (action.type === actions.explicitNoteContentAccepted.type) {
        run.edit('one edited more\ntwo\n');
        run.dispatch(
          actions.applyNoteUpdated(
            'ws',
            'note',
            note({ content: 'one edited\ntwo newest\n', rev: 14 }),
          ),
        );
      }
    });
    pending.resolve({ ok: true, noteId: 'note', newContent: 'one edited\ntwo remote\n', rev: 8 });
    await settle();
    expect(run.editor()).toMatchObject({
      content: 'one edited more\ntwo newest\n',
      baseContent: 'one edited\ntwo newest\n',
      baseRev: 14,
    });
    expect(projections.getNoteById(run.getState(), 'ws', 'note')).toMatchObject({
      rev: 14,
      content: 'one edited\ntwo newest\n',
    });
    run.dispatch(actions.explicitNoteContentAccepted('ws', 'note', 'stale', 6));
    expect(projections.getNoteById(run.getState(), 'ws', 'note')?.rev).toBe(14);
  });

  it.each(['permission', 'read readiness'] as const)(
    'checks %s again at the final dispatch callback',
    async (reason) => {
      const prepared = deferred<void>();
      const sent = vi.fn();
      const run = harness(note(), async (options) => {
        await prepared.promise;
        options.onDispatch();
        sent();
        return { ok: true, noteId: 'note', newContent: 'draft', rev: 5 };
      });
      run.open();
      run.edit('draft');
      run.save();
      await settle();
      if (reason === 'permission') run.setAuthority('revoked');
      else run.setReady(false);
      prepared.resolve();
      await settle();
      expect(sent).not.toHaveBeenCalled();
      expect(run.ops()[0]?.status).toBe('failed');
    },
  );

  it('retains a post-cancellation transport failure as unknown and discards no draft', async () => {
    const pending = deferred<unknown>();
    const run = harness(note(), async (options) => {
      options.onDispatch();
      return pending.promise;
    });
    run.open();
    run.edit('draft');
    run.save();
    await settle();
    run.task.cancel();
    await run.task.toPromise();
    pending.reject(new Error('connection closed'));
    await settle();
    expect(run.ops()[0]?.status).toBe('unknown');
    expect(run.editor()?.content).toBe('draft');
    expect(run.backendRequest).toHaveBeenCalledTimes(1);
  });

  it('keeps unchanged reducer references and plain serializable draft/receipt facts', async () => {
    const run = harness();
    run.open();
    const before = run.getState().workspaceNotes;
    run.edit('one\ntwo\n');
    expect(run.getState().workspaceNotes).toBe(before);
    run.edit('draft');
    run.save();
    await settle();
    expect(structuredClone(run.getState())).toEqual(run.getState());
    const current = run.getState().workspaceNotes;
    run.dispatch(actions.explicitNoteSaveSettled('save', 'confirmed', 5));
    expect(run.getState().workspaceNotes).toBe(current);
  });
});
