import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appClient } from '$lib/client';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import {
  createEventRecoverySession,
  RecoveryRequestTimeoutError,
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
  updateNoteTitle,
  updateNote,
  deleteNote,
  noteEventReceived,
  noteContentViewRequested,
  noteContentViewReleased,
  commentEventReceived,
  refreshNoteFromEventRequested,
  noteAttributionViewRequested,
  noteAttributionInvalidated,
  noteAttributionViewReleased,
} from '../workspace-notes-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  commentsReducer,
  commentLoadRequested,
  commentLoadReleased,
} from '../../comments/comments-slice';
import {
  dispatchNoteRecoveryEvent,
  dispatchNoteAttributionRecoveryEvent,
} from './note-event-receipt';
import { notesRecoveryKey, commentsRecoveryKey, attributionRecoveryKey } from './notes-recovery';
import { withRecoveryAdmissions } from '../../../middlewares/event-recovery';
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
async function harness(holdRefresh = false) {
  const heldRefresh: any[] = [];
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
    if (holdRefresh && action.type === refreshNoteFromEventRequested.type) heldRefresh.push(action);
    else channel.put(action);
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
  const makeSession = () =>
    createEventRecoverySession({
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
  const scope = rendererEventRecovery.attach(makeSession());
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
    show: () => dispatch(noteContentViewRequested('body', 'visible', 'ws', 'spec')),
    hide: () => dispatch(noteContentViewReleased('ws', 'body')),
    releaseRefresh: () => {
      for (const action of heldRefresh.splice(0)) channel.put(action);
    },
    replace: () => {
      current = true;
      return rendererEventRecovery.attach(makeSession());
    },
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
    expect(h.read).not.toHaveBeenCalled();
    expect(h.row()?.content).toBe('old');
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
    expect(h.store.state.workspaceNotes.byWorkspaceId.ws).toBeUndefined();
    expect(appClient.notes.list).not.toHaveBeenCalled();
    resolve({ notes: [row('old workspace')] });
    await settle();
    expect(appClient.notes.list).toHaveBeenCalledTimes(1);
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

describe('independent typed-note review probes', () => {
  it('shares an ordinary pending comment read across two open views', async () => {
    const h = await harness();
    const finishes: Array<(rows: any[]) => void> = [];
    const read = vi
      .spyOn(appClient.comments, 'list')
      .mockImplementation(() => new Promise((done) => finishes.push(done)));
    h.dispatch(commentLoadRequested('view-a', 'one', 'ws', 'spec'));
    h.dispatch(commentLoadRequested('view-b', 'two', 'ws', 'spec'));
    await settle();
    const count = read.mock.calls.length;
    for (const done of finishes) done([]);
    await settle();
    expect(count).toBe(1);
  });
  it('does not overlap recovery with an ordinary held comment read', async () => {
    const h = await harness();
    let finish!: (rows: any[]) => void;
    vi.spyOn(appClient.comments, 'list').mockImplementation(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    h.dispatch(commentLoadRequested('view', 'one', 'ws', 'spec'));
    await settle();
    h.loss();
    await settle();
    const recoveryReadsWhilePending = h.commentRead.mock.calls.length;
    finish([]);
    await settle();
    expect(recoveryReadsWhilePending).toBe(0);
    expect(h.commentRead).toHaveBeenCalledTimes(1);
    expect(h.store.state.comments.commentsById.ids).toEqual(['comment']);
  });
  it('does not issue a title mutation after a preceding flush crosses session replacement', async () => {
    const h = await harness();
    let finish!: (value: any) => void;
    vi.spyOn(appClient.notes, 'setContent').mockImplementation(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    const title = vi
      .spyOn(appClient.notes, 'updateMetadata')
      .mockResolvedValue({ success: true } as never);
    h.dispatch(updateNoteContent('ws', 'spec', 'private draft'));
    h.dispatch(updateNoteTitle('ws', 'spec', 'old-session title'));
    await settle();
    h.retire();
    h.replace();
    h.dispatch(loadWorkspaceNotesSucceeded(['ws'], { ws: [row('successor')] } as never));
    finish({ success: true, newContent: 'private draft', noteRev: 1 });
    await settle();
    expect(title).not.toHaveBeenCalled();
    expect(h.row()?.title).toBe('Spec');
  });
  it('does not start a queued note event read after its captured authority retires', async () => {
    const h = await harness();
    h.show();
    const finishes: Array<(value: any) => void> = [];
    const read = vi
      .spyOn(appClient.notes, 'get')
      .mockImplementation(() => new Promise((done) => finishes.push(done)));
    h.dispatch(readNoteRequested('ws', 'spec'));
    h.dispatch(noteEventReceived('ws', 'spec', 'note:updated'));
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
    h.retire();
    finishes[0](row('private old'));
    await settle();
    const count = read.mock.calls.length;
    for (const done of finishes.slice(1)) done(row('private trailing'));
    await settle();
    expect(count).toBe(1);
  });
  it('shares ordinary attribution work and serializes its recovery snapshot', async () => {
    const h = await harness();
    let finish!: (value: any) => void;
    let active = 0,
      peak = 0;
    const load = vi.spyOn(appClient.notes.lineAttribution, 'load').mockImplementation(() => {
      peak = Math.max(peak, ++active);
      return new Promise((done) => {
        finish = (value) => {
          active--;
          done(value);
        };
      });
    });
    h.attributionRead.mockImplementation(async () => {
      peak = Math.max(peak, ++active);
      active--;
      return { workspaceId: 'ws', noteId: 'spec', lines: [], revision: 3 };
    });
    h.dispatch(noteAttributionViewRequested('a', 'one', 'ws', 'spec'));
    h.dispatch(noteAttributionViewRequested('b', 'two', 'ws', 'spec'));
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    h.loss();
    await settle();
    expect(h.attributionRead).not.toHaveBeenCalled();
    finish(null);
    await settle();
    expect(h.attributionRead).toHaveBeenCalledTimes(1);
    expect(peak).toBe(1);
    expect(
      getItem(h.store.state.workspaceNotes.byWorkspaceId.ws.attributionViews, 'a')?.data,
    ).toMatchObject({ revision: 3 });
    expect(
      getItem(h.store.state.workspaceNotes.byWorkspaceId.ws.attributionViews, 'b')?.data,
    ).toMatchObject({ revision: 3 });
  });
  it.each(['title', 'metadata', 'delete'] as const)(
    'does not dispatch an old %s command after same-id workspace remount',
    async (kind) => {
      const h = await harness();
      let finish!: (value: any) => void;
      vi.spyOn(appClient.notes, 'setContent').mockImplementation(
        () =>
          new Promise((done) => {
            finish = done;
          }),
      );
      const metadata = vi
        .spyOn(appClient.notes, 'updateMetadata')
        .mockResolvedValue({ success: true });
      const remove = vi.spyOn(appClient.notes, 'delete').mockResolvedValue({ success: true });
      h.dispatch(updateNoteContent('ws', 'spec', 'private draft'));
      h.dispatch(
        kind === 'title'
          ? updateNoteTitle('ws', 'spec', 'old title')
          : kind === 'metadata'
            ? updateNote('ws', 'spec', { tags: ['old'] })
            : deleteNote('ws', 'spec'),
      );
      await settle();
      h.dispatch(workspaceUnmounted('ws'));
      vi.spyOn(appClient.notes, 'list').mockResolvedValue([row('remount')] as never);
      vi.spyOn(appClient.notes, 'get').mockResolvedValue(row('remount') as never);
      h.dispatch(workspaceNotesHydrationRequested('ws', 2, false));
      await settle();
      finish({ success: true, newContent: 'private draft' });
      await settle();
      expect(metadata).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(h.row()?.content).toBe('remount');
    },
  );
});

describe('newer push while ordinary read is pending', () => {
  it('serializes comment reads and settles view loading after an accepted push', async () => {
    const h = await harness();
    const finishes: Array<(rows: Awaited<ReturnType<typeof appClient.comments.list>>) => void> = [];
    let active = 0,
      peak = 0;
    const read = vi.spyOn(appClient.comments, 'list').mockImplementation(() => {
      peak = Math.max(peak, ++active);
      return new Promise((done) =>
        finishes.push((rows) => {
          active--;
          done(rows);
        }),
      );
    });
    h.dispatch(commentLoadRequested('view', 'one', 'ws', 'spec'));
    await settle();
    h.dispatch(commentEventReceived('ws', 'spec', 'added'));
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
    finishes[0]([]);
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
    finishes[1]([]);
    await settle();
    expect(peak).toBe(1);
    expect(getItem(h.store.state.comments.loadsByConsumer, 'view')?.status).toBe('ready');
  });
});

describe('settlement after an admitted push supersedes an ordinary read', () => {
  it('preserves full workspace hydration when a note event arrives before the list', async () => {
    const h = await harness();
    h.show();
    let finish!: (rows: ReturnType<typeof row>[]) => void;
    const freshRows = [row('fresh event'), { ...row('untouched note'), id: 'sibling' }];
    h.read.mockResolvedValue({ notes: freshRows } as never);
    const list = vi
      .spyOn(appClient.notes, 'list')
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            finish = (rows) => done(rows as never);
          }),
      )
      .mockResolvedValue(freshRows as never);
    vi.spyOn(appClient.notes, 'get').mockImplementation(
      async (noteId: string) => ({ ...row('fresh event'), id: noteId }) as never,
    );
    h.dispatch(workspaceNotesHydrationRequested('ws', 2, true));
    await settle();
    expect(list).toHaveBeenCalledTimes(1);
    h.dispatch(noteEventReceived('ws', 'spec', 'note:updated'));
    await settle();
    finish([row('old snapshot'), { ...row('untouched note'), id: 'sibling' }]);
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(selectNoteById.select(h.store.state, 'ws', 'sibling')?.content).toBe('untouched note');
    expect(h.row()?.content).toBe('fresh event');
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(1);
  });
});

describe('comment view settlement ownership', () => {
  it('does not finish a consumer that moved to a sibling note', async () => {
    const h = await harness();
    const finishes: Array<() => void> = [];
    vi.spyOn(appClient.comments, 'list').mockImplementation(
      (id) =>
        new Promise((done) => {
          if (id === 'spec') finishes.push(() => done([]));
        }),
    );
    h.dispatch(commentLoadRequested('view', 'one', 'ws', 'spec'));
    await settle();
    h.dispatch(commentLoadRequested('keeper', 'one', 'ws', 'spec'));
    await settle();
    h.dispatch(commentEventReceived('ws', 'spec', 'added'));
    await settle();
    h.dispatch(commentLoadRequested('view', 'two', 'ws', 'sibling'));
    await settle();
    finishes[0]();
    await settle();
    finishes[1]();
    await settle();
    expect(getItem(h.store.state.comments.loadsByConsumer, 'keeper')?.status).toBe('ready');
    expect(getItem(h.store.state.comments.loadsByConsumer, 'view')).toMatchObject({
      requestId: 'two',
      noteId: 'sibling',
      status: 'loading',
    });
  });
});

describe('admitted note ingress completion', () => {
  function admit(key: string) {
    rendererEventRecovery.push(key);
    return new Map([[key, rendererEventRecovery.capture(key)]]);
  }
  it('recovers the slim catalog while hidden and refreshes body only on show', async () => {
    const h = await harness();
    const { content: _content, ...metadata } = row('new body');
    h.read.mockResolvedValue({
      notes: [{ ...metadata, contentLength: 8, contentPreview: 'new body' }],
    } as never);
    const get = vi.spyOn(appClient.notes, 'get').mockResolvedValue(row('new body') as never);
    h.loss();
    await settle();
    expect(h.request).toHaveBeenCalledWith('note.list', { workspaceId: 'ws', projection: 'slim' });
    expect(get).not.toHaveBeenCalled();
    h.show();
    await settle();
    expect(get).toHaveBeenCalledTimes(1);
    expect(h.row()?.content).toBe('new body');
    h.loss('2');
    await vi.advanceTimersByTimeAsync(250);
    await settle();
    expect(get).toHaveBeenCalledTimes(2);
    expect(h.row()?.content).toBe('new body');
  });
  it('invalidates admitted hidden content without reading and refreshes on show', async () => {
    const h = await harness();
    const read = vi.spyOn(appClient.notes, 'get').mockResolvedValue(row('visible fresh') as never);
    await dispatchNoteRecoveryEvent(
      noteEventReceived('ws', 'spec', 'note:updated'),
      admit(notesRecoveryKey('ws')),
    );
    expect(read).not.toHaveBeenCalled();
    expect(h.store.state.workspaceNotes.byWorkspaceId.ws.staleContentByNoteId.spec).toBeGreaterThan(
      0,
    );
    h.show();
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
    expect(h.row()?.content).toBe('visible fresh');
  });
  it('does not start admitted content queued behind a held read after hiding', async () => {
    const h = await harness();
    h.show();
    let finish!: (value: any) => void;
    const read = vi
      .spyOn(appClient.notes, 'get')
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            finish = done;
          }),
      )
      .mockResolvedValue(row('visible fresh') as never);
    const first = readNoteRequested('ws', 'spec');
    h.dispatch(first);
    await settle();
    const pending = dispatchNoteRecoveryEvent(
      noteEventReceived('ws', 'spec', 'note:updated'),
      admit(notesRecoveryKey('ws')),
    );
    await settle();
    h.hide();
    expect(h.store.state.workspaceNotes.byWorkspaceId.ws.contentViews.map.body).toBeUndefined();
    finish(row('stale held'));
    await pending;
    await first.promise;
    expect(read).toHaveBeenCalledTimes(1);
    expect(h.row()?.content).toBe('old');
    h.show();
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
    expect(h.row()?.content).toBe('visible fresh');
  });
  it('waits for the real note read and reducer commit', async () => {
    const h = await harness();
    h.show();
    let resolve!: (value: any) => void;
    const read = vi.spyOn(appClient.notes, 'get').mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    let completed = false;
    const processing = dispatchNoteRecoveryEvent(
      noteEventReceived('ws', 'spec', 'note:updated'),
      admit(notesRecoveryKey('ws')),
    ).then(() => {
      completed = true;
    });
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
    expect(completed).toBe(false);
    resolve(row('admitted'));
    await processing;
    expect(h.row()?.content).toBe('admitted');
  });
  it('rejects null, missing, and superseded original admissions without a fresh read', async () => {
    const h = await harness();
    h.show();
    const read = vi.spyOn(appClient.notes, 'get');
    const key = notesRecoveryKey('ws');
    const old = admit(key);
    rendererEventRecovery.push(key);
    for (const admissions of [old, new Map(), new Map([[key, null]])]) {
      await dispatchNoteRecoveryEvent(noteEventReceived('ws', 'spec', 'note:updated'), admissions);
    }
    expect(read).not.toHaveBeenCalled();
  });
  it('settles held processing on session retirement without resurrecting note data', async () => {
    const h = await harness();
    h.show();
    let resolve!: (value: any) => void;
    vi.spyOn(appClient.notes, 'get').mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    let completed = false;
    const processing = dispatchNoteRecoveryEvent(
      noteEventReceived('ws', 'spec', 'note:updated'),
      admit(notesRecoveryKey('ws')),
    ).then(() => {
      completed = true;
    });
    await settle();
    expect(completed).toBe(false);
    h.retire();
    await settle();
    expect(completed).toBe(true);
    resolve(row('retired'));
    await processing;
    expect(h.row()).toBeUndefined();
  });
  it('waits for comment read and settles coalesced event acknowledgments', async () => {
    const h = await harness();
    h.dispatch(commentLoadRequested('view', 'one', 'ws', 'spec'));
    await settle();
    let resolve!: (value: any) => void;
    const read = vi
      .spyOn(appClient.comments, 'list')
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue([]);
    const key = commentsRecoveryKey('ws', 'spec');
    let completed = 0;
    const first = dispatchNoteRecoveryEvent(commentEventReceived('ws', 'spec'), admit(key)).then(
      () => {
        completed++;
      },
    );
    await settle();
    const second = dispatchNoteRecoveryEvent(commentEventReceived('ws', 'spec'), admit(key)).then(
      () => {
        completed++;
      },
    );
    const third = dispatchNoteRecoveryEvent(commentEventReceived('ws', 'spec'), admit(key)).then(
      () => {
        completed++;
      },
    );
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
    expect(completed).toBe(0);
    resolve([]);
    await Promise.all([first, second, third]);
    expect(read).toHaveBeenCalledTimes(2);
    expect(completed).toBe(3);
  });
  it('waits for attribution state', async () => {
    const h = await harness();
    vi.spyOn(appClient.notes.lineAttribution, 'load').mockResolvedValue(null);
    h.dispatch(noteAttributionViewRequested('view', 'one', 'ws', 'spec'));
    await settle();
    let resolve!: (value: any) => void;
    const read = vi.spyOn(appClient.notes.lineAttribution, 'load').mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    let completed = false;
    const processing = dispatchNoteAttributionRecoveryEvent(
      { workspaceId: 'ws', noteId: 'spec' },
      admit(attributionRecoveryKey('ws', 'spec')),
    ).then(() => {
      completed = true;
    });
    await settle();
    expect(completed).toBe(false);
    expect(read).toHaveBeenCalledTimes(2);
    resolve({ workspaceId: 'ws', noteId: 'spec', lines: [], revision: 7 });
    await processing;
    expect(
      getItem(h.store.state.workspaceNotes.byWorkspaceId.ws.attributionViews, 'view')?.data
        ?.revision,
    ).toBe(7);
  });
  it('retains the original receipt across a delayed refresh descendant and same-ID replacement', async () => {
    const h = await harness(true);
    h.show();
    const read = vi.spyOn(appClient.notes, 'get').mockResolvedValue(row('stale') as never);
    h.dispatch(
      withRecoveryAdmissions(
        noteEventReceived('ws', 'spec', 'note:updated'),
        admit(notesRecoveryKey('ws')),
      ),
    );
    await settle();
    expect(read).not.toHaveBeenCalled();
    h.retire();
    h.replace();
    h.releaseRefresh();
    await settle();
    expect(read).not.toHaveBeenCalled();
    expect(h.row()).toBeUndefined();
  });
  it('coalesces note bursts to one trailing physical read and acknowledges every event', async () => {
    const h = await harness();
    h.show();
    let resolve!: (value: any) => void;
    let active = 0;
    let peak = 0;
    const read = vi
      .spyOn(appClient.notes, 'get')
      .mockImplementationOnce(() => {
        peak = Math.max(peak, ++active);
        return new Promise((done) => {
          resolve = (value) => {
            active--;
            done(value);
          };
        });
      })
      .mockImplementation(async () => {
        peak = Math.max(peak, ++active);
        active--;
        return row('latest') as never;
      });
    const event = () =>
      dispatchNoteRecoveryEvent(
        noteEventReceived('ws', 'spec', 'note:updated'),
        admit(notesRecoveryKey('ws')),
      );
    const first = event();
    await settle();
    const others = [event(), event(), event()];
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
    resolve(row('old'));
    await Promise.all([first, ...others]);
    expect(read).toHaveBeenCalledTimes(2);
    expect(peak).toBe(1);
    expect(h.row()?.content).toBe('latest');
  });
  it('acknowledges read failure, workspace cleanup, deletion, and an absent consumer', async () => {
    const h = await harness();
    h.show();
    const key = notesRecoveryKey('ws');
    const read = vi.spyOn(appClient.notes, 'get').mockRejectedValueOnce(new Error('failed'));
    await dispatchNoteRecoveryEvent(noteEventReceived('ws', 'spec', 'note:updated'), admit(key));
    expect(h.row()?.content).toBe('old');
    read.mockImplementation(() => new Promise(() => {}));
    let completed = false;
    const pending = dispatchNoteRecoveryEvent(
      noteEventReceived('ws', 'spec', 'note:updated'),
      admit(key),
    ).then(() => {
      completed = true;
    });
    await settle();
    expect(completed).toBe(false);
    h.dispatch(workspaceUnmounted('ws'));
    await pending;
    expect(completed).toBe(true);
    h.task.cancel();
    await dispatchNoteRecoveryEvent(noteEventReceived('ws', 'spec', 'note:deleted'), new Map());
    await dispatchNoteAttributionRecoveryEvent({}, new Map());
  });
  it('acknowledges attribution with no view and does not recreate a released view', async () => {
    const h = await harness();
    const key = attributionRecoveryKey('ws', 'spec');
    const read = vi.spyOn(appClient.notes.lineAttribution, 'load').mockResolvedValue(null);
    await dispatchNoteAttributionRecoveryEvent({ workspaceId: 'ws', noteId: 'spec' }, admit(key));
    expect(read).not.toHaveBeenCalled();
    h.dispatch(noteAttributionViewRequested('view', 'one', 'ws', 'spec'));
    await settle();
    let resolve!: (value: any) => void;
    read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    let completed = false;
    const pending = dispatchNoteAttributionRecoveryEvent(
      { workspaceId: 'ws', noteId: 'spec' },
      admit(key),
    ).then(() => {
      completed = true;
    });
    await settle();
    h.dispatch(noteAttributionViewReleased('ws', 'view'));
    await settle();
    expect(completed).toBe(true);
    resolve({ workspaceId: 'ws', noteId: 'spec', lines: [], revision: 8 });
    await pending;
    expect(
      getItem(h.store.state.workspaceNotes.byWorkspaceId.ws.attributionViews, 'view'),
    ).toBeUndefined();
  });
  it('rejects missing integrated admissions on refresh, read, and attribution descendants', async () => {
    const h = await harness();
    h.show();
    const read = vi.spyOn(appClient.notes, 'get').mockResolvedValue(row('unadmitted') as never);
    const attribution = vi.spyOn(appClient.notes.lineAttribution, 'load').mockResolvedValue(null);
    h.dispatch(noteAttributionViewRequested('view', 'one', 'ws', 'spec'));
    await settle();
    attribution.mockClear();
    h.dispatch(
      withRecoveryAdmissions(
        refreshNoteFromEventRequested('ws', 'spec', 'note:updated'),
        new Map(),
      ),
    );
    const request = withRecoveryAdmissions(
      readNoteRequested('ws', 'spec', 'note:updated'),
      new Map(),
    );
    h.dispatch(request);
    h.dispatch(withRecoveryAdmissions(noteAttributionInvalidated('ws', 'spec'), new Map()));
    await settle();
    expect(await request.promise).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(attribution).not.toHaveBeenCalled();
  });
});

describe('physical note read drainage', () => {
  it('keeps a timed-out comment read ahead of recovery and repairs actual rows after drainage', async () => {
    const h = await harness();
    let drain!: (value: { errors: unknown[]; retired: boolean }) => void;
    const timeout = new RecoveryRequestTimeoutError(
      new Promise((done) => {
        drain = done;
      }),
    );
    vi.spyOn(appClient.comments, 'list').mockRejectedValueOnce(timeout);
    h.dispatch(commentLoadRequested('view', 'one', 'ws', 'spec'));
    await settle();
    h.loss();
    await settle();
    expect(h.commentRead).not.toHaveBeenCalled();
    expect(h.store.state.comments.commentsById.ids).toEqual([]);
    drain({ errors: [], retired: false });
    await settle();
    expect(h.commentRead).toHaveBeenCalledTimes(1);
    expect(getItem(h.store.state.comments.commentsById, 'comment')?.content).toBe('new comment');
  });
});
