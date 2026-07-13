/**
 * Tests for Unified Agent Factory
 *
 * Tests the consolidated agent creation service that consolidates
 * createAgent, createInitialAgent, and createContextualAgent into one unified interface.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
  afterEach,
} from 'vitest';
import {
  UnifiedAgentFactory,
  type UnifiedAgentConfig,
} from '../agent-factory';
import type { Workspace } from '$shared/types';
import { AgentStatus } from '$shared/types';

// Mock configured app Store
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({ workspaceAgents: { byWorkspaceId: {} }, workspace: { activeWorkspaceId: 'test-ws' } }),
    dispatch: vi.fn(),
  });
});

// Mock the widened AgentsClient seam (AUDIT-P2-12b): `createInBackend` now
// routes agent creation through `appClient.agents.create` (→ daemon
// `agent.create`, PROTOCOL §5.5) instead of the legacy `AGENT_CHANNELS.CREATE`
// IPC. The mock echoes the FE-supplied id back per the daemon contract.
vi.mock('$lib/client', () => ({
  appClient: {
    agents: {
      create: vi.fn(async (request: { agentId?: string; workspaceId: string; name?: string }) => ({
        id: request.agentId ?? 'agent-123',
        backendSessionId: null,
        workspaceId: request.workspaceId,
        name: request.name ?? 'Test Agent',
        status: 'Idle',
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    },
  },
}));

// Mock electron-bridge for user rules
vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn().mockResolvedValue({
    success: true,
    data: 'User defined rules',
  }),
}));

import { appClient } from '$lib/client';
const agentsApi = appClient.agents as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe('UnifiedAgentFactory', () => {
  let factory: UnifiedAgentFactory;
  let mockWorkspace: Workspace;

  beforeEach(() => {
    factory = UnifiedAgentFactory.getInstance();
    mockWorkspace = {
      id: 'workspace-123' as any,
      title: 'Test Workspace',
      path: '/test/workspace',
      repositoryPath: '/test/workspace',
      worktreePath: undefined,
      branch: 'main',
      changesets: [],
      timeline: [],
      conversationInfo: [],
      status: 'active' as any,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createAgent', () => {
    it('should create an agent with valid configuration', async () => {
      const config: UnifiedAgentConfig = {
        name: 'Test Agent',
        workspaceId: mockWorkspace.id as any,
        model: 'sonnet4.5',
        systemPrompt: 'You are a helpful assistant',
      };

      const result = await factory.createAgent(mockWorkspace, config);

      // Log the result to debug
      if (!result.success) {
        console.error('Agent creation failed:', result.error);
      }

      expect(result.success).toBe(true);
      expect(result.agent).toBeDefined();
      expect(result.agent?.name).toBe('Test Agent');
      expect(result.agent?.status).toBe(AgentStatus.Idle);
      expect(result.agentId).toBeDefined();
      expect(result.sessionId).toBeDefined();
      // Note: streamId is no longer returned - agentId is the canonical key for streams
    });

    it('should normalize agent name if too long', async () => {
      const longName = 'A'.repeat(150);
      const config: UnifiedAgentConfig = {
        name: longName,
        workspaceId: mockWorkspace.id as any,
      };

      const result = await factory.createAgent(mockWorkspace, config);

      expect(result.success).toBe(true);
      expect(result.agent?.name.length).toBeLessThanOrEqual(100);
    });

    it('should use default name if not provided', async () => {
      const config: UnifiedAgentConfig = {
        name: '',
        workspaceId: mockWorkspace.id as any,
      };

      const result = await factory.createAgent(mockWorkspace, config);

      expect(result.success).toBe(true);
      // When no name and no initialMessage, falls back to generic "Agent" name
      expect(result.agent?.name).toBe('Agent');
    });

    it('should fail if workspace has no path', async () => {
      const invalidWorkspace = { ...mockWorkspace, path: undefined, repositoryPath: undefined };
      const config: UnifiedAgentConfig = {
        name: 'Test Agent',
        workspaceId: mockWorkspace.id as any,
      };

      const result = await factory.createAgent(invalidWorkspace, config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('path');
    });

    it('should respect explicit isBackground: false and not fall back to metadata', async () => {
      const config: UnifiedAgentConfig = {
        name: 'Foreground Agent',
        workspaceId: mockWorkspace.id as any,
        isBackground: false,
        metadata: { isBackground: true },
      };

      const result = await factory.createAgent(mockWorkspace, config);

      expect(result.success).toBe(true);
      expect(result.agent?.isBackground).toBe(false);
    });

    it('should fall back to metadata.isBackground when isBackground is undefined', async () => {
      const config: UnifiedAgentConfig = {
        name: 'Background via Metadata',
        workspaceId: mockWorkspace.id as any,
        metadata: { isBackground: true },
      };

      const result = await factory.createAgent(mockWorkspace, config);

      expect(result.success).toBe(true);
      expect(result.agent?.isBackground).toBe(true);
    });

    it('should include metadata in agent state', async () => {
      const config: UnifiedAgentConfig = {
        name: 'Test Agent',
        workspaceId: mockWorkspace.id as any,
        source: 'workspace-initializer',
        metadata: { custom: 'value' },
      };

      const result = await factory.createAgent(mockWorkspace, config);

      expect(result.success).toBe(true);
      expect(result.agent?.metadata?.source).toBe('workspace-initializer');
      expect(result.agent?.metadata?.custom).toBe('value');
    });

    it('routes create through appClient.agents.create with the widened wire shape', async () => {
      agentsApi.create.mockClear();
      const config: UnifiedAgentConfig = {
        id: 'agent-fixed-1',
        name: 'Wire Agent',
        workspaceId: mockWorkspace.id as any,
        model: 'sonnet4.5',
        provider: 'auggie',
        agentType: 'chat' as any,
        behaviorPrompt: 'be nice',
        metadata: { source: 'wire-test' },
      };

      const result = await factory.createAgent(mockWorkspace, config);
      expect(result.success).toBe(true);

      expect(agentsApi.create).toHaveBeenCalledTimes(1);
      const [request] = agentsApi.create.mock.calls[0] as [Record<string, unknown>];
      // AUDIT-P2-12b: FE forwards the widened AgentCreateRequest fields
      // consumed by the daemon (§5.5). `prompt` carries the behaviorPrompt.
      expect(request.workspaceId).toBe(String(mockWorkspace.id));
      expect(request.workspacePath).toBe(mockWorkspace.repositoryPath);
      expect(request.agentId).toBe('agent-fixed-1');
      expect(request.name).toBe('Wire Agent');
      expect(request.model).toBe('sonnet4.5');
      expect(request.provider).toBe('auggie');
      expect(request.agentType).toBe('chat');
      expect(request.prompt).toBe('be nice');
      expect(request.metadata).toMatchObject({ source: 'wire-test' });
    });
  });
});
