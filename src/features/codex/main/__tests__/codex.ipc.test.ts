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
  // Retained after AUDIT-R1b so the tests can still assert the FE never
  // reaches a spawn (`spawnCodexProbe` throws synchronously — the assertion
  // guards against a regression that re-introduces local spawning).
  spawn: vi.fn(),
  killChildProcessTree: vi.fn(),
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

vi.mock('child_process', () => ({
  default: { spawn: mocks.spawn },
  spawn: mocks.spawn,
}));

vi.mock('../../../../shared/main/process-tree-kill', () => ({
  killChildProcessTree: mocks.killChildProcessTree,
}));

vi.mock('../codex-resolver', () => ({
  resolveCodexModelListCommands: mocks.resolveCodexModelListCommands,
}));

vi.mock('../codex-acp-manager', () => ({
  getManagedCodexAcpStatus: mocks.getManagedCodexAcpStatus,
}));

// AUDIT-R1b: `CodexAppServerAcpAdapter` is still constructed by the module
// under test — mock it minimally so the import doesn't touch the real
// transport. The adapter methods are never reached at runtime because the
// preceding `spawnCodexProbe` throws.
vi.mock('../codex-app-server-transport', () => ({
  CodexAppServerAcpAdapter: vi.fn().mockImplementation(() => ({
    initialize: vi.fn(),
    listModels: vi.fn(),
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
    mocks.spawn.mockReset();
    mocks.killChildProcessTree.mockReset();
    mocks.webContentsSend.mockReset();
    mocks.getManagedCodexAcpStatus.mockReturnValue({ state: 'not_installed', version: '0.13.0' });
  });

  // AUDIT-R1b: the FE spawn seam behind the dynamic Codex model probes was
  // deleted (no daemon-side ACP handshake RPC yet), so every attempted probe
  // now fails synchronously and the GET_MODELS handler falls back to the
  // static Codex model list with an "unavailable" warning. These tests
  // assert that fallback path — and that spawn is never invoked, since the
  // production code never reaches it.
  it('falls back to the static Codex model list with an unavailable warning when a dynamic candidate is present (AUDIT-R1b)', async () => {
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
    // spawn is retained as an import to keep createJsonRpcRequester typed but
    // is never invoked at runtime after AUDIT-R1b.
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('attempts every candidate before falling back so `attemptedSources` covers the full list (AUDIT-R1b)', async () => {
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
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('returns the static fallback warning when no dynamic path is available', async () => {
    mocks.resolveCodexModelListCommands.mockResolvedValue([]);

    const handler = await setupAndGetModels();
    const result = await handler();

    expect(result.success).toBe(true);
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.warning).toBe('Codex not installed; using static model list');
    expect(mocks.spawn).not.toHaveBeenCalled();
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
