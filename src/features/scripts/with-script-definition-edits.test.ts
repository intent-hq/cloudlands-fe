import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appClient } from '$lib/client';
import { store } from '$store/renderer/store';
import { admitLegacyPrincipal } from '../../test/fixtures/principal-state';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import {
  clearScriptOperations,
  deleteScriptRequested,
  setScriptsData,
} from '$store/renderer/slices/scripts/scripts-slice';
import { selectCanDeleteScript } from '$store/renderer/slices/scripts/scripts-selectors';
import { scriptsOperationSaga } from '$store/renderer/slices/scripts/sagas/scripts-operation-saga';
import { scriptsClient } from './scripts.client';
import { withScriptDefinitionEdits } from './with-script-definition-edits';
import type { ScriptWithState } from './types';

vi.mock('$lib/client', () => ({
  appClient: { scripts: { list: vi.fn(), create: vi.fn(), remove: vi.fn() } },
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
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let stop: () => void;
beforeEach(() => {
  vi.clearAllMocks();
  store.dispose();
  store.init();
  admitLegacyPrincipal();
  store.dispatch(setWorkspaceEntity({ id: WS, title: 'Edits', myRole: 'owner' } as never));
  store.dispatch(setScriptsData(WS, [script]));
  vi.mocked(appClient.scripts.list).mockResolvedValue([script]);
  vi.mocked(appClient.scripts.create).mockResolvedValue({ success: true });
  vi.mocked(appClient.scripts.remove).mockResolvedValue({ success: true });
  stop = store.runSaga(scriptsOperationSaga);
});
afterEach(() => {
  stop();
  store.dispose();
});

const save = (ws = WS) =>
  withScriptDefinitionEdits(ws, ['check'], () =>
    scriptsClient.update(ws, 'check', { name: 'Renamed' }),
  );

describe('definition writes and deletion', () => {
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
    expect(appClient.scripts.remove).not.toHaveBeenCalled();
    expect(selectCanDeleteScript.select(store.state, WS, 'check')).toBe(false);
    pending.resolve({ success: true });
    await saved;
    expect(selectCanDeleteScript.select(store.state, WS, 'check')).toBe(true);
    store.dispatch(deleteScriptRequested(WS, 'check', 'Delete failed'));
    await vi.waitFor(() =>
      expect(store.state.scripts.byWorkspaceId[WS].scripts.check).toBeUndefined(),
    );
    expect(appClient.scripts.remove).toHaveBeenCalledExactlyOnceWith(WS, 'check');
    expect((await save()).success).toBe(false);
    expect(appClient.scripts.create).toHaveBeenCalledOnce();
  });

  it('refuses a late save while deletion is already pending', async () => {
    const pending = deferred<{ success: boolean }>();
    vi.mocked(appClient.scripts.remove).mockReturnValue(pending.promise);
    store.dispatch(deleteScriptRequested(WS, 'check', 'Delete failed'));
    expect((await save()).success).toBe(false);
    expect(appClient.scripts.list).not.toHaveBeenCalled();
    expect(appClient.scripts.create).not.toHaveBeenCalled();
    pending.resolve({ success: true });
    await vi.waitFor(() =>
      expect(store.state.scripts.byWorkspaceId[WS].scripts.check).toBeUndefined(),
    );
  });

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
    const saved = withScriptDefinitionEdits(WS, ['check'], () => pending.promise);
    vi.mocked(appClient.scripts.list).mockRejectedValueOnce(new Error('offline'));
    await expect(save('other')).rejects.toThrow('offline');
    expect(selectCanDeleteScript.select(store.state, 'other', 'check')).toBe(true);
    expect(selectCanDeleteScript.select(store.state, WS, 'check')).toBe(false);
    pending.resolve({ success: true });
    await saved;
  });
});
