import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: unknown[]) => unknown;

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  appOn: vi.fn(),
  initiateMcpOAuth: vi.fn(),
  backendRequest: vi.fn(),
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
  getBackendClient: () => ({ request: mocks.backendRequest }),
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

const figmaRecord = {
  id: 'srv-figma',
  name: 'figma',
  transport: 'http',
  url: 'https://mcp.figma.com/mcp',
  enabled: true,
};

describe('USER_MCP_CHANNELS.AUTHENTICATE', () => {
  beforeEach(() => {
    mocks.backendRequest.mockResolvedValue({ servers: [figmaRecord] });
  });

  it('resolves the hosted server URL from the daemon record by id', async () => {
    mocks.initiateMcpOAuth.mockResolvedValue({ success: true });

    const result = await handlerFor(USER_MCP_CHANNELS.AUTHENTICATE)({}, { serverId: 'srv-figma' });

    expect(mocks.backendRequest).toHaveBeenCalledExactlyOnceWith('mcp.servers.list');
    expect(mocks.initiateMcpOAuth).toHaveBeenCalledExactlyOnceWith(
      'srv-figma',
      'https://mcp.figma.com/mcp',
    );
    expect(result).toEqual({ success: true, data: { success: true } });
  });

  it('accepts a renderer URL that matches the daemon record', async () => {
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

  it('rejects a renderer URL that disagrees with the daemon record before OAuth starts', async () => {
    const result = await handlerFor(USER_MCP_CHANNELS.AUTHENTICATE)(
      {},
      { serverId: 'srv-figma', url: 'https://attacker.example/mcp' },
    );

    expect(mocks.initiateMcpOAuth).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: false,
      error: { code: 'MCP_SERVER_URL_MISMATCH', message: expect.any(String) },
    });
  });

  it('returns a structured error for an unknown server id without starting OAuth', async () => {
    const result = await handlerFor(USER_MCP_CHANNELS.AUTHENTICATE)(
      {},
      { serverId: 'srv-missing' },
    );

    expect(mocks.initiateMcpOAuth).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: false,
      error: { code: 'MCP_SERVER_NOT_FOUND', message: expect.any(String) },
    });
  });

  it('returns a structured error when the daemon record has no hosted URL', async () => {
    mocks.backendRequest.mockResolvedValue({
      servers: [
        { id: 'srv-local', name: 'local', transport: 'stdio', command: 'npx', enabled: true },
      ],
    });

    const result = await handlerFor(USER_MCP_CHANNELS.AUTHENTICATE)({}, { serverId: 'srv-local' });

    expect(mocks.initiateMcpOAuth).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: false,
      error: { code: 'MCP_SERVER_URL_MISSING', message: expect.any(String) },
    });
  });

  it('rejects a missing daemon id before OAuth starts', async () => {
    const result = await handlerFor(USER_MCP_CHANNELS.AUTHENTICATE)(
      {},
      { url: 'https://mcp.figma.com/mcp' },
    );

    expect(mocks.backendRequest).not.toHaveBeenCalled();
    expect(mocks.initiateMcpOAuth).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });
});
