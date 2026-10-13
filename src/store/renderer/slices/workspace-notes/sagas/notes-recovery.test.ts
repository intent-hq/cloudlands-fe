import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appClient } from '$lib/client';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import {
  createEventRecoverySession,
  type RecoveryNotification,
} from '$shared/event-recovery/session';
import { selectNoteById } from '../workspace-notes-selectors';
import {
  workspaceNotesReducer,
  loadWorkspaceNotesSucceeded,
  workspaceNotesHydrationRequested,
  readNoteRequested,
  restoreNoteVersion,
  updateNoteContent,
  noteAttributionViewRequested,
  noteAttributionViewReleased,
} from '../workspace-notes-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  commentsReducer,
  commentLoadRequested,
  commentLoadReleased,
} from '../../comments/comments-slice';
import { notesReadSaga } from './notes-read-saga';
import { noteVersionsSaga } from './note-versions-saga';
import { notesWriteSaga } from './notes-write-saga';
import type { StoreState } from '../../../types';
const row = (content: string) => ({
  id: 'spec',
  workspaceId: 'ws',
  title: 'Spec',
  content,
  contentType: 'markdown',
  tags: [],
  isPinned: false,
  isArchived: false,
  visibility: 'workspace',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
});
const settle = async () => {
  for (let i = 0; i < 80; i++) await Promise.resolve();
};
const cleanups: Array<() => void> = [];
async function harness() {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const channel = stdChannel();
  let state = {
    workspaceNotes: workspaceNotesReducer(
      undefined,
      loadWorkspaceNotesSucceeded(['ws'], { ws: [row('old')] } as never),
    ),
    comments: commentsReducer(undefined, { type: '@@init' }),
    connections: { hasReceivedList: true, windowBackendId: 'backend-a' },
    daemonHealth: { health: 'up', connectionGeneration: 1 },
    workspaceEvents: { subscriptionGeneration: 1, subscriptionPending: false },
  };
  const dispatch = (action: any) => {
    state = {
      ...state,
      workspaceNotes: workspaceNotesReducer(state.workspaceNotes, action),
      comments: commentsReducer(state.comments, action),
    };
    channel.put(action);
    return action;
  };
  const store = {
    get state() {
      return state as unknown as StoreState;
    },
    dispatch,
  };
  let receive!: (n: RecoveryNotification) => void;
  let retire!: () => void;
  let current = true;
  const read = vi.fn(async () => ({ notes: [row('new')] }));
  const commentRead = vi.fn(async () => ({
    threads: [
      {
        comments: [
          {
            id: 'comment',
            threadId: 'thread',
            noteId: 'spec',
            workspaceId: 'ws',
            content: 'new comment',
            type: 'comment',
          },
        ],
      },
    ],
  }));
  const attributionRead = vi.fn(async () => ({
    workspaceId: 'ws',
    noteId: 'spec',
    lines: [],
    revision: 2,
  }));
  const request = vi.fn(async (method: string, params?: unknown) => {
    if (method === 'events.subscribe') return { subscriptionId: 'generic', lossRecovery: 1 };
    if (method === 'events.fence') return params;
    if (method === 'note.lineAttribution.load') return attributionRead();
    if (method === 'note.list') return read();
    if (method === 'comment.list') return commentRead();
    return {};
  });
  const session = createEventRecoverySession({
    supported: true,
    isCurrent: () => current,
    onNotification: (fn) => {
      receive = fn;
      return () => {};
    },
    onRetired: (fn) => {
      retire = fn;
      return () => {};
    },
    request: async (method, params, observe) => {
      const result = await request(method, params);
      observe?.(result);
      return result;
    },
    dispose: () => {
      current = false;
    },
  });
  const scope = rendererEventRecovery.attach(session);
  const task = runSaga({ channel, dispatch, getState: () => store.state }, notesReadSaga, store);
  const writes = runSaga({ channel, dispatch, getState: () => store.state }, notesWriteSaga, store);
  const versions = runSaga(
    { channel, dispatch, getState: () => store.state },
    noteVersionsSaga,
    store,
  );
  cleanups.push(() => {
    versions.cancel();
    task.cancel();
    writes.cancel();
  });
  await scope.subscribe(
    { workspaceId: 'ws', eventTypes: ['note:*', 'task:*', 'comment:*'] },
    { recover: true },
  );
  dispatch(workspaceNotesHydrationRequested('ws', 1, false));
  await settle();
  return {
    dispatch,
    read,
    commentRead,
    attributionRead,
    request,
    store,
    task,
    row: () => selectNoteById.select(store.state, 'ws', 'spec'),
    loss: (generation = '1') =>
      receive({
        method: 'events.lost',
        params: { subscriptionId: 'generic', generation, scope: { workspaceId: 'ws' } },
      }),
    retire: () => {
      current = false;
      retire();
    },
    emit: (n: RecoveryNotification) => receive(n),
  };
}
afterEach(() => {
  for (const off of cleanups.splice(0)) off();
  rendererEventRecovery.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('active note recovery', () => {
  it('restores a final lost update without another event and rejects an older note read', async () => {
    const h = await harness();
    let resolve!: (value: any) => void;
    vi.spyOn(appClient.notes, 'get').mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const old = readNoteRequested('ws', 'spec');
    h.dispatch(old);
    await settle();
    h.loss();
    await settle();
    expect(h.row()?.content).toBe('new');
    resolve(row('old reply'));
    await settle();
    expect(h.row()?.content).toBe('new');
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.request.mock.calls.filter(([method]) => method === 'events.fence')).toHaveLength(2);
  });
  it('clears protected note state on retirement and cannot resurrect from a held recovery', async () => {
    const h = await harness();
    let resolve!: (value: any) => void;
    h.read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    h.loss();
    await settle();
    h.retire();
    expect(h.row()).toBeUndefined();
    resolve({ notes: [row('private')] });
    await settle();
    expect(h.row()).toBeUndefined();
  });
  it('does not apply a held old workspace snapshot after unmount and same-id remount', async () => {
    const h = await harness();
    let resolve!: (value: any) => void;
    h.read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    h.loss();
    await settle();
    h.dispatch(workspaceUnmounted('ws'));
    vi.spyOn(appClient.notes, 'list').mockResolvedValue([row('remounted')] as never);
    vi.spyOn(appClient.notes, 'get').mockResolvedValue(row('remounted') as never);
    h.dispatch(workspaceNotesHydrationRequested('ws', 2, false));
    await settle();
    expect(h.store.state.workspaceNotes).toMatchObject({
      byWorkspaceId: { ws: { initialized: true } },
    });
    resolve({ notes: [row('old workspace')] });
    await settle();
    expect(h.row()?.content).toBe('remounted');
  });
  it('recovers comments once while active and defers closed-view recovery until demand', async () => {
    const h = await harness();
    vi.spyOn(appClient.comments, 'list').mockResolvedValue([]);
    const initial = commentLoadRequested('view', 'one', 'ws', 'spec');
    h.dispatch(initial);
    await settle();
    h.loss();
    await settle();
    expect(h.store.state.comments.commentsById.ids).toEqual(['comment']);
    expect(h.commentRead).toHaveBeenCalledTimes(1);
    h.dispatch(commentLoadReleased('view'));
    h.loss('2');
    await settle();
    expect(h.commentRead).toHaveBeenCalledTimes(1);
    h.dispatch(commentLoadRequested('view', 'two', 'ws', 'spec'));
    await vi.advanceTimersByTimeAsync(250);
    await settle();
    expect(h.commentRead).toHaveBeenCalledTimes(2);
    expect(h.store.state.comments.commentsById.ids).toEqual(['comment']);
  });
  it('preserves a pending edit through recovery and reconciles after its delayed save settles', async () => {
    const h = await harness();
    let finish!: (value: any) => void;
    vi.spyOn(appClient.notes, 'setContent').mockImplementation(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    h.dispatch(updateNoteContent('ws', 'spec', 'local edit', { immediate: true }));
    await settle();
    h.loss();
    await settle();
    expect(h.row()?.content).toBe('local edit');
    finish({ success: true, newContent: 'old echo', noteRev: 1 });
    await settle();
    await vi.advanceTimersByTimeAsync(250);
    await settle();
    expect(h.row()?.content).toBe('new');
    expect(h.store.state.workspaceNotes.byWorkspaceId.ws.pendingContentByNoteId).toEqual({});
  });
  it('does not send debounced edits after their authority retires', async () => {
    const h = await harness();
    const save = vi
      .spyOn(appClient.notes, 'setContent')
      .mockResolvedValue({ success: true } as never);
    h.dispatch(updateNoteContent('ws', 'spec', 'private draft'));
    h.retire();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(save).not.toHaveBeenCalled();
    expect(h.row()).toBeUndefined();
  });

  it('recovers demanded attribution and clears it on retirement', async () => {
    const h = await harness();
    vi.spyOn(appClient.notes.lineAttribution, 'load').mockResolvedValue(null);
    h.dispatch(noteAttributionViewRequested('view', 'one', 'ws', 'spec'));
    await settle();
    h.loss();
    await settle();
    const view = () =>
      getItem(h.store.state.workspaceNotes.byWorkspaceId.ws.attributionViews, 'view');
    expect(view()?.data).toEqual(await h.attributionRead.mock.results[0].value);
    expect(h.attributionRead).toHaveBeenCalledTimes(1);
    h.dispatch(noteAttributionViewReleased('ws', 'view'));
    h.loss('2');
    await settle();
    expect(h.attributionRead).toHaveBeenCalledTimes(1);
    h.retire();
    expect(h.row()).toBeUndefined();
  });
  it('rejects a held restore echo after generic loss', async () => {
    const h = await harness();
    let finish!: (value: any) => void;
    vi.spyOn(appClient.notes, 'restoreVersion').mockImplementation(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    vi.spyOn(appClient.notes, 'listVersions').mockResolvedValue([]);
    h.dispatch(restoreNoteVersion('ws', 'spec', 'v1'));
    await settle();
    h.loss();
    await settle();
    finish({ success: true, note: row('old restore echo') });
    await settle();
    expect(h.row()?.content).toBe('new');
  });
});
