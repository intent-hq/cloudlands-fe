import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { appClient } from '$lib/client';
import { backendRequest } from '$lib/client/live/backend-transport';
import { AcceptChangesClient } from '$features/accept-changes/accept-changes.client';
import { stageFiles } from '$features/git/git-write-service';
import { WorkspaceId } from '$shared/types/branded-ids';
import { registerMockIpcHandler, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { createMockWorkspace } from '../../test/factories/workspace.factory';
import { startAppStoreLifecycle, type AppStoreHmrData } from './app-store-lifecycle';
import { startRootStoreLifecycle } from './root-store-lifecycle';
import { store as appStore } from './store';
import { connectionsListReceived } from './slices/connections/connections-slice';
import { guestSessionsListReceived } from './slices/guest-sessions/guest-sessions-slice';
import { gitWriteRequested } from './slices/git/git-write-slice';
import { selectGitWriteOperation } from './slices/git/git-write-selectors';
import { gitReadRequested, releaseGitRead } from './slices/git/git-slice';
import { selectGitRead } from './slices/git/git-selectors';
import { prWorkflowRequested } from './slices/pr-workflow/pr-workflow-slice';
import { loadFileContentSucceeded, saveFileContentRequested } from './slices/files/files-slice';
import { setFileExplorerWorkspacePath } from './slices/file-explorer/file-explorer-slice';
import { setWorkspaceEntity } from './slices/workspace/workspace-slice';
import { prepareContext } from './slices/background-agent-executor/utils/context-preparation';
import { selectGitStatus } from './slices/git/git-selectors';
import { selectHostRole } from './slices/principal/principal-selectors';

// Mock only I/O. Production Store, complete startup registry, reducers,
// compatibility facades and every participating saga execute unchanged.
vi.mock('$lib/client/live/backend-transport', () => ({
  electronAPI: () => window.electronAPI,
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(async () => ({ subscriptionId: 'composition-events' })),
  backendUnsubscribe: vi.fn(async () => {}),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/electron-bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/electron-bridge')>()),
  invoke: vi.fn(() => new Promise(() => {})),
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

const status = {
  branch: 'feature',
  ahead: 0,
  behind: 0,
  diverged: false,
  files: [],
  hasUncommittedChanges: false,
  hasUntrackedFiles: false,
};
const details = (commitHash: string, path: string) => ({
  commitHash,
  author: 'Fixture',
  authorEmail: 'fixture@example.test',
  date: '2026-09-29T00:00:00Z',
  message: 'fixture',
  files: [path],
  fileDetails: [{ path, additions: 2, deletions: 1 }],
});
const patch = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n';
let stopRoot: (() => void) | undefined;
let stopApp: (() => void) | undefined;
let hmr: AppStoreHmrData;
let handlers: Map<string, (params: Record<string, unknown>) => unknown>;

function calls(method: string) {
  return vi.mocked(backendRequest).mock.calls.filter(([name]) => name === method);
}

beforeEach(async () => {
  vi.clearAllMocks();
  resetMockIpcRouter();
  for (const channel of ['agent:get-active-streams', 'workspace:list', 'auto-update:get-state']) {
    registerMockIpcHandler(channel, () => new Promise(() => {}));
  }
  handlers = new Map();
  handlers.set('client.hello', () => ({ server: { capabilities: {} } }));
  handlers.set('principal.me', () => ({
    id: 'composition-owner',
    login: null,
    displayName: null,
    avatarUrl: null,
    isAdministrator: true,
  }));
  handlers.set('git.status', () => status);
  handlers.set('git.stage', ({ paths }) => ({ ok: true, paths }));
  handlers.set('git.stageHunk', () => ({ ok: true }));
  handlers.set('git.unstageHunk', () => ({ ok: true }));
  handlers.set('file.write', ({ path, content }) => ({
    ok: true,
    path,
    size: String(content).length,
  }));
  vi.mocked(backendRequest).mockImplementation(async (method, params) => {
    const handler = handlers.get(method);
    return handler ? handler(params as Record<string, unknown>) : new Promise(() => {});
  });
  vi.spyOn(window.electronAPI!, 'invoke').mockImplementation(async (channel) =>
    channel === 'backend:get-status' ? { status: 'connected' } : new Promise(() => {}),
  );
  hmr = {};
  stopRoot = startRootStoreLifecycle(appStore, { startSagas: () => [] });
  stopApp = startAppStoreLifecycle(appStore, hmr);
  appStore.dispatch(
    connectionsListReceived({ connections: [], activeId: 'local', windowBackendId: 'local' }),
  );
  appStore.dispatch(guestSessionsListReceived({ sessions: [], openIds: [], connectedIds: [] }));
  await vi.waitFor(() => expect(selectHostRole.select(appStore.state)).toBe('owner'));
  // Existing presence attachment reads its own ID; principal admission separately
  // discovers authority. Both production owners use the same §5.49 wire contract.
  expect(calls('principal.me')).toEqual([
    ['principal.me', {}],
    ['principal.me', {}],
  ]);
  expect(calls('client.hello')).toEqual([['client.hello', {}]]);
});

afterEach(() => {
  stopApp?.();
  stopRoot?.();
  stopApp = stopRoot = undefined;
  vi.restoreAllMocks();
  resetMockIpcRouter();
});

describe('Git workflow production composition and reload smoke', () => {
  it('routes public Git/Accept facades and PR intent through one ordered owner without blocking another workspace', async () => {
    for (const id of ['composition-a', 'composition-b']) {
      appStore.dispatch(setWorkspaceEntity(createMockWorkspace({ id: WorkspaceId(id) })));
    }
    const stage = Promise.withResolvers<{ ok: boolean; paths: string[] }>();
    handlers.set('git.stage', () => stage.promise);
    const inBandFailure = { success: false, steps: [], error: 'commit hook rejected' };
    handlers.set('accept-changes.execute', () => inBandFailure);
    const staged = stageFiles('composition-a', ['a.ts']);
    const accepted = AcceptChangesClient.execute(WorkspaceId('composition-a'), 'commit', {
      commitMessage: 'fixture',
    });
    const push = prWorkflowRequested('composition-b', { kind: 'push', targetBranch: 'main' });
    appStore.dispatch(push);
    await expect(push.promise).resolves.toMatchObject({
      success: false,
      error: 'commit hook rejected',
    });
    expect(calls('git.stage')).toEqual([
      ['git.stage', { workspaceId: 'composition-a', paths: ['a.ts'] }],
    ]);
    expect(calls('accept-changes.execute')).toHaveLength(1);
    expect(calls('accept-changes.execute')[0][1]).toMatchObject({
      workspaceId: 'composition-b',
      action: 'push',
    });
    stage.resolve({ ok: true, paths: ['a.ts'] });
    await expect(staged).resolves.toEqual({ success: true });
    await expect(accepted).resolves.toEqual(inBandFailure);
    expect(calls('accept-changes.execute')).toHaveLength(2);
    expect(calls('accept-changes.execute')[1]).toEqual([
      'accept-changes.execute',
      {
        workspaceId: 'composition-a',
        action: 'commit',
        files: undefined,
        commitMessage: 'fixture',
        prTitle: undefined,
        prBody: undefined,
        targetBranch: undefined,
        mergeStrategy: undefined,
        upToCommitHash: undefined,
        undoCommitsMetadata: undefined,
        options: {
          stageUnstaged: undefined,
          pushAfterCommit: undefined,
          createPRAfterPush: undefined,
          rebaseFirst: undefined,
          localOnly: undefined,
        },
      },
    ]);
  });

  it('dispatches real hunk owners and settles transport failures without duplicate mutation calls', async () => {
    for (const kind of ['stageHunk', 'unstageHunk'] as const) {
      const request = gitWriteRequested('composition-hunks', kind, {
        kind,
        filePath: 'a.ts',
        hunkPatch: patch,
        source: 'diff',
      });
      appStore.dispatch(request);
      await expect(request.promise).resolves.toEqual({ success: true });
      expect(calls(`git.${kind}`)).toEqual([
        [`git.${kind}`, { workspaceId: 'composition-hunks', filePath: 'a.ts', hunkPatch: patch }],
      ]);
      expect(
        selectGitWriteOperation.select(appStore.state, 'composition-hunks', kind)?.status,
      ).toBe('succeeded');
    }
    handlers.set('git.stageHunk', () => {
      throw new Error('patch no longer applies');
    });
    const failed = gitWriteRequested('composition-hunks', 'failed', {
      kind: 'stageHunk',
      filePath: 'a.ts',
      hunkPatch: patch,
    });
    appStore.dispatch(failed);
    await expect(failed.promise).resolves.toEqual({
      success: false,
      error: 'patch no longer applies',
    });
    expect(
      selectGitWriteOperation.select(appStore.state, 'composition-hunks', 'failed')?.status,
    ).toBe('failed');
    expect(calls('git.stageHunk')).toHaveLength(2);
  });

  it('isolates read consumers by root and ignores a late result after rebinding the same consumer', async () => {
    const old = Promise.withResolvers<ReturnType<typeof details>>();
    handlers.set('git.commitDetails', (params) =>
      params.gitRootId === 'root-old' ? old.promise : details('hash', 'current.ts'),
    );
    appStore.dispatch(
      gitReadRequested('composition-reads', 'view', 'old', {
        kind: 'commitDetails',
        commitHash: 'hash',
        gitRootId: 'root-old',
      }),
    );
    await vi.waitFor(() => expect(calls('git.commitDetails')).toHaveLength(1));
    appStore.dispatch(
      gitReadRequested('composition-reads', 'view', 'new', {
        kind: 'commitDetails',
        commitHash: 'hash',
        gitRootId: 'root-new',
      }),
    );
    appStore.dispatch(
      gitReadRequested('composition-reads', 'other-view', 'joined', {
        kind: 'commitDetails',
        commitHash: 'hash',
        gitRootId: 'root-new',
      }),
    );
    await vi.waitFor(() =>
      expect(selectGitRead.select(appStore.state, 'composition-reads', 'view')).toMatchObject({
        requestId: 'new',
        loading: false,
        result: { kind: 'commitDetails', details: { files: ['current.ts'] } },
      }),
    );
    old.resolve(details('hash', 'stale.ts'));
    await old.promise;
    expect(selectGitRead.select(appStore.state, 'composition-reads', 'view')?.requestId).toBe(
      'new',
    );
    expect(
      selectGitRead.select(appStore.state, 'composition-reads', 'other-view')?.result,
    ).toMatchObject({ details: { files: ['current.ts'] } });
    expect(calls('git.commitDetails')).toEqual([
      [
        'git.commitDetails',
        { workspaceId: 'composition-reads', commitHash: 'hash', gitRootId: 'root-old' },
      ],
      [
        'git.commitDetails',
        { workspaceId: 'composition-reads', commitHash: 'hash', gitRootId: 'root-new' },
      ],
    ]);
    appStore.dispatch(releaseGitRead('composition-reads', 'view', 'new'));
    appStore.dispatch(releaseGitRead('composition-reads', 'other-view', 'joined'));
  });

  it('retains a pending editor transport barrier across owner reload, rejects cancelled Git work and starts one replacement owner', async () => {
    const write = Promise.withResolvers<{ ok: boolean; path: string; size: number }>();
    handlers.set('file.write', () => write.promise);
    appStore.dispatch(
      setWorkspaceEntity(
        createMockWorkspace({
          id: WorkspaceId('composition-reload'),
          worktreePath: '/repo',
          repositoryPath: '/repo',
        }),
      ),
    );
    appStore.dispatch(setFileExplorerWorkspacePath('composition-reload', '/repo'));
    appStore.dispatch(loadFileContentSucceeded('composition-reload', 'a.ts', '/repo/a.ts', 'old'));
    appStore.dispatch(
      saveFileContentRequested('composition-reload', '/repo/a.ts', '/repo/a.ts', 'edited'),
    );
    await vi.waitFor(() => expect(calls('file.write')).toHaveLength(1));
    const cancelled = gitWriteRequested('composition-reload', 'before-reload', {
      kind: 'discard',
      paths: ['a.ts'],
    });
    appStore.dispatch(cancelled);
    const previousStop = stopApp!;
    stopApp = startAppStoreLifecycle(appStore, hmr);
    previousStop();
    await expect(cancelled.promise).rejects.toThrow();
    const restarted = stageFiles('composition-reload', ['a.ts']);
    expect(calls('git.stage')).toHaveLength(0);
    expect(calls('git.discard')).toHaveLength(0);
    write.resolve({ ok: true, path: 'a.ts', size: 6 });
    await expect(restarted).resolves.toEqual({ success: true });
    expect(calls('file.write')).toEqual([
      [
        'file.write',
        {
          workspaceId: 'composition-reload',
          path: 'a.ts',
          content: 'edited',
          idempotencyKey: expect.any(String),
        },
      ],
    ]);
    expect(calls('git.stage')).toEqual([
      ['git.stage', { workspaceId: 'composition-reload', paths: ['a.ts'] }],
    ]);
    expect(calls('git.discard')).toHaveLength(0);
  });

  it('refreshes a stale primary diff after a mutation while a secondary root read progresses', async () => {
    const oldDiff = Promise.withResolvers<unknown[]>();
    const mutation = Promise.withResolvers<{ ok: boolean; paths: string[] }>();
    let primaryReads = 0;
    handlers.set('git.stage', () => mutation.promise);
    handlers.set('git.diffs', (params) => {
      if (params.gitRootId === 'secondary') return [{ path: 'secondary.ts', hunks: [] }];
      return ++primaryReads === 1 ? oldDiff.promise : [{ path: 'current.ts', hunks: [] }];
    });
    appStore.dispatch(
      gitReadRequested('composition-fence', 'primary', 'primary-request', {
        kind: 'diffs',
        path: 'a.ts',
        staged: true,
      }),
    );
    await vi.waitFor(() => expect(primaryReads).toBe(1));
    const write = stageFiles('composition-fence', ['a.ts']);
    await vi.waitFor(() => expect(calls('git.stage')).toHaveLength(1));
    appStore.dispatch(
      gitReadRequested('composition-fence', 'secondary', 'secondary-request', {
        kind: 'diffs',
        path: 'a.ts',
        staged: true,
        gitRootId: 'secondary',
      }),
    );
    await vi.waitFor(() =>
      expect(selectGitRead.select(appStore.state, 'composition-fence', 'secondary')).toMatchObject({
        loading: false,
        result: { chunks: [{ file: 'secondary.ts' }] },
      }),
    );
    oldDiff.resolve([{ path: 'stale.ts', hunks: [] }]);
    await oldDiff.promise;
    expect(selectGitRead.select(appStore.state, 'composition-fence', 'primary')?.result).toBeNull();
    mutation.resolve({ ok: true, paths: ['a.ts'] });
    await expect(write).resolves.toEqual({ success: true });
    await vi.waitFor(() =>
      expect(selectGitRead.select(appStore.state, 'composition-fence', 'primary')).toMatchObject({
        loading: false,
        result: { chunks: [{ file: 'current.ts' }] },
      }),
    );
    expect(
      calls('git.diffs').filter(([, params]) => !(params as { gitRootId?: string }).gitRootId),
    ).toHaveLength(2);
    appStore.dispatch(releaseGitRead('composition-fence', 'primary', 'primary-request'));
    appStore.dispatch(releaseGitRead('composition-fence', 'secondary', 'secondary-request'));
  });

  it('preserves the creation-time path-based pull seam without requiring a workspace or another owner', async () => {
    handlers.set('git.pull', () => ({ ok: true }));
    await expect(appClient.git.pull('/fixture/repo', 'main')).resolves.toEqual({ success: true });
    expect(calls('git.pull')).toEqual([
      [
        'git.pull',
        { repoPath: '/fixture/repo', branchName: 'main' },
        { timeoutMs: expect.any(Number) },
      ],
    ]);
  });

  it('preserves the background executor status, staged diff and history public seams', async () => {
    const workspace = createMockWorkspace({ id: WorkspaceId('composition-context') });
    const daemonStatus = {
      ...status,
      hasUncommittedChanges: true,
      files: [
        { path: 'a.ts', status: 'modified', staged: true },
        { path: 'unselected.ts', status: 'modified', staged: false },
      ],
    };
    handlers.set('git.status', () => daemonStatus);
    handlers.set('git.diffs', () => [
      {
        path: 'a.ts',
        hunks: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: [
              { type: 'Deletion', content: 'old' },
              { type: 'Addition', content: 'new' },
            ],
          },
        ],
      },
    ]);
    handlers.set('git.commits', () => ({
      items: [
        {
          hash: 'context-hash',
          sha: 'context',
          author: 'Fixture',
          email: 'fixture@example.test',
          date: '2026-09-29T00:00:00Z',
          message: 'prior-context-message',
        },
      ],
    }));
    const context = await prepareContext(workspace, 'commit');
    expect(calls('git.status')).toEqual([['git.status', { workspaceId: workspace.id }]]);
    expect(calls('git.diffs')).toEqual([
      ['git.diffs', { workspaceId: workspace.id, path: 'a.ts', staged: true }],
    ]);
    expect(calls('git.commits')).toEqual([
      ['git.commits', { workspaceId: workspace.id, limit: 5 }],
    ]);
    expect(selectGitStatus.select(appStore.state, workspace.id)).toEqual(daemonStatus);
    expect(context).toContain('prior-context-message');
    expect(context).toContain('-old\n+new');
    expect(context).not.toContain('unselected.ts');
  });
});
