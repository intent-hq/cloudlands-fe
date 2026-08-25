import type { Workspace } from '$shared/types';
import type { UnifiedAgentFactory } from '$features/agent/services/agent-factory';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { createAgentMock } = vi.hoisted(() => ({ createAgentMock: vi.fn() }));
vi.mock('$lib/client', () => ({ appClient: { agents: { create: createAgentMock } } }));

describe('Manual agent creation entry points', () => {
  let factory: UnifiedAgentFactory;
  let disposeStore: () => void;
  const workspace = {
    id: 'ws-manual',
    title: 'Manual workspace',
    worktreePath: '/worktrees/manual',
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
      id: 'agent-manual-daemon',
      backendSessionId: null,
      workspaceId: workspace.id,
      name: 'Manual Agent',
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

  it.each([
    ['workspace-page', 'opus4.1'],
    ['workspace-sidebar', undefined],
  ] as const)('forwards the %s entry point with its selected model', async (source, model) => {
    const result = await factory.createAgent(workspace, {
      workspaceId: workspace.id,
      name: 'Manual Agent',
      source,
      model,
    });

    expect(result).toMatchObject({
      success: true,
      agentId: 'agent-manual-daemon',
      agent: { workspaceId: workspace.id, model, metadata: { source } },
    });
    expect(createAgentMock).toHaveBeenCalledWith({
      workspaceId: workspace.id,
      workspacePath: workspace.worktreePath,
      name: 'Manual Agent',
      model,
      provider: undefined,
      agentType: undefined,
      prompt: undefined,
      specialist: undefined,
      metadata: { agentType: undefined, source },
      workspaceContext: undefined,
    });
  });
});
