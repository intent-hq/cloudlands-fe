import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appClient } from '$lib/client';
import { LiveScriptsClient } from '$lib/client/live/live-scripts-client';
import { backendRequest } from '$lib/client/live/backend-transport';
import { store } from '$store/renderer/store';
import { admitLegacyPrincipal } from '../../test/fixtures/principal-state';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import {
  clearScriptOperations,
  startScriptRequested,
  deleteScriptRequested,
  setScriptsData,
} from '$store/renderer/slices/scripts/scripts-slice';
import {
  workspaceUnmounted,
  workspaceDeleted,
} from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { selectCanDeleteScript } from '$store/renderer/slices/scripts/scripts-selectors';
import { scriptsOperationSaga } from '$store/renderer/slices/scripts/sagas/scripts-operation-saga';
import { scriptsClient } from './scripts.client';
import type { ScriptWithState } from './types';

const removeRequest = vi.hoisted(() => vi.fn());

vi.mock('$lib/client/live/backend-transport', async () => {
  const { appClient } = await import('$lib/client');
  return {
    backendRequest: vi.fn(
      async (method: string, params: { workspaceId: string; scriptId?: string }) => {
        if (method === 'script.remove') {
          const result = await removeRequest(params.workspaceId, params.scriptId);
          if (!result.success) throw new Error(result.error);
          return { ok: true };
        }
        const { workspaceId, ...definition } = params;
        const result = await appClient.scripts.create(workspaceId, definition as never);
        if (!result.success) throw new Error(result.error);
        return result.script;
      },
    ),
  };
});

vi.mock('$lib/client', () => ({
  appClient: {
    scripts: { list: vi.fn(), create: vi.fn() },
    files: { read: vi.fn() },
  },
}));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { error: vi.fn() } }));

const WS = 'edit-races';
const script: ScriptWithState = {
  id: 'check',
  workspaceId: WS,
  name: 'Check',
  command: 'true',
  mode: 'command',
  source: 'user',
  createdAt: '2026-10-09',
  runtime: { status: 'idle', restartCount: 0 },
};
function deferred<T>() {
  let resolve!: (result: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
let stop: () => void;
beforeEach(() => {
  vi.resetAllMocks();
  store.dispose();
  store.init();
  admitLegacyPrincipal();
  store.dispatch(setWorkspaceEntity({ id: WS, title: 'Edits', myRole: 'owner' } as never));
  store.dispatch(setScriptsData(WS, [script]));
  vi.mocked(appClient.scripts.list).mockResolvedValue([script]);
  vi.mocked(appClient.scripts.create).mockResolvedValue({ success: true });
  removeRequest.mockResolvedValue({ success: true });
  stop = store.runSaga(scriptsOperationSaga);
});
afterEach(() => {
  stop();
  store.dispose();
});

const save = (ws = WS) => scriptsClient.update(ws, 'check', { name: 'Renamed' });

describe('public definition writes and deletion', () => {
  it('reserves before the definition read begins', async () => {
    const pending = deferred<ScriptWithState[]>();
    let deletableAtRead = true;
    vi.mocked(appClient.scripts.list).mockImplementationOnce(() => {
      deletableAtRead = selectCanDeleteScript.select(store.state, WS, 'check');
      return pending.promise;
    });
    const saved = save();
    store.dispatch(deleteScriptRequested(WS, 'check', 'Delete failed'));
    expect(removeRequest).not.toHaveBeenCalled();
    pending.resolve([script]);
    expect((await saved).success).toBe(true);
    expect(deletableAtRead).toBe(false);
  });

  it('reserves detection before scanning manifests and through its upserts and removals', async () => {
    const auto = { ...script, name: 'test', source: 'auto-detected', command: 'old' };
    const stale = { ...auto, id: 'stale', name: 'stale' };
    store.dispatch(setScriptsData(WS, [auto, stale]));
    vi.mocked(appClient.scripts.list).mockResolvedValue([auto, stale]);
    const scan = deferred<null>();
    vi.mocked(appClient.files.read).mockImplementation(async (_ws, path) => {
      if (path === 'package.json') {
        await scan.promise;
        return { originalContent: JSON.stringify({ scripts: { test: 'vitest' } }) } as never;
      }
      return null;
    });
    const upsert = deferred<{ success: boolean }>();
    const removal = deferred<{ success: boolean }>();
    vi.mocked(appClient.scripts.create).mockReturnValueOnce(upsert.promise);
    removeRequest.mockReturnValueOnce(removal.promise);
    const detected = scriptsClient.detect(WS);
    expect(selectCanDeleteScript.select(store.state, WS, 'check')).toBe(false);
    expect(selectCanDeleteScript.select(store.state, WS, 'stale')).toBe(false);
    scan.resolve(null);
    await vi.waitFor(() => expect(appClient.scripts.create).toHaveBeenCalledOnce());
    store.dispatch(deleteScriptRequested(WS, 'check', 'Delete failed'));
    expect(removeRequest).not.toHaveBeenCalled();
    upsert.resolve({ success: true });
    await vi.waitFor(() => expect(removeRequest).toHaveBeenCalledWith(WS, 'stale'));
    expect(selectCanDeleteScript.select(store.state, WS, 'check')).toBe(false);
    removal.resolve({ success: true });
    expect(await detected).toMatchObject({ success: true, detected: 1, removed: 1 });
    expect(selectCanDeleteScript.select(store.state, WS, 'check')).toBe(true);
  });

  it('protects definitions arriving after detection starts with an empty cache', async () => {
    store.dispatch(setScriptsData(WS, []));
    const auto = { ...script, name: 'test', source: 'auto-detected', command: 'old' };
    vi.mocked(appClient.files.read).mockImplementation(async (_ws, path) =>
      path === 'package.json'
        ? ({ originalContent: JSON.stringify({ scripts: { test: 'vitest' } }) } as never)
        : null,
    );
    const read = deferred<ScriptWithState[]>();
    vi.mocked(appClient.scripts.list).mockReturnValueOnce(read.promise);
    const detected = scriptsClient.detect(WS);
    await vi.waitFor(() => expect(appClient.scripts.list).toHaveBeenCalledOnce());
    store.dispatch(setScriptsData(WS, [auto]));
    expect(selectCanDeleteScript.select(store.state, WS, 'check')).toBe(false);
    store.dispatch(deleteScriptRequested(WS, 'check', 'Delete failed'));
    expect(removeRequest).not.toHaveBeenCalled();
    expect((await save()).success).toBe(false);
    expect(appClient.scripts.list).toHaveBeenCalledOnce();
    read.resolve([auto]);
    expect((await detected).success).toBe(true);
    expect(selectCanDeleteScript.select(store.state, WS, 'check')).toBe(true);
  });

  it('keeps an empty-cache detection reservation across cleanup and rejects overlapping detection', async () => {
    store.dispatch(setScriptsData(WS, []));
    const scan = deferred<null>();
    vi.mocked(appClient.files.read).mockReturnValue(scan.promise);
    const detected = scriptsClient.detect(WS);
    store.dispatch(clearScriptOperations(WS));
    const readCount = vi.mocked(appClient.files.read).mock.calls.length;
    expect((await scriptsClient.detect(WS)).success).toBe(false);
    expect(appClient.files.read).toHaveBeenCalledTimes(readCount);
    store.dispatch(startScriptRequested(WS, 'not-yet-loaded'));
    expect(store.state.scripts.byWorkspaceId[WS].operations).toEqual({});
    scan.resolve(null);
    expect((await detected).success).toBe(true);
    expect((await scriptsClient.detect(WS)).success).toBe(true);
  });

  it('rejects the lower public creation API upsert while deletion is pending', async () => {
    const removal = deferred<{ success: boolean }>();
    removeRequest.mockReturnValueOnce(removal.promise);
    store.dispatch(deleteScriptRequested(WS, 'check', 'Delete failed'));
    const client = new LiveScriptsClient();
    const input = {
      name: 'Resurrected',
      command: 'true',
      mode: 'command' as const,
      scriptId: 'check',
    };
    // @ts-expect-error Existing IDs are not accepted by the ordinary creation boundary.
    expect((await client.create(WS, input)).success).toBe(false);
    expect(backendRequest).not.toHaveBeenCalledWith('script.create', expect.anything());
    removal.resolve({ success: true });
    await vi.waitFor(() =>
      expect(store.state.scripts.byWorkspaceId[WS].scripts.check).toBeUndefined(),
    );
  });

  it('releases every detection reservation when the daemon list fails', async () => {
    const history = { ...script, id: 'history', archivedAt: '2026-10-09' };
    store.dispatch(setScriptsData(WS, [script, history]));
    vi.mocked(appClient.files.read).mockResolvedValue(null);
    const read = deferred<ScriptWithState[]>();
    vi.mocked(appClient.scripts.list).mockReturnValueOnce(read.promise);
    const detected = scriptsClient.detect(WS);
    expect(selectCanDeleteScript.select(store.state, WS, 'check')).toBe(false);
    expect(selectCanDeleteScript.select(store.state, WS, 'history')).toBe(false);
    await vi.waitFor(() => expect(appClient.scripts.list).toHaveBeenCalledOnce());
    // A rejected list is handled by detection's existing failure envelope.
    read.reject(new Error('offline'));
    expect(await detected).toEqual({ success: false, error: 'offline' });
    expect(selectCanDeleteScript.select(store.state, WS, 'check')).toBe(true);
    expect(selectCanDeleteScript.select(store.state, WS, 'history')).toBe(true);
  });

  it('rejects detection before any reads when deletion is pending', async () => {
    const pending = deferred<{ success: boolean }>();
    removeRequest.mockReturnValueOnce(pending.promise);
    store.dispatch(deleteScriptRequested(WS, 'check', 'Delete failed'));
    expect((await scriptsClient.detect(WS)).success).toBe(false);
    expect(appClient.files.read).not.toHaveBeenCalled();
    expect(appClient.scripts.list).not.toHaveBeenCalled();
    pending.resolve({ success: true });
  });

  it('rejects direct removal during a pending definition save', async () => {
    const pending = deferred<{ success: boolean }>();
    vi.mocked(appClient.scripts.create).mockReturnValueOnce(pending.promise);
    const saved = save();
    await vi.waitFor(() => expect(appClient.scripts.create).toHaveBeenCalledOnce());
    const removed = await scriptsClient.remove(WS, 'check');
    pending.resolve({ success: true });
    await saved;
    expect(removed.success).toBe(false);
    expect(removeRequest).not.toHaveBeenCalled();
  });

  it('holds a direct removal reservation until settled and prevents a later stale save', async () => {
    const pending = deferred<{ success: boolean }>();
    removeRequest.mockReturnValueOnce(pending.promise);
    const removing = scriptsClient.remove(WS, 'check');
    expect((await save()).success).toBe(false);
    expect(appClient.scripts.list).not.toHaveBeenCalled();
    pending.resolve({ success: true });
    expect((await removing).success).toBe(true);
    expect((await save()).success).toBe(false);
    expect(appClient.scripts.create).not.toHaveBeenCalled();
  });

  it('rejects Undo without any partial removal or recreation during an edit', async () => {
    const pending = deferred<{ success: boolean }>();
    vi.mocked(appClient.scripts.create).mockReturnValueOnce(pending.promise);
    const saved = save();
    await vi.waitFor(() => expect(appClient.scripts.create).toHaveBeenCalledOnce());
    expect((await scriptsClient.restoreSnapshot(WS, [script])).success).toBe(false);
    expect(removeRequest).not.toHaveBeenCalled();
    expect(appClient.scripts.create).toHaveBeenCalledOnce();
    pending.resolve({ success: true });
    await saved;
  });

  it('keeps Undo reserved through its last recreation and releases failures', async () => {
    const recreation = deferred<{ success: boolean; error: string }>();
    vi.mocked(appClient.scripts.create).mockReturnValueOnce(recreation.promise);
    const restored = scriptsClient.restoreSnapshot(WS, [script]);
    await vi.waitFor(() => expect(appClient.scripts.create).toHaveBeenCalledOnce());
    store.dispatch(setScriptsData(WS, [script]));
    expect(selectCanDeleteScript.select(store.state, WS, 'check')).toBe(false);
    expect((await scriptsClient.remove(WS, 'check')).success).toBe(false);
    expect(removeRequest).toHaveBeenCalledOnce();
    recreation.resolve({ success: false, error: 'offline' });
    expect(await restored).toEqual({ success: false, error: 'offline' });
    expect(selectCanDeleteScript.select(store.state, WS, 'check')).toBe(true);
  });

  it('holds deletion until the upsert settles, then removes after the save', async () => {
    const pending = deferred<{ success: boolean }>();
    vi.mocked(appClient.scripts.create).mockReturnValue(pending.promise);
    const saved = save();
    await vi.waitFor(() =>
      expect(appClient.scripts.create).toHaveBeenCalledWith(
        WS,
        expect.objectContaining({ scriptId: 'check', name: 'Renamed' }),
      ),
    );
    store.dispatch(deleteScriptRequested(WS, 'check', 'Delete failed'));
    expect(removeRequest).not.toHaveBeenCalled();
    expect(selectCanDeleteScript.select(store.state, WS, 'check')).toBe(false);
    pending.resolve({ success: true });
    await saved;
    expect(selectCanDeleteScript.select(store.state, WS, 'check')).toBe(true);
    store.dispatch(deleteScriptRequested(WS, 'check', 'Delete failed'));
    await vi.waitFor(() =>
      expect(store.state.scripts.byWorkspaceId[WS].scripts.check).toBeUndefined(),
    );
    expect(removeRequest).toHaveBeenCalledExactlyOnceWith(WS, 'check');
    expect((await save()).success).toBe(false);
    expect(appClient.scripts.create).toHaveBeenCalledOnce();
  });

  it('refuses a late save while deletion is already pending', async () => {
    const pending = deferred<{ success: boolean }>();
    removeRequest.mockReturnValue(pending.promise);
    store.dispatch(deleteScriptRequested(WS, 'check', 'Delete failed'));
    expect((await save()).success).toBe(false);
    expect(appClient.scripts.list).not.toHaveBeenCalled();
    expect(appClient.scripts.create).not.toHaveBeenCalled();
    pending.resolve({ success: true });
    await vi.waitFor(() =>
      expect(store.state.scripts.byWorkspaceId[WS].scripts.check).toBeUndefined(),
    );
  });

  it.each([
    ['unmount success', workspaceUnmounted(WS), true],
    ['unmount failure', workspaceUnmounted(WS), false],
    ['workspace deletion success', workspaceDeleted(WS, []), true],
    ['workspace deletion failure', workspaceDeleted(WS, []), false],
  ] as const)(
    'holds lifecycle deletion through cleanup until settlement: %s',
    async (_name, cleanup, success) => {
      const pending = deferred<{ success: boolean; error?: string }>();
      removeRequest.mockReturnValueOnce(pending.promise);
      store.dispatch(deleteScriptRequested(WS, 'check', 'Delete failed'));
      store.dispatch(cleanup);
      expect((await save()).success).toBe(false);
      expect((await scriptsClient.detect(WS)).success).toBe(false);
      expect((await scriptsClient.remove(WS, 'check')).success).toBe(false);
      store.dispatch(deleteScriptRequested(WS, 'check', 'Delete failed'));
      store.dispatch(startScriptRequested(WS, 'check'));
      expect(removeRequest).toHaveBeenCalledOnce();
      expect(appClient.scripts.list).not.toHaveBeenCalled();
      expect(appClient.scripts.create).not.toHaveBeenCalled();
      pending.resolve({ success, error: success ? undefined : 'offline' });
      await vi.waitFor(() =>
        expect(store.state.scripts.byWorkspaceId[WS].operations.check?.pending).not.toBe(true),
      );
      // Cleanup invalidates the old request's UI completion even after it settles.
      expect(store.state.scripts.byWorkspaceId[WS].scripts.check).toBeDefined();
      if (!success) {
        expect((await save()).success).toBe(true);
      }
    },
  );

  it('retains an in-flight save across cleanup and releases it on failure for retry', async () => {
    const pending = deferred<{ success: boolean; error: string }>();
    vi.mocked(appClient.scripts.create).mockReturnValueOnce(pending.promise);
    const saved = save();
    await vi.waitFor(() => expect(appClient.scripts.create).toHaveBeenCalledOnce());
    store.dispatch(clearScriptOperations(WS));
    expect(selectCanDeleteScript.select(store.state, WS, 'check')).toBe(false);
    expect((await save()).success).toBe(false);
    pending.resolve({ success: false, error: 'offline' });
    expect(await saved).toEqual({ success: false, error: 'offline' });
    expect(selectCanDeleteScript.select(store.state, WS, 'check')).toBe(true);
    expect((await save()).success).toBe(true);
  });

  it('releases thrown saves and keeps workspace reservations separate', async () => {
    store.dispatch(setScriptsData('other', [{ ...script, workspaceId: 'other' }]));
    const pending = deferred<{ success: boolean }>();
    vi.mocked(appClient.scripts.create).mockReturnValueOnce(pending.promise);
    const saved = save();
    await vi.waitFor(() => expect(appClient.scripts.create).toHaveBeenCalledOnce());
    vi.mocked(appClient.scripts.list).mockRejectedValueOnce(new Error('offline'));
    await expect(save('other')).rejects.toThrow('offline');
    expect(selectCanDeleteScript.select(store.state, 'other', 'check')).toBe(true);
    expect(selectCanDeleteScript.select(store.state, WS, 'check')).toBe(false);
    pending.resolve({ success: true });
    await saved;
  });
});
