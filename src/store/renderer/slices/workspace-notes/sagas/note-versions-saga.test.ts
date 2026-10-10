import {
  daemonHealthReducer,
  connectionStatusChanged,
} from '../../daemon-health/daemon-health-slice';
import { workspaceDeleted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  noteDeleteViewChanged,
  noteDeleteViewRetired,
  applyNoteDeleted,
} from '../workspace-notes-slice';
import { runSaga, stdChannel } from 'redux-saga';
import { all, call } from 'typed-redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appClient } from '$lib/client';
import {
  AuthorType,
  ContentType,
  NoteVisibility,
  type Note,
  type NoteVersion,
} from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  applyNoteUpdated,
  applyNoteVersions,
  applyNoteVersionsError,
  fetchNoteVersions,
  loadWorkspaceNotesSucceeded,
  restoreNoteVersion,
  updateNoteContent,
  workspaceNotesReducer,
} from '../workspace-notes-slice';
import { noteVersionsSaga } from './note-versions-saga';
import { notesWriteSaga } from './notes-write-saga';

const WS = 'ws-note-versions';
const NOTE = 'note-1';
const NOW = '2026-01-01T00:00:00.000Z';
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function version(number: number): NoteVersion {
  return {
    versionId: `version-${number}`,
    versionNumber: number,
    content: `body-${number}`,
    title: `Title ${number}`,
    author: { id: 'user-1', name: 'User', type: AuthorType.User },
    createdAt: `2026-01-0${number}T00:00:00.000Z`,
  };
}

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: NoteId(NOTE),
    workspaceId: WorkspaceId(WS),
    title: 'Title',
    content: 'body',
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Workspace,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function harness(seed: Note | Note[] = note(), onError?: (error: Error) => void) {
  const channel = stdChannel();
  const actions: unknown[] = [];
  const notesByWorkspace: Record<string, Note[]> = {};
  for (const item of Array.isArray(seed) ? seed : [seed]) {
    const workspaceId = String(item.workspaceId);
    (notesByWorkspace[workspaceId] ??= []).push(item);
  }
  let workspaceNotes = workspaceNotesReducer(
    undefined,
    loadWorkspaceNotesSucceeded(Object.keys(notesByWorkspace), notesByWorkspace),
  );
  let daemonHealth = daemonHealthReducer(undefined, connectionStatusChanged('connected'));
  const dispatch = (action: Parameters<typeof workspaceNotesReducer>[1]) => {
    workspaceNotes = workspaceNotesReducer(workspaceNotes, action);
    daemonHealth = daemonHealthReducer(daemonHealth, action);
    // Record publication effects; internal lifetime allocation is still reduced above.
    if (action.type !== 'workspaceNotes/ensureNotePublicationLifetime') actions.push(action);
    channel.put(action);
    return action;
  };
  function* saga() {
    yield* all([call(noteVersionsSaga), call(notesWriteSaga)]);
  }
  const task = runSaga(
    { channel, dispatch, onError, getState: () => ({ workspaceNotes, daemonHealth }) },
    saga,
  );
  return { actions, channel, dispatch, getState: () => workspaceNotes, task };
}

describe('noteVersionsSaga', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses the exact fetch request, preserves ordering, and drops response-only fields', async () => {
    const wire = { ...version(3), wireOnly: 'drop' } as NoteVersion;
    const response = [wire, version(1), version(2)];
    const listVersions = vi.spyOn(appClient.notes, 'listVersions').mockResolvedValue(response);
    const run = harness();

    run.channel.put(fetchNoteVersions(WS, NOTE));
    await settle();

    expect(listVersions.mock.calls).toEqual([[WS, NOTE]]);
    expect(run.actions).toEqual([
      applyNoteVersions(WS, NOTE, [version(3), version(1), version(2)]),
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('uses global latest fetch semantics across note and workspace payload keys', async () => {
    let resolveFirst!: (versions: NoteVersion[]) => void;
    const latest = [version(2)];
    const listVersions = vi
      .spyOn(appClient.notes, 'listVersions')
      .mockReturnValueOnce(
        new Promise((done) => {
          resolveFirst = done;
        }),
      )
      .mockResolvedValueOnce(latest);
    const run = harness();

    run.channel.put(fetchNoteVersions(WS, 'note-stale'));
    await settle();
    run.channel.put(fetchNoteVersions('ws-latest', 'note-latest'));
    await settle();
    resolveFirst([version(1)]);
    await settle();

    expect(listVersions.mock.calls).toEqual([
      [WS, 'note-stale'],
      ['ws-latest', 'note-latest'],
    ]);
    expect(run.actions).toEqual([applyNoteVersions('ws-latest', 'note-latest', latest)]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('maps a thrown fetch to the workspace error action', async () => {
    vi.spyOn(appClient.notes, 'listVersions').mockRejectedValue(new Error('offline'));
    const run = harness();

    run.channel.put(fetchNoteVersions(WS, NOTE));
    await settle();

    expect(run.actions).toEqual([applyNoteVersionsError(WS, 'offline')]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('cancels an in-flight fetch and suppresses its late result on cleanup', async () => {
    let resolve!: (versions: NoteVersion[]) => void;
    const listVersions = vi.spyOn(appClient.notes, 'listVersions').mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const run = harness();

    run.channel.put(fetchNoteVersions(WS, NOTE));
    await settle();
    run.channel.put(workspaceUnmounted(WS));
    await settle();
    resolve([version(1)]);
    await settle();

    expect(listVersions.mock.calls).toEqual([[WS, NOTE]]);
    expect(run.actions).toEqual([]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('restores before refetching versions', async () => {
    const order: string[] = [];
    const restored = note({ content: 'restored body', rev: 5 });
    const restore = vi.spyOn(appClient.notes, 'restoreVersion').mockImplementation(async () => {
      order.push('restore');
      return { success: true, note: restored };
    });
    const listVersions = vi.spyOn(appClient.notes, 'listVersions').mockImplementation(async () => {
      order.push('list');
      return [version(2)];
    });
    const run = harness();

    run.channel.put(restoreNoteVersion(WS, NOTE, 'version-1'));
    await settle();

    expect(restore.mock.calls).toEqual([[WS, NOTE, 'version-1']]);
    expect(listVersions.mock.calls).toEqual([[WS, NOTE]]);
    expect(order).toEqual(['restore', 'list']);
    expect(
      run.actions.filter(
        (action) =>
          (action as { type?: string }).type === applyNoteUpdated.type ||
          (action as { type?: string }).type === applyNoteVersions.type,
      ),
    ).toEqual([applyNoteUpdated(WS, NOTE, restored), applyNoteVersions(WS, NOTE, [version(2)])]);
    run.task.cancel();
    await run.task.toPromise();
  });

  // Regression (PR #2404 fresh review): the saga is the central restore path,
  // so it must wait for a content save that is already on the wire — not only
  // a still-debounced draft — before issuing note.restoreVersion, whichever
  // caller dispatched the action.
  it('does not issue the restore RPC while a content save is still in flight', async () => {
    const WS_SVC = 'ws-note-versions-svc';
    let resolveSave!: (v: unknown) => void;
    const setContent = vi.spyOn(appClient.notes, 'setContent').mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve;
      }) as never,
    );
    const restored = note({ workspaceId: WorkspaceId(WS_SVC), content: 'restored body', rev: 3 });
    const restore = vi
      .spyOn(appClient.notes, 'restoreVersion')
      .mockResolvedValue({ success: true, note: restored });
    vi.spyOn(appClient.notes, 'listVersions').mockResolvedValue([]);
    const run = harness(note({ workspaceId: WorkspaceId(WS_SVC) }));

    run.channel.put(updateNoteContent(WS_SVC, NOTE, 'edited', { immediate: true }));
    await settle();
    expect(setContent).toHaveBeenCalledTimes(1);
    expect(run.getState().byWorkspaceId[WS_SVC]?.pendingContentByNoteId[NOTE]).toBe(true);

    run.channel.put(restoreNoteVersion(WS_SVC, NOTE, 'version-1'));
    await settle();
    expect(run.getState().byWorkspaceId[WS_SVC]?.pendingContentByNoteId[NOTE]).toBe(true);
    expect(restore).not.toHaveBeenCalled();

    resolveSave({ success: true, newContent: 'edited', noteRev: 2 });
    await settle();
    await settle();

    expect(run.getState().byWorkspaceId[WS_SVC]?.pendingContentByNoteId[NOTE]).toBeUndefined();
    expect(restore.mock.calls).toEqual([[WS_SVC, NOTE, 'version-1']]);
    expect(run.actions).toContainEqual(applyNoteUpdated(WS_SVC, NOTE, restored));
    run.task.cancel();
    await run.task.toPromise();
  });

  it('preserves cached unmetDependsOn when the restored note omits the projection', async () => {
    const cached = note({
      metadata: {
        task: {
          status: 'not_started',
          dependsOn: [NoteId('dep-1')],
          unmetDependsOn: [NoteId('dep-1')],
        },
      },
    });
    const restored = note({
      content: 'restored body',
      rev: 5,
      metadata: { task: { status: 'not_started', dependsOn: [NoteId('dep-1')] } },
    });
    vi.spyOn(appClient.notes, 'restoreVersion').mockResolvedValue({
      success: true,
      note: restored,
    });
    vi.spyOn(appClient.notes, 'listVersions').mockResolvedValue([]);
    const run = harness(cached);

    run.channel.put(restoreNoteVersion(WS, NOTE, 'version-1'));
    await settle();

    const applied = run.getState().byWorkspaceId[WS]?.notes.map[NOTE];
    expect(applied?.content).toEqual('restored body');
    expect(applied?.metadata?.task?.unmetDependsOn).toEqual([NoteId('dep-1')]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('leaves the note and version state untouched when restore fails', async () => {
    const restore = vi.spyOn(appClient.notes, 'restoreVersion').mockResolvedValue({
      success: false,
      error: 'rejected',
    });
    const listVersions = vi.spyOn(appClient.notes, 'listVersions');
    const run = harness();

    run.channel.put(restoreNoteVersion(WS, NOTE, 'version-1'));
    await settle();

    expect(restore.mock.calls).toEqual([[WS, NOTE, 'version-1']]);
    expect(listVersions.mock.calls).toEqual([]);
    expect(
      run.actions.filter(
        (action) => !(action as { type?: string }).type?.startsWith('workspaceNotes/settle'),
      ),
    ).toEqual([]);
    run.task.cancel();
    await run.task.toPromise();
  });
});

it('keeps version operations alive when a retained strict draft refuses settlement', async () => {
  const errors: Error[] = [];
  vi.spyOn(appClient.notes, 'update').mockRejectedValue(
    Object.assign(new Error('Strict conflict'), { rpcCode: -32005 }),
  );
  const restore = vi
    .spyOn(appClient.notes, 'restoreVersion')
    .mockResolvedValue({ success: true, note: note({ content: 'restored', rev: 7 }) });
  const list = vi.spyOn(appClient.notes, 'listVersions').mockResolvedValue([version(1)]);
  const run = harness([note({ rev: 4 }), note({ id: NoteId('clean-note'), rev: 6 })], (error) =>
    errors.push(error),
  );
  const completion = run.task.toPromise().catch(() => undefined);
  try {
    run.channel.put(
      updateNoteContent(WS, NOTE, 'local draft', { strict: true, immediate: true, baseRev: 4 }),
    );
    await vi.waitFor(() =>
      expect(run.getState().retainedDrafts[JSON.stringify([WS, NOTE])]?.error).toBe(
        'Strict conflict',
      ),
    );
    run.channel.put(restoreNoteVersion(WS, NOTE, 'version-1'));
    await vi.waitFor(() =>
      expect(run.actions).toContainEqual(applyNoteVersionsError(WS, 'Strict conflict')),
    );
    expect(restore).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
    expect(run.task.isRunning()).toBe(true);
    run.channel.put(restoreNoteVersion(WS, 'clean-note', 'version-1'));
    await vi.waitFor(() =>
      expect(restore).toHaveBeenCalledExactlyOnceWith(WS, 'clean-note', 'version-1'),
    );
    run.channel.put(fetchNoteVersions(WS, NOTE));
    await vi.waitFor(() => expect(list).toHaveBeenCalledWith(WS, NOTE));
    expect(errors).toEqual([]);
    expect(run.task.isRunning()).toBe(true);
  } finally {
    run.task.cancel();
    await completion;
    vi.restoreAllMocks();
  }
});

it('does not publish a late restored version into a replacement after terminal retirement', async () => {
  let finish!: (result: { success: boolean; note: Note }) => void;
  vi.spyOn(appClient.notes, 'restoreVersion').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  vi.spyOn(appClient.notes, 'listVersions').mockResolvedValue([]);
  const run = harness();
  try {
    run.channel.put(restoreNoteVersion(WS, NOTE, 'version-1'));
    for (let i = 0; i < 8; i++) await settle();
    const deleted = {
      backendGeneration: 1,
      workspaceId: WS,
      noteId: NOTE,
      noteInstanceId: 'old-instance',
      owner: 'confirmed-owner',
      phase: 'deleted' as const,
      held: true,
      hidden: true,
      canCancel: false,
      terminalAbsent: { epoch: 'epoch', sequence: 4 },
    };
    run.dispatch(noteDeleteViewChanged(deleted));
    run.dispatch(applyNoteDeleted(WS, NOTE));
    run.dispatch(noteDeleteViewRetired(deleted));
    run.dispatch(
      loadWorkspaceNotesSucceeded(
        [WS],
        { [WS]: [note({ content: 'replacement body', rev: 1 })] },
        { [WS]: run.getState().byWorkspaceId[WS].deleteReadAuthority },
      ),
    );
    finish({ success: true, note: note({ content: 'old restored body', rev: 8 }) });
    for (let i = 0; i < 8; i++) await settle();
    expect(run.getState().byWorkspaceId[WS].notes.map[NOTE].content).toBe('replacement body');
  } finally {
    run.task.cancel();
    await run.task.toPromise();
    vi.restoreAllMocks();
  }
});

it.each(['reconnect', 'workspace-reuse'] as const)(
  'rejects a late restore response after %s and permits a fresh restore',
  async (change) => {
    let finish!: (result: { success: boolean; note: Note }) => void;
    const restore = vi.spyOn(appClient.notes, 'restoreVersion').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const list = vi.spyOn(appClient.notes, 'listVersions').mockResolvedValue([]);
    const run = harness();
    try {
      run.channel.put(restoreNoteVersion(WS, NOTE, 'version-1'));
      for (let i = 0; i < 8; i++) await settle();
      expect(restore).toHaveBeenCalledOnce();
      if (change === 'reconnect') {
        run.dispatch(connectionStatusChanged('disconnected'));
        run.dispatch(connectionStatusChanged('connected'));
      } else run.dispatch(workspaceDeleted(WS, [], 'replaced'));
      run.dispatch(
        loadWorkspaceNotesSucceeded([WS], { [WS]: [note({ content: 'replacement', rev: 1 })] }),
      );
      finish({ success: true, note: note({ content: 'old restored body', rev: 99 }) });
      for (let i = 0; i < 8; i++) await settle();
      expect(run.getState().byWorkspaceId[WS].notes.map[NOTE]).toMatchObject({
        content: 'replacement',
        rev: 1,
      });
      expect(list).not.toHaveBeenCalled();
      restore.mockResolvedValue({
        success: true,
        note: note({ content: 'fresh restore', rev: 2 }),
      });
      run.channel.put(restoreNoteVersion(WS, NOTE, 'version-2'));
      for (let i = 0; i < 8; i++) await settle();
      expect(restore).toHaveBeenCalledTimes(2);
      expect(run.getState().byWorkspaceId[WS].notes.map[NOTE].content).toBe('fresh restore');
      expect(list).toHaveBeenCalledOnce();
    } finally {
      run.task.cancel();
      await run.task.toPromise();
      vi.restoreAllMocks();
    }
  },
);
