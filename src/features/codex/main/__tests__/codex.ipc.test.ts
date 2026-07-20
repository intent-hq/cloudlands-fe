import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  resolveCodexModelListCommands: vi.fn(),
  getManagedCodexAcpStatus: vi.fn(),
  // AUDIT-R1c: the four ACP probes now spawn through the daemon
  // (`host.execStream`, PROTOCOL §5.14) via `startAcpChildStream`. The mock
  // lets each test decide whether the daemon-side stream starts, streams
  // handshake responses, or fails to start.
  startAcpChildStream: vi.fn(),
  webContentsSend: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      mocks.handlers.set(channel, handler);
    }),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      {
        isDestroyed: () => false,
        webContents: { send: mocks.webContentsSend },
      },
    ]),
  },
}));

vi.mock('../../../../shared/main/acp-child-stream', () => ({
  startAcpChildStream: mocks.startAcpChildStream,
}));

vi.mock('../codex-resolver', () => ({
  resolveCodexModelListCommands: mocks.resolveCodexModelListCommands,
}));

vi.mock('../codex-acp-manager', () => ({
  getManagedCodexAcpStatus: mocks.getManagedCodexAcpStatus,
}));

// `CodexAppServerAcpAdapter` is still constructed by the module under test —
// mock it minimally so the import doesn't touch the real transport. The
// adapter methods are only reached when startAcpChildStream succeeds.
vi.mock('../codex-app-server-transport', () => ({
  CodexAppServerAcpAdapter: vi.fn().mockImplementation(() => ({
    initialize: vi.fn(),
    listModels: vi.fn().mockResolvedValue({ data: [] }),
    dispose: vi.fn(),
    on: vi.fn(),
  })),
}));

async function setupAndGetModels() {
  const { setupCodexIPC } = await import('../codex.ipc');
  setupCodexIPC();
  const handler = mocks.handlers.get('codex:get-models');
  if (!handler) throw new Error('codex:get-models handler was not registered');
  return handler;
}

async function getCodexCliParser() {
  const { parseModelsFromCodexCliResponse } = await import('../codex.ipc');
  return parseModelsFromCodexCliResponse;
}

describe('codex IPC model listing', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.resolveCodexModelListCommands.mockReset();
    mocks.startAcpChildStream.mockReset();
    mocks.webContentsSend.mockReset();
    mocks.getManagedCodexAcpStatus.mockReturnValue({ state: 'not_installed', version: '0.16.0' });
  });

  // AUDIT-R1c: the FE probes route through the daemon (`host.execStream`)
  // via `startAcpChildStream`. When the daemon-side stream cannot be started
  // — the daemon is unavailable or times out — GET_MODELS falls back to the
  // static Codex list with an "unavailable" warning.
  it('routes every candidate through startAcpChildStream and falls back to the static list when the stream cannot start', async () => {
    mocks.startAcpChildStream.mockRejectedValue(new Error('stream unavailable'));
    mocks.resolveCodexModelListCommands.mockResolvedValue([
      {
        command: '/opt/homebrew/bin/codex',
        argsPrefix: ['app-server', '--listen', 'stdio://'],
        usesNpx: false,
        source: 'codex-app-server',
        codexCliVersion: '0.128.0',
      },
    ]);

    const handler = await setupAndGetModels();
    const result = await handler();

    expect(result.success).toBe(true);
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.warning).toBe(
      'Codex dynamic model list unavailable; using static model list',
    );
    expect(mocks.startAcpChildStream).toHaveBeenCalledWith(
      '/opt/homebrew/bin/codex',
      expect.objectContaining({
        args: ['app-server', '--listen', 'stdio://'],
      }),
    );
  });

  it('attempts every candidate before falling back so `attemptedSources` covers the full list', async () => {
    mocks.startAcpChildStream.mockRejectedValue(new Error('stream unavailable'));
    mocks.resolveCodexModelListCommands.mockResolvedValue([
      {
        command: '/opt/homebrew/bin/codex',
        argsPrefix: ['app-server', '--listen', 'stdio://'],
        usesNpx: false,
        source: 'codex-app-server',
        codexCliVersion: '0.128.0',
      },
      {
        command: process.execPath,
        argsPrefix: ['/managed/codex-acp.js'],
        usesNpx: false,
        source: 'managed-codex-acp',
        env: { ELECTRON_RUN_AS_NODE: '1' },
      },
    ]);

    const handler = await setupAndGetModels();
    const result = await handler();

    expect(result.success).toBe(true);
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.warning).toBe(
      'Codex dynamic model list unavailable; using static model list',
    );
    expect(mocks.startAcpChildStream).toHaveBeenCalledTimes(2);
    expect(mocks.startAcpChildStream).toHaveBeenNthCalledWith(
      1,
      '/opt/homebrew/bin/codex',
      expect.objectContaining({ args: ['app-server', '--listen', 'stdio://'] }),
    );
    expect(mocks.startAcpChildStream).toHaveBeenNthCalledWith(
      2,
      process.execPath,
      expect.objectContaining({
        args: ['/managed/codex-acp.js'],
        env: { ELECTRON_RUN_AS_NODE: '1' },
      }),
    );
  });

  it('returns the static fallback warning when no dynamic path is available', async () => {
    mocks.resolveCodexModelListCommands.mockResolvedValue([]);

    const handler = await setupAndGetModels();
    const result = await handler();

    expect(result.success).toBe(true);
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.warning).toBe('Codex not installed; using static model list');
    expect(mocks.startAcpChildStream).not.toHaveBeenCalled();
  });

  it('returns no models for malformed codex CLI model/list responses', async () => {
    const parseModels = await getCodexCliParser();

    expect(() => parseModels('{"jsonrpc":"2.0","id":1,"result":{"models":[')).not.toThrow();
    expect(parseModels('{"jsonrpc":"2.0","id":1,"result":{"models":[')).toEqual([]);
    expect(parseModels({ error: { code: -32000, message: 'model list failed' } })).toEqual([]);
    expect(parseModels({ result: {} })).toEqual([]);
    expect(parseModels({ result: { models: { model: 'gpt-5.5' } } })).toEqual([]);
  });
});
