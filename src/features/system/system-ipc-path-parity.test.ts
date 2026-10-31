/**
 * Main/renderer path parity for `system:execute-command` (cloudlands-fe#3918
 * bug class). The same params go through the main-process handler
 * (`main/system.ipc.ts` → `hostExec`) and the renderer path the app uses (the
 * real `$lib/electron-bridge` `invoke` → mock IPC router →
 * `host-bridge-seeder`); the daemon `host.exec` requests must match.
 */
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  mainRequest: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    getAppPath: vi.fn(() => '/tmp/app'),
    getVersion: vi.fn(() => '0.0.0'),
    getName: vi.fn(() => 'Intent'),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    fromId: vi.fn(),
    getFocusedWindow: vi.fn(() => undefined),
    fromWebContents: vi.fn(() => undefined),
  },
  clipboard: { writeText: vi.fn() },
  dialog: {},
  ipcMain: { handle: mocks.handle, removeHandler: vi.fn() },
  nativeTheme: { shouldUseDarkColors: false },
  shell: { openExternal: vi.fn() },
}));

vi.mock('../../main/browser-ipc-broadcast-adapter', () => ({
  broadcastToBrowserIpcClients: vi.fn(),
}));

vi.mock('$features/backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: mocks.mainRequest }),
  getBackendClientForConnection: () => ({ request: mocks.mainRequest }),
  getBackendIdForIpcSender: () => 'local',
}));

// test-setup stubs the bridge globally; parity needs the real invoke hop.
vi.mock('$lib/electron-bridge', async (importOriginal) => importOriginal());

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(),
  backendUnsubscribe: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

import { backendRequest } from '$lib/client/live/backend-transport';
import { invoke } from '$lib/electron-bridge';
import { SYSTEM_CHANNELS } from '$shared/ipc/channels';
import '$store/renderer/seeders/host-bridge-seeder';
import { SystemExecuteCommandSchema } from '../../main/ipc-schemas';
import {
  contractCalls,
  describeParity,
  expectSameDaemonRequests,
  expectSchemaKeysCovered,
  type DaemonCall,
} from '../../test/ipc-path-parity';
import { setupSystemIPC } from './main/system.ipc';

const CONTRACT_METHODS = ['host.exec'] as const;

let daemonOs = 'linux';

async function daemon(method: string): Promise<unknown> {
  switch (method) {
    case 'system.status':
      return { host: { os: daemonOs } };
    case 'host.exec':
      return { stdout: 'ok', stderr: '', exitCode: 0 };
    default:
      return {};
  }
}

async function runMain(params: Record<string, unknown>): Promise<DaemonCall[]> {
  mocks.handle.mockClear();
  setupSystemIPC();
  const call = mocks.handle.mock.calls.find(
    ([channel]) => channel === SYSTEM_CHANNELS.EXECUTE_COMMAND,
  );
  if (!call) throw new Error('main registered no system:execute-command handler');
  await (call[1] as (...args: unknown[]) => Promise<unknown>)({ sender: { id: 1 } }, params);
  return contractCalls(mocks.mainRequest.mock.calls, CONTRACT_METHODS);
}

async function runRenderer(params: Record<string, unknown>): Promise<DaemonCall[]> {
  await invoke(SYSTEM_CHANNELS.EXECUTE_COMMAND, params);
  return contractCalls(vi.mocked(backendRequest).mock.calls, CONTRACT_METHODS);
}

beforeEach(() => {
  vi.clearAllMocks();
  daemonOs = 'linux';
  mocks.mainRequest.mockImplementation(daemon);
  vi.mocked(backendRequest).mockImplementation(daemon as typeof backendRequest);
});

const SCENARIOS: Record<string, Record<string, unknown>> = {
  'a bare command': { command: 'git status --porcelain' },
  'a command scoped to a workspace directory': {
    command: 'git log -1',
    cwd: '/repos/app/worktrees/amber-forest',
    workspaceId: 'amber-forest',
  },
  'a workspace id without a cwd': { command: 'pwd', workspaceId: 'amber-forest' },
};

describeParity(SYSTEM_CHANNELS.EXECUTE_COMMAND, () => {
  it.skipIf(process.platform === 'win32').each(Object.entries(SCENARIOS))(
    '%s',
    async (_name, params) => {
      const main = await runMain(params);
      const renderer = await runRenderer(params);
      expectSameDaemonRequests(SYSTEM_CHANNELS.EXECUTE_COMMAND, main, renderer);
    },
  );

  it('scenarios set every field the main-process schema accepts', () => {
    expectSchemaKeysCovered(
      SYSTEM_CHANNELS.EXECUTE_COMMAND,
      SystemExecuteCommandSchema,
      Object.values(SCENARIOS),
    );
  });

  // Known divergence: main picks the shell from the CLIENT's OS
  // (`process.platform`) while the renderer asks the daemon host
  // (`system.status` → `host.os`), so a Windows daemon reached from a POSIX
  // client gets `cmd.exe` only on the renderer path. Fails once they agree.
  it.skipIf(process.platform === 'win32')(
    'known divergence — the shell follows the client OS on main, the daemon OS on the renderer',
    async () => {
      daemonOs = 'windows';
      const params = { command: 'dir' };
      const main = await runMain(params);
      const renderer = await runRenderer(params);
      expect(renderer).not.toEqual(main);
    },
  );
});
