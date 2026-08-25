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

describe('Agent creation model forwarding', () => {
  let factory: UnifiedAgentFactory;
  let disposeStore: () => void;
  const workspace = {
    id: 'ws-models',
    title: 'Model workspace',
    worktreePath: '/worktrees/models',
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
  } as Workspace;

  beforeAll(() => {
    disposeStore = initAppStore(store).dispose;
    factory = UnifiedAgentFactory.getInstance();
  }, 30_000);

  beforeEach(() => {
    createAgentMock.mockReset();
    createAgentMock.mockImplementation(async (request: { workspaceId: string; name?: string }) => ({
      id: 'agent-model-daemon',
      backendSessionId: null,
      workspaceId: request.workspaceId,
      name: request.name ?? 'Agent',
      status: 'pending',
      messages: [],
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z',
    }));
  });
  afterAll(() => {
    disposeStore?.();
    vi.clearAllMocks();
  });

  it.each(['haiku4.5', 'sonnet4.5', 'opus4.1'])('forwards explicit model %s', async (model) => {
    const normalizedName = `${model[0].toUpperCase()}${model.slice(1)} Agent`;
    const result = await factory.createAgent(workspace, {
      workspaceId: workspace.id,
      name: `${model} Agent`,
      model,
    });

    expect(result).toMatchObject({
      success: true,
      agentId: 'agent-model-daemon',
      agent: { model },
    });
    expect(createAgentMock).toHaveBeenCalledWith({
      workspaceId: workspace.id,
      workspacePath: workspace.worktreePath,
      name: normalizedName,
      model,
      provider: undefined,
      agentType: undefined,
      prompt: undefined,
      specialist: undefined,
      metadata: { agentType: undefined, source: 'api' },
      workspaceContext: undefined,
    });
  });

  it('omits the model so the daemon can resolve its default', async () => {
    const result = await factory.createAgent(workspace, {
      workspaceId: workspace.id,
      name: 'Default Model Agent',
    });

    expect(result).toMatchObject({ success: true, agent: { model: undefined } });
    expect(createAgentMock).toHaveBeenCalledWith({
      workspaceId: workspace.id,
      workspacePath: workspace.worktreePath,
      name: 'Default Model Agent',
      model: undefined,
      provider: undefined,
      agentType: undefined,
      prompt: undefined,
      specialist: undefined,
      metadata: { agentType: undefined, source: 'api' },
      workspaceContext: undefined,
    });
  });
});
