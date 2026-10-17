import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { appClient } from '$lib/client';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import {
  __resetDaemonEventsBridgeForTests,
  routeDaemonEventsNotification,
} from '$features/events/daemon-events-bridge.client';
import {
  createEventRecoverySession,
  type RecoveryNotification,
} from '$shared/event-recovery/session';
import { admitLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { store } from '../../../store';
import { commentLoadRequested } from '../../comments/comments-slice';
import {
  loadWorkspaceNotesSucceeded,
  noteAttributionViewRequested,
  noteContentViewRequested,
  workspaceNotesHydrationRequested,
} from '../workspace-notes-slice';
import { selectNoteById } from '../workspace-notes-selectors';
import { notesReadSaga } from './notes-read-saga';
import { notesRecoveryKey, commentsRecoveryKey, attributionRecoveryKey } from './notes-recovery';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(async () => ({})),
  onBackendNotification: () => () => {},
  onBackendReconnected: () => () => {},
}));
beforeAll(() => {
  store.init();
});
afterAll(() => {
  store.dispose();
});
const cleanups: Array<() => void> = [];
const flush = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve();
};
const note = (workspaceId: string, content: string) => ({
  id: 'spec',
  workspaceId,
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
type Kind = 'note' | 'comment' | 'attribution';
async function harness(kind: Kind) {
  vi.useFakeTimers();
  rendererEventRecovery.dispose();
  admitLegacyPrincipal();
  const workspaceId = `notes-ingress-${kind}`;
  let receive!: (notification: RecoveryNotification) => void;
  const request = vi.fn(
    async (method: string, params?: unknown, observe?: (result: unknown) => void) => {
      const result =
        method === 'events.subscribe'
          ? { subscriptionId: 'notes-ingress', lossRecovery: 1 }
          : params;
      observe?.(result);
      return result;
    },
  );
  const session = createEventRecoverySession({
    supported: true,
    isCurrent: () => true,
    onRetired: () => () => {},
    dispose: () => {},
    request,
    onNotification: (handler) => {
      receive = handler;
      return () => {};
    },
  });
  const scope = rendererEventRecovery.attach(session, (notification, lifetimes) =>
    routeDaemonEventsNotification(notification.method, notification.params, 'notes-ingress', {
      lifetimes,
    }),
  );
  const stop = store.runSaga(notesReadSaga);
  cleanups.push(() => {
    stop();
    rendererEventRecovery.dispose();
  });
  await scope.subscribe(
    { workspaceId, eventTypes: ['note:*', 'task:*', 'comment:*', 'line-attribution:*'] },
    { recover: true },
  );
  store.dispatch(
    loadWorkspaceNotesSucceeded([workspaceId], {
      [workspaceId]: [note(workspaceId, 'before')],
    } as never),
  );
  store.dispatch(workspaceNotesHydrationRequested(workspaceId, 1, false));
  if (kind === 'note') {
    store.dispatch(noteContentViewRequested('body', 'visible', workspaceId, 'spec'));
  }
  if (kind === 'comment') {
    vi.spyOn(appClient.comments, 'list').mockResolvedValue([]);
    store.dispatch(commentLoadRequested('ingress-comment', 'one', workspaceId, 'spec'));
  }
  if (kind === 'attribution') {
    vi.spyOn(appClient.notes.lineAttribution, 'load').mockResolvedValue(null);
    store.dispatch(noteAttributionViewRequested('ingress-attribution', 'one', workspaceId, 'spec'));
  }
  await flush();
  const key =
    kind === 'note'
      ? notesRecoveryKey(workspaceId)
      : kind === 'comment'
        ? commentsRecoveryKey(workspaceId, 'spec')
        : attributionRecoveryKey(workspaceId, 'spec');
  const params = {
    subscriptionId: 'notes-ingress',
    event: {
      id: 'ingress-event',
      workspaceId,
      type:
        kind === 'note'
          ? 'note:updated'
          : kind === 'comment'
            ? 'comment:added'
            : 'line-attribution:updated',
      timestamp: '2026-01-01',
      data: { noteId: 'spec' },
    },
  };
  const value =
    kind === 'note'
      ? note(workspaceId, 'after')
      : kind === 'comment'
        ? [
            {
              id: 'ingress-comment',
              threadId: 'thread',
              workspaceId,
              noteId: 'spec',
              content: 'after',
              type: 'comment',
            },
          ]
        : { workspaceId, noteId: 'spec', attributions: {}, computedAt: 'after' };
  const read =
    kind === 'note'
      ? vi.spyOn(appClient.notes, 'get')
      : kind === 'comment'
        ? vi.spyOn(appClient.comments, 'list')
        : vi.spyOn(appClient.notes.lineAttribution, 'load');
  read.mockClear();
  const state = () =>
    kind === 'note'
      ? selectNoteById.select(store.state, workspaceId, 'spec')?.content
      : kind === 'comment'
        ? getItem(store.state.comments.commentsById, 'ingress-comment')?.content
        : getItem(
            store.state.workspaceNotes.byWorkspaceId[workspaceId].attributionViews,
            'ingress-attribution',
          )?.data?.computedAt;
  return { session, receive, request, key, params, value, read, state };
}
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  __resetDaemonEventsBridgeForTests();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('session ingress through installed note consumers', () => {
  it.each(['note', 'comment', 'attribution'] as const)(
    'fences %s only after the held read and actual reducer commit',
    async (kind) => {
      const h = await harness(kind);
      let finish!: (value: any) => void;
      h.read.mockImplementationOnce(
        () =>
          new Promise<any>((resolve) => {
            finish = resolve;
          }),
      );
      h.receive({ method: 'events.event', params: h.params });
      await flush();
      expect(h.read).toHaveBeenCalledTimes(1);
      const observe = vi.fn(() => h.state());
      const fence = h.session.fence(['notes-ingress'], observe);
      await flush();
      expect(h.request.mock.calls.filter(([method]) => method === 'events.fence')).toHaveLength(1);
      expect(observe).not.toHaveBeenCalled();
      finish(h.value);
      await fence;
      expect(observe).toHaveBeenCalledTimes(1);
      expect(observe.mock.results[0].value).toBe('after');
    },
  );
  it.each(['note', 'comment', 'attribution'] as const)(
    'rejects null or missing integrated %s admission before transport',
    async (kind) => {
      const h = await harness(kind);
      const before = h.state();
      await routeDaemonEventsNotification('events.event', h.params, 'notes-ingress', {
        lifetimes: new Map([[h.key, null]]),
      });
      await routeDaemonEventsNotification('events.event', h.params, 'notes-ingress', {
        lifetimes: new Map(),
      });
      await vi.advanceTimersByTimeAsync(1000);
      await flush();
      expect(h.read).not.toHaveBeenCalled();
      expect(h.state()).toBe(before);
    },
  );
});
