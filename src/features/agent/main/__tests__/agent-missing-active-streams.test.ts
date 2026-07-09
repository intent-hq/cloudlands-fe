import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';

// Mock the daemon JSON-RPC seam so the IPC handler's daemon calls are
// observable without a real socket. Method-aware so `workspace.list` and
// `agent.list` can be scripted independently per test.
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

// C1d-3: `agent:get-active-streams` is a cross-workspace probe used by the
// renderer `active-streams-tracker`. Post-rewire it iterates
// `workspace.list` → `agent.list` per workspace (PROTOCOL.md §5.5) and
// filters on the AgentLite `isStreaming || isResponding` flags, returning
// the tracker's `ActiveStream[]` shape (`agentId, sessionId, workspaceId,
// startTime`).
describe("agent:get-active-streams IPC wire contract (via workspace.list + agent.list)", () => {
  async function registerAndGetHandler() {
    const { registerMissingAgentHandlers } = await import('../agent-missing.ipc');
    registerMissingAgentHandlers();
    const calls = (ipcMain.handle as any).mock.calls as Array<[string, Function]>;
    const entry = calls.find(([channel]) => channel === 'agent:get-active-streams');
    expect(entry, 'agent:get-active-streams handler must be registered').toBeDefined();
    return entry![1];
  }

  it('issues workspace.list then agent.list per workspace and returns streaming/responding agents in the ActiveStream shape', async () => {
    // Method-aware router: workspace.list → 2 workspaces; agent.list → per-ws AgentLite[]
    requestMock.mockImplementation(async (method: string, params?: any) => {
      if (method === 'workspace.list') {
        return { workspaces: [{ id: 'ws-1' }, { id: 'ws-2' }] };
      }
      if (method === 'agent.list' && params?.workspaceId === 'ws-1') {
        return {
          agents: [
            {
              id: 'agent-a',
              workspaceId: 'ws-1',
              isStreaming: true,
              isResponding: false,
              updatedAt: '2026-07-06T00:00:00.000Z',
            },
            {
              id: 'agent-idle',
              workspaceId: 'ws-1',
              isStreaming: false,
              isResponding: false,
              updatedAt: '2026-07-06T00:00:01.000Z',
            },
          ],
        };
      }
      if (method === 'agent.list' && params?.workspaceId === 'ws-2') {
        return {
          agents: [
            {
              id: 'agent-b',
              workspaceId: 'ws-2',
              isStreaming: false,
              isResponding: true,
              updatedAt: '2026-07-06T00:00:02.000Z',
            },
          ],
        };
      }
      return {};
    });

    const handler = await registerAndGetHandler();
    const result = await handler({} as any);

    // Wire assertions — exact request shape per PROTOCOL.md §5.5.
    const methods = requestMock.mock.calls.map((c) => c[0]);
    expect(methods[0]).toBe('workspace.list');
    expect(requestMock).toHaveBeenCalledWith('agent.list', { workspaceId: 'ws-1' });
    expect(requestMock).toHaveBeenCalledWith('agent.list', { workspaceId: 'ws-2' });

    // Response-shape compatibility with `active-streams-tracker.ts` `ActiveStream`:
    // { agentId, sessionId, workspaceId, startTime } — no assistantAppMessageId,
    // no accumulatedContent (the renderer tracker does not read those fields).
    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    const streams = result.data as Array<Record<string, unknown>>;
    expect(streams).toHaveLength(2);
    expect(streams).toContainEqual({
      agentId: 'agent-a',
      sessionId: 'agent-a',
      workspaceId: 'ws-1',
      startTime: Date.parse('2026-07-06T00:00:00.000Z'),
    });
    expect(streams).toContainEqual({
      agentId: 'agent-b',
      sessionId: 'agent-b',
      workspaceId: 'ws-2',
      startTime: Date.parse('2026-07-06T00:00:02.000Z'),
    });
    // Field-level compat: consumer-required keys present; unused fields omitted.
    for (const s of streams) {
      expect(Object.keys(s).sort()).toEqual(
        ['agentId', 'sessionId', 'workspaceId', 'startTime'].sort(),
      );
      expect(typeof s.startTime).toBe('number');
    }
  });

  it('coerces missing/invalid updatedAt to startTime=0 (best-effort)', async () => {
    requestMock.mockImplementation(async (method: string, params?: any) => {
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

  it('returns { success: false, data: [] } when workspace.list rejects', async () => {
    requestMock.mockImplementation(async (method: string) => {
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
