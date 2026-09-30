import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { all, call, takeEvery } from 'typed-redux-saga';
import { backendRequest } from '$lib/client/live/backend-transport';
import { notify } from '$lib/components/patterns/notify';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { Workspace } from '$shared/types';
import { backgroundGitActionsService } from '$features/accept-changes/background-git-actions.service';
import { store } from '../../../store';
import { startRootStoreLifecycle } from '../../../root-store-lifecycle';
import {
  reserveGitMutation,
  queueFileMutation,
  isGitMutationPending,
} from '../../../utils/worktree-mutation-queue';
import '../../../seeders/git-bridge-seeder';
import '../../../seeders/terminals-scripts-seeder';
import { connectionsListReceived } from '../../connections/connections-slice';
import { guestSessionsListReceived } from '../../guest-sessions/guest-sessions-slice';
import { setWorkspaceEntity } from '../../workspace/workspace-slice';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import { authCompleted } from '../../github-auth/github-auth-slice';
import {
  backendReconnected,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  setCommitMessage,
  setPRContent,
  setSidebarCommitWhenReady,
  setSidebarCreatePRWhenReady,
  setPendingAutoAction,
  refreshRequested,
  refreshAcceptChangesStatus,
} from '../../changes/changes-slice';
import { selectAcceptChangesState } from '../../changes/changes-selectors';
import { setExecutorState } from '../../background-agent-executor/background-agent-executor-slice';
import { selectGitOperationFlags } from '../../git/git-selectors';
import { loadGitStatus, setGitOperationFlag } from '../../git/git-slice';
import {
  selectActiveTerminalIdForWorkspace,
  selectIsTerminalOverlayOpenForWorkspace,
} from '../../terminals/terminals-selectors';
import {
  prWorkflowRequested,
  resumePRWorkflowAfterAuth,
  setPRWorkflowDrawer,
} from '../pr-workflow-slice';
import { selectPRWorkflow } from '../pr-workflow-selectors';
import { prWorkflowSaga } from './pr-workflow-saga';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn().mockResolvedValue({ subscriptionId: 'terminal-subscription' }),
  backendUnsubscribe: vi.fn().mockResolvedValue(undefined),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

let dispose: () => void;
let stop: () => void;
let stopRefreshObserver: () => void;
const refreshActions = vi.fn();
const workspace = {
  id: WorkspaceId('pr-alpha'),
  title: 'Workspace',
  path: '/repo',
  worktreePath: '/repo/worktree',
  branch: 'feature',
  baseRef: 'main',
  myRole: 'owner',
} as Workspace;
let handlers: Map<string, (params: Record<string, unknown>) => unknown>;
const calls = (method: string) =>
  vi.mocked(backendRequest).mock.calls.filter(([name]) => name === method);
const executeParams = (action: string, overrides = {}) => ({
  workspaceId: 'pr-alpha',
  action,
  files: undefined,
  commitMessage: undefined,
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
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  handlers = new Map([
    ['workspace.get', () => ({ workspace })],
    ['git.agentCommit', () => ({ success: true })],
    ['accept-changes.execute', () => ({ success: true, steps: [] })],
  ]);
  vi.mocked(backendRequest).mockImplementation(async (method, params) => {
    const handler = handlers.get(method);
    if (!handler) throw new Error(`Unexpected RPC ${method}`);
    return handler(params as Record<string, unknown>);
  });
  dispose = startRootStoreLifecycle(store, { startSagas: () => [] });
  stopRefreshObserver = store.runSaga(function* () {
    yield* all([
      takeEvery(loadGitStatus, function* (action) {
        yield* call(refreshActions, action);
      }),
      takeEvery(refreshRequested, function* (action) {
        yield* call(refreshActions, action);
      }),
      takeEvery(refreshAcceptChangesStatus, function* (action) {
        yield* call(refreshActions, action);
      }),
      takeEvery(setGitOperationFlag, function* (action) {
        yield* call(refreshActions, action);
      }),
    ]);
  });
  stop = store.runSaga(prWorkflowSaga);
  store.dispatch(
    connectionsListReceived({ connections: [], activeId: 'local', windowBackendId: 'local' }),
  );
  store.dispatch(guestSessionsListReceived({ sessions: [], openIds: [], connectedIds: [] }));
  store.dispatch(setWorkspaceEntity(workspace));
});
afterEach(() => {
  stop();
  stopRefreshObserver();
  dispose();
  vi.restoreAllMocks();
});

describe('PR workflow production owner with mocked transport', () => {
  it.each(['owner', 'collaborator'] as const)(
    'owns ordered refresh and busy-flag cleanup for a %s without owner-only collaborator reads',
    async (myRole) => {
      store.dispatch(setWorkspaceEntity({ ...workspace, myRole }));
      const request = prWorkflowRequested('pr-alpha', { kind: 'refresh' });
      store.dispatch(request);
      await expect(request.promise).resolves.toEqual({ success: true });
      expect(
        refreshActions.mock.calls.map(([action]) => ({
          type: action.type,
          payload: action.payload,
        })),
      ).toEqual([
        { type: 'git/setGitOperationFlag', payload: ['pr-alpha', 'isRefreshingGitStatus', true] },
        { type: 'git/loadStatus', payload: ['pr-alpha', true] },
        { type: 'changes/refreshRequested', payload: ['pr-alpha', true] },
        ...(myRole === 'owner'
          ? [{ type: 'changes/refreshAcceptChangesStatus', payload: ['pr-alpha'] }]
          : []),
        { type: 'git/setGitOperationFlag', payload: ['pr-alpha', 'isRefreshingGitStatus', false] },
      ]);
      expect(selectGitOperationFlags.select(store.state, 'pr-alpha').isRefreshingGitStatus).toBe(
        false,
      );
      expect(backendRequest).not.toHaveBeenCalled();
    },
  );

  it('consumes a collaborator auto-commit without dispatching an owner-only mutation', async () => {
    store.dispatch(setWorkspaceEntity({ ...workspace, myRole: 'collaborator' }));
    store.dispatch(setCommitMessage('pr-alpha', 'Generated draft'));
    store.dispatch(setPendingAutoAction('pr-alpha', { action: 'commit', workspaceId: 'pr-alpha' }));
    await vi.waitFor(() =>
      expect(selectAcceptChangesState.select(store.state, 'pr-alpha').pendingAutoAction).toBeNull(),
    );
    expect(selectPRWorkflow.select(store.state, 'pr-alpha').operations.commit).toBeUndefined();
    expect(selectAcceptChangesState.select(store.state, 'pr-alpha').commitMessage).toBe(
      'Generated draft',
    );
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('keeps commit-before-create atomic against filesystem writes and reconciles authoritative workspace data', async () => {
    const committed = Promise.withResolvers<{ success: boolean; steps: [] }>();
    const order: string[] = [];
    const pr = {
      id: '7',
      number: 7,
      url: 'https://github.test/o/r/pull/7',
      title: 'Authoritative title',
      status: 'open',
      createdAt: '2026-09-29T00:00:00Z',
      updatedAt: '2026-09-29T00:00:00Z',
    };
    handlers.set('accept-changes.execute', (params) => {
      order.push(String(params.action));
      return params.action === 'commit'
        ? committed.promise
        : { success: true, steps: [], result: { prNumber: 7, prHtmlUrl: pr.url } };
    });
    handlers.set('workspace.get', () => ({
      workspace: { ...workspace, activePullRequest: pr, prNumber: 7 },
    }));
    store.dispatch(setPRWorkflowDrawer('pr-alpha', 'prDrawerOpen', true));
    const result = backgroundGitActionsService.createPR({
      workspaceId: 'pr-alpha',
      prTitle: ' Title ',
      prDescription: ' Body ',
      targetBranch: 'main',
      hasStaged: true,
    });
    await vi.waitFor(() => expect(order).toEqual(['commit']));
    const write = queueFileMutation('pr-alpha', 'a.ts', async () => {
      order.push('file-write');
    });
    committed.resolve({ success: true, steps: [] });
    await expect(result).resolves.toMatchObject({ success: true, prNumber: 7, prHtmlUrl: pr.url });
    await write;
    expect(order).toEqual(['commit', 'create-pr', 'file-write']);
    expect(calls('accept-changes.execute').map(([, params]) => params)).toEqual([
      executeParams('commit', { commitMessage: 'Title' }),
      executeParams('create-pr', { prTitle: 'Title', prBody: 'Body', targetBranch: 'main' }),
    ]);
    expect(calls('workspace.get')).toEqual([['workspace.get', { workspaceId: 'pr-alpha' }]]);
    expect(selectWorkspaceById.select(store.state, 'pr-alpha')?.activePullRequest).toEqual(pr);
    expect(selectPRWorkflow.select(store.state, 'pr-alpha').prDrawerOpen).toBe(false);
  });

  it('retains drafts and prevents create after an in-band staged-commit failure', async () => {
    handlers.set('accept-changes.execute', () => ({
      success: false,
      steps: [],
      error: 'hook rejected',
    }));
    const result = await backgroundGitActionsService.createPR({
      workspaceId: 'pr-alpha',
      prTitle: 'Title',
      prDescription: '',
      hasStaged: true,
    });
    expect(result).toEqual({ success: false, error: 'hook rejected' });
    expect(calls('accept-changes.execute')).toHaveLength(1);
    expect(selectPRWorkflow.select(store.state, 'pr-alpha').operations['create-pr']?.status).toBe(
      'error',
    );
  });

  it('settles thrown transport failures in-band and clears busy flags', async () => {
    handlers.set('accept-changes.execute', () => {
      throw new Error('network unavailable');
    });
    const request = prWorkflowRequested('pr-alpha', {
      kind: 'push',
      upToCommitHash: 'abc',
      targetBranch: 'feature',
    });
    store.dispatch(request);
    await expect(request.promise).resolves.toEqual({
      success: false,
      error: 'network unavailable',
    });
    expect(calls('accept-changes.execute')).toEqual([
      [
        'accept-changes.execute',
        executeParams('push', { upToCommitHash: 'abc', targetBranch: 'feature' }),
      ],
    ]);
    expect(selectGitOperationFlags.select(store.state, 'pr-alpha').isPushing).toBe(false);
  });

  it('rechecks role after a queued lease becomes ready', async () => {
    const lease = reserveGitMutation('pr-alpha');
    const request = prWorkflowRequested('pr-alpha', { kind: 'push', upToCommitHash: 'abc' });
    store.dispatch(request);
    store.dispatch(setWorkspaceEntity({ ...workspace, myRole: 'collaborator' }));
    await lease.release();
    await expect(request.promise).resolves.toMatchObject({ success: false });
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('releases the lease and reconciles after create throws following a successful staged commit', async () => {
    const order: string[] = [];
    store.dispatch(setPRContent('pr-alpha', 'Draft title', 'Draft body'));
    handlers.set('accept-changes.execute', ({ action }) => {
      order.push(String(action));
      if (action === 'commit') return { success: true, steps: [] };
      throw new Error('forge unavailable');
    });
    handlers.set('workspace.get', () => {
      expect(isGitMutationPending('pr-alpha')).toBe(false);
      order.push('reconcile');
      return { workspace };
    });
    const result = await backgroundGitActionsService.createPR({
      workspaceId: 'pr-alpha',
      prTitle: 'Draft title',
      prDescription: 'Draft body',
      hasStaged: true,
    });
    expect(result).toEqual({ success: false, error: 'forge unavailable' });
    expect(order).toEqual(['commit', 'create-pr', 'reconcile']);
    expect(selectAcceptChangesState.select(store.state, 'pr-alpha')).toMatchObject({
      prTitle: 'Draft title',
      prDescription: 'Draft body',
    });
  });

  it('keeps the push-recovery action bound to its workspace and opens the returned terminal', async () => {
    handlers.set('accept-changes.execute', () => ({
      success: false,
      steps: [],
      error: 'Remote is behind. Pull the latest changes',
    }));
    handlers.set('terminal.create', () => ({ terminalId: 'recovery-terminal' }));
    const request = prWorkflowRequested('pr-alpha', {
      kind: 'push',
      targetBranch: 'feature',
      upToCommitHash: 'abc',
    });
    store.dispatch(request);
    await expect(request.promise).resolves.toMatchObject({ success: false });
    const action = vi.mocked(notify.error).mock.calls.at(-1)?.[1]?.action;
    expect(action).toHaveProperty('onClick', expect.any(Function));
    if (!action || typeof action !== 'object' || !('onClick' in action))
      throw new Error('Missing recovery action');
    store.dispatch(
      setWorkspaceEntity({ ...workspace, id: WorkspaceId('pr-beta'), branch: 'other' }),
    );
    action.onClick(new MouseEvent('click'));
    await vi.waitFor(() =>
      expect(selectActiveTerminalIdForWorkspace.select(store.state, 'pr-alpha')).toBe(
        'recovery-terminal',
      ),
    );
    expect(calls('terminal.create')).toEqual([
      [
        'terminal.create',
        {
          workspaceId: 'pr-alpha',
          cols: 80,
          rows: 24,
          cwd: '/repo/worktree',
          command: 'git fetch origin feature && git rebase origin/feature',
        },
      ],
    ]);
    expect(selectIsTerminalOverlayOpenForWorkspace.select(store.state, 'pr-alpha')).toBe(true);
    expect(selectIsTerminalOverlayOpenForWorkspace.select(store.state, 'pr-beta')).toBe(false);
  });

  it('routes force-push through its wire bridge and closes its drawer only on success', async () => {
    store.dispatch(setPRWorkflowDrawer('pr-alpha', 'forcePushDrawerOpen', true));
    handlers.set('git.push', () => {
      throw new Error('remote rejected');
    });
    const failed = prWorkflowRequested('pr-alpha', { kind: 'force-push' });
    store.dispatch(failed);
    await expect(failed.promise).resolves.toEqual({ success: false, error: 'remote rejected' });
    expect(selectPRWorkflow.select(store.state, 'pr-alpha').forcePushDrawerOpen).toBe(true);
    handlers.set('git.push', () => ({ ok: true, branch: 'feature', pushedSha: 'abc' }));
    const succeeded = prWorkflowRequested('pr-alpha', { kind: 'force-push' });
    store.dispatch(succeeded);
    await expect(succeeded.promise).resolves.toEqual({ success: true });
    expect(calls('git.push')).toEqual([
      ['git.push', { workspaceId: 'pr-alpha', force: true }, { timeoutMs: 300000 }],
      ['git.push', { workspaceId: 'pr-alpha', force: true }, { timeoutMs: 300000 }],
    ]);
    expect(selectPRWorkflow.select(store.state, 'pr-alpha').forcePushDrawerOpen).toBe(false);
    expect(selectGitOperationFlags.select(store.state, 'pr-alpha').isForcePushing).toBe(false);
  });

  it('adds a remote with the captured URL and preserves the drawer on failure', async () => {
    store.dispatch(setPRWorkflowDrawer('pr-alpha', 'connectRemoteDrawerOpen', true));
    handlers.set('accept-changes.addRemote', () => {
      throw new Error('invalid remote');
    });
    const failed = prWorkflowRequested('pr-alpha', {
      kind: 'connect-remote',
      remoteUrl: ' https://github.test/o/r.git ',
    });
    store.dispatch(failed);
    await expect(failed.promise).resolves.toMatchObject({
      success: false,
      error: 'invalid remote',
    });
    expect(calls('accept-changes.addRemote')).toEqual([
      [
        'accept-changes.addRemote',
        { workspaceId: 'pr-alpha', remoteUrl: 'https://github.test/o/r.git' },
      ],
    ]);
    expect(selectPRWorkflow.select(store.state, 'pr-alpha').connectRemoteDrawerOpen).toBe(true);
  });

  it('applies the new base returned by rebase and then reads authoritative workspace state', async () => {
    const updated = { ...workspace, baseCommitSha: 'rebased-sha' };
    handlers.set('accept-changes.execute', () => ({
      success: true,
      steps: [],
      result: { newBaseSha: 'rebased-sha' },
    }));
    handlers.set('workspace.update', () => ({ workspace: updated }));
    handlers.set('workspace.get', () => ({ workspace: updated }));
    const request = prWorkflowRequested('pr-alpha', { kind: 'rebase', trunkBranch: 'main' });
    store.dispatch(request);
    await expect(request.promise).resolves.toEqual({ success: true });
    expect(calls('accept-changes.execute')).toEqual([
      ['accept-changes.execute', executeParams('rebase-onto-trunk')],
    ]);
    expect(calls('workspace.update')).toEqual([
      ['workspace.update', { workspaceId: 'pr-alpha', baseCommitSha: 'rebased-sha' }],
    ]);
    expect(selectWorkspaceById.select(store.state, 'pr-alpha')?.baseCommitSha).toBe('rebased-sha');
    expect(selectGitOperationFlags.select(store.state, 'pr-alpha').isRebasing).toBe(false);
  });

  it('cancels on unmount without releasing an active transport tail or accepting late results', async () => {
    const pull = Promise.withResolvers<{ ok: boolean }>();
    handlers.set('git.pull', () => pull.promise);
    const request = prWorkflowRequested('pr-alpha', { kind: 'pull' });
    store.dispatch(request);
    await vi.waitFor(() =>
      expect(calls('git.pull')).toEqual([
        [
          'git.pull',
          { repoPath: '/repo/worktree', branchName: 'feature', workspaceId: 'pr-alpha' },
          { timeoutMs: 150000 },
        ],
      ]),
    );
    store.dispatch(workspaceUnmounted('pr-alpha'));
    await expect(request.promise).resolves.toMatchObject({ success: false });
    let fileWritten = false;
    const write = queueFileMutation('pr-alpha', 'a.ts', async () => {
      fileWritten = true;
    });
    await Promise.resolve();
    expect(fileWritten).toBe(false);
    pull.resolve({ ok: true });
    await write;
    expect(notify.success).not.toHaveBeenCalled();
    expect(selectGitOperationFlags.select(store.state, 'pr-alpha').isPulling).toBe(false);
  });

  it('preserves an in-flight create across reconnect and reconciles the actual result without replay', async () => {
    const created = Promise.withResolvers<{
      success: boolean;
      steps: [];
      result: { prNumber: number; prHtmlUrl: string };
    }>();
    const pr = {
      id: '9',
      number: 9,
      title: 'Created remotely',
      status: 'open',
      url: 'https://github.test/o/r/pull/9',
      createdAt: '2026-09-29T00:00:00Z',
      updatedAt: '2026-09-29T00:00:00Z',
    };
    handlers.set('accept-changes.execute', () => created.promise);
    handlers.set('workspace.get', () => ({ workspace: { ...workspace, activePullRequest: pr } }));
    const request = prWorkflowRequested('pr-alpha', {
      kind: 'create-pr',
      prTitle: 'Title',
      prDescription: 'Body',
    });
    store.dispatch(request);
    await vi.waitFor(() => expect(calls('accept-changes.execute')).toHaveLength(1));
    store.dispatch(backendReconnected());
    expect(selectPRWorkflow.select(store.state, 'pr-alpha').operations['create-pr']?.status).toBe(
      'pending',
    );
    expect(isGitMutationPending('pr-alpha')).toBe(true);
    expect(calls('workspace.get')).toEqual([]);
    created.resolve({ success: true, steps: [], result: { prNumber: 9, prHtmlUrl: pr.url } });
    await expect(request.promise).resolves.toEqual({
      success: true,
      prNumber: 9,
      prHtmlUrl: pr.url,
    });
    expect(calls('accept-changes.execute')).toEqual([
      ['accept-changes.execute', executeParams('create-pr', { prTitle: 'Title', prBody: 'Body' })],
    ]);
    expect(calls('workspace.get')).toEqual([['workspace.get', { workspaceId: 'pr-alpha' }]]);
    expect(selectWorkspaceById.select(store.state, 'pr-alpha')?.activePullRequest).toEqual(pr);
    expect(isGitMutationPending('pr-alpha')).toBe(false);
  });

  it('holds an auth-required command and retries the captured workspace exactly once', async () => {
    const request = prWorkflowRequested('pr-alpha', {
      kind: 'create-pr',
      prTitle: 'Title',
      prDescription: 'Body',
      requireAuth: true,
    });
    store.dispatch(request);
    await expect(request.promise).resolves.toEqual({ success: false, needsAuth: true });
    expect(backendRequest).not.toHaveBeenCalled();
    store.dispatch(authCompleted(null));
    store.dispatch(resumePRWorkflowAfterAuth('pr-alpha'));
    store.dispatch(resumePRWorkflowAfterAuth('pr-alpha'));
    await vi.waitFor(() =>
      expect(selectPRWorkflow.select(store.state, 'pr-alpha').operations['create-pr']?.status).toBe(
        'success',
      ),
    );
    expect(calls('accept-changes.execute')).toHaveLength(1);
    expect(selectPRWorkflow.select(store.state, 'pr-alpha').pendingAuth).toBeNull();
  });

  it('consumes generated commit and PR results through the canonical draft owner and one auto-action', async () => {
    store.dispatch(setCommitMessage('pr-alpha', 'old'));
    store.dispatch(setSidebarCommitWhenReady('pr-alpha', true));
    store.dispatch(
      setExecutorState('pr-alpha', 'commit', { status: 'success', result: 'Generated commit' }),
    );
    await vi.waitFor(() =>
      expect(selectPRWorkflow.select(store.state, 'pr-alpha').operations.commit?.status).toBe(
        'success',
      ),
    );
    expect(calls('git.agentCommit')).toEqual([
      [
        'git.agentCommit',
        { workspaceId: 'pr-alpha', message: 'Generated commit', userRequested: true },
      ],
    ]);
    expect(selectAcceptChangesState.select(store.state, 'pr-alpha').commitWhenReady).toBe(false);
    store.dispatch(authCompleted(null));
    store.dispatch(setSidebarCreatePRWhenReady('pr-alpha', true));
    store.dispatch(
      setExecutorState('pr-alpha', 'pr', {
        executionContext: { targetBranch: 'release' },
        status: 'success',
        result: '# Generated title\n\nGenerated body',
      }),
    );
    await vi.waitFor(() =>
      expect(selectPRWorkflow.select(store.state, 'pr-alpha').operations['create-pr']?.status).toBe(
        'success',
      ),
    );
    expect(calls('accept-changes.execute')).toEqual([
      [
        'accept-changes.execute',
        executeParams('create-pr', {
          prTitle: 'Generated title',
          prBody: 'Generated body',
          targetBranch: 'release',
        }),
      ],
    ]);
    expect(selectAcceptChangesState.select(store.state, 'pr-alpha').pendingAutoAction).toBeNull();
  });
});
