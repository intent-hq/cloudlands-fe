import type { Workspace } from '$shared/types';
import { AgentStatus } from '$shared/types';
import type { UnifiedAgentFactory } from '$features/agent/services/agent-factory';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { createAgentMock } = vi.hoisted(() => ({ createAgentMock: vi.fn() }));
vi.mock('$lib/client', () => ({ appClient: { agents: { create: createAgentMock } } }));

describe('Initial agent creation', () => {
  let factory: UnifiedAgentFactory;
  let disposeStore: () => void;
  const workspace = {
    id: 'ws-initial',
    title: 'Initial workspace',
    worktreePath: '/worktrees/initial',
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
  } as Workspace;

  beforeAll(async () => {
    if (!globalThis.window) {
      Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
    }
    const [{ UnifiedAgentFactory }, { initAppStore, store }] = await Promise.all([
      import('$features/agent/services/agent-factory'),
      import('$store/renderer/store'),
    ]);
    disposeStore = initAppStore(store).dispose;
    factory = UnifiedAgentFactory.getInstance();
  }, 30_000);

  beforeEach(() => {
    createAgentMock.mockReset();
    createAgentMock.mockResolvedValue({
      id: 'agent-initial-daemon',
      backendSessionId: null,
      workspaceId: workspace.id,
      name: 'Initial Workspace Agent',
      status: 'pending',
      messages: [],
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z',
    });
  });
  afterAll(() => {
    disposeStore?.();
    vi.clearAllMocks();
  });

  it('creates the initializer session through the daemon and records its source', async () => {
    const result = await factory.createAgent(workspace, {
      workspaceId: workspace.id,
      name: 'Initial Workspace Agent',
      agentType: 'workspace',
      source: 'workspace-initializer',
    });

    expect(result).toMatchObject({
      success: true,
      agentId: 'agent-initial-daemon',
      agent: {
        id: 'agent-initial-daemon',
        workspaceId: workspace.id,
        status: AgentStatus.Idle,
        metadata: { agentType: 'workspace', source: 'workspace-initializer' },
      },
    });
    expect(createAgentMock).toHaveBeenCalledWith({
      workspaceId: workspace.id,
      workspacePath: workspace.worktreePath,
      name: 'Initial Workspace Agent',
      model: undefined,
      provider: undefined,
      agentType: 'workspace',
      prompt: undefined,
      specialist: undefined,
      metadata: { agentType: 'workspace', source: 'workspace-initializer' },
      workspaceContext: undefined,
    });
  });
});
