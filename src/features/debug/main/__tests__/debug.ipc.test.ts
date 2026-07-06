import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '$shared/ipc-registry';

// Mock the daemon JSON-RPC seam so the debug handler's `agent.list` call is
// observable without a real socket.
const request = vi.fn();
vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request }),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

// The handler is only registered when NODE_ENV === 'development'.
const ORIGINAL_ENV = process.env.NODE_ENV;
beforeEach(() => {
  process.env.NODE_ENV = 'development';
  request.mockReset();
  (ipcMain.handle as any).mockReset();
});
afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_ENV;
});

// P3-1: debug.ipc `LIST_AGENTS` routes through the daemon `agent.list`
// (PROTOCOL.md §5.5) rather than the retired agent-{uuid}.json store.
describe('debug IPC LIST_AGENTS wire contract', () => {
  it('forwards { workspaceId } to agent.list and projects the AgentLite result', async () => {
    const { setupDebugIPC } = await import('../debug.ipc');
    setupDebugIPC();

    // Capture the registered LIST_AGENTS handler.
    const calls = (ipcMain.handle as any).mock.calls as Array<[string, Function]>;
    const entry = calls.find(([channel]) => channel === IPC_CHANNELS.DEBUG.LIST_AGENTS);
    expect(entry, 'LIST_AGENTS handler must be registered in dev').toBeDefined();
    const handler = entry![1];

    request.mockResolvedValueOnce({
      agents: [
        {
          id: 'agent-1',
          name: 'A',
          status: 'idle',
          messageCount: 3,
          createdAt: '2026-06-30T00:00:00.000Z',
        },
        {
          id: 'agent-2',
          name: 'B',
          status: 'responding',
          createdAt: '2026-06-30T00:00:01.000Z',
        },
      ],
    });

    const result = await handler({} as any, { workspaceId: 'ws-1' });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('agent.list', { workspaceId: 'ws-1' });
    expect(result).toEqual({
      success: true,
      agents: [
        {
          id: 'agent-1',
          name: 'A',
          status: 'idle',
          messageCount: 3,
          createdAt: '2026-06-30T00:00:00.000Z',
        },
        {
          id: 'agent-2',
          name: 'B',
          status: 'responding',
          messageCount: 0,
          createdAt: '2026-06-30T00:00:01.000Z',
        },
      ],
    });
  });

  it('returns { success: false, error } when the daemon rejects', async () => {
    const { setupDebugIPC } = await import('../debug.ipc');
    setupDebugIPC();

    const calls = (ipcMain.handle as any).mock.calls as Array<[string, Function]>;
    const handler = calls.find(([channel]) => channel === IPC_CHANNELS.DEBUG.LIST_AGENTS)![1];
    request.mockRejectedValueOnce(new Error('boom'));

    const result = await handler({} as any, { workspaceId: 'ws-1' });
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('boom');
  });
});

// C1d-3: TRIGGER_BACKEND_RESUME routes through the daemon `agent.sendMessage`
// (PROTOCOL.md §5.5) instead of the retired FE `sendBackendInitiatedMessage`
// path. `messageMetadata` becomes log-only (no daemon param); `queued: true`
// replaces the removed `errorCode: "ALREADY_STREAMING"` signal.
describe('debug IPC TRIGGER_BACKEND_RESUME wire contract', () => {
  it('forwards { agentId, content, workspaceId } to agent.sendMessage and returns the daemon result', async () => {
    const { setupDebugIPC } = await import('../debug.ipc');
    setupDebugIPC();

    const calls = (ipcMain.handle as any).mock.calls as Array<[string, Function]>;
    const entry = calls.find(([channel]) => channel === IPC_CHANNELS.DEBUG.TRIGGER_BACKEND_RESUME);
    expect(entry, 'TRIGGER_BACKEND_RESUME handler must be registered in dev').toBeDefined();
    const handler = entry![1];

    request.mockResolvedValueOnce({ success: true, queued: false, messageId: 'user-msg-1' });

    const result = await handler({} as any, {
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      message: 'wake up',
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('agent.sendMessage', {
      agentId: 'agent-1',
      content: 'wake up',
      workspaceId: 'ws-1',
    });
    expect(result).toEqual({ success: true, queued: false, messageId: 'user-msg-1' });
  });

  it('surfaces the daemon `queued: true` result verbatim (the "already streaming" signal per PROTOCOL §5.5 migration note)', async () => {
    const { setupDebugIPC } = await import('../debug.ipc');
    setupDebugIPC();

    const calls = (ipcMain.handle as any).mock.calls as Array<[string, Function]>;
    const handler = calls.find(([channel]) => channel === IPC_CHANNELS.DEBUG.TRIGGER_BACKEND_RESUME)![1];

    request.mockResolvedValueOnce({ success: true, queued: true, messageId: 'user-msg-2' });

    const result = await handler({} as any, {
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      message: 'wake again',
    });

    expect(request).toHaveBeenCalledWith('agent.sendMessage', {
      agentId: 'agent-1',
      content: 'wake again',
      workspaceId: 'ws-1',
    });
    expect(result).toEqual({ success: true, queued: true, messageId: 'user-msg-2' });
  });

  it('falls back to a synthesised debug message when no `message` is supplied', async () => {
    const { setupDebugIPC } = await import('../debug.ipc');
    setupDebugIPC();

    const calls = (ipcMain.handle as any).mock.calls as Array<[string, Function]>;
    const handler = calls.find(([channel]) => channel === IPC_CHANNELS.DEBUG.TRIGGER_BACKEND_RESUME)![1];

    request.mockResolvedValueOnce({ success: true, queued: false });

    await handler({} as any, { workspaceId: 'ws-1', agentId: 'agent-1' });

    expect(request).toHaveBeenCalledTimes(1);
    const [method, params] = request.mock.calls[0] as [string, Record<string, unknown>];
    expect(method).toBe('agent.sendMessage');
    expect(params.agentId).toBe('agent-1');
    expect(params.workspaceId).toBe('ws-1');
    expect(typeof params.content).toBe('string');
    expect(String(params.content)).toContain('[DEBUG] Backend-initiated wake test');
    // messageMetadata is FE-log-only per PROTOCOL §5.5; it must NOT appear on the wire.
    expect(params).not.toHaveProperty('messageMetadata');
  });

  it('returns { success: false, error } when the daemon rejects', async () => {
    const { setupDebugIPC } = await import('../debug.ipc');
    setupDebugIPC();

    const calls = (ipcMain.handle as any).mock.calls as Array<[string, Function]>;
    const handler = calls.find(([channel]) => channel === IPC_CHANNELS.DEBUG.TRIGGER_BACKEND_RESUME)![1];

    request.mockRejectedValueOnce(new Error('rpc boom'));

    const result = await handler({} as any, {
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      message: 'x',
    });

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('rpc boom');
  });
});
