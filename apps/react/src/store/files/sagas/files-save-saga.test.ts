import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { store } from '@/store';
import { filesSaveSaga } from './files-save-saga';
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
import type { Workspace } from '$shared/types';
const ports = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/features/backend/backend-transport', () => ({ backendRequest: ports.request }));
const ws = WorkspaceId('file-save-owned'),
  path = 'a.txt',
  absolute = '/owned/repo/a.txt';
let dispose: () => void, stop: () => void;
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
