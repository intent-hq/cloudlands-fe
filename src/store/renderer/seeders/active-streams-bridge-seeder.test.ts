/**
 * Active Streams Bridge Seeder Test
 *
 * Tests the daemon-backed agent:get-active-streams handler that queries
 * workspace.list → agent.list per workspace and filters on isStreaming ||
 * isResponding, mirroring the main-process handler in agent-missing.ipc.ts.
 *
 * FAKE transport only: the daemon bridge is mocked so no IPC ever fires.
 * Each test asserts the JSON-RPC method + params the handler emits and how
 * it maps the daemon result back to the renderer envelope.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  installMockBackend,
  resetMockBackend,
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

  it('queries workspace.list → agent.list and returns streaming agents in ActiveStream shape', async () => {
    // Mock workspace.list returning two workspaces
    backend.onRequest('workspace.list', () => ({
      workspaces: [
        { id: 'ws1', title: 'Workspace 1' },
        { id: 'ws2', title: 'Workspace 2' },
      ],
    }));

    // Mock agent.list for ws1: one streaming agent, one idle agent
    backend.onRequest('agent.list', (params) => {
      if ((params as { workspaceId: string }).workspaceId === 'ws1') {
        return {
          agents: [
            {
              id: 'agent-streaming-1',
              isStreaming: true,
              isResponding: false,
              updatedAt: '2026-07-18T05:00:00.000Z',
            },
            {
              id: 'agent-idle-1',
              isStreaming: false,
              isResponding: false,
              updatedAt: '2026-07-18T04:00:00.000Z',
            },
          ],
        };
      }
      // ws2: one responding agent
      if ((params as { workspaceId: string }).workspaceId === 'ws2') {
        return {
          agents: [
            {
              id: 'agent-responding-2',
              isStreaming: false,
              isResponding: true,
              updatedAt: '2026-07-18T05:30:00.000Z',
            },
          ],
        };
      }
      return { agents: [] };
    });

    // Invoke the handler via the mock IPC router
    const { invoke } = await import('$shared/generated/ipc-client');
    const result = await invoke<{ success: boolean; data?: unknown; error?: string }>(
      'agent:get-active-streams',
    );

    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    const streams = result.data as Array<{
      agentId: string;
      sessionId: string;
      workspaceId: string;
      startTime: number;
    }>;

    // Should return 2 active streams (streaming + responding), filtering out the idle agent
    expect(streams).toHaveLength(2);

    const stream1 = streams.find((s) => s.agentId === 'agent-streaming-1');
    expect(stream1).toBeDefined();
    expect(stream1?.sessionId).toBe('agent-streaming-1');
    expect(stream1?.workspaceId).toBe('ws1');
    expect(stream1?.startTime).toBe(Date.parse('2026-07-18T05:00:00.000Z'));

    const stream2 = streams.find((s) => s.agentId === 'agent-responding-2');
    expect(stream2).toBeDefined();
    expect(stream2?.sessionId).toBe('agent-responding-2');
    expect(stream2?.workspaceId).toBe('ws2');
    expect(stream2?.startTime).toBe(Date.parse('2026-07-18T05:30:00.000Z'));
  });

  it('filters out agents that are neither streaming nor responding', async () => {
    backend.onRequest('workspace.list', () => ({
      workspaces: [{ id: 'ws1' }],
    }));

    backend.onRequest('agent.list', () => ({
      agents: [
        { id: 'agent-idle', isStreaming: false, isResponding: false },
        { id: 'agent-waiting', isStreaming: false, isResponding: false },
      ],
    }));

    const { invoke } = await import('$shared/generated/ipc-client');
    const result = await invoke<{ success: boolean; data?: unknown }>(
      'agent:get-active-streams',
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it('returns { success: false, data: [] } on daemon failure', async () => {
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

  it('handles invalid updatedAt by using startTime = 0', async () => {
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
    const result = await invoke<{ success: boolean; data?: unknown }>(
      'agent:get-active-streams',
    );

    expect(result.success).toBe(true);
    const streams = result.data as Array<{ agentId: string; startTime: number }>;
    expect(streams).toHaveLength(2);
    expect(streams.every((s) => s.startTime === 0)).toBe(true);
  });
});
