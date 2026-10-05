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

  it('never requests workspace.list or agent.list when agent.listActive fails with -32601 (serves the last known snapshot)', async () => {
    backend.onRequest('agent.listActive', () => ({
      streams: [{ agentId: 'agent-y', sessionId: 'agent-y', workspaceId: 'ws8', startTime: 7 }],
    }));

    const { invoke } = await import('$shared/generated/ipc-client');
    const first = await invoke<{ success: boolean; data?: unknown }>('agent:get-active-streams');
    expect(first.success).toBe(true);
    expect(first.data).toEqual([
      { agentId: 'agent-y', sessionId: 'agent-y', workspaceId: 'ws8', startTime: 7 },
    ]);

    backend.onRequest('agent.listActive', () => {
      throw new BackendError({
        code: 'METHOD_NOT_FOUND',
        message: 'method not found',
        rpcCode: -32601,
      });
    });
    backend.onRequest('workspace.list', () => {
      throw new Error('should never fan out on method-not-found');
    });
    backend.onRequest('agent.list', () => {
      throw new Error('should never fan out on method-not-found');
    });

    const second = await invoke<{ success: boolean; data?: unknown }>('agent:get-active-streams');
    expect(second).toEqual(first);
    expect(backend.requests.map(({ method }) => method)).toEqual([
      'agent.listActive',
      'agent.listActive',
    ]);
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
});
