/**
 * Active Streams Bridge Seeder Test
 *
 * Tests the daemon-backed agent:get-active-streams handler that queries
 * agent.listActive, mirroring the main-process handler in agent-missing.ipc.ts.
 *
 * FAKE transport only: the daemon bridge is mocked so no IPC ever fires.
 * Each test asserts the JSON-RPC method + params the handler emits and how
 * it maps the daemon result back to the renderer envelope.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  installMockBackend,
  resetMockBackend,
  BackendError,
  type MockBackendHandle,
} from '../../../test/mocks/backend-transport.mock';

vi.mock('$lib/client/live/backend-transport', async () => {
  const mod = await import('../../../test/mocks/backend-transport.mock');
  return mod.mockBackendTransportModule;
});

describe('Active Streams Bridge Seeder', () => {
  let backend: MockBackendHandle;

  beforeEach(async () => {
    backend = installMockBackend();
    // Import the seeder AFTER the mock is installed so the handler is registered
    await import('./active-streams-bridge-seeder');
  });

  afterEach(() => {
    resetMockBackend();
  });

  it('requests agent.listActive without params and returns its ActiveStream shape', async () => {
    backend.onRequest('agent.listActive', () => ({
      streams: [
        {
          agentId: 'agent-streaming-1',
          sessionId: 'agent-streaming-1',
          workspaceId: 'ws1',
          startTime: 1_784_350_800_000,
        },
        {
          agentId: 'agent-responding-2',
          sessionId: 'agent-responding-2',
          workspaceId: 'ws2',
          startTime: 1_784_352_600_000,
        },
      ],
    }));

    // Invoke the handler via the mock IPC router
    const { invoke } = await import('$shared/generated/ipc-client');
    const result = await invoke<{ success: boolean; data?: unknown; error?: string }>(
      'agent:get-active-streams',
    );

    expect(backend.requests).toEqual([{ method: 'agent.listActive', params: undefined }]);
    expect(backend.requests.some(({ method }) => method === 'agent.list')).toBe(false);

    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    const streams = result.data as Array<{
      agentId: string;
      sessionId: string;
      workspaceId: string;
      startTime: number;
    }>;

    expect(streams).toEqual([
      {
        agentId: 'agent-streaming-1',
        sessionId: 'agent-streaming-1',
        workspaceId: 'ws1',
        startTime: 1_784_350_800_000,
      },
      {
        agentId: 'agent-responding-2',
        sessionId: 'agent-responding-2',
        workspaceId: 'ws2',
        startTime: 1_784_352_600_000,
      },
    ]);
  });

  it('returns an empty successful result when no agents are mid-turn', async () => {
    backend.onRequest('agent.listActive', () => ({ streams: [] }));

    const { invoke } = await import('$shared/generated/ipc-client');
    const result = await invoke<{ success: boolean; data?: unknown }>('agent:get-active-streams');

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it('returns { success: false, data: [] } when the compatibility fallback also fails', async () => {
    backend.onRequest('agent.listActive', () => {
      throw new BackendError({
        code: 'METHOD_NOT_FOUND',
        message: 'method not found',
        rpcCode: -32601,
      });
    });
    backend.onRequest('workspace.list', () => {
      throw new Error('Daemon connection failed');
    });

    const { invoke } = await import('$shared/generated/ipc-client');
    const result = await invoke<{ success: boolean; error?: string; data?: unknown }>(
      'agent:get-active-streams',
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Daemon connection failed');
    expect(result.data).toEqual([]);
  });

  it('falls back to the legacy fan-out when agent.listActive is unavailable', async () => {
    backend.onRequest('agent.listActive', () => {
      throw new BackendError({
        code: 'METHOD_NOT_FOUND',
        message: 'method not found',
        rpcCode: -32601,
      });
    });
    backend.onRequest('workspace.list', () => ({
      workspaces: [{ id: 'ws1' }],
    }));

    backend.onRequest('agent.list', () => ({
      agents: [
        { id: 'agent-1', isStreaming: true, updatedAt: 'invalid-date' },
        { id: 'agent-2', isResponding: true, updatedAt: undefined },
      ],
    }));

    const { invoke } = await import('$shared/generated/ipc-client');
    const result = await invoke<{ success: boolean; data?: unknown }>('agent:get-active-streams');

    expect(result.success).toBe(true);
    const streams = result.data as Array<{ agentId: string; startTime: number }>;
    expect(streams).toHaveLength(2);
    expect(streams.every((s) => s.startTime === 0)).toBe(true);
  });

  it('serves the last known snapshot on a transient agent.listActive failure without fanning out', async () => {
    backend.onRequest('agent.listActive', () => ({
      streams: [{ agentId: 'agent-z', sessionId: 'agent-z', workspaceId: 'ws9', startTime: 42 }],
    }));

    const { invoke } = await import('$shared/generated/ipc-client');
    const first = await invoke<{ success: boolean; data?: unknown }>('agent:get-active-streams');
    expect(first.success).toBe(true);
    expect(first.data).toEqual([
      { agentId: 'agent-z', sessionId: 'agent-z', workspaceId: 'ws9', startTime: 42 },
    ]);

    backend.onRequest('agent.listActive', () => {
      throw new Error('request timed out');
    });
    backend.onRequest('workspace.list', () => {
      throw new Error('should not fan out on a transient failure');
    });

    const second = await invoke<{ success: boolean; data?: unknown }>('agent:get-active-streams');
    expect(second).toEqual(first);
    expect(backend.requests.some(({ method }) => method === 'workspace.list')).toBe(false);
  });

  it('does not fan out on a message-only "method not found" error lacking a real code', async () => {
    backend.onRequest('agent.listActive', () => ({
      streams: [{ agentId: 'agent-z', sessionId: 'agent-z', workspaceId: 'ws9', startTime: 42 }],
    }));

    const { invoke } = await import('$shared/generated/ipc-client');
    const first = await invoke<{ success: boolean; data?: unknown }>('agent:get-active-streams');
    expect(first.success).toBe(true);

    // Structured internal error whose message happens to mention "method not
    // found" but carries no METHOD_NOT_FOUND code/rpcCode — must not trigger
    // the legacy fan-out.
    backend.onRequest('agent.listActive', () => {
      throw new Error('internal error: could not resolve method not found in registry');
    });
    backend.onRequest('workspace.list', () => {
      throw new Error('should not fan out on a non-code failure');
    });

    const second = await invoke<{ success: boolean; data?: unknown }>('agent:get-active-streams');
    expect(second).toEqual(first);
    expect(backend.requests.some(({ method }) => method === 'workspace.list')).toBe(false);
  });
});
