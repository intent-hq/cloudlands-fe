import { selectGitCommitState } from '../git-commit-selectors';
import { setCommitMessage } from '../../../../../../src/store/renderer/slices/changes/changes-slice';
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
  files: [{ path: 'a.txt', staged: true, status: GitFileStatus.Modified }],
  hasUncommittedChanges: true,
  hasUntrackedFiles: false,
};
function request(id = 'one') {
  const state = selectGitCommitState.select(store.state, ws);
  const action = gitWriteRequested(ws, id, {
    kind: 'commit',
    consumerId: 'view',
    admissionContext: state.context!,
    authorityKey: state.authorityKey!,
    reviewedPaths: state.paths,
    params: { message: state.message, userRequested: true, currentIndex: true },
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
    return { ok: true, hash: 'a'.repeat(40), files: ['a.txt'] };
  });
  store.dispatch(setCommitMessage(ws, 'Explicit local commit'));
  stop = store.runSaga(gitWriteSaga);
});
afterEach(() => {
  stop();
  dispose();
});

it('commits only current index through canonical client and preserves the returned SHA', async () => {
  await expect(request()).resolves.toMatchObject({
    success: true,
    commitOutcome: { state: 'confirmed', hash: 'a'.repeat(40) },
  });
  expect(
    ports.request.mock.calls
      .filter(([method]) => method === 'git.agentCommit')
      .map(([, params]) => params),
  ).toEqual([{ workspaceId: ws, message: 'Explicit local commit', userRequested: true }]);
  expect(selectGitCommitState.select(store.state, ws).message).toBe('');
});
it('refuses an index path-set changed after user activation before commit dispatch', async () => {
  ports.request.mockResolvedValueOnce({
    ...status,
    files: [{ path: 'other.txt', staged: true, status: GitFileStatus.Modified }],
  });
  await expect(request()).resolves.toMatchObject({ success: false });
  expect(ports.request.mock.calls.some(([method]) => method === 'git.agentCommit')).toBe(false);
  await expect(request('explicit-retry')).resolves.toMatchObject({ success: true });
});
it('fails before dispatch on missing fresh locks without creating an unknown receipt', async () => {
  ports.request.mockImplementation(async (method, _params, options) => {
    options?.onDispatch?.();
    if (method === 'git.status') return status;
    throw new Error('locks unavailable');
  });
  await expect(request()).resolves.toEqual({ success: false, error: 'locks unavailable' });
  expect(selectGitCommitState.select(store.state, ws).latest?.status).toBe('failed');
  expect(ports.request.mock.calls.some(([method]) => method === 'git.agentCommit')).toBe(false);
});
it('retains unknown outcome on departure and forbids another commit instead of retrying transport', async () => {
  ports.request.mockImplementation(async (method, _params, options) => {
    options?.onDispatch?.();
    if (method === 'git.agentCommit') throw new Error('lost acknowledgement');
    if (method === 'git.status') return status;
    return { lockedAgentIds: [], lockedFilePaths: [] };
  });
  await expect(request()).resolves.toMatchObject({
    success: false,
    commitOutcome: { state: 'unknown' },
  });
  store.dispatch(gitWriteConsumerReleased(ws, 'view'));
  store.dispatch(workspaceUnmounted(ws));
  store.dispatch(workspaceMounted(ws));
  expect(selectGitCommitState.select(store.state, ws).latest?.status).toBe('unknown');
  await expect(request('repeat')).resolves.toMatchObject({ success: false });
  expect(ports.request.mock.calls.filter(([method]) => method === 'git.agentCommit')).toHaveLength(
    1,
  );
});
it('retains confirmed settlement across departure and does not erase a newer commit draft', async () => {
  let resolve!: (value: unknown) => void;
  ports.request.mockImplementation((method, _params, options) => {
    options?.onDispatch?.();
    if (method === 'git.agentCommit')
      return new Promise((done) => {
        resolve = done;
      });
    return Promise.resolve(
      method === 'git.status' ? status : { lockedAgentIds: [], lockedFilePaths: [] },
    );
  });
  const first = request();
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  store.dispatch(gitWriteConsumerReleased(ws, 'view'));
  store.dispatch(workspaceUnmounted(ws));
  // Canonical changes drafts retire with their workspace. A new draft after return
  // must not be cleared by the previous view's late commit acknowledgement.
  store.dispatch(workspaceMounted(ws));
  store.dispatch(setCommitMessage(ws, 'Newer draft'));
  resolve({ ok: true, hash: 'a'.repeat(40), files: ['a.txt'] });
  await first;
  store.dispatch(workspaceMounted(ws));
  expect(selectGitCommitState.select(store.state, ws).latest?.result?.commitOutcome).toEqual({
    state: 'confirmed',
    hash: 'a'.repeat(40),
    files: ['a.txt'],
  });
  expect(selectGitCommitState.select(store.state, ws).message).toBe('Newer draft');
});
it('does not publish another principal response or dispatch after preflight authority retirement', async () => {
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
  resolve(status);
  await first;
  expect(ports.request.mock.calls.some(([method]) => method === 'git.agentCommit')).toBe(false);
  expect(selectGitCommitState.select(store.state, ws).latest).toBeUndefined();
});

it('retains even a whitespace-only newer draft edit while a mounted commit settles', async () => {
  let resolve!: (value: unknown) => void;
  ports.request.mockImplementation((method, _params, options) => {
    options?.onDispatch?.();
    if (method === 'git.agentCommit')
      return new Promise((done) => {
        resolve = done;
      });
    return Promise.resolve(
      method === 'git.status' ? status : { lockedAgentIds: [], lockedFilePaths: [] },
    );
  });
  const first = request();
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  store.dispatch(setCommitMessage(ws, 'Explicit local commit '));
  resolve({ ok: true, hash: 'a'.repeat(40), files: ['a.txt'] });
  await first;
  expect(selectGitCommitState.select(store.state, ws).message).toBe('Explicit local commit ');
});

it.each(['git.status', 'file-tracking.getAgentLocks'])(
  'does not dispatch a commit cancelled during %s preflight',
  async (heldMethod) => {
    let resolve!: (value: unknown) => void;
    ports.request.mockImplementation((method, _params, options) => {
      options?.onDispatch?.();
      if (method === heldMethod)
        return new Promise((done) => {
          resolve = done;
        });
      return Promise.resolve(
        method === 'git.status' ? status : { lockedAgentIds: [], lockedFilePaths: [] },
      );
    });
    const pending = request();
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    stop();
    resolve(heldMethod === 'git.status' ? status : { lockedAgentIds: [], lockedFilePaths: [] });
    await expect(pending).resolves.toMatchObject({ success: false });
    expect(
      ports.request.mock.calls.filter(([method]) => method === 'git.agentCommit'),
    ).toHaveLength(0);
    expect(selectGitCommitState.select(store.state, ws).latest?.status).toBe('failed');
  },
);
