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
  restoreNoteVersion,
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

function harness() {
  const channel = stdChannel();
  const actions: unknown[] = [];
  const task = runSaga({ channel, dispatch: (action) => actions.push(action) }, noteVersionsSaga);
  return { actions, channel, task };
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