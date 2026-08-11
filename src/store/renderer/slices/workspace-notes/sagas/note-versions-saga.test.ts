import { runSaga, stdChannel } from 'redux-saga';
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
  workspaceNotesReducer,
} from '../workspace-notes-slice';
import { noteVersionsSaga } from './note-versions-saga';

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

function harness(seed: Note | Note[] = note()) {
  const channel = stdChannel();
  const actions: unknown[] = [];
  let workspaceNotes = workspaceNotesReducer(
    undefined,
    loadWorkspaceNotesSucceeded([WS], { [WS]: Array.isArray(seed) ? seed : [seed] }),
  );
  const dispatch = (action: Parameters<typeof workspaceNotesReducer>[1]) => {
    workspaceNotes = workspaceNotesReducer(workspaceNotes, action);
    actions.push(action);
    return action;
  };
  const task = runSaga(
    { channel, dispatch, getState: () => ({ workspaceNotes }) },
    noteVersionsSaga,
  );
  return { actions, channel, getState: () => workspaceNotes, task };
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
    expect(run.actions).toEqual([
      applyNoteUpdated(WS, NOTE, restored),
      applyNoteVersions(WS, NOTE, [version(2)]),
    ]);
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
    expect(run.actions).toEqual([]);
    run.task.cancel();
    await run.task.toPromise();
  });
});
