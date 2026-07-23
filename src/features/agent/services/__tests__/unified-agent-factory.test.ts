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

const { mockStoreDispatch, backendRequestMock } = vi.hoisted(() => ({
  mockStoreDispatch: vi.fn(),
  backendRequestMock: vi.fn(),
}));

// Mock the BackendTransport seam: sendInitialMessage() calls
// backendRequest("agent.sendMessage") directly (PROTOCOL.md §5.5) — no
// mock-IPC STREAM_MESSAGE hop.
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: backendRequestMock,
  backendSubscribe: vi.fn(async () => ({})),
  backendUnsubscribe: vi.fn(async () => {}),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
  detectLiveStateCapability: vi.fn(async () => false),
  isBackendAvailable: () => true,
  BackendError: class BackendError extends Error {},
}));

// Mock configured app Store
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({ workspaceAgents: { byWorkspaceId: {} }, workspace: { activeWorkspaceId: 'test-ws' } }),
    dispatch: mockStoreDispatch,
  });
});

// Mock the widened AgentsClient seam (AUDIT-P2-12b): `createInBackend` now
// routes agent creation through `appClient.agents.create` (→ daemon
// `agent.create`, PROTOCOL §5.5) instead of the legacy `AGENT_CHANNELS.CREATE`
// IPC. The daemon assigns the session id and returns it on the response —
// the mock mints its own id, mirroring the daemon contract.
vi.mock('$lib/client', () => ({
  appClient: {
    agents: {
      create: vi.fn(async (request: { workspaceId: string; name?: string }) => ({
        id: 'agent-daemon-assigned-123',
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
    backendRequestMock.mockReset();
    backendRequestMock.mockResolvedValue({ success: true, queued: false, messageId: 'm-1' });
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
      // The daemon assigns the agent id — no client id may reach the wire,
      // even when the caller supplied config.id.
      expect(request.agentId).toBeUndefined();
      expect('agentId' in request).toBe(false);
      expect(request.name).toBe('Wire Agent');
      expect(request.model).toBe('sonnet4.5');
      expect(request.provider).toBe('auggie');
      expect(request.agentType).toBe('chat');
      expect(request.prompt).toBe('be nice');
      expect(request.metadata).toMatchObject({ source: 'wire-test' });
    });

    it('adopts the daemon-assigned agent id from the create response', async () => {
      agentsApi.create.mockClear();
      const config: UnifiedAgentConfig = {
        id: 'agent-client-optimistic',
        name: 'Adopt Agent',
        workspaceId: mockWorkspace.id as any,
      };

      const result = await factory.createAgent(mockWorkspace, config);

      expect(result.success).toBe(true);
      // The returned session and agentId are keyed by the daemon's id, not
      // the caller's optimistic one — follow-up sends target the daemon id.
      expect(String(result.agent?.id)).toBe('agent-daemon-assigned-123');
      expect(String(result.agentId)).toBe('agent-daemon-assigned-123');
    });

    it('fails creation when the daemon response carries no agent id', async () => {
      agentsApi.create.mockClear();
      // Daemon returns a session without an id (wire divergence): the factory
      // must abort BEFORE any upsert/send instead of proceeding with the
      // provisional id the daemon doesn't recognize.
      agentsApi.create.mockResolvedValueOnce({
        backendSessionId: null,
        workspaceId: 'test-workspace-id',
        name: 'No Id Agent',
        status: 'Idle',
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as never);

      const result = await factory.createAgent(mockWorkspace, {
        name: 'No Id Agent',
        workspaceId: mockWorkspace.id as any,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('missing daemon-assigned agent id');
      expect(result.agent).toBeUndefined();
    });

    const findSendMessageCall = () =>
      backendRequestMock.mock.calls.find(([method]) => method === 'agent.sendMessage');

    it('emits agent.sendMessage on the wire with the PROTOCOL.md §5.5 initial-message envelope', async () => {
      const result = await factory.createAgent(mockWorkspace, {
        name: 'Initial Agent',
        workspaceId: mockWorkspace.id as any,
        initialMessage: 'Initial prompt',
      });
      expect(result.success).toBe(true);

      // The initial-message send is fired after createAgent resolves the
      // daemon id (fire-and-forget); flush it before asserting.
      await vi.waitFor(() => {
        expect(findSendMessageCall()).toBeDefined();
      });

      const [, params] = findSendMessageCall()! as [string, Record<string, unknown>];
      expect(params).toMatchObject({
        agentId: 'agent-daemon-assigned-123',
        workspaceId: String(mockWorkspace.id),
        content: 'Initial prompt',
      });
      expect(typeof params.userAppMessageId).toBe('string');
      // Legacy-only fields the daemon ignores must no longer be sent.
      expect(params).not.toHaveProperty('sessionId');
      expect(params).not.toHaveProperty('agentName');
      expect(params).not.toHaveProperty('systemPrompt');
    });

    it('forwards the optimistic initial user message appMessageId on the backend send (dup-first-message guard)', async () => {
      const result = await factory.createAgent(mockWorkspace, {
        name: 'Initial Agent',
        workspaceId: mockWorkspace.id as any,
        initialMessage: 'Initial prompt',
      });
      expect(result.success).toBe(true);

      await vi.waitFor(() => {
        expect(findSendMessageCall()).toBeDefined();
      });

      const addMessageCall = mockStoreDispatch.mock.calls.find(
        ([action]) => action?.type === 'agentSessions/addMessage',
      );
      const sendMessageCall = findSendMessageCall();

      expect(addMessageCall).toBeDefined();
      expect(sendMessageCall).toBeDefined();
      // The optimistic user message staged in the store and the wire send
      // must share one logical id so the daemon-echoed canonical message
      // merges with the optimistic one instead of rendering twice.
      const [, sendParams] = sendMessageCall! as [string, Record<string, unknown>];
      const [addMessageAction] = addMessageCall! as [{ payload: [string, { appMessageId?: string }] }];
      expect(sendParams.userAppMessageId).toBe(addMessageAction.payload[1].appMessageId);
      expect(sendParams.userAppMessageId).toBeTruthy();
    });

    it('honors a caller-owned appMessageId for the initial user message', async () => {
      const appMessageId = 'app_msg_initializer-owned';
      const result = await factory.createAgent(mockWorkspace, {
        name: 'Initial Agent',
        workspaceId: mockWorkspace.id as any,
        initialMessage: 'Initial prompt',
        appMessageId,
      });
      expect(result.success).toBe(true);

      await vi.waitFor(() => {
        expect(findSendMessageCall()).toBeDefined();
      });

      const addMessageCall = mockStoreDispatch.mock.calls.find(
        ([action]) => action?.type === 'agentSessions/addMessage',
      );
      const [, sendParams] = findSendMessageCall()! as [string, Record<string, unknown>];
      const [addMessageAction] = addMessageCall! as [{ payload: [string, { appMessageId?: string }] }];
      expect(sendParams.userAppMessageId).toBe(appMessageId);
      expect(addMessageAction.payload[1].appMessageId).toBe(appMessageId);
    });

    it('ignores an empty caller appMessageId and mints one instead', async () => {
      const result = await factory.createAgent(mockWorkspace, {
        name: 'Initial Agent',
        workspaceId: mockWorkspace.id as any,
        initialMessage: 'Initial prompt',
        appMessageId: '   ',
      });
      expect(result.success).toBe(true);

      await vi.waitFor(() => {
        expect(findSendMessageCall()).toBeDefined();
      });

      const [, sendParams] = findSendMessageCall()! as [string, Record<string, unknown>];
      expect(typeof sendParams.userAppMessageId).toBe('string');
      expect((sendParams.userAppMessageId as string).trim().length).toBeGreaterThan(0);
    });

    it('sends the initial message to the daemon-assigned id, only after create resolves', async () => {
      agentsApi.create.mockClear();

      const config: UnifiedAgentConfig = {
        id: 'agent-client-optimistic',
        name: 'Ordered Agent',
        workspaceId: mockWorkspace.id as any,
        initialMessage: 'Hello from the test',
      };

      const result = await factory.createAgent(mockWorkspace, config);
      expect(result.success).toBe(true);

      await vi.waitFor(() => {
        const sendCall = findSendMessageCall();
        expect(sendCall).toBeDefined();
        const [, params] = sendCall! as [string, Record<string, unknown>];
        // The send targets the DAEMON-assigned id — never the optimistic one —
        // so it can no longer race to `-32602 not found: agent session`.
        expect(params.agentId).toBe('agent-daemon-assigned-123');
      });
    });

    it('resets the streaming flag when the transport rejects (BackendError-style JSON-RPC failure)', async () => {
      backendRequestMock.mockRejectedValue(
        new Error('Invalid params: content is required (-32602)'),
      );

      const result = await factory.createAgent(mockWorkspace, {
        name: 'Initial Agent',
        workspaceId: mockWorkspace.id as any,
        initialMessage: 'Initial prompt',
      });
      expect(result.success).toBe(true);

      await vi.waitFor(() => {
        const streamingReset = mockStoreDispatch.mock.calls.find(
          ([action]) =>
            action?.type === 'agentSessions/setAgentStreaming' &&
            action?.payload?.[0] === 'agent-daemon-assigned-123' &&
            action?.payload?.[1] === false,
        );
        expect(streamingReset).toBeDefined();
      });
    });
  });
});
