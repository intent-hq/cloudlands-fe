import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wire-contract tests for the CHECK_GIT / CHECK_NODE / CHECK_GH handlers in
 * `system.ipc.ts`.
 *
 * The probes are delegated to the daemon host via the uncached
 * `host.checkGit` / `host.checkNode` / `host.checkGh` methods. These
 * tests capture the registered `ipcMain.handle` callback for each channel,
 * invoke it, and assert the exact wire request (method name, no params)
 * plus the response mapping: node versions are v-stripped and compared
 * against MINIMUM_NODE_VERSION, gh versions are forwarded verbatim, and
 * failures fold to a `success:true` envelope — never an error. For git a
 * daemon-reported probe answer folds to `available:false` while a transport
 * failure folds to `available:'unknown'`.
 */

type Handler = (...args: unknown[]) => unknown;

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  appOn: vi.fn(),
}));

const backendMocks = vi.hoisted(() => ({
  request: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    on: electronMocks.appOn,
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
  ipcMain: { handle: electronMocks.handle, removeHandler: vi.fn() },
  nativeTheme: { shouldUseDarkColors: false },
  shell: {},
}));

vi.mock('../../../../main/browser-ipc-broadcast-adapter', () => ({
  broadcastToBrowserIpcClients: vi.fn(),
}));

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: backendMocks.request }),
  onBackendReconnected: vi.fn(() => () => {}),
}));

vi.mock('../../../../shared/main/host-exec', () => ({ hostExec: vi.fn() }));
vi.mock('../../../../shared/main/host-exec-stream', () => ({ hostExecStream: vi.fn() }));
vi.mock('../../../../shared/main/async-utils', () => ({
  findAuggieAsync: vi.fn(),
  findVSCodeAsync: vi.fn(),
}));

import { SYSTEM_CHANNELS } from '../../../../shared/ipc/channels';
import { setupSystemIPC } from '../system.ipc';

function handlerFor(channel: string): Handler {
  const call = electronMocks.handle.mock.calls.find(([registered]) => registered === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as Handler;
}

beforeEach(() => {
  vi.clearAllMocks();
  setupSystemIPC();
});

describe('SYSTEM_CHANNELS.CHECK_GIT → host.checkGit (uncached daemon probe)', () => {
  it('issues exactly `host.checkGit` with no params and forwards the version', async () => {
    backendMocks.request.mockResolvedValue({ available: true, version: 'git version 2.43.0' });

    const handler = handlerFor(SYSTEM_CHANNELS.CHECK_GIT);
    const result = await handler({});

    expect(backendMocks.request).toHaveBeenCalledTimes(1);
    expect(backendMocks.request).toHaveBeenCalledWith('host.checkGit');
    expect(result).toEqual({
      success: true,
      data: { available: true, version: 'git version 2.43.0' },
    });
  });

  it('folds a daemon `available:false` answer (genuine missing binary) to { available:false }', async () => {
    backendMocks.request.mockResolvedValue({ available: false });

    const handler = handlerFor(SYSTEM_CHANNELS.CHECK_GIT);
    const result = await handler({});

    expect(result).toEqual({ success: true, data: { available: false } });
  });

  it("folds a wire rejection (RPC timeout / daemon unreachable) to { available:'unknown' }, never available:false", async () => {
    backendMocks.request.mockRejectedValue(new Error('Request timeout'));

    const handler = handlerFor(SYSTEM_CHANNELS.CHECK_GIT);
    const result = await handler({});

    expect(result).toEqual({ success: true, data: { available: 'unknown' } });
  });
});

describe('SYSTEM_CHANNELS.CHECK_NODE → host.checkNode (uncached daemon probe)', () => {
  it('issues exactly `host.checkNode` with no params, v-strips the version, and compares against MINIMUM_NODE_VERSION', async () => {
    backendMocks.request.mockResolvedValue({ available: true, version: 'v22.11.0' });

    const handler = handlerFor(SYSTEM_CHANNELS.CHECK_NODE);
    const result = await handler({});

    expect(backendMocks.request).toHaveBeenCalledTimes(1);
    expect(backendMocks.request).toHaveBeenCalledWith('host.checkNode');
    expect(result).toEqual({
      success: true,
      data: { available: true, version: '22.11.0', versionOk: true },
    });
  });

  it('reports versionOk:false for an available node below MINIMUM_NODE_VERSION', async () => {
    backendMocks.request.mockResolvedValue({ available: true, version: 'v18.19.0' });

    const handler = handlerFor(SYSTEM_CHANNELS.CHECK_NODE);
    const result = await handler({});

    expect(result).toEqual({
      success: true,
      data: { available: true, version: '18.19.0', versionOk: false },
    });
  });

  it('folds a daemon `available:false` answer to { available:false, versionOk:false }', async () => {
    backendMocks.request.mockResolvedValue({ available: false });

    const handler = handlerFor(SYSTEM_CHANNELS.CHECK_NODE);
    const result = await handler({});

    expect(backendMocks.request).toHaveBeenCalledWith('host.checkNode');
    expect(result).toEqual({
      success: true,
      data: { available: false, versionOk: false },
    });
  });

  it('folds a wire rejection to { available:false, versionOk:false }, never an error', async () => {
    backendMocks.request.mockRejectedValue(new Error('rpc down'));

    const handler = handlerFor(SYSTEM_CHANNELS.CHECK_NODE);
    const result = await handler({});

    expect(result).toEqual({
      success: true,
      data: { available: false, versionOk: false },
    });
  });
});

describe('SYSTEM_CHANNELS.CHECK_GH → host.checkGh (uncached daemon probe)', () => {
  it('issues exactly `host.checkGh` with no params and forwards the version verbatim', async () => {
    backendMocks.request.mockResolvedValue({ available: true, version: '2.62.0' });

    const handler = handlerFor(SYSTEM_CHANNELS.CHECK_GH);
    const result = await handler({});

    expect(backendMocks.request).toHaveBeenCalledTimes(1);
    expect(backendMocks.request).toHaveBeenCalledWith('host.checkGh');
    expect(result).toEqual({
      success: true,
      data: { available: true, version: '2.62.0' },
    });
  });

  it('folds a daemon `available:false` answer to { available:false }', async () => {
    backendMocks.request.mockResolvedValue({ available: false });

    const handler = handlerFor(SYSTEM_CHANNELS.CHECK_GH);
    const result = await handler({});

    expect(result).toEqual({ success: true, data: { available: false } });
  });

  it('folds a wire rejection to { available:false }, never an error', async () => {
    backendMocks.request.mockRejectedValue(new Error('rpc down'));

    const handler = handlerFor(SYSTEM_CHANNELS.CHECK_GH);
    const result = await handler({});

    expect(result).toEqual({ success: true, data: { available: false } });
  });
});
