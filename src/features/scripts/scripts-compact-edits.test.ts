import { principalContextChanged } from '$store/renderer/slices/principal/principal-slice';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { backendRequest } from '$lib/client/live/backend-transport';
import { scriptsClient } from './scripts.client';
import { store } from '$store/renderer/store';
import {
  setScriptsData,
  scriptSnapshotReceived,
  removeScript,
  editScriptRequested,
  scriptOperationSucceeded,
} from '$store/renderer/slices/scripts/scripts-slice';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import {
  workspaceUnmounted,
  backendReconnected,
} from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { admitLegacyPrincipal } from '../../test/fixtures/principal-state';
import { scriptsOperationSaga } from '$store/renderer/slices/scripts/sagas/scripts-operation-saga';
import { CURRENT_PROTOCOL_VERSION } from '../../test/current-protocol-version';

vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: vi.fn() }));
vi.mock('$lib/client', async () => {
  const { LiveScriptsClient } = await import('$lib/client/live/live-scripts-client');
  return { appClient: { scripts: new LiveScriptsClient() } };
});
const full = {
  id: 'script',
  workspaceId: 'ws',
  name: 'Build',
  command: 'a'.repeat(200),
  cwd: 'app',
  env: { TOKEN: 'value' },
  healthUrl: 'http://localhost:1234/health',
  readyPattern: 'READY',
  mode: 'command' as const,
  source: 'user',
  createdAt: 'now',
  runtime: { status: 'idle' as const, restartCount: 0 },
};
let stop: () => void;
beforeEach(() => {
  vi.resetAllMocks();
  store.dispose();
  store.init();
  stop = store.runSaga(scriptsOperationSaga);
  admitLegacyPrincipal();
  store.dispatch(setWorkspaceEntity({ id: 'ws', title: 'Scripts', myRole: 'owner' } as never));
  const {
    command,
    cwd: _cwd,
    env: _env,
    healthUrl: _health,
    readyPattern: _ready,
    ...summary
  } = full;
  store.dispatch(
    setScriptsData('ws', [
      { ...summary, commandPreview: command.slice(0, 160), commandTruncated: true },
    ]),
  );
  vi.mocked(backendRequest).mockImplementation(async (method) => {
    if (method === 'client.hello')
      return {
        server: {
          protocolVersion: CURRENT_PROTOCOL_VERSION,
          capabilities: { scriptActiveLists: 1 },
        },
      };
    if (method === 'script.get') return full;
    if (method === 'script.create') return full;
    throw new Error('unexpected ' + method);
  });
});
afterEach(() => {
  stop();
  store.dispose();
});
it('edits only a selected complete definition and never writes its preview', async () => {
  expect((await scriptsClient.update('ws', 'script', { name: 'Renamed' })).success).toBe(true);
  expect(backendRequest).toHaveBeenCalledWith('script.get', {
    workspaceId: 'ws',
    scriptId: 'script',
  });
  expect(backendRequest).toHaveBeenCalledWith(
    'script.create',
    expect.objectContaining({
      workspaceId: 'ws',
      scriptId: 'script',
      name: 'Renamed',
      command: full.command,
      cwd: full.cwd,
      env: full.env,
      healthUrl: full.healthUrl,
      readyPattern: full.readyPattern,
    }),
  );
  expect(backendRequest).not.toHaveBeenCalledWith('script.list', expect.anything());
});
it('refuses a stale edit detail when an archive event wins during the read', async () => {
  let resolve!: (value: unknown) => void;
  const original = vi.mocked(backendRequest).getMockImplementation()!;
  vi.mocked(backendRequest).mockImplementation((method, params) =>
    method === 'script.get' ? new Promise((done) => (resolve = done)) : original(method, params),
  );
  const editing = scriptsClient.update('ws', 'script', { name: 'Renamed' });
  await vi.waitFor(() => expect(resolve).toBeDefined());
  store.dispatch(scriptSnapshotReceived('ws', { ...full, archivedAt: 'later' }));
  resolve(full);
  expect((await editing).success).toBe(false);
  expect(backendRequest).not.toHaveBeenCalledWith('script.create', expect.anything());
});

for (const operation of ['update', 'remove'] as const) {
  const mutate = () =>
    operation === 'update'
      ? scriptsClient.update('ws', full.id, { name: 'Renamed' }, full)
      : scriptsClient.remove('ws', full.id, full);
  it(`reserves off-page selected ${operation} without loading pages or publishing the full inventory`, async () => {
    store.dispatch(setScriptsData('ws', []));
    const original = vi.mocked(backendRequest).getMockImplementation()!;
    vi.mocked(backendRequest).mockImplementation((method, params) =>
      method === 'script.remove' ? Promise.resolve({ ok: true }) : original(method, params),
    );
    expect((await mutate()).success).toBe(true);
    expect(backendRequest).toHaveBeenCalledWith('script.get', {
      workspaceId: 'ws',
      scriptId: full.id,
    });
    expect(backendRequest).toHaveBeenCalledWith(
      operation === 'update' ? 'script.create' : 'script.remove',
      expect.objectContaining({ workspaceId: 'ws', scriptId: full.id }),
    );
    expect(backendRequest).not.toHaveBeenCalledWith('script.list', expect.anything());
    expect(store.state.scripts.byWorkspaceId.ws.scripts).toEqual({});
  });
  it(`refuses off-page ${operation} without current management authority`, async () => {
    store.dispatch(setScriptsData('ws', []));
    store.dispatch(principalContextChanged(null));
    expect((await mutate()).success).toBe(false);
    expect(backendRequest).not.toHaveBeenCalled();
  });
  it.each([
    'foreign workspace',
    'foreign id',
    'source changed',
    'revision changed',
    'running',
    'starting',
    'restarting',
    'archived',
  ] as const)(`refuses off-page ${operation} when detail is %s`, async (kind) => {
    store.dispatch(setScriptsData('ws', []));
    const invalid = { ...full };
    if (kind === 'foreign workspace') invalid.workspaceId = 'other';
    if (kind === 'foreign id') invalid.id = 'other';
    if (kind === 'source changed') invalid.source = 'different';
    if (kind === 'revision changed') Object.assign(invalid, { updatedAt: 'new' });
    if (kind === 'archived') Object.assign(invalid, { archivedAt: 'later' });
    if (['running', 'starting', 'restarting'].includes(kind))
      Object.assign(invalid, { runtime: { status: kind, restartCount: 0 } });
    const original = vi.mocked(backendRequest).getMockImplementation()!;
    vi.mocked(backendRequest).mockImplementation((method, params) =>
      method === 'script.get' ? Promise.resolve(invalid) : original(method, params),
    );
    expect((await mutate()).success).toBe(false);
    expect(backendRequest).not.toHaveBeenCalledWith('script.create', expect.anything());
    expect(backendRequest).not.toHaveBeenCalledWith('script.remove', expect.anything());
  });
  it.each([
    'removed',
    'archived',
    'changed',
    'unmounted',
    'reconnected',
    'authority',
    'pending',
  ] as const)(`refuses off-page ${operation} after %s wins`, async (kind) => {
    store.dispatch(setScriptsData('ws', []));
    if (kind === 'pending') {
      store.dispatch(editScriptRequested('ws', full.id));
      expect((await mutate()).success).toBe(false);
      expect(backendRequest).not.toHaveBeenCalled();
      return;
    }
    let resolve!: (value: unknown) => void;
    const original = vi.mocked(backendRequest).getMockImplementation()!;
    vi.mocked(backendRequest).mockImplementation((method, params) =>
      method === 'script.get' ? new Promise((done) => (resolve = done)) : original(method, params),
    );
    const result = mutate();
    await vi.waitFor(() => expect(resolve).toBeDefined());
    if (kind === 'removed') store.dispatch(removeScript('ws', full.id));
    if (kind === 'archived')
      store.dispatch(scriptSnapshotReceived('ws', { ...full, archivedAt: 'later' }));
    if (kind === 'changed')
      store.dispatch(scriptSnapshotReceived('ws', { ...full, command: 'newer' }));
    if (kind === 'unmounted') store.dispatch(workspaceUnmounted('ws'));
    if (kind === 'reconnected') store.dispatch(backendReconnected());
    if (kind === 'authority')
      store.dispatch(
        setWorkspaceEntity({ id: 'ws', title: 'Scripts', myRole: 'collaborator' } as never),
      );
    resolve(full);
    expect((await result).success).toBe(false);
    expect(backendRequest).not.toHaveBeenCalledWith('script.create', expect.anything());
    expect(backendRequest).not.toHaveBeenCalledWith('script.remove', expect.anything());
  });
}

it('does not publish old selected removal into a reinitialized store', async () => {
  store.dispatch(setScriptsData('ws', []));
  let finish!: (value: unknown) => void;
  const original = vi.mocked(backendRequest).getMockImplementation()!;
  vi.mocked(backendRequest).mockImplementation((method, params) =>
    method === 'script.remove' ? new Promise((done) => (finish = done)) : original(method, params),
  );
  const removing = scriptsClient.remove('ws', full.id, full);
  await vi.waitFor(() => expect(finish).toBeDefined());
  store.dispose();
  store.init();
  admitLegacyPrincipal();
  store.dispatch(setWorkspaceEntity({ id: 'ws', title: 'New backend', myRole: 'owner' } as never));
  const replacement = { ...full, name: 'New backend row' };
  store.dispatch(setScriptsData('ws', [replacement]));
  finish({ ok: true });
  await removing;
  expect(store.state.scripts.byWorkspaceId.ws.scripts[full.id]).toEqual(replacement);
});

it.each(['update', 'remove'] as const)(
  'rejects selected %s after its reservation is released during get',
  async (operation) => {
    store.dispatch(setScriptsData('ws', []));
    let finish!: (value: unknown) => void;
    const original = vi.mocked(backendRequest).getMockImplementation()!;
    vi.mocked(backendRequest).mockImplementation((method, params) =>
      method === 'script.get' ? new Promise((done) => (finish = done)) : original(method, params),
    );
    const pending =
      operation === 'update'
        ? scriptsClient.update('ws', full.id, { name: 'New' }, full)
        : scriptsClient.remove('ws', full.id, full);
    await vi.waitFor(() => expect(finish).toBeDefined());
    store.dispatch(scriptOperationSucceeded('ws', full.id, 'edit'));
    finish(full);
    expect((await pending).success).toBe(false);
    expect(backendRequest).not.toHaveBeenCalledWith('script.create', expect.anything());
    expect(backendRequest).not.toHaveBeenCalledWith('script.remove', expect.anything());
  },
);
