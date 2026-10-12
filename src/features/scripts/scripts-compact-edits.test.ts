import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { backendRequest } from '$lib/client/live/backend-transport';
import { scriptsClient } from './scripts.client';
import { store } from '$store/renderer/store';
import {
  setScriptsData,
  scriptSnapshotReceived,
} from '$store/renderer/slices/scripts/scripts-slice';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { admitLegacyPrincipal } from '../../test/fixtures/principal-state';
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
beforeEach(() => {
  vi.resetAllMocks();
  store.dispose();
  store.init();
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
      return { server: { protocolVersion: '14.0', capabilities: { scriptActiveLists: 1 } } };
    if (method === 'script.get') return full;
    if (method === 'script.create') return full;
    throw new Error('unexpected ' + method);
  });
});
afterEach(() => store.dispose());
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

it('restores full detection Undo data including readiness settings', async () => {
  const original = vi.mocked(backendRequest).getMockImplementation()!;
  vi.mocked(backendRequest).mockImplementation((method, params) =>
    method === 'script.list' ? Promise.resolve({ scripts: [] }) : original(method, params),
  );
  expect((await scriptsClient.restoreSnapshot('ws', [full])).success).toBe(true);
  expect(backendRequest).toHaveBeenCalledWith(
    'script.create',
    expect.objectContaining({
      command: full.command,
      cwd: full.cwd,
      env: full.env,
      healthUrl: full.healthUrl,
      readyPattern: full.readyPattern,
    }),
  );
});
