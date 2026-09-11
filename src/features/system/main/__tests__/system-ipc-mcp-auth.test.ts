import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: unknown[]) => unknown;

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  appOn: vi.fn(),
  initiateMcpOAuth: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    on: mocks.appOn,
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
  shell: {},
}));

vi.mock('../../../../main/browser-ipc-broadcast-adapter', () => ({
  broadcastToBrowserIpcClients: vi.fn(),
}));
vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: vi.fn() }),
}));
vi.mock('../../../../shared/main/host-exec', () => ({ hostExec: vi.fn() }));
vi.mock('../../../../shared/main/host-exec-stream', () => ({ hostExecStream: vi.fn() }));
vi.mock('../../../../shared/main/async-utils', () => ({
  findAuggieAsync: vi.fn(),
  findVSCodeAsync: vi.fn(),
}));
vi.mock('../../../mcp/main/mcp-oauth', () => ({ initiateMcpOAuth: mocks.initiateMcpOAuth }));

import { USER_MCP_CHANNELS } from '../../../../shared/ipc/channels';
import { setupSystemIPC } from '../system.ipc';

function handlerFor(channel: string): Handler {
  const call = mocks.handle.mock.calls.find(([registered]) => registered === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as Handler;
}

beforeEach(() => {
  vi.clearAllMocks();
  setupSystemIPC();
});

describe('USER_MCP_CHANNELS.AUTHENTICATE', () => {
  it('registers OAuth and forwards the daemon id with the hosted server URL', async () => {
    mocks.initiateMcpOAuth.mockResolvedValue({ success: true });

    const result = await handlerFor(USER_MCP_CHANNELS.AUTHENTICATE)(
      {},
      { serverId: 'srv-figma', url: 'https://mcp.figma.com/mcp' },
    );

    expect(mocks.initiateMcpOAuth).toHaveBeenCalledExactlyOnceWith(
      'srv-figma',
      'https://mcp.figma.com/mcp',
    );
    expect(result).toEqual({ success: true, data: { success: true } });
  });

  it('rejects a missing daemon id before OAuth starts', async () => {
    const result = await handlerFor(USER_MCP_CHANNELS.AUTHENTICATE)(
      {},
      { url: 'https://mcp.figma.com/mcp' },
    );

    expect(mocks.initiateMcpOAuth).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });
});
