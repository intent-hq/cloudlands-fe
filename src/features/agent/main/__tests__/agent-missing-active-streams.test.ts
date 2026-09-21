import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';

// Mock the daemon JSON-RPC seam so the IPC handler's daemon calls are
// observable without a real socket.
const requestMock = vi.hoisted(() => vi.fn());
vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: requestMock }),
}));

// Downstream dependencies of the module under test — kept minimal so the
// handler under test drives the wire calls.
vi.mock('../../../system/main/system.ipc', () => ({
  getWindowIdsForWorkspace: () => [],
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

beforeEach(() => {
  requestMock.mockReset();
  (ipcMain.handle as any).mockReset();
  (ipcMain.removeHandler as any).mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('agent:get-active-streams IPC wire contract', () => {
  async function registerAndGetHandler() {
    const { registerMissingAgentHandlers } = await import('../agent-missing.ipc');
    registerMissingAgentHandlers();
    const calls = (ipcMain.handle as any).mock.calls as Array<[string, Function]>;
    const entry = calls.find(([channel]) => channel === 'agent:get-active-streams');
    expect(entry, 'agent:get-active-streams handler must be registered').toBeDefined();
    return entry![1];
  }

  it('requests agent.listActive without params and maps its streams without agent.list fan-out', async () => {
    requestMock.mockResolvedValue({
      streams: [
        {
          agentId: 'agent-a',
          sessionId: 'agent-a',
          workspaceId: 'ws-1',
          startTime: 1_783_296_000_000,
        },
        {
          agentId: 'agent-b',
          sessionId: 'agent-b',
          workspaceId: 'ws-2',
          startTime: 1_783_296_002_000,
        },
      ],
    });

    const handler = await registerAndGetHandler();
    const result = await handler({} as any);

    expect(requestMock.mock.calls).toEqual([['agent.listActive']]);
    expect(requestMock).not.toHaveBeenCalledWith('agent.list', expect.anything());
    expect(result).toEqual({
      success: true,
      data: [
        {
          agentId: 'agent-a',
          sessionId: 'agent-a',
          workspaceId: 'ws-1',
          startTime: 1_783_296_000_000,
        },
        {
          agentId: 'agent-b',
          sessionId: 'agent-b',
          workspaceId: 'ws-2',
          startTime: 1_783_296_002_000,
        },
      ],
    });
  });

  it.each([
    ['rpcCode -32601', { rpcCode: -32601 }],
    ['code METHOD_NOT_FOUND', { code: 'METHOD_NOT_FOUND' }],
  ])(
    'never requests workspace.list or agent.list when agent.listActive fails with %s (serves the last known snapshot)',
    async (_label, errorFields) => {
      requestMock.mockImplementation(async (method: string) => {
        if (method === 'agent.listActive') {
          return {
            streams: [
              { agentId: 'agent-a', sessionId: 'agent-a', workspaceId: 'ws-1', startTime: 1 },
            ],
          };
        }
        return {};
      });

      const handler = await registerAndGetHandler();
      const first = await handler({} as any);
      expect(first.success).toBe(true);
      expect(first.data).toHaveLength(1);

      requestMock.mockReset();
      requestMock.mockImplementation(async (method: string) => {
        if (method === 'agent.listActive') {
          throw Object.assign(new Error('Method not found'), errorFields);
        }
        throw new Error('should never fan out on method-not-found');
      });

      const second = await handler({} as any);
      expect(second).toEqual(first);
      expect(requestMock.mock.calls).toEqual([['agent.listActive']]);
      expect(requestMock).not.toHaveBeenCalledWith('workspace.list');
      expect(requestMock).not.toHaveBeenCalledWith('agent.list', expect.anything());
    },
  );

  it('returns an empty successful result when agent.listActive fails with -32601 before any snapshot exists', async () => {
    requestMock.mockImplementation(async (method: string) => {
      if (method === 'agent.listActive') {
        throw Object.assign(new Error('Method not found'), { rpcCode: -32601 });
      }
      throw new Error('should never fan out on method-not-found');
    });

    const handler = await registerAndGetHandler();
    const result = await handler({} as any);
    expect(result).toEqual({ success: true, data: [] });
    expect(requestMock.mock.calls).toEqual([['agent.listActive']]);
  });

  it('serves the last known snapshot on a transient agent.listActive failure without fanning out', async () => {
    requestMock.mockImplementation(async (method: string) => {
      if (method === 'agent.listActive') {
        return {
          streams: [
            { agentId: 'agent-a', sessionId: 'agent-a', workspaceId: 'ws-1', startTime: 1 },
          ],
        };
      }
      return {};
    });

    const handler = await registerAndGetHandler();
    const first = await handler({} as any);
    expect(first.success).toBe(true);
    expect(first.data).toHaveLength(1);

    requestMock.mockReset();
    requestMock.mockImplementation(async (method: string) => {
      if (method === 'agent.listActive') throw new Error('request timed out');
      throw new Error('should not fan out on a transient failure');
    });

    const second = await handler({} as any);
    expect(second).toEqual(first);
    expect(requestMock.mock.calls).toEqual([['agent.listActive']]);
    expect(requestMock).not.toHaveBeenCalledWith('workspace.list');
    expect(requestMock).not.toHaveBeenCalledWith('agent.list', expect.anything());
  });
});
