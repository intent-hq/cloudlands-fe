/**
 * Specialist Metadata Tests
 *
 * Verifies that specialist metadata is properly stored and accessible, and
 * that the factory lifts the specialist onto the `agent.create` wire request
 * as top-level `specialistId` (PROTOCOL §5.5 — the daemon does NOT harvest
 * `metadata.specialist`, so metadata-only would never persist).
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';

// FAKE transport only: creation routes factory → appClient.agents.create →
// LiveAgentsClient → backend-transport, so mocking the transport lets these
// tests assert the exact `agent.create` JSON-RPC params on the wire.
vi.mock('$lib/client/live/backend-transport', async () => {
  const mod = await import('../../../../test/mocks/backend-transport.mock');
  return mod.mockBackendTransportModule;
});

import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from '../../../../test/mocks/backend-transport.mock';

vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn().mockResolvedValue({ success: true, data: '' }),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({ workspaceAgents: { byWorkspaceId: {} } }),
    dispatch: vi.fn(),
  });
});

import {
  UnifiedAgentFactory,
  agentFactory,
} from '../agent-factory';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { Workspace } from '$shared/types';

describe('Specialist Metadata', () => {
  let factory: UnifiedAgentFactory;
  let backend: MockBackendHandle;
  let created = 0;

  beforeEach(() => {
    // Use the singleton instance
    factory = agentFactory;
    vi.clearAllMocks();
    backend = installMockBackend();
    // PROTOCOL §5.5 widened response: `{ agent: AgentLite }` with the
    // daemon-assigned id. The daemon persists top-level `specialistId` and
    // serves it back on `metadata.specialist` — mirror that here.
    backend.onRequest('agent.create', (params) => {
      const p = params as Record<string, unknown>;
      return {
        agent: {
          id: `agent-daemon-${++created}`,
          workspaceId: p.workspaceId,
          name: p.name ?? 'Mock Agent',
          model: p.model,
          provider: p.provider,
          status: 'pending',
          metadata:
            typeof p.specialistId === 'string' ? { specialist: p.specialistId } : {},
          createdAt: '2026-07-22T00:00:00.000Z',
          updatedAt: '2026-07-22T00:00:00.000Z',
        },
      };
    });
  });

  afterEach(() => {
    resetMockBackend();
  });

  const createMockWorkspace = (id: string): Workspace => ({
    id: id as unknown as ReturnType<typeof WorkspaceId>,
    name: 'Test Workspace',
    path: `/tmp/test-workspace-${id}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const lastCreateParams = (): Record<string, unknown> => {
    const req = backend.requests.filter((r) => r.method === 'agent.create').at(-1);
    expect(req).toBeDefined();
    return req?.params as Record<string, unknown>;
  };

  it('should store specialist in metadata when provided', async () => {
    const workspace = createMockWorkspace('specialist-1');
    const config = {
      name: 'Implementation Agent',
      workspaceId: workspace.id,
      metadata: {
        specialist: 'implementor',
      },
    };

    const result = await factory.createAgent(workspace, config);

    expect(result.success).toBe(true);
    expect(result.agent?.metadata?.specialist).toBe('implementor');
  });

  it('sends the specialist as top-level specialistId on the agent.create wire request', async () => {
    // Regression: the specialist-picker path only carried the specialist in
    // `metadata`, which the daemon never harvests — the session persisted
    // with no specialist and the UI fell back to "General" after refetch.
    const workspace = createMockWorkspace('specialist-wire-1');
    const result = await factory.createAgent(workspace, {
      name: 'PR Shepherd 2',
      workspaceId: workspace.id,
      metadata: { specialist: 'pr-shepherd' },
    });

    expect(result.success).toBe(true);
    const params = lastCreateParams();
    expect(params.specialistId).toBe('pr-shepherd');
    expect(params.metadata).toMatchObject({ specialist: 'pr-shepherd' });
    // Daemon-assigned id is adopted from the PROTOCOL-shaped response.
    expect(result.agent?.id).toMatch(/^agent-daemon-/);
  });

  it('omits specialistId from the agent.create wire request when no specialist is chosen', async () => {
    const workspace = createMockWorkspace('specialist-wire-2');
    const result = await factory.createAgent(workspace, {
      name: 'Plain Agent',
      workspaceId: workspace.id,
    });

    expect(result.success).toBe(true);
    expect(lastCreateParams()).not.toHaveProperty('specialistId');
  });

  it('should handle verifier specialist', async () => {
    const workspace = createMockWorkspace('specialist-2');
    const config = {
      name: 'Review Agent',
      workspaceId: workspace.id,
      metadata: {
        specialist: 'verifier',
      },
    };

    const result = await factory.createAgent(workspace, config);

    expect(result.success).toBe(true);
    expect(result.agent?.metadata?.specialist).toBe('verifier');
  });

  it('should work without specialist metadata', async () => {
    const workspace = createMockWorkspace('specialist-3');
    const config = {
      name: 'Regular Agent',
      workspaceId: workspace.id,
    };

    const result = await factory.createAgent(workspace, config);

    expect(result.success).toBe(true);
    expect(result.agent?.metadata?.specialist).toBeUndefined();
  });

  it('should preserve specialist alongside other metadata', async () => {
    const workspace = createMockWorkspace('specialist-4');
    const config = {
      name: 'Complex Agent',
      workspaceId: workspace.id,
      metadata: {
        specialist: 'implementor',
        source: 'test',
        custom: 'value',
      },
    };

    const result = await factory.createAgent(workspace, config);

    expect(result.success).toBe(true);
    expect(result.agent?.metadata?.specialist).toBe('implementor');
    expect(result.agent?.metadata?.source).toBe('test');
    expect(result.agent?.metadata?.custom).toBe('value');
  });
});
