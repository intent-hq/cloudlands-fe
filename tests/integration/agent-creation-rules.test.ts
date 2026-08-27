import type { Workspace } from '$shared/types';
import { UnifiedAgentFactory } from '$features/agent/services/agent-factory';
import { initAppStore, store } from '$store/renderer/store';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { createAgentMock } = vi.hoisted(() => {
  if (!globalThis.window) {
    Object.defineProperty(globalThis, 'window', { value: {}, writable: true, configurable: true });
  }
  return { createAgentMock: vi.fn() };
});
vi.mock('$lib/client', () => ({ appClient: { agents: { create: createAgentMock } } }));

describe('Daemon-owned agent rules', () => {
  let factory: UnifiedAgentFactory;
  let disposeStore: () => void;
  const workspace = {
    id: 'ws-rules',
    title: 'Rules workspace',
    worktreePath: '/worktrees/rules',
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
  } as Workspace;

  beforeAll(() => {
    disposeStore = initAppStore(store).dispose;
    factory = UnifiedAgentFactory.getInstance();
  }, 30_000);

  beforeEach(() => {
    createAgentMock.mockReset();
    createAgentMock.mockResolvedValue({
      id: 'agent-rules-daemon',
      backendSessionId: null,
      workspaceId: workspace.id,
      name: 'Rules Agent',
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

  it('forwards agent type and behavior prompt for daemon-side instruction assembly', async () => {
    const result = await factory.createAgent(workspace, {
      workspaceId: workspace.id,
      name: 'Rules Agent',
      agentType: 'code-review',
      behaviorPrompt: 'Focus on correctness',
      source: 'contextual-menu',
    });

    expect(result).toMatchObject({
      success: true,
      agentId: 'agent-rules-daemon',
      agent: { metadata: { agentType: 'code-review' } },
    });
    expect(result.agent).not.toHaveProperty('systemPrompt');
    expect(createAgentMock).toHaveBeenCalledWith({
      workspaceId: workspace.id,
      workspacePath: workspace.worktreePath,
      name: 'Rules Agent',
      model: undefined,
      provider: undefined,
      agentType: 'code-review',
      prompt: 'Focus on correctness',
      specialist: undefined,
      metadata: { agentType: 'code-review', source: 'contextual-menu' },
      workspaceContext: undefined,
    });
  });

  it('does not send a legacy frontend-built system prompt', async () => {
    await factory.createAgent(workspace, {
      workspaceId: workspace.id,
      name: 'Rules Agent',
      agentType: 'workspace',
      systemPrompt: 'Frontend rules must not reach the daemon',
    });

    expect(createAgentMock).toHaveBeenCalledWith({
      workspaceId: workspace.id,
      workspacePath: workspace.worktreePath,
      name: 'Rules Agent',
      model: undefined,
      provider: undefined,
      agentType: 'workspace',
      prompt: undefined,
      specialist: undefined,
      metadata: { agentType: 'workspace', source: 'api' },
      workspaceContext: undefined,
    });
  });
});
