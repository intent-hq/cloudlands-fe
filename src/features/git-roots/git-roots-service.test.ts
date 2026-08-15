/**
 * Git-roots service wire contract + event folding (multi git root tracking,
 * intent-hq/monorepo#2053).
 *
 * FAKE transport only: the backend-transport seam is mocked. Asserts the
 * exact `gitRoot.list` request shape, the `gitRoot:*` events.subscribe
 * registration, and the pure fold of each root lifecycle event into the list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(),
  backendUnsubscribe: vi.fn().mockResolvedValue(undefined),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

import {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
  type BackendNotification,
} from '$lib/client/live/backend-transport';
import {
  foldGitRootEvent,
  listGitRoots,
  subscribeGitRoots,
  type GitRootRow,
} from './git-roots-service';

const mockedRequest = vi.mocked(backendRequest);
const mockedSubscribe = vi.mocked(backendSubscribe);
const mockedUnsubscribe = vi.mocked(backendUnsubscribe);
const mockedOnNotification = vi.mocked(onBackendNotification);

/** `gitRoot.list` wire row (persisted fields + live-read `branch`). */
function makeRoot(overrides: Partial<GitRootRow> = {}): GitRootRow {
  return {
    id: 'root-1',
    workspaceId: 'ws-1',
    path: '/repos/monorepo/packages/intentd',
    source: 'agent',
    branch: 'feature/subtree',
    repoOwner: 'intent-hq',
    repoName: 'intentd',
    registeredByAgentIds: ['agent-1'],
    createdAt: '2026-08-13T10:00:00Z',
    updatedAt: '2026-08-13T10:05:00Z',
    ...overrides,
  };
}

describe('foldGitRootEvent (§6.5 gitRoot:* lifecycle)', () => {
  it('gitRoot:unregistered removes the root by id', () => {
    const other = makeRoot({ id: 'root-2' });
    const { gitRoots, needsRefetch } = foldGitRootEvent(
      [makeRoot(), other],
      'gitRoot:unregistered',
      { workspaceId: 'ws-1', gitRootId: 'root-1', path: '/repos/monorepo/packages/intentd' },
    );
    expect(gitRoots).toEqual([other]);
    expect(needsRefetch).toBe(false);
  });

  it('gitRoot:registered appends an unseen root from the self-sufficient payload', () => {
    const incoming = makeRoot({ id: 'root-9', branch: undefined });
    const { gitRoots, needsRefetch } = foldGitRootEvent([makeRoot()], 'gitRoot:registered', {
      workspaceId: 'ws-1',
      gitRoot: incoming,
    });
    expect(gitRoots).toEqual([makeRoot(), incoming]);
    // Events never carry the live-read branch — converge via gitRoot.list.
    expect(needsRefetch).toBe(true);
  });

  it('gitRoot:updated replaces a known root, preserving the known branch', () => {
    const updated = makeRoot({ branch: undefined, prNumber: 42 });
    const { gitRoots, needsRefetch } = foldGitRootEvent([makeRoot()], 'gitRoot:updated', {
      workspaceId: 'ws-1',
      gitRoot: updated,
    });
    expect(gitRoots).toEqual([makeRoot({ prNumber: 42 })]);
    expect(needsRefetch).toBe(false);
  });

  it('ignores unknown event types and malformed payloads', () => {
    const initial = [makeRoot()];
    expect(foldGitRootEvent(initial, 'gitRoot:unknown', { gitRootId: 'root-1' }).gitRoots).toBe(
      initial,
    );
    expect(foldGitRootEvent(initial, 'gitRoot:unregistered', {}).gitRoots).toBe(initial);
    expect(foldGitRootEvent(initial, 'gitRoot:registered', {}).gitRoots).toBe(initial);
  });
});

describe('wire requests (fake transport)', () => {
  afterEach(() => vi.clearAllMocks());

  it('listGitRoots forwards gitRoot.list { workspaceId } and unwraps gitRoots', async () => {
    mockedRequest.mockResolvedValueOnce({ gitRoots: [makeRoot()] });
    const gitRoots = await listGitRoots('ws-1');
    expect(mockedRequest).toHaveBeenCalledWith('gitRoot.list', { workspaceId: 'ws-1' });
    expect(gitRoots).toEqual([makeRoot()]);
  });

  it('listGitRoots returns [] for a malformed response', async () => {
    mockedRequest.mockResolvedValueOnce({});
    expect(await listGitRoots('ws-1')).toEqual([]);
  });
});

describe('subscribeGitRoots (gitRoot:* events.subscribe + fold)', () => {
  let notify: ((n: BackendNotification) => void) | undefined;

  beforeEach(() => {
    mockedOnNotification.mockImplementation((handler) => {
      notify = handler;
      return () => {};
    });
    mockedSubscribe.mockResolvedValue({ subscriptionId: 'ws-sub-7' });
  });

  afterEach(() => {
    notify = undefined;
    vi.clearAllMocks();
  });

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('registers a workspace-scoped gitRoot:* subscription, seeds from gitRoot.list, folds events', async () => {
    mockedRequest.mockResolvedValue({ gitRoots: [makeRoot()] });
    const seen: GitRootRow[][] = [];
    const { dispose } = subscribeGitRoots('ws-1', (gitRoots) => seen.push(gitRoots));
    await flush();

    expect(mockedSubscribe).toHaveBeenCalledWith({
      eventTypes: ['gitRoot:*'],
      workspaceId: 'ws-1',
    });
    expect(mockedRequest).toHaveBeenCalledWith('gitRoot.list', { workspaceId: 'ws-1' });
    expect(seen.at(-1)).toEqual([makeRoot()]);

    notify?.({
      method: 'events.event',
      params: {
        subscriptionId: 'ws-sub-7',
        event: {
          type: 'gitRoot:updated',
          workspaceId: 'ws-1',
          data: { workspaceId: 'ws-1', gitRoot: makeRoot({ prNumber: 7, branch: undefined }) },
        },
      },
    });
    // Known branch is preserved when the event row omits it.
    expect(seen.at(-1)).toEqual([makeRoot({ prNumber: 7 })]);

    notify?.({
      method: 'events.event',
      params: {
        subscriptionId: 'ws-sub-7',
        event: {
          type: 'gitRoot:unregistered',
          workspaceId: 'ws-1',
          data: { workspaceId: 'ws-1', gitRootId: 'root-1', path: makeRoot().path },
        },
      },
    });
    expect(seen.at(-1)).toEqual([]);

    dispose();
    expect(mockedUnsubscribe).toHaveBeenCalledWith('ws-sub-7');
  });

  it('ignores foreign-workspace and foreign-subscription events', async () => {
    mockedRequest.mockResolvedValue({ gitRoots: [makeRoot()] });
    const seen: GitRootRow[][] = [];
    const { dispose } = subscribeGitRoots('ws-1', (gitRoots) => seen.push(gitRoots));
    await flush();
    const baseline = seen.length;

    notify?.({
      method: 'events.event',
      params: {
        subscriptionId: 'ws-sub-7',
        event: {
          type: 'gitRoot:unregistered',
          workspaceId: 'ws-2',
          data: { workspaceId: 'ws-2', gitRootId: 'root-1' },
        },
      },
    });
    notify?.({
      method: 'events.event',
      params: {
        subscriptionId: 'ws-sub-other',
        event: {
          type: 'gitRoot:unregistered',
          workspaceId: 'ws-1',
          data: { workspaceId: 'ws-1', gitRootId: 'root-1' },
        },
      },
    });
    expect(seen.length).toBe(baseline);
    dispose();
  });

  it('refetches when a registered event row lacks the live-read branch', async () => {
    mockedRequest
      .mockResolvedValueOnce({ gitRoots: [] })
      .mockResolvedValueOnce({ gitRoots: [makeRoot({ id: 'root-9' })] });
    const seen: GitRootRow[][] = [];
    const { dispose } = subscribeGitRoots('ws-1', (gitRoots) => seen.push(gitRoots));
    await flush();

    notify?.({
      method: 'events.event',
      params: {
        subscriptionId: 'ws-sub-7',
        event: {
          type: 'gitRoot:registered',
          workspaceId: 'ws-1',
          data: { workspaceId: 'ws-1', gitRoot: makeRoot({ id: 'root-9', branch: undefined }) },
        },
      },
    });
    await flush();

    expect(mockedRequest).toHaveBeenCalledTimes(2);
    expect(seen.at(-1)).toEqual([makeRoot({ id: 'root-9' })]);
    dispose();
  });

  it('drops a locally-removed root from a list response that was in flight during the unregister', async () => {
    let resolveSecondList: ((value: unknown) => void) | undefined;
    mockedRequest
      .mockResolvedValueOnce({ gitRoots: [makeRoot()] })
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSecondList = resolve)));
    const seen: GitRootRow[][] = [];
    const { refetch, dispose } = subscribeGitRoots('ws-1', (gitRoots) => seen.push(gitRoots));
    await flush();
    expect(seen.at(-1)).toEqual([makeRoot()]);

    // Start a second list, then unregister while it is in flight. The stale
    // response still carries the row — it must not resurrect the root.
    refetch();
    notify?.({
      method: 'events.event',
      params: {
        subscriptionId: 'ws-sub-7',
        event: {
          type: 'gitRoot:unregistered',
          workspaceId: 'ws-1',
          data: { workspaceId: 'ws-1', gitRootId: 'root-1', path: makeRoot().path },
        },
      },
    });
    expect(seen.at(-1)).toEqual([]);

    resolveSecondList?.({ gitRoots: [makeRoot()] });
    await flush();
    expect(seen.at(-1)).toEqual([]);
    dispose();
  });

  it('refetch() re-runs gitRoot.list and emits the fresh list (branch arrives on list only)', async () => {
    const refreshed = makeRoot({ branch: 'feature/rebased' });
    mockedRequest
      .mockResolvedValueOnce({ gitRoots: [makeRoot()] })
      .mockResolvedValueOnce({ gitRoots: [refreshed] });
    const seen: GitRootRow[][] = [];
    const { refetch, dispose } = subscribeGitRoots('ws-1', (gitRoots) => seen.push(gitRoots));
    await flush();
    expect(seen.at(-1)?.[0].branch).toBe('feature/subtree');

    refetch();
    await flush();

    expect(mockedRequest).toHaveBeenCalledTimes(2);
    expect(mockedRequest).toHaveBeenNthCalledWith(2, 'gitRoot.list', { workspaceId: 'ws-1' });
    expect(seen.at(-1)).toEqual([refreshed]);
    dispose();
  });
});
