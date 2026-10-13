import { BackendError } from '$lib/client/live/backend-transport-types';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('$store/renderer/store', () => ({
  store: { createSelector: (fn: any) => ({ select: fn }), state: {}, dispatch: vi.fn() },
}));
vi.mock('$store/renderer/slices/principal/principal-selectors', () => ({
  selectPrincipalActionContext: { select: (s: any) => s.authority },
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: { select: (s: any) => (s.exists ? { id: 'ws' } : undefined) },
  selectWorkspaceParticipationContext: { select: (s: any) => (s.exists ? s.authority : null) },
  selectWorkspaceListLoadedForBackend: { select: () => true },
}));
vi.mock('$store/renderer/slices/chat-changes/chat-changes-selectors', () => ({
  selectChatChangesCanRead: { select: () => true },
}));
import {
  createCollection,
  getItem,
  getItems,
} from '@themislib/themis/utils/collections/collection-utils';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import {
  createEventRecoverySession,
  type RecoveryNotification,
} from '$shared/event-recovery/session';
import {
  chatChangesReducer,
  chatChangesInputChanged,
  chatChangesEnriched,
  chatChangesFileRefreshStarted,
  chatChangesFileRefreshed,
  chatChangesConsumerReleased,
} from '$store/renderer/slices/chat-changes/chat-changes-slice';
import { installChatChangesRecovery } from './chat-content-recovery';
import { captureGitRead, chatContentRecoveryKey } from './git-recovery-read-lane';
const cleanup: (() => void)[] = [];
const settle = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve();
};
const hunk = {
  oldStart: 1,
  oldLines: 1,
  newStart: 1,
  newLines: 1,
  lines: [
    { type: 'Deletion', content: 'old' },
    { type: 'Addition', content: 'fresh' },
  ],
};
async function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  let emit!: (event: RecoveryNotification) => void;
  const request = vi.fn(async (method: string, params?: any): Promise<any> => {
    if (method === 'events.subscribe') return { subscriptionId: 'all', lossRecovery: 1 };
    if (method === 'events.fence') return params;
    if (method === 'git.diffs')
      return params.staged ? [] : params.paths.map((path: string) => ({ path, hunks: [hunk] }));
    if (method === 'git.showFile') return { content: 'old' };
    if (method === 'file.read') return { content: 'fresh' };
    throw new Error(method);
  });
  const scope = rendererEventRecovery.attach(
    createEventRecoverySession({
      supported: true,
      isCurrent: () => true,
      request: async (m, p, observe) => {
        const value = await request(m, p);
        observe?.(value);
        return value;
      },
      onNotification: (fn) => {
        emit = fn;
        return () => {};
      },
      onRetired: () => () => {},
      dispose: () => {},
    }),
  );
  let state: any = {
    authority: 'a',
    exists: true,
    connections: { windowBackendId: 'local' },
    workspace: { deletionTokens: {} },
    gitRoots: { byWorkspaceId: { ws: { gitRoots: createCollection('id') } } },
    chatChanges: chatChangesReducer.initialState,
  };
  const listeners = new Set<() => void>();
  const store = {
    getState: () => state,
    dispatch: (action: any) => {
      state = { ...state, chatChanges: chatChangesReducer(state.chatChanges, action) };
      for (const fn of listeners) fn();
    },
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  cleanup.push(installChatChangesRecovery(scope, store));
  await scope.subscribe({ eventTypes: ['*'] }, { recover: true });
  const input = {
    changes: [
      {
        filePath: 'a.ts',
        action: 'modify' as const,
        toolName: 'git',
        toolCallId: 'a',
        additions: 1,
        deletions: 1,
        category: 'unstaged' as const,
        oldContent: 'old',
        newContent: 'obsolete',
      },
    ],
    showStagingControls: true,
    isAggregate: false,
    groupByCommit: false,
    nodeOwnedPaths: false,
  };
  store.dispatch(chatChangesInputChanged('ws', 'live', 'r', input));
  const consumer = () => getItem(state.chatChanges.byWorkspaceId.ws.consumers, 'live')!;
  return {
    store,
    request,
    consumer,
    input,
    rows: () => getItems(consumer().changes).map((row) => row.change),
    event: () =>
      emit({
        method: 'events.event',
        params: {
          subscriptionId: 'all',
          event: { type: 'git:status', workspaceId: 'ws', data: {} },
        },
      }),
    loss: () =>
      emit({
        method: 'events.lost',
        params: { subscriptionId: 'all', generation: '1', scope: { workspaceId: null } },
      }),
    change: (patch: any) => {
      state = { ...state, ...patch };
      for (const fn of listeners) fn();
    },
  };
}
afterEach(() => {
  for (const off of cleanup.splice(0)) off();
  rendererEventRecovery.detach();
  vi.useRealTimers();
});
it('recovers real live chat cache with bounded staged reads and no transcript refresh', async () => {
  const h = await setup();
  h.store.dispatch(
    chatChangesInputChanged('ws', 'transcript', 't', {
      ...h.input,
      showStagingControls: false,
      changes: h.input.changes.map((c) => ({ ...c, filePath: 'transcript.ts' })),
    }),
  );
  h.loss();
  h.loss();
  await settle();
  await vi.runAllTimersAsync();
  await settle();
  expect(h.rows()).toMatchObject([{ filePath: 'a.ts', newContent: 'fresh', staged: false }]);
  expect(h.request.mock.calls.filter(([m]) => m === 'git.diffs')).toHaveLength(2);
  expect(h.request.mock.calls.filter(([m]) => m === 'events.fence')).toHaveLength(2);
  expect(JSON.stringify(h.request.mock.calls)).not.toContain('transcript.ts');
});
it('waits for ordinary reads and rejects old queued or reducer refresh replies', async () => {
  const h = await setup();
  const c = h.consumer();
  const lane = captureGitRead(chatContentRecoveryKey('ws', 'live', c.resourceKey, c.requestId));
  let finish!: (value: any) => void;
  const original = h.request.getMockImplementation()!;
  h.request.mockImplementation((m, p) =>
    m === 'file.read'
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : original(m, p),
  );
  const pending = lane.transport!.request('file.read', { workspaceId: 'ws', path: 'held' });
  h.store.dispatch(
    chatChangesFileRefreshStarted('ws', 'live', c.resourceKey, {
      path: 'a.ts',
      requestId: 'old-refresh',
      status: 'pending',
      refreshedAt: 0,
    }),
  );
  h.loss();
  await settle();
  expect(h.request.mock.calls.filter(([m]) => m === 'git.diffs')).toHaveLength(0);
  expect(lane.receipt.commit(() => undefined)).toBe(false);
  h.request.mockImplementation(original);
  finish({ content: 'late' });
  await pending;
  await settle();
  await vi.runAllTimersAsync();
  await settle();
  h.store.dispatch(
    chatChangesFileRefreshed(
      'ws',
      'live',
      c.resourceKey,
      { path: 'a.ts', requestId: 'old-refresh', status: 'ready', refreshedAt: 0 },
      h.input.changes,
    ),
  );
  h.store.dispatch(
    chatChangesEnriched('ws', 'live', c.requestId, c.resourceKey, h.input.changes, Date.now()),
  );
  expect(h.rows()).toMatchObject([{ newContent: 'fresh' }]);
});
it('clears now-clean live rows and retires authority without reviving old content', async () => {
  const h = await setup();
  const original = h.request.getMockImplementation()!;
  h.request.mockImplementation((m, p) =>
    m === 'git.diffs' ? Promise.resolve([]) : original(m, p),
  );
  h.loss();
  await settle();
  await vi.runAllTimersAsync();
  await settle();
  expect(h.rows()).toEqual([]);
  h.change({ authority: 'b' });
  h.change({ authority: 'a' });
  expect(h.rows()).toEqual([]);
  h.store.dispatch(chatChangesConsumerReleased('ws', 'live'));
});

it('clears protected live chat rows on an ordinary authorization denial', async () => {
  const h = await setup();
  const c = h.consumer();
  const lane = captureGitRead(chatContentRecoveryKey('ws', 'live', c.resourceKey, c.requestId));
  const original = h.request.getMockImplementation()!;
  h.request.mockImplementation((m, p) =>
    m === 'git.showFile' ? Promise.reject({ rpcCode: -32003 }) : original(m, p),
  );
  await expect(
    lane.transport!.request('git.showFile', { workspaceId: 'ws', ref: 'HEAD', filePath: 'a.ts' }),
  ).rejects.toEqual({ rpcCode: -32003 });
  expect(h.rows()).toEqual([]);
  expect(lane.receipt.commit(() => undefined)).toBe(false);
});

it('removes a collapsed branch-base row when the authoritative branch diff is clean', async () => {
  const h = await setup();
  const original = h.request.getMockImplementation()!;
  h.request.mockImplementation((m, p) =>
    m === 'git.branchDiff' ? Promise.resolve([]) : original(m, p),
  );
  h.store.dispatch(
    chatChangesInputChanged('ws', 'live', 'branch', {
      ...h.input,
      branchBaseRef: 'main',
      changes: ['first', 'second'].flatMap((commitHash) =>
        h.input.changes.map((c) => ({ ...c, category: 'committed' as const, commitHash })),
      ),
    }),
  );
  h.loss();
  await settle();
  await vi.runAllTimersAsync();
  await settle();
  expect(h.rows()).toEqual([]);
  expect(h.request.mock.calls.filter(([m]) => m === 'git.branchDiff')).toHaveLength(1);
});

it('updates a live chat cache after an ordinary admitted event without fences', async () => {
  const h = await setup();
  h.event();
  await settle();
  await vi.runAllTimersAsync();
  await settle();
  expect(h.rows()).toMatchObject([{ newContent: 'fresh' }]);
  expect(h.request.mock.calls.filter(([m]) => m === 'events.fence')).toHaveLength(0);
  expect(h.request.mock.calls.filter(([m]) => m === 'git.diffs')).toHaveLength(2);
});

it.each(['replacement', 'remove-readd', 'membership-regrant'] as const)(
  'old Git root denial cannot retire replacement chat cache (%s)',
  async (change) => {
    const h = await setup();
    h.change({
      gitRoots: {
        byWorkspaceId: {
          ws: {
            gitRoots: createCollection('id', [{ id: 'root', path: '/old-root', createdAt: 'one' }]),
          },
        },
      },
    });
    h.store.dispatch(
      chatChangesInputChanged('ws', 'live', 'root-request', { ...h.input, gitRootId: 'root' }),
    );
    let reject!: (e: unknown) => void;
    const held = new Promise<any>((_, r) => {
      reject = r;
    });
    const normal = h.request.getMockImplementation()!;
    h.request.mockImplementation((m, p) => (m === 'git.showFile' ? held : normal(m, p)));
    const old = h.consumer();
    const lane = captureGitRead(
      chatContentRecoveryKey('ws', 'live', old.resourceKey, old.requestId),
    );
    const pending = lane
      .run(() =>
        lane.transport!.request('git.showFile', {
          workspaceId: 'ws',
          gitRootId: 'root',
          ref: 'HEAD',
          filePath: 'a.ts',
        }),
      )
      .catch(() => undefined);
    await settle();
    if (change === 'membership-regrant') {
      h.change({ exists: false });
      h.change({ exists: true });
    } else {
      if (change === 'remove-readd')
        h.change({ gitRoots: { byWorkspaceId: { ws: { gitRoots: createCollection('id') } } } });
      h.change({
        gitRoots: {
          byWorkspaceId: {
            ws: {
              gitRoots: createCollection('id', [
                {
                  id: 'root',
                  path: change === 'replacement' ? '/new-root' : '/old-root',
                  createdAt: change === 'replacement' ? 'two' : 'one',
                },
              ]),
            },
          },
        },
      });
    }
    const { chatChangesRecovered } =
      await import('$store/renderer/slices/chat-changes/chat-changes-slice');
    const now = h.consumer();
    h.store.dispatch(
      chatChangesRecovered('ws', 'live', now.requestId, now.resourceKey, [
        { ...h.input.changes[0], newContent: 'new root content' },
      ]),
    );
    reject({ rpcCode: -32003 });
    await pending;
    await settle();
    expect(h.rows()).toMatchObject([{ newContent: 'new root content' }]);
  },
);

it.each([false, true])(
  'retains eventual ordinary chat denial under its original authority (obsolete=%s)',
  async (obsolete) => {
    const h = await setup();
    let finish!: (v: { retired: boolean; errors: unknown[] }) => void;
    const completion = new Promise<{ retired: boolean; errors: unknown[] }>((resolve) => {
      finish = resolve;
    });
    const timeout = new BackendError({ code: 'TIMEOUT', message: 'ordinary deadline' }, completion);
    const normal = h.request.getMockImplementation()!;
    h.request.mockImplementation((m, p) =>
      m === 'git.showFile' ? Promise.reject(timeout) : normal(m, p),
    );
    const consumer = h.consumer();
    const lane = captureGitRead(
      chatContentRecoveryKey('ws', 'live', consumer.resourceKey, consumer.requestId),
    );
    await expect(
      lane.run(() =>
        lane.transport!.request('git.showFile', {
          workspaceId: 'ws',
          ref: 'HEAD',
          filePath: 'a.ts',
        }),
      ),
    ).rejects.toBe(timeout);
    if (obsolete) {
      h.change({ exists: false });
      h.change({ exists: true });
      const { chatChangesRecovered } =
        await import('$store/renderer/slices/chat-changes/chat-changes-slice');
      const now = h.consumer();
      h.store.dispatch(
        chatChangesRecovered('ws', 'live', now.requestId, now.resourceKey, [
          { ...h.input.changes[0], newContent: 'replacement' },
        ]),
      );
    }
    finish({ retired: false, errors: [{ rpcCode: -32003 }] });
    await settle();
    expect(h.rows()).toMatchObject(obsolete ? [{ newContent: 'replacement' }] : []);
  },
);
