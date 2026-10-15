import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { store } from '@/store';
import { filesSaveSaga } from './files-save-saga';
import { gitStatusReadSaga } from '../../git/sagas/git-status-read-saga';
import {
  loadGitStatus,
  setGitStatus,
} from '../../../../../../src/store/renderer/slices/git/git-slice';
import { createAdmittedLegacyPrincipal } from '../../../../../../src/test/fixtures/admitted-legacy-principal';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '../../../../../../src/store/renderer/slices/workspace/workspace-slice';
import {
  workspaceMounted,
  workspaceUnmounted,
} from '../../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import {
  loadFileContentSucceeded,
  updateFileContent,
  saveFileContentRequested,
  removeFileContentEntry,
} from '../../../../../../src/store/renderer/slices/files/files-slice';
import {
  getFileSaveOperation,
  getFileContentEntry,
} from '../../../../../../src/store/renderer/slices/files/files-projections';
import { principalContextChanged } from '../../../../../../src/store/renderer/slices/principal/principal-slice';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import { captureFileSaveAuthority } from '@/features/workspace/file-save-runtime';
import { WorkspaceId } from '$shared/types/branded-ids';
import { GitFileStatus, type Workspace } from '$shared/types';
const ports = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/features/backend/backend-transport', () => ({ backendRequest: ports.request }));
const ws = WorkspaceId('file-save-owned'),
  path = 'a.txt',
  absolute = '/owned/repo/a.txt';
let dispose: () => void, stop: () => void;
const readers: (() => void)[] = [];
function load() {
  store.dispatch(
    loadFileContentSucceeded(
      ws,
      path,
      absolute,
      { kind: 'editable-text', content: 'original\r\n' },
      false,
    ),
  );
  store.dispatch(
    updateFileContent(
      ws,
      path,
      { kind: 'editable-text', content: 'edited\r\n' },
      { autoSave: false },
    ),
  );
}
function save(id = 'one') {
  const entry = getFileContentEntry(store.state, ws, path)!;
  store.dispatch(
    saveFileContentRequested(
      ws,
      path,
      absolute,
      { kind: 'editable-text', content: entry.localContent! },
      { requestId: id, authority: captureFileSaveAuthority(ws, path, absolute)! },
    ),
  );
}
const operation = (id = 'one') => getFileSaveOperation(store.state, id);
const wireCalls: unknown[][] = [];
const writes = () => wireCalls.filter(([method]) => method === 'file.write');
beforeEach(() => {
  wireCalls.length = 0;
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
  load();
  ports.request.mockReset().mockImplementation(async (method, _params, options) => {
    options?.onDispatch?.();
    wireCalls.push([method, _params]);
    return method === 'file-tracking.getAgentLocks'
      ? { lockedAgentIds: [], lockedFilePaths: [] }
      : { ok: true };
  });
  stop = store.runSaga(filesSaveSaga);
});
afterEach(() => {
  readers.splice(0).forEach((stopReader) => stopReader());
  stop();
  dispose();
});
it('writes exactly the edited bytes after fresh locks and acknowledges canonical content', async () => {
  save();
  await vi.waitFor(() => expect(operation()?.status).toBe('succeeded'));
  expect(writes()).toHaveLength(1);
  expect(writes()[0][1]).toMatchObject({ workspaceId: ws, path, content: 'edited\r\n' });
  expect(getFileContentEntry(store.state, ws, path)).toMatchObject({
    originalContent: 'edited\r\n',
    localContent: 'edited\r\n',
    saving: false,
  });
});
it('retains newer edits when an earlier write acknowledges', async () => {
  let resolve!: (v: unknown) => void;
  ports.request.mockImplementation((method, _params, options) => {
    options?.onDispatch?.();
    wireCalls.push([method, _params]);
    return method === 'file.write'
      ? new Promise((done) => {
          resolve = done;
        })
      : Promise.resolve({ lockedAgentIds: [], lockedFilePaths: [] });
  });
  save();
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  store.dispatch(
    updateFileContent(
      ws,
      path,
      { kind: 'editable-text', content: 'newer\r\n' },
      { autoSave: false },
    ),
  );
  resolve({ ok: true });
  await vi.waitFor(() => expect(operation()?.status).toBe('succeeded'));
  expect(getFileContentEntry(store.state, ws, path)).toMatchObject({
    originalContent: 'edited\r\n',
    localContent: 'newer\r\n',
  });
});
it('retains running ownership across view departure and blocks duplicate writes', async () => {
  let reject!: (e: unknown) => void;
  ports.request.mockImplementation((method, _params, options) => {
    options?.onDispatch?.();
    wireCalls.push([method, _params]);
    return method === 'file.write'
      ? new Promise((_done, fail) => {
          reject = fail;
        })
      : Promise.resolve({ lockedAgentIds: [], lockedFilePaths: [] });
  });
  save();
  await vi.waitFor(() => expect(reject).toBeTypeOf('function'));
  store.dispatch(removeFileContentEntry(ws, path));
  store.dispatch(workspaceUnmounted(ws));
  store.dispatch(workspaceMounted(ws));
  load();
  save('duplicate');
  reject(new Error('lost acknowledgement'));
  await vi.waitFor(() => expect(operation()?.status).toBe('uncertain'));
  save('after-loss');
  await Promise.resolve();
  expect(writes()).toHaveLength(1);
  expect(getFileContentEntry(store.state, ws, path)?.originalContent).toBe('original\r\n');
});
it.each(['principal', 'preview', 'cancel'])(
  'declines a delayed preflight after %s retirement',
  async (kind) => {
    let resolve!: (v: unknown) => void;
    ports.request.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    save();
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    if (kind === 'principal') store.dispatch(principalContextChanged('replacement'));
    else if (kind === 'preview')
      store.dispatch(
        loadFileContentSucceeded(
          ws,
          path,
          absolute,
          { kind: 'read-only-text', content: 'prefix', bytesRead: 6, totalBytes: 100 },
          true,
        ),
      );
    else stop();
    resolve({ lockedAgentIds: [], lockedFilePaths: [] });
    await vi.waitFor(() => expect(['failed', 'cancelled']).toContain(operation()?.status));
    expect(writes()).toHaveLength(0);
  },
);
it('denies a locked file and allows deliberate retry after a definite refusal', async () => {
  ports.request.mockResolvedValueOnce({ lockedAgentIds: ['agent'], lockedFilePaths: [path] });
  save();
  await vi.waitFor(() => expect(operation()?.status).toBe('failed'));
  expect(writes()).toHaveLength(0);
  save('retry');
  await vi.waitFor(() => expect(operation('retry')?.status).toBe('succeeded'));
  expect(writes()).toHaveLength(1);
});

const cleanStatus = {
  branch: 'main',
  ahead: 0,
  behind: 0,
  diverged: false,
  files: [],
  hasUncommittedChanges: false,
  hasUntrackedFiles: false,
};
const savedStatus = {
  ...cleanStatus,
  files: [{ path, status: GitFileStatus.Modified, staged: false }],
  hasUncommittedChanges: true,
};
function reconcileReads() {
  readers.push(store.runSaga(gitStatusReadSaga));
  store.dispatch(setGitStatus(ws, cleanStatus));
}
function saveAndStatusPorts(write: () => Promise<unknown> = async () => ({ ok: true })) {
  ports.request.mockImplementation(async (method, params, options) => {
    options?.onDispatch?.();
    wireCalls.push([method, params]);
    if (method === 'file.write') return write();
    if (method === 'git.status') return savedStatus;
    return { lockedAgentIds: [], lockedFilePaths: [] };
  });
}
it('reconciles actual status after confirmed Save without source hydration or an explicit refresh', async () => {
  store.dispatch(workspaceUnmounted(ws));
  load();
  reconcileReads();
  saveAndStatusPorts();
  save();
  await vi.waitFor(() =>
    expect(store.state.git.byWorkspaceId[ws]?.status?.files).toEqual(savedStatus.files),
  );
  expect(writes()).toHaveLength(1);
  expect(wireCalls.filter(([method]) => method === 'git.status')).toEqual([
    ['git.status', { workspaceId: ws, forceRefresh: true }],
  ]);
});
it.each(['failed', 'uncertain', 'cancelled'] as const)(
  'does not reconcile a %s Save as a success',
  async (outcome) => {
    reconcileReads();
    saveAndStatusPorts(async () => {
      throw new Error('lost acknowledgement');
    });
    if (outcome === 'failed')
      ports.request.mockResolvedValueOnce({ lockedAgentIds: ['agent'], lockedFilePaths: [path] });
    if (outcome === 'cancelled') store.dispatch(removeFileContentEntry(ws, path));
    if (outcome === 'cancelled')
      store.dispatch(
        saveFileContentRequested(
          ws,
          path,
          absolute,
          { kind: 'editable-text', content: 'edited\r\n' },
          { requestId: 'one', authority: captureFileSaveAuthority(ws, path, absolute)! },
        ),
      );
    else save();
    await vi.waitFor(() => expect(operation()?.status).toBe(outcome));
    expect(wireCalls.filter(([method]) => method === 'git.status')).toHaveLength(0);
    expect(store.state.git.byWorkspaceId[ws]?.status?.files).toEqual([]);
  },
);
it.each(['departed', 'remounted', 'principal', 'root'] as const)(
  'settles confirmed Save after %s without adopting another scope or recreating a draft',
  async (change) => {
    reconcileReads();
    let acknowledge!: (value: unknown) => void;
    saveAndStatusPorts(
      () =>
        new Promise((done) => {
          acknowledge = done;
        }),
    );
    save();
    await vi.waitFor(() => expect(acknowledge).toBeTypeOf('function'));
    store.dispatch(removeFileContentEntry(ws, path));
    store.dispatch(workspaceUnmounted(ws));
    if (change === 'remounted') {
      store.dispatch(workspaceMounted(ws));
      load();
      store.dispatch(loadGitStatus(ws));
      await vi.waitFor(() =>
        expect(wireCalls.filter(([method]) => method === 'git.status')).toHaveLength(1),
      );
    }
    if (change === 'principal') store.dispatch(principalContextChanged('replacement'));
    if (change === 'root')
      store.dispatch(
        setWorkspaceEntity({ id: ws, myRole: 'owner', worktreePath: '/owned/other' } as Workspace),
      );
    acknowledge({ ok: true });
    await vi.waitFor(() => expect(operation()?.status).toBe('succeeded'));
    if (change === 'remounted') {
      await vi.waitFor(() =>
        expect(store.state.git.byWorkspaceId[ws]?.status?.files).toEqual(savedStatus.files),
      );
      expect(wireCalls.filter(([method]) => method === 'git.status')).toHaveLength(2);
    } else {
      expect(wireCalls.filter(([method]) => method === 'git.status')).toHaveLength(0);
    }
    expect(getFileContentEntry(store.state, ws, path)?.originalContent).toBe(
      change === 'remounted' ? 'original\r\n' : undefined,
    );
    expect(writes()).toHaveLength(1);
  },
);
it('rejects a pre-Save status snapshot and coalesces a fresh read after it settles', async () => {
  reconcileReads();
  let oldRead!: (value: unknown) => void;
  let newRead!: (value: unknown) => void;
  let reads = 0;
  saveAndStatusPorts();
  const defaultRequest = ports.request.getMockImplementation()!;
  ports.request.mockImplementation((method, ...args) => {
    if (method === 'git.status') {
      reads++;
      return new Promise((done) => {
        if (reads === 1) oldRead = done;
        else newRead = done;
      });
    }
    return defaultRequest(method, ...args);
  });
  const oldStatus = {
    ...cleanStatus,
    files: [{ path: 'old.txt', status: GitFileStatus.Modified, staged: false }],
  };
  store.dispatch(setGitStatus(ws, oldStatus));
  store.dispatch(loadGitStatus(ws));
  await vi.waitFor(() => expect(oldRead).toBeTypeOf('function'));
  save();
  await vi.waitFor(() => expect(operation()?.status).toBe('succeeded'));
  oldRead(cleanStatus);
  await vi.waitFor(() => expect(newRead).toBeTypeOf('function'));
  expect(store.state.git.byWorkspaceId[ws]?.status?.files).toEqual(oldStatus.files);
  newRead(savedStatus);
  await vi.waitFor(() =>
    expect(store.state.git.byWorkspaceId[ws]?.status?.files).toEqual(savedStatus.files),
  );
  expect(reads).toBe(2);
});
