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

  it('falls back to the legacy fan-out when agent.listActive is unavailable', async () => {
    requestMock.mockImplementation(async (method: string, params?: any) => {
      if (method === 'agent.listActive') throw new Error('method not found');
      if (method === 'workspace.list') return { workspaces: [{ id: 'ws-1' }] };
      if (method === 'agent.list' && params?.workspaceId === 'ws-1') {
        return {
          agents: [
            { id: 'agent-c', workspaceId: 'ws-1', isResponding: true },
            { id: 'agent-d', workspaceId: 'ws-1', isStreaming: true, updatedAt: 'not-a-date' },
          ],
        };
      }
      return {};
    });

    const handler = await registerAndGetHandler();
    const result = await handler({} as any);
    expect(result.success).toBe(true);
    const streams = (result.data as Array<{ agentId: string; startTime: number }>).sort((a, b) =>
      a.agentId.localeCompare(b.agentId),
    );
    expect(streams).toEqual([
      { agentId: 'agent-c', sessionId: 'agent-c', workspaceId: 'ws-1', startTime: 0 },
      { agentId: 'agent-d', sessionId: 'agent-d', workspaceId: 'ws-1', startTime: 0 },
    ]);
  });

  it('skips a workspace when its agent.list rejects, still returning results from siblings', async () => {
    requestMock.mockImplementation(async (method: string, params?: any) => {
      if (method === 'agent.listActive') throw new Error('method not found');
      if (method === 'workspace.list') return { workspaces: [{ id: 'ws-good' }, { id: 'ws-bad' }] };
      if (method === 'agent.list' && params?.workspaceId === 'ws-good') {
        return {
          agents: [
            {
              id: 'agent-ok',
              workspaceId: 'ws-good',
              isStreaming: true,
              updatedAt: '2026-07-06T00:00:00.000Z',
            },
          ],
        };
      }
      if (method === 'agent.list' && params?.workspaceId === 'ws-bad') {
        throw new Error('ws-bad boom');
      }
      return {};
    });

    const handler = await registerAndGetHandler();
    const result = await handler({} as any);
    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      {
        agentId: 'agent-ok',
        sessionId: 'agent-ok',
        workspaceId: 'ws-good',
        startTime: Date.parse('2026-07-06T00:00:00.000Z'),
      },
    ]);
  });

  it('returns { success: false, data: [] } when the compatibility fallback also fails', async () => {
    requestMock.mockImplementation(async (method: string) => {
      if (method === 'agent.listActive') throw new Error('method not found');
      if (method === 'workspace.list') throw new Error('workspace boom');
      return {};
    });

    const handler = await registerAndGetHandler();
    const result = await handler({} as any);
    expect(result.success).toBe(false);
    expect(result.data).toEqual([]);
    expect(String(result.error)).toContain('workspace boom');
  });
});
