import { BackendError } from '$lib/client/live/backend-transport-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('$store/renderer/slices/tab-state/tab-state-selectors', () => ({
  selectCurrentWorkspaceTabId: { select: (s: any) => s.selected },
}));
vi.mock('$store/renderer/slices/chat-changes/chat-changes-selectors', () => ({
  selectChatChangesCanRead: { select: () => true },
}));
vi.mock('$store/renderer/store', () => ({
  store: { state: {}, dispatch: vi.fn(), createSelector: (fn: any) => ({ select: fn }) },
}));
vi.mock('$store/renderer/slices/principal/principal-selectors', () => ({
  selectPrincipalActionContext: { select: (s: any) => s.authority },
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: { select: (s: any, id: string) => (s.exists ? { id } : undefined) },
  selectWorkspaceParticipationContext: { select: (s: any) => (s.exists ? s.authority : null) },
  selectWorkspaceListLoadedForBackend: { select: () => true },
}));
import { createCollection, getItem } from '@themislib/themis/utils/collections/collection-utils';
import {
  createEventRecoverySession,
  type RecoveryNotification,
} from '$shared/event-recovery/session';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import {
  gitReducer,
  gitReadRequested,
  gitReadStarted,
  gitReadCompleted,
  releaseGitRead,
  setSecondaryRootGit,
} from '$store/renderer/slices/git/git-slice';
import { gitReadKey } from '$store/renderer/slices/git/utils/git-read-key';
import { installGitContentRecovery } from './git-content-recovery';
import {
  installSecondaryRootRecovery,
  captureSecondaryRootRead,
  readSecondaryRootSnapshot,
} from './git-secondary-root-recovery';
import {
  captureGitRead,
  gitContentRecoveryKey,
  chatContentRecoveryKey,
} from './git-recovery-read-lane';
import { readGitContent } from './git-content-read';
import { installChatChangesRecovery } from './chat-content-recovery';
import {
  chatChangesReducer,
  chatChangesInputChanged,
} from '$store/renderer/slices/chat-changes/chat-changes-slice';

const cleanups: (() => void)[] = [];
const settle = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function setup(root = false, recover = true) {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  let emit!: (event: RecoveryNotification) => void;
  const request = vi.fn(async (method: string, params?: any): Promise<any> => {
    if (method === 'events.subscribe')
      return { subscriptionId: 'global', ...(recover ? { lossRecovery: 1 } : {}) };
    if (method === 'events.fence') return params;
    if (method === 'git.showFile') return { content: 'fresh' };
    throw new Error(method);
  });
  const scope = rendererEventRecovery.attach(
    createEventRecoverySession({
      supported: true,
      isCurrent: () => true,
      request: async (method, params, observe) => {
        const value = await request(method, params);
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
    selected: 'ws',
    panelLayout: { byWorkspaceId: {} },
    authority: 'a',
    exists: true,
    connections: { windowBackendId: 'local' },
    workspace: { deletionTokens: {} },
    git: gitReducer.initialState,
    chatChanges: chatChangesReducer.initialState,
    gitRoots: {
      byWorkspaceId: {
        ws: {
          gitRoots: createCollection(
            'id',
            root ? [{ id: 'root', path: '/root', createdAt: 'first' }] : [],
          ),
        },
      },
    },
  };
  const listeners = new Set<() => void>();
  const dispatch = (action: any) => {
    state = {
      ...state,
      git: gitReducer(state.git, action),
      chatChanges: chatChangesReducer(state.chatChanges, action),
    };
    for (const listener of listeners) listener();
  };
  const store = {
    getState: () => state,
    dispatch,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  cleanups.push(installGitContentRecovery(scope, store));
  await scope.subscribe({ eventTypes: ['*'] }, { recover });
  const read = {
    kind: 'showFile' as const,
    ref: 'HEAD',
    filePath: 'a.ts',
    ...(root ? { gitRootId: 'root' } : {}),
  };
  dispatch(gitReadRequested('ws', 'view', 'request', read));
  const key = gitReadKey(read);
  dispatch(gitReadStarted('ws', key, 'old'));
  dispatch(gitReadCompleted('ws', key, 'old', { kind: 'showFile', content: 'old' }, null));
  return {
    scope,
    store,
    dispatch,
    request,
    read,
    key,
    entry: () => getItem(state.git.byWorkspaceId.ws.reads, key) as any,
    change: (patch: any) => {
      state = { ...state, ...patch };
      for (const listener of listeners) listener();
    },
    loss: (generation = '1') =>
      emit({
        method: 'events.lost',
        params: { subscriptionId: 'global', generation, scope: { workspaceId: null } },
      }),
    event: (gitRootId?: string) =>
      emit({
        method: 'events.event',
        params: {
          subscriptionId: 'global',
          event: { type: 'git:status', workspaceId: 'ws', data: { gitRootId } },
        },
      }),
  };
}
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  rendererEventRecovery.dispose();
  vi.useRealTimers();
});

describe('Git content recovery', () => {
  it('repairs final loss once, rejects the old generation, and ignores duplicate markers', async () => {
    const h = await setup();
    h.loss();
    await settle();
    expect(h.entry().result).toEqual({ kind: 'showFile', content: 'fresh' });
    expect(h.request.mock.calls.filter(([m]) => m === 'git.showFile')).toEqual([
      ['git.showFile', { workspaceId: 'ws', ref: 'HEAD', filePath: 'a.ts' }],
    ]);
    h.dispatch(gitReadCompleted('ws', h.key, 'old', { kind: 'showFile', content: 'late' }, null));
    h.loss();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.entry().result.content).toBe('fresh');
    expect(h.request.mock.calls.filter(([m]) => m === 'git.showFile')).toHaveLength(1);
    expect(h.request.mock.calls.filter(([m]) => m === 'events.fence')).toHaveLength(2);
  });
  it('waits for the physical ordinary read and rejects its pre-loss receipt', async () => {
    const h = await setup();
    const held = deferred<{ content: string }>();
    h.request.mockImplementationOnce(() => held.promise);
    const lane = captureGitRead(gitContentRecoveryKey('ws', h.key));
    const ordinary = lane.run(() =>
      readGitContent('ws', h.read, lane.transport!, new AbortController().signal, () => true),
    );
    h.loss();
    await settle();
    expect(h.request.mock.calls.filter(([m]) => m === 'git.showFile')).toHaveLength(1);
    held.resolve({ content: 'late' });
    await ordinary;
    await settle();
    expect(lane.receipt.commit(() => undefined)).toBe(false);
    expect(h.entry().result.content).toBe('fresh');
    expect(h.request.mock.calls.filter(([m]) => m === 'git.showFile')).toHaveLength(2);
  });
  it.each(['root removal', 'authority ABA', 'workspace deletion'])(
    'clears retired content and fences late replies after %s',
    async (kind) => {
      const h = await setup(true);
      const held = deferred<{ content: string }>();
      const original = h.request.getMockImplementation()!;
      h.request.mockImplementation((method, params) =>
        method === 'git.showFile' ? held.promise : original(method, params),
      );
      h.loss();
      await settle();
      if (kind === 'root removal')
        h.change({ gitRoots: { byWorkspaceId: { ws: { gitRoots: createCollection('id', []) } } } });
      else if (kind === 'authority ABA') {
        h.change({ authority: 'b' });
        h.change({ authority: 'a' });
      } else h.change({ exists: false });
      held.resolve({ content: 'late' });
      await settle();
      expect(h.entry().result).toBeNull();
      expect(h.request.mock.calls.filter(([m]) => m === 'git.showFile')).toHaveLength(1);
    },
  );
  it('drops released consumer demand and does not start a queued read with an obsolete receipt', async () => {
    const h = await setup();
    const lane = captureGitRead(gitContentRecoveryKey('ws', h.key));
    const held = deferred<void>();
    const first = lane.run(() => held.promise);
    const read = vi.fn(async () => 1);
    const queued = lane.run(read).catch(() => undefined);
    h.dispatch(releaseGitRead('ws', 'view', 'request'));
    h.loss();
    held.resolve();
    await Promise.all([first, queued]);
    await settle();
    expect(read).not.toHaveBeenCalled();
    expect(h.request.mock.calls.filter(([m]) => m === 'git.showFile')).toHaveLength(0);
  });
  it('treats delayed unversioned pushes after recovery as bounded rereads', async () => {
    const h = await setup();
    h.loss();
    await settle();
    h.event();
    h.event();
    await settle();
    expect(h.request.mock.calls.filter(([m]) => m === 'git.showFile')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(250);
    await settle();
    expect(h.entry().result.content).toBe('fresh');
    expect(h.request.mock.calls.filter(([m]) => m === 'git.showFile')).toHaveLength(2);
  });
});

describe('secondary-root retained projections', () => {
  it('recovers demanded roots, defers inactive caches, and cannot restore a removed root', async () => {
    const h = await setup(true);
    h.dispatch(releaseGitRead('ws', 'view', 'request'));
    const roots = [
      { id: 'root', path: '/root', createdAt: 'first' },
      { id: 'other', path: '/other', createdAt: 'first' },
    ];
    h.change({
      gitRoots: { byWorkspaceId: { ws: { gitRoots: createCollection('id', roots) } } },
      panelLayout: {
        byWorkspaceId: {
          ws: {
            panels: {
              p: {
                activeTabId: 'active',
                tabs: [{ id: 'active', type: 'local-changes', data: { gitRootId: 'root' } }],
              },
            },
          },
        },
      },
    });
    const initial = {
      status: { branch: 'old', ahead: 0, behind: 0, files: [] },
      commits: [],
      commitFiles: {},
    };
    h.dispatch(setSecondaryRootGit('ws', 'root', initial as any));
    h.dispatch(setSecondaryRootGit('ws', 'other', initial as any));
    cleanups.push(installSecondaryRootRecovery(h.scope, h.store));
    const original = h.request.getMockImplementation()!;
    h.request.mockImplementation((method, params) =>
      method === 'git.status'
        ? Promise.resolve({ ...initial.status, branch: params.gitRootId })
        : method === 'git.commits'
          ? Promise.resolve({ items: [] })
          : original(method, params),
    );
    h.loss();
    await settle();
    expect(h.store.getState().git.byWorkspaceId.ws.secondaryRoots.root.status.branch).toBe('root');
    expect(h.store.getState().git.byWorkspaceId.ws.secondaryRoots.other.status.branch).toBe('old');
    expect(h.request.mock.calls.filter(([m]) => m === 'git.status')).toEqual([
      ['git.status', { workspaceId: 'ws', gitRootId: 'root' }],
    ]);
    h.change({
      panelLayout: {
        byWorkspaceId: {
          ws: {
            panels: {
              p: {
                activeTabId: 'active',
                tabs: [{ id: 'active', type: 'local-changes', data: { gitRootId: 'other' } }],
              },
            },
          },
        },
      },
    });
    await settle();
    expect(h.store.getState().git.byWorkspaceId.ws.secondaryRoots.other.status.branch).toBe(
      'other',
    );
    const held = deferred<any>();
    h.request.mockImplementation((m, p) =>
      m === 'git.status'
        ? held.promise
        : m === 'git.commits'
          ? Promise.resolve({ items: [] })
          : original(m, p),
    );
    h.loss('2');
    await vi.advanceTimersByTimeAsync(250);
    await settle();
    h.change({
      gitRoots: { byWorkspaceId: { ws: { gitRoots: createCollection('id', [roots[0]]) } } },
    });
    held.resolve({ ...initial.status, branch: 'late' });
    await settle();
    expect(h.store.getState().git.byWorkspaceId.ws.secondaryRoots.other).toBeUndefined();
  });
});

describe('tracked diff recovery batching', () => {
  it('replaces supplied live contents using one batched scoped diff read without reading transcripts', async () => {
    const h = await setup();
    h.dispatch(releaseGitRead('ws', 'view', 'request'));
    const original = h.request.getMockImplementation()!;
    h.request.mockImplementation((m, p) =>
      m === 'git.diffs'
        ? Promise.resolve(p.paths.map((path: string) => ({ path, hunks: [] })))
        : m === 'git.showFile'
          ? Promise.resolve({ content: 'index' })
          : m === 'file.read'
            ? Promise.resolve({ content: 'worktree' })
            : original(m, p),
    );
    const base = {
      kind: 'trackedDiff' as const,
      workspacePath: '/ws',
      stage: 'unstaged',
      allowHeadReads: true,
      forceRefresh: false,
      useProvidedContent: true,
      providedOld: 'obsolete index',
      providedNew: 'obsolete working',
    };
    const requests = [
      { ...base, filePath: 'a.ts' },
      { ...base, filePath: 'b.ts' },
      { ...base, filePath: 'transcript.ts', allowHeadReads: false },
    ];
    requests.forEach((request, i) =>
      h.dispatch(gitReadRequested('ws', String(i), String(i), request)),
    );
    h.loss();
    await settle();
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    expect(h.request.mock.calls.filter(([m]) => m === 'git.diffs')).toEqual([
      ['git.diffs', { workspaceId: 'ws', paths: ['a.ts', 'b.ts'] }],
    ]);
    const rows = h.store.getState().git.byWorkspaceId.ws.reads;
    expect(getItem(rows, gitReadKey(requests[0])).result).toMatchObject({
      oldContent: 'index',
      newContent: 'worktree',
    });
    expect(getItem(rows, gitReadKey(requests[2])).result).toMatchObject({
      oldContent: 'obsolete index',
      newContent: 'obsolete working',
    });
    expect(
      h.request.mock.calls.filter(
        ([, p]) => p?.filePath === 'transcript.ts' || p?.path === 'transcript.ts',
      ),
    ).toHaveLength(0);
  });
});

it('clears supplied mutable diff contents when the recovered file is now clean', async () => {
  const h = await setup();
  h.dispatch(releaseGitRead('ws', 'view', 'request'));
  const original = h.request.getMockImplementation()!;
  h.request.mockImplementation((m, p) =>
    m === 'git.diffs' ? Promise.resolve([]) : original(m, p),
  );
  const request = {
    kind: 'trackedDiff' as const,
    filePath: 'clean.ts',
    workspacePath: '/ws',
    stage: 'unstaged',
    allowHeadReads: true,
    forceRefresh: false,
    useProvidedContent: true,
    providedOld: 'old',
    providedNew: 'obsolete',
  };
  h.dispatch(gitReadRequested('ws', 'clean', 'clean', request));
  h.loss();
  await settle();
  await vi.runAllTimersAsync();
  await settle();
  expect(
    getItem(h.store.getState().git.byWorkspaceId.ws.reads, gitReadKey(request)).result,
  ).toMatchObject({ oldContent: '', newContent: '' });
  expect(h.request.mock.calls.filter(([m]) => m === 'git.diffs')).toHaveLength(2);
});

it('keeps ordinary live content updates working when the admitted lease is legacy', async () => {
  const h = await setup(false, false);
  h.event();
  await settle();
  expect(h.entry().result).toEqual({ kind: 'showFile', content: 'fresh' });
  expect(h.request.mock.calls.filter(([m]) => m === 'events.fence')).toHaveLength(0);
});

it('keeps ordinary secondary-root events working on legacy leases', async () => {
  const h = await setup(true, false);
  h.change({
    panelLayout: {
      byWorkspaceId: {
        ws: {
          panels: {
            p: {
              activeTabId: 'active',
              tabs: [{ id: 'active', type: 'local-changes', data: { gitRootId: 'root' } }],
            },
          },
        },
      },
    },
  });
  h.dispatch(releaseGitRead('ws', 'view', 'request'));
  const initial = {
    status: { branch: 'old', ahead: 0, behind: 0, files: [] },
    commits: [],
    commitFiles: {},
  };
  h.dispatch(setSecondaryRootGit('ws', 'root', initial as any));
  cleanups.push(installSecondaryRootRecovery(h.scope, h.store));
  const original = h.request.getMockImplementation()!;
  h.request.mockImplementation((method, params) =>
    method === 'git.status'
      ? Promise.resolve({ ...initial.status, branch: 'fresh' })
      : method === 'git.commits'
        ? Promise.resolve({ items: [] })
        : original(method, params),
  );
  h.event('root');
  await settle();
  expect(h.store.getState().git.byWorkspaceId.ws.secondaryRoots.root.status.branch).toBe('fresh');
  expect(h.request.mock.calls.filter(([m]) => m === 'git.status')).toHaveLength(1);
  expect(h.request.mock.calls.filter(([m]) => m === 'events.fence')).toHaveLength(0);
});

it('retires protected ordinary content on canonical authorization rejection', async () => {
  const h = await setup(false, false);
  const original = h.request.getMockImplementation()!;
  h.request.mockImplementation((method, params) =>
    method === 'git.showFile' ? Promise.reject({ rpcCode: -32003 }) : original(method, params),
  );
  h.event();
  await settle();
  expect(h.entry().result).toBeNull();
  h.event();
  await settle();
  expect(h.request.mock.calls.filter(([m]) => m === 'git.showFile')).toHaveLength(1);
});

it('shares physical recovery batches between Git and live chat views of the same root', async () => {
  const h = await setup();
  h.dispatch(releaseGitRead('ws', 'view', 'request'));
  cleanups.push(installChatChangesRecovery(h.scope, h.store));
  const original = h.request.getMockImplementation()!;
  const hunks = [
    {
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      lines: [{ type: 'Addition', content: 'fresh' }],
    },
  ];
  h.request.mockImplementation((m, p) =>
    m === 'git.diffs'
      ? Promise.resolve(p.staged ? [] : p.paths.map((path: string) => ({ path, hunks })))
      : m === 'file.read'
        ? Promise.resolve({ content: 'fresh' })
        : original(m, p),
  );
  h.dispatch(
    gitReadRequested('ws', 'git', 'g', {
      kind: 'trackedDiff',
      filePath: 'a.ts',
      workspacePath: '/ws',
      stage: 'unstaged',
      allowHeadReads: true,
      forceRefresh: false,
      useProvidedContent: false,
    }),
  );
  h.dispatch(
    chatChangesInputChanged('ws', 'chat', 'c', {
      changes: [
        {
          filePath: 'a.ts',
          action: 'modify',
          toolName: 'git',
          toolCallId: 'a',
          additions: 1,
          deletions: 0,
          category: 'unstaged',
        },
      ],
      showStagingControls: true,
      isAggregate: false,
      groupByCommit: false,
      nodeOwnedPaths: false,
    }),
  );
  h.loss();
  await settle();
  await vi.runAllTimersAsync();
  await settle();
  expect(h.request.mock.calls.filter(([m, p]) => m === 'git.diffs' && !p.staged)).toHaveLength(1);
  expect(h.request.mock.calls.filter(([m]) => m === 'file.read')).toHaveLength(1);
});

it.each([false, true])(
  'keeps the ordinary Git lane occupied until a timed-out physical read drains (replacement=%s)',
  async (replacement) => {
    const h = await setup();
    const held = deferred<{ content: string }>();
    const normal = h.request.getMockImplementation()!;
    let calls = 0;
    h.request.mockImplementation((m, p) =>
      m === 'git.showFile' && ++calls === 1 ? held.promise : normal(m, p),
    );
    const lane = captureGitRead(gitContentRecoveryKey('ws', h.key));
    const ordinary = lane
      .run(() =>
        readGitContent('ws', h.read, lane.transport!, new AbortController().signal, () => true),
      )
      .catch((e) => e);
    await settle();
    h.loss();
    await settle();
    expect(h.request.mock.calls.filter(([m]) => m === 'git.showFile')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30001);
    if (replacement) {
      h.request.mockImplementation((m, p) =>
        m === 'events.subscribe'
          ? Promise.resolve({ subscriptionId: 'successor', lossRecovery: 1 })
          : normal(m, p),
      );
      await h.scope.subscribe({ eventTypes: ['*'] }, { recover: true });
    }
    await settle();
    try {
      expect(h.request.mock.calls.filter(([m]) => m === 'git.showFile')).toHaveLength(1);
    } finally {
      held.resolve({ content: 'old physical reply' });
      await ordinary;
      await settle();
    }
    await vi.runAllTimersAsync();
    await settle();
    expect(h.request.mock.calls.filter(([m]) => m === 'git.showFile')).toHaveLength(2);
    expect(h.entry().result).toMatchObject({ content: 'fresh' });
  },
);
it.each(['recovery', 'ordinary', 'late', 'obsolete'] as const)(
  'clears only a current denied secondary-root cache before its sibling drains (%s)',
  async (mode) => {
    const h = await setup(true);
    h.dispatch(releaseGitRead('ws', 'view', 'request'));
    const initial = {
      status: { branch: 'private', ahead: 0, behind: 0, files: [] },
      commits: [],
      commitFiles: {},
    };
    h.dispatch(setSecondaryRootGit('ws', 'root', initial as any));
    h.change({
      panelLayout: {
        byWorkspaceId: {
          ws: {
            panels: {
              p: {
                activeTabId: 'a',
                tabs: [{ id: 'a', type: 'local-changes', data: { gitRootId: 'root' } }],
              },
            },
          },
        },
      },
    });
    cleanups.push(installSecondaryRootRecovery(h.scope, h.store));
    const held = deferred<any>();
    let deny!: (reason: unknown) => void;
    const status = new Promise((_, reject) => {
      deny = reject;
    });
    const normal = h.request.getMockImplementation()!;
    h.request.mockImplementation((m, p) =>
      m === 'git.status'
        ? mode === 'late' || mode === 'obsolete'
          ? status
          : Promise.reject({ rpcCode: -32003 })
        : m === 'git.commits'
          ? held.promise
          : normal(m, p),
    );
    let ordinary: Promise<unknown> | undefined;
    if (mode === 'ordinary') {
      const lane = captureSecondaryRootRead('ws', 'root');
      ordinary = lane
        .run(() => readSecondaryRootSnapshot('ws', 'root', undefined, 30, lane.transport!))
        .catch((e) => e);
    } else h.loss();
    await settle();
    if (mode === 'late') {
      await vi.advanceTimersByTimeAsync(30001);
      deny({ rpcCode: -32003 });
      await settle();
    }
    if (mode === 'obsolete') {
      h.change({
        gitRoots: {
          byWorkspaceId: {
            ws: {
              gitRoots: createCollection('id', [{ id: 'root', path: '/new', createdAt: 'new' }]),
            },
          },
        },
      });
      h.dispatch(
        setSecondaryRootGit('ws', 'root', {
          ...initial,
          status: { ...initial.status, branch: 'successor' },
        } as any),
      );
      deny({ rpcCode: -32003 });
      await settle();
    }
    try {
      if (mode === 'obsolete')
        expect(h.store.getState().git.byWorkspaceId.ws.secondaryRoots.root.status.branch).toBe(
          'successor',
        );
      else expect(h.store.getState().git.byWorkspaceId.ws.secondaryRoots.root).toBeUndefined();
      expect(h.request.mock.calls.filter(([m]) => m === 'git.status')).toHaveLength(1);
    } finally {
      held.resolve({ items: [] });
      await ordinary;
      await settle();
    }
  },
);

it.each([false, true])(
  'retains eventual ordinary Git denial under its original authority (obsolete=%s)',
  async (obsolete) => {
    const h = await setup(true);
    const completion = deferred<{ retired: boolean; errors: unknown[] }>();
    const timeout = new BackendError(
      { code: 'TIMEOUT', message: 'ordinary deadline' },
      completion.promise,
    );
    const normal = h.request.getMockImplementation()!;
    h.request.mockImplementation((m, p) =>
      m === 'git.showFile' ? Promise.reject(timeout) : normal(m, p),
    );
    const lane = captureGitRead(gitContentRecoveryKey('ws', h.key));
    await expect(
      lane.run(() =>
        readGitContent('ws', h.read, lane.transport!, new AbortController().signal, () => true),
      ),
    ).rejects.toBe(timeout);
    if (obsolete) {
      h.request.mockImplementation((method, params) =>
        method === 'git.showFile'
          ? Promise.resolve({ content: 'replacement' })
          : normal(method, params),
      );
      h.change({
        gitRoots: {
          byWorkspaceId: {
            ws: {
              gitRoots: createCollection('id', [{ id: 'root', path: '/new', createdAt: 'new' }]),
            },
          },
        },
      });
      await settle();
      h.dispatch(gitReadStarted('ws', h.key, 'replacement'));
      h.dispatch(
        gitReadCompleted(
          'ws',
          h.key,
          'replacement',
          { kind: 'showFile', content: 'replacement' },
          null,
        ),
      );
    }
    completion.resolve({ retired: false, errors: [{ rpcCode: -32003 }] });
    await settle();
    expect(h.entry().result).toEqual(
      obsolete ? { kind: 'showFile', content: 'replacement' } : null,
    );
  },
);

it.each(['push', 'loss'] as const)(
  'retires late ordinary denial across %s before queued reads can run',
  async (change) => {
    const h = await setup();
    const completion = deferred<{ retired: boolean; errors: unknown[] }>();
    const timeout = new BackendError(
      { code: 'TIMEOUT', message: 'ordinary deadline' },
      completion.promise,
    );
    const normal = h.request.getMockImplementation()!;
    let calls = 0;
    h.request.mockImplementation((method, params) =>
      method === 'git.showFile' && ++calls === 1 ? Promise.reject(timeout) : normal(method, params),
    );
    const key = gitContentRecoveryKey('ws', h.key);
    const lane = captureGitRead(key);
    await expect(
      lane.run(() =>
        readGitContent('ws', h.read, lane.transport!, new AbortController().signal, () => true),
      ),
    ).rejects.toBe(timeout);
    if (change === 'push') h.event();
    else h.loss();
    await settle();
    completion.resolve({ retired: false, errors: [{ rpcCode: -32003 }] });
    await settle();
    expect(h.entry().result).toBeNull();
    expect(rendererEventRecovery.captureAuthority(key).isCurrent()).toBe(false);
    expect(h.request.mock.calls.filter(([method]) => method === 'git.showFile')).toHaveLength(1);
  },
);

async function ordinaryGitWire() {
  const { BrowserWebSocketTransport } =
    await import('$lib/client/live/browser-websocket-transport');
  let socket: any;
  const transport = new BrowserWebSocketTransport({
    url: 'ws://127.0.0.1:9100/rpc?token=test',
    requestTimeoutMs: 25,
    webSocketFactory: () => {
      socket = {
        onopen: null,
        onmessage: null,
        onerror: null,
        onclose: null,
        sent: [] as string[],
        send(data: string) {
          this.sent.push(data);
        },
        close() {},
        receive(frame: unknown) {
          this.onmessage?.({ data: JSON.stringify(frame) });
        },
      };
      return socket;
    },
  });
  const flush = async () => {
    for (let i = 0; i < 100; i++) await Promise.resolve();
  };
  const ready = transport.request('probe.ready');
  void ready.catch(() => undefined);
  socket.onopen();
  await flush();
  const hello = JSON.parse(socket.sent.at(-1));
  expect(hello.method).toBe('client.hello');
  socket.receive({
    jsonrpc: '2.0',
    id: hello.id,
    result: {
      clientId: 'browser-verifier',
      protocolVersion: '2.2',
      server: {
        locality: 'local',
        hasDisplay: false,
        osArch: 'linux/x86_64',
        version: '0.1.0',
        protocolVersion: '2.2',
        capabilities: { liveState: true, eventStreamRecovery: 1 },
      },
    },
  });
  await flush();
  const initial = JSON.parse(socket.sent.at(-1));
  expect(initial.method).toBe('probe.ready');
  socket.receive({ jsonrpc: '2.0', id: initial.id, result: {} });
  await ready;
  return {
    transport,
    socket,
    flush,
    frames: (method: string) =>
      socket.sent.map((s: string) => JSON.parse(s)).filter((f: any) => f.method === method),
    reply: (frame: any, result: unknown) =>
      socket.receive({ jsonrpc: '2.0', id: frame.id, result }),
    deny: (frame: any) =>
      socket.receive({ jsonrpc: '2.0', id: frame.id, error: { code: -32003, message: 'denied' } }),
  };
}

it('a new physical Git connection does not inherit an old ordinary completion barrier', async () => {
  const old = await setup();
  const firstWire = await ordinaryGitWire();
  const firstNormal = old.request.getMockImplementation()!;
  old.request.mockImplementation((m, p) =>
    m === 'git.showFile' ? firstWire.transport.request(m, p) : firstNormal(m, p),
  );
  const firstLane = captureGitRead(gitContentRecoveryKey('ws', old.key));
  const first = firstLane
    .run(() =>
      readGitContent(
        'ws',
        old.read,
        firstLane.transport!,
        new AbortController().signal,
        () => true,
      ),
    )
    .catch((e) => e);
  await firstWire.flush();
  expect(firstWire.frames('git.showFile')).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(26);
  await firstWire.flush();
  expect(await first).toMatchObject({ code: 'TIMEOUT' });
  const current = await setup();
  const secondWire = await ordinaryGitWire();
  const secondNormal = current.request.getMockImplementation()!;
  current.request.mockImplementation((m, p) =>
    m === 'git.showFile' ? secondWire.transport.request(m, p) : secondNormal(m, p),
  );
  const secondLane = captureGitRead(gitContentRecoveryKey('ws', current.key));
  const next = secondLane
    .run(() =>
      readGitContent(
        'ws',
        current.read,
        secondLane.transport!,
        new AbortController().signal,
        () => true,
      ),
    )
    .catch((e) => e);
  try {
    await secondWire.flush();
    expect(secondLane.receipt.isCurrent()).toBe(true);
    expect(
      secondWire.frames('git.showFile'),
      'new transport must dispatch before the old socket reply',
    ).toHaveLength(1);
  } finally {
    firstWire.reply(firstWire.frames('git.showFile')[0], { content: 'obsolete' });
    await firstWire.flush();
    await secondWire.flush();
    for (const f of secondWire.frames('git.showFile')) secondWire.reply(f, { content: 'current' });
    await secondWire.flush();
    await next;
    firstWire.transport.dispose();
    secondWire.transport.dispose();
  }
});

it('captured Browser Git scope releases replacement after retirement', async () => {
  const h = await setup();
  for (const off of cleanups.splice(0)) off();
  const firstWire = await ordinaryGitWire();
  const oldScope = rendererEventRecovery.attach(await firstWire.transport.captureEventRecovery());
  h.dispatch(gitReadStarted('ws', h.key, 'initial'));
  h.dispatch(
    gitReadCompleted('ws', h.key, 'initial', { kind: 'showFile', content: 'private old' }, null),
  );
  const stopOld = installGitContentRecovery(oldScope, h.store);
  cleanups.push(stopOld);
  const lane = captureGitRead(gitContentRecoveryKey('ws', h.key));
  const old = lane
    .run(() =>
      readGitContent('ws', h.read, lane.transport!, new AbortController().signal, () => true),
    )
    .catch((e) => e);
  await firstWire.flush();
  expect(firstWire.frames('git.showFile')).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(30001);
  await firstWire.flush();
  expect(await old).toBeInstanceOf(Error);
  stopOld();
  const nextWire = await ordinaryGitWire();
  const nextScope = rendererEventRecovery.attach(await nextWire.transport.captureEventRecovery());
  h.dispatch(gitReadStarted('ws', h.key, 'current'));
  h.dispatch(
    gitReadCompleted('ws', h.key, 'current', { kind: 'showFile', content: 'cached current' }, null),
  );
  cleanups.push(installGitContentRecovery(nextScope, h.store));
  const nextLane = captureGitRead(gitContentRecoveryKey('ws', h.key));
  const next = nextLane
    .run(() =>
      readGitContent('ws', h.read, nextLane.transport!, new AbortController().signal, () => true),
    )
    .catch((e) => e);
  try {
    await nextWire.flush();
    expect(nextLane.receipt.isCurrent()).toBe(true);
    expect(nextWire.frames('git.showFile')).toHaveLength(1);
  } finally {
    firstWire.reply(firstWire.frames('git.showFile')[0], { content: 'old' });
    await firstWire.flush();
    await nextWire.flush();
    for (const f of nextWire.frames('git.showFile')) nextWire.reply(f, { content: 'new' });
    await next;
    firstWire.transport.dispose();
    nextWire.transport.dispose();
  }
});

it.each(['ordinary', 'recovery'])(
  'tracked Git content retires denied authority before held sibling drains (%s)',
  async (mode) => {
    const h = await setup();
    h.dispatch(releaseGitRead('ws', 'view', 'request'));
    const normal = h.request.getMockImplementation()!;
    const denied = deferred<any>();
    const sibling = deferred<any>();
    h.request.mockImplementation((m, p) =>
      m === 'git.diffs'
        ? Promise.resolve(p.paths.map((path: string) => ({ path, hunks: [] })))
        : m === 'git.showFile'
          ? denied.promise
          : m === 'file.read'
            ? sibling.promise
            : normal(m, p),
    );
    const read = {
      kind: 'trackedDiff' as const,
      filePath: 'secret.ts',
      workspacePath: '/ws',
      stage: 'unstaged',
      allowHeadReads: true,
      forceRefresh: false,
      useProvidedContent: true,
      providedOld: 'private index',
      providedNew: 'private disk',
    };
    h.dispatch(gitReadRequested('ws', 'tracked', 'tracked', read));
    await settle();
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    const key = gitReadKey(read);
    h.dispatch(gitReadStarted('ws', key, 'seed'));
    h.dispatch(
      gitReadCompleted(
        'ws',
        key,
        'seed',
        { kind: 'trackedDiff', oldContent: 'private index', newContent: 'private disk' } as any,
        null,
      ),
    );
    if (mode === 'recovery') h.loss();
    else h.event();
    await settle();
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    try {
      expect(h.request.mock.calls.filter(([m]) => m === 'git.showFile')).toHaveLength(1);
      expect(h.request.mock.calls.filter(([m]) => m === 'file.read')).toHaveLength(1);
      // The held Promise adopts an immediate rejected canonical reply.
      denied.resolve(Promise.reject({ rpcCode: -32003, message: 'Forbidden' }));
      await settle();
      expect(
        getItem(h.store.getState().git.byWorkspaceId.ws.reads, key).result,
        'denied content must clear before physical sibling settles',
      ).toBeNull();
      expect(
        rendererEventRecovery.captureAuthority(gitContentRecoveryKey('ws', key)).isCurrent(),
      ).toBe(false);
    } finally {
      sibling.resolve({ content: 'old' });
      denied.resolve({ content: 'old' });
      await settle();
    }
  },
);

it.each(['current', 'late', 'push', 'replacement'])(
  'every joined trackedDiff owner observes its original denial (%s)',
  async (mode) => {
    const h = await setup();
    h.dispatch(releaseGitRead('ws', 'view', 'request'));
    const normal = h.request.getMockImplementation()!;
    const denied = deferred<any>();
    const held = deferred<any>();
    const completion = deferred<{ retired: boolean; errors: unknown[] }>();
    h.request.mockImplementation((m, p) =>
      m === 'git.diffs'
        ? Promise.resolve(p.paths.map((path: string) => ({ path, hunks: [] })))
        : m === 'git.showFile'
          ? p.filePath === 'b.ts'
            ? denied.promise
            : Promise.resolve({ content: 'index a' })
          : m === 'file.read'
            ? p.path === 'b.ts'
              ? held.promise
              : Promise.resolve({ content: 'disk a' })
            : normal(m, p),
    );
    const reads = ['a.ts', 'b.ts'].map((filePath) => ({
      kind: 'trackedDiff' as const,
      filePath,
      workspacePath: '/ws',
      stage: 'unstaged',
      allowHeadReads: true,
      forceRefresh: false,
      useProvidedContent: true,
      providedOld: 'private index ' + filePath,
      providedNew: 'private disk ' + filePath,
    }));
    for (let i = 0; i < reads.length; i++)
      h.dispatch(gitReadRequested('ws', 'view' + i, 'req' + i, reads[i]));
    await settle();
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    for (const read of reads) {
      const key = gitReadKey(read);
      h.dispatch(gitReadStarted('ws', key, 'seed'));
      h.dispatch(
        gitReadCompleted(
          'ws',
          key,
          'seed',
          {
            kind: 'trackedDiff',
            oldContent: read.providedOld,
            newContent: read.providedNew,
          } as any,
          null,
        ),
      );
    }
    h.event();
    await settle();
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    try {
      expect(h.request.mock.calls.filter(([m]) => m === 'git.diffs')).toHaveLength(1);
      expect(h.request.mock.calls.filter(([m]) => m === 'git.showFile')).toHaveLength(2);
      expect(h.request.mock.calls.filter(([m]) => m === 'file.read')).toHaveLength(2);
      const secondKey = gitReadKey(reads[1]);
      if (mode === 'replacement') {
        h.dispatch(releaseGitRead('ws', 'view1', 'req1'));
        h.dispatch(gitReadRequested('ws', 'view1', 'successor', reads[1]));
      }
      if (mode === 'push' || mode === 'replacement') {
        h.dispatch(gitReadStarted('ws', secondKey, 'newer'));
        h.dispatch(
          gitReadCompleted(
            'ws',
            secondKey,
            'newer',
            { kind: 'trackedDiff', oldContent: 'new index', newContent: 'new disk' },
            null,
          ),
        );
      }
      const denial = { rpcCode: -32003, message: 'Forbidden' };
      if (mode === 'late') {
        denied.resolve(
          Promise.reject(
            new BackendError({ code: 'TIMEOUT', message: 'deadline' }, completion.promise),
          ),
        );
        await settle();
        expect(
          getItem(h.store.getState().git.byWorkspaceId.ws.reads, secondKey).result,
        ).not.toBeNull();
        completion.resolve({ retired: false, errors: [denial] });
      } else denied.resolve(Promise.reject(denial));
      await settle();
      const result = getItem(h.store.getState().git.byWorkspaceId.ws.reads, secondKey).result;
      if (mode === 'replacement') expect(result).toMatchObject({ newContent: 'new disk' });
      else expect(result, 'joined owner retires before physical sibling settles').toBeNull();
      expect(
        getItem(h.store.getState().git.byWorkspaceId.ws.reads, gitReadKey(reads[0])).result,
      ).not.toBeNull();
      expect(h.request.mock.calls.filter(([m]) => m === 'git.showFile')).toHaveLength(2);
      expect(h.request.mock.calls.filter(([m]) => m === 'file.read')).toHaveLength(2);
    } finally {
      held.resolve({ content: 'old b' });
      denied.resolve({ content: 'old b' });
      await settle();
    }
  },
);

it('notifies both Git and chat owners of a coalesced denial before sibling drain', async () => {
  const h = await setup();
  h.dispatch(releaseGitRead('ws', 'view', 'request'));
  cleanups.push(installChatChangesRecovery(h.scope, h.store));
  const original = h.request.getMockImplementation()!;
  const denied = deferred<any>();
  const held = deferred<any>();
  const hunks = [
    {
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      lines: [{ type: 'Addition', content: 'fresh' }],
    },
  ];
  h.request.mockImplementation((m, p) =>
    m === 'git.diffs'
      ? Promise.resolve(p.staged ? [] : p.paths.map((path: string) => ({ path, hunks })))
      : m === 'file.read'
        ? held.promise
        : m === 'git.showFile'
          ? denied.promise
          : original(m, p),
  );
  h.dispatch(
    gitReadRequested('ws', 'git', 'g', {
      kind: 'trackedDiff',
      filePath: 'a.ts',
      workspacePath: '/ws',
      stage: 'unstaged',
      allowHeadReads: true,
      forceRefresh: false,
      useProvidedContent: false,
    }),
  );
  h.dispatch(
    chatChangesInputChanged('ws', 'chat', 'c', {
      changes: [
        {
          filePath: 'a.ts',
          action: 'modify',
          toolName: 'git',
          toolCallId: 'a',
          additions: 1,
          deletions: 0,
          category: 'unstaged',
        },
      ],
      showStagingControls: true,
      isAggregate: false,
      groupByCommit: false,
      nodeOwnedPaths: false,
    }),
  );
  h.loss();
  await settle();
  await vi.advanceTimersByTimeAsync(0);
  await settle();
  expect(h.request.mock.calls.filter(([m, p]) => m === 'git.diffs' && !p.staged)).toHaveLength(1);
  expect(h.request.mock.calls.filter(([m]) => m === 'file.read')).toHaveLength(1);
  try {
    denied.resolve(Promise.reject({ rpcCode: -32003, message: 'Forbidden' }));
    await settle();
    const c = getItem(h.store.getState().chatChanges.byWorkspaceId.ws.consumers, 'chat');
    expect(
      rendererEventRecovery
        .captureAuthority(chatContentRecoveryKey('ws', 'chat', c.resourceKey, c.requestId))
        .isCurrent(),
    ).toBe(false);
  } finally {
    held.resolve({ content: 'obsolete' });
    await settle();
  }
});
