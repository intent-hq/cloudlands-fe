import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  resolveCodexModelListCommands: vi.fn(),
  getManagedCodexAcpStatus: vi.fn(),
  spawn: vi.fn(),
  killChildProcessTree: vi.fn(),
  webContentsSend: vi.fn(),
  appServerInitialize: vi.fn(),
  appServerListModels: vi.fn(),
  appServerDispose: vi.fn(),
  appServerOn: vi.fn(),
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

vi.mock('../codex-app-server-transport', () => ({
  CodexAppServerAcpAdapter: vi.fn().mockImplementation(function () {
    return {
      initialize: mocks.appServerInitialize,
      listModels: mocks.appServerListModels,
      dispose: mocks.appServerDispose,
      on: mocks.appServerOn,
    };
  }),
}));

function createRpcChild(handler: (request: any) => any) {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 1234;
  child.kill = vi.fn();
  child.stdin = {
    write: vi.fn((line: string) => {
      const request = JSON.parse(line);
      const result = handler(request);
      if (result !== undefined) {
        const response = `${JSON.stringify({ id: request.id, result })}\n`;
        const midpoint = Math.ceil(response.length / 2);
        child.stdout.emit('data', Buffer.from(response.slice(0, midpoint)));
        child.stdout.emit('data', Buffer.from(response.slice(midpoint)));
      }
      return true;
    }),
  };
  return child;
}

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
    mocks.appServerInitialize.mockReset();
    mocks.appServerListModels.mockReset();
    mocks.appServerDispose.mockReset();
    mocks.appServerOn.mockReset();
    mocks.getManagedCodexAcpStatus.mockReturnValue({ state: 'not_installed', version: '0.13.0' });
    mocks.appServerInitialize.mockResolvedValue({});
    mocks.appServerListModels.mockResolvedValue({ data: [] });
  });

  it('returns models from the preferred codex app-server candidate', async () => {
    mocks.resolveCodexModelListCommands.mockResolvedValue([
      {
        command: '/opt/homebrew/bin/codex',
        argsPrefix: ['app-server', '--listen', 'stdio://'],
        usesNpx: false,
        source: 'codex-app-server',
        codexCliVersion: '0.128.0',
      },
    ]);
    const child = createRpcChild(() => undefined);
    mocks.spawn.mockReturnValueOnce(child);
    mocks.appServerListModels.mockResolvedValueOnce({
      data: [
        {
          id: 'model-1',
          model: 'gpt-5.5-codex',
          displayName: 'GPT-5.5 Codex',
          description: 'App-server model',
        },
      ],
    });

    const handler = await setupAndGetModels();
    const result = await handler();

    expect(result.success).toBe(true);
    expect(result.warning).toBeUndefined();
    expect(result.data).toEqual([
      { value: 'gpt-5.5-codex', label: 'GPT-5.5 Codex', description: 'App-server model' },
    ]);
    expect(mocks.spawn).toHaveBeenCalledWith(
      '/opt/homebrew/bin/codex',
      ['app-server', '--listen', 'stdio://'],
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
    );
    expect(mocks.appServerInitialize).toHaveBeenCalledTimes(1);
    expect(mocks.appServerDispose).toHaveBeenCalledTimes(1);
    expect(child.kill).not.toHaveBeenCalled();
    expect(mocks.killChildProcessTree).toHaveBeenCalledWith(child);
  });

  it('falls through to the next candidate when codex app-server probing fails', async () => {
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
    const appServerChild = createRpcChild(() => undefined);
    const acpChild = createRpcChild((request) => {
      if (request.method === 'initialize') return {};
      if (request.method === 'session/new') {
        return { models: { available: [{ modelId: 'fallback-model', name: 'Fallback Model' }] } };
      }
      return undefined;
    });
    mocks.spawn.mockReturnValueOnce(appServerChild).mockReturnValueOnce(acpChild);
    mocks.appServerInitialize.mockRejectedValueOnce(new Error('app-server unavailable'));

    const handler = await setupAndGetModels();
    const result = await handler();

    expect(result.success).toBe(true);
    expect(result.warning).toBeUndefined();
    expect(result.data).toEqual([{ value: 'fallback-model', label: 'Fallback Model' }]);
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    expect(mocks.appServerDispose).toHaveBeenCalledTimes(1);
    expect(appServerChild.kill).not.toHaveBeenCalled();
    expect(mocks.killChildProcessTree).toHaveBeenCalledWith(appServerChild);
    expect(mocks.killChildProcessTree).toHaveBeenCalledWith(acpChild);
  });

  it('passes managed codex-acp env into the dynamic model-list probe spawn', async () => {
    mocks.resolveCodexModelListCommands.mockResolvedValue([
      {
        command: process.execPath,
        argsPrefix: ['/managed/codex-acp.js'],
        usesNpx: false,
        source: 'managed-codex-acp',
        env: { ELECTRON_RUN_AS_NODE: '1' },
      },
    ]);

    mocks.spawn.mockReturnValueOnce(
      createRpcChild((request) => {
        if (request.method === 'initialize') return {};
        if (request.method === 'session/new') {
          return {
            models: {
              available: [
                {
                  modelId: 'gpt-5.5',
                  name: 'GPT-5.5',
                  description: 'Newest frontier model',
                },
              ],
            },
          };
        }
        return undefined;
      }),
    );

    const handler = await setupAndGetModels();
    const result = await handler();

    expect(result.success).toBe(true);
    expect(result.warning).toBeUndefined();
    expect(result.data).toEqual([
      {
        value: 'gpt-5.5',
        label: 'GPT-5.5',
        description: 'Newest frontier model',
      },
    ]);
    expect(mocks.spawn).toHaveBeenCalledWith(
      process.execPath,
      ['/managed/codex-acp.js'],
      expect.objectContaining({
        stdio: ['pipe', 'pipe', 'pipe'],
        env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1' }),
      }),
    );

    const cachedResult = await handler();
    expect(cachedResult.data).toEqual(result.data);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
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
