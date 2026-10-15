import { readGitLocks } from '@/features/workspace/git-lock-runtime';
import { setAgentLockState } from '../../../../../../src/store/renderer/slices/agent-lock/agent-lock-slice';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { store } from '@/store';
import { gitWriteSaga } from './git-write-saga';
import { createAdmittedLegacyPrincipal } from '../../../../../../src/test/fixtures/admitted-legacy-principal';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '../../../../../../src/store/renderer/slices/workspace/workspace-slice';
import { setGitStatus } from '../../../../../../src/store/renderer/slices/git/git-slice';
import {
  gitWriteRequested,
  gitWriteConsumerReleased,
} from '../../../../../../src/store/renderer/slices/git/git-write-slice';
import {
  workspaceUnmounted,
  workspaceMounted,
} from '../../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { principalContextChanged } from '../../../../../../src/store/renderer/slices/principal/principal-slice';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import {
  selectGitWriteContext,
  selectGitWritePending,
  selectGitWriteConsumerError,
} from '../git-write-selectors';
import { WorkspaceId } from '$shared/types/branded-ids';
import { GitFileStatus, type Workspace, type GitStatus } from '$shared/types';
const ports = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/features/backend/backend-transport', () => ({ backendRequest: ports.request }));
const ws = WorkspaceId('staging-owned');
let dispose: () => void;
let stop: () => void;
const status: GitStatus = {
  branch: 'main',
  ahead: 0,
  behind: 0,
  diverged: false,
  files: [{ path: 'a.txt', staged: false, status: GitFileStatus.Modified }],
  hasUncommittedChanges: true,
  hasUntrackedFiles: false,
};
function request(id = 'one') {
  const action = gitWriteRequested(ws, id, {
    kind: 'stage',
    paths: ['a.txt'],
    consumerId: 'view',
    admissionContext: selectGitWriteContext.select(store.state, ws)!,
  });
  store.dispatch(action);
  return action.promise;
}
beforeEach(() => {
  dispose = store.init(createAdmittedLegacyPrincipal());
  store.dispatch(
    setWorkspaceEntity({ id: ws, myRole: 'owner', worktreePath: '/owned/repo' } as Workspace),
  );
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
  store.dispatch(workspaceMounted(ws));
  store.dispatch(setGitStatus(ws, status));
  ports.request.mockReset().mockImplementation(async (method, _params, options) => {
    options?.onDispatch?.();
    if (method === 'file-tracking.getAgentLocks')
      return { lockedAgentIds: [], lockedFilePaths: [] };
    if (method === 'git.status') return status;
    return { success: true };
  });
  stop = store.runSaga(gitWriteSaga);
});
afterEach(() => {
  stop();
  dispose();
});
it('uses the canonical explicit-path mutation after fresh locks and refreshes status', async () => {
  await expect(request()).resolves.toMatchObject({ success: true });
  expect(ports.request.mock.calls.map(([method]) => method)).toEqual([
    'file-tracking.getAgentLocks',
    'git.stage',
    'git.status',
  ]);
  expect(ports.request.mock.calls[1][1]).toEqual({ workspaceId: ws, paths: ['a.txt'] });
});
it('fails closed on lock read failure and permits a deliberate retry', async () => {
  ports.request.mockRejectedValueOnce(new Error('locks unavailable'));
  await expect(request()).resolves.toMatchObject({ success: false, error: 'locks unavailable' });
  expect(ports.request.mock.calls.some(([method]) => method === 'git.stage')).toBe(false);
  await expect(request('retry')).resolves.toMatchObject({ success: true });
});
it('rejects locked files, even if their UI snapshot previously allowed a click', async () => {
  ports.request.mockResolvedValueOnce({ lockedAgentIds: ['agent'], lockedFilePaths: ['a.txt'] });
  await expect(request()).resolves.toMatchObject({ success: false });
  expect(ports.request.mock.calls.some(([method]) => method === 'git.stage')).toBe(false);
});
it('retains pending ownership across departure and duplicate activation until the actual write settles', async () => {
  let resolve!: (value: unknown) => void;
  ports.request.mockImplementation((method, _params, options) => {
    options?.onDispatch?.();
    return method === 'git.stage'
      ? new Promise((done) => {
          resolve = done;
        })
      : Promise.resolve({ lockedAgentIds: [], lockedFilePaths: [] });
  });
  const first = request();
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  store.dispatch(gitWriteConsumerReleased(ws, 'view'));
  store.dispatch(workspaceUnmounted(ws));
  expect(selectGitWritePending.select(store.state, ws)).toBe(true);
  const duplicate = request('duplicate');
  resolve({ success: true });
  await first;
  await duplicate;
  expect(ports.request.mock.calls.filter(([method]) => method === 'git.stage')).toHaveLength(1);
  expect(selectGitWritePending.select(store.state, ws)).toBe(false);
});
it('fences a replaced principal after lock read and cleans the exact pending record', async () => {
  let resolve!: (value: unknown) => void;
  ports.request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const first = request();
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  store.dispatch(principalContextChanged('replacement'));
  resolve({ lockedAgentIds: [], lockedFilePaths: [] });
  await first;
  expect(ports.request.mock.calls.some(([method]) => method === 'git.stage')).toBe(false);
  expect(selectGitWritePending.select(store.state, ws)).toBe(false);
});

it('does not turn collaborator read access into management permission', async () => {
  store.dispatch(
    setWorkspaceEntity({
      id: ws,
      myRole: 'collaborator',
      canManage: false,
      worktreePath: '/owned/repo',
    } as Workspace),
  );
  expect(selectGitWriteContext.select(store.state, ws)).toBeNull();
  await expect(request()).resolves.toMatchObject({ success: false });
  expect(ports.request).not.toHaveBeenCalled();
});
it('rejects paths outside the admitted primary-root file policy', async () => {
  for (const path of ['../outside.txt', '/absolute.txt', '.', '*']) {
    const action = gitWriteRequested(ws, path, {
      kind: 'stage',
      paths: [path],
      admissionContext: selectGitWriteContext.select(store.state, ws)!,
    });
    store.dispatch(action);
    await expect(action.promise).resolves.toMatchObject({ success: false });
  }
  expect(ports.request.mock.calls.some(([method]) => method === 'git.stage')).toBe(false);
});

it('retains a failed operation for the panel when its reconciled row disappears', async () => {
  ports.request.mockImplementation(async (method, _params, options) => {
    options?.onDispatch?.();
    if (method === 'file-tracking.getAgentLocks')
      return { lockedAgentIds: [], lockedFilePaths: [] };
    if (method === 'git.stage') throw new Error('pathspec missing');
    return { ...status, files: [] };
  });
  await expect(request()).resolves.toMatchObject({ success: false, error: 'pathspec missing' });
  expect(store.state.git.byWorkspaceId[ws]?.status?.files).toEqual([]);
  expect(selectGitWriteConsumerError.select(store.state, ws, 'view')).toBe('pathspec missing');
  expect(selectGitWriteConsumerError.select(store.state, ws, 'another-view')).toBeUndefined();
  store.dispatch(gitWriteConsumerReleased(ws, 'view'));
  expect(selectGitWriteConsumerError.select(store.state, ws, 'view')).toBeUndefined();
});

it('uses the actual freshness locks when an older hydration finishes first', async () => {
  const replies: ((value: unknown) => void)[] = [];
  ports.request.mockImplementation((method, _params, options) => {
    options?.onDispatch?.();
    if (method === 'file-tracking.getAgentLocks')
      return new Promise((resolve) => replies.push(resolve));
    return Promise.resolve(status);
  });
  const hydration = readGitLocks(ws);
  const write = request();
  await vi.waitFor(() => expect(replies).toHaveLength(2));
  replies[0]({ lockedAgentIds: [], lockedFilePaths: [] });
  await hydration;
  replies[1]({ lockedAgentIds: ['working-agent'], lockedFilePaths: ['a.txt'] });
  await expect(write).resolves.toMatchObject({ success: false });
  expect(ports.request.mock.calls.filter(([method]) => method === 'git.stage')).toHaveLength(0);
});
it('retains a newer daemon lock event over a stale hydration response', async () => {
  let resolve!: (value: unknown) => void;
  ports.request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const hydration = readGitLocks(ws);
  store.dispatch(
    setAgentLockState(
      ws,
      { 'working-agent': true },
      { 'a.txt': true },
      selectGitWriteContext.select(store.state, ws)!,
      true,
    ),
  );
  resolve({ lockedAgentIds: [], lockedFilePaths: [] });
  await expect(hydration).resolves.toMatchObject({ lockedFilePaths: { 'a.txt': true } });
  expect(store.state.agentLock.byWorkspaceId[ws].lockedFilePaths).toEqual({ 'a.txt': true });
});
