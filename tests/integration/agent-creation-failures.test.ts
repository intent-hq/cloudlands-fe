import type { Workspace } from '$shared/types';
import type { UnifiedAgentFactory } from '$features/agent/services/agent-factory';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { createAgentMock } = vi.hoisted(() => ({ createAgentMock: vi.fn() }));
vi.mock('$lib/client', () => ({ appClient: { agents: { create: createAgentMock } } }));

describe('Agent creation failures and recovery', () => {
  let factory: UnifiedAgentFactory;
  let disposeStore: () => void;
  const workspace = {
    id: 'ws-failures',
    title: 'Failure workspace',
    worktreePath: '/worktrees/failures',
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
  } as Workspace;
  const request = {
    workspaceId: workspace.id,
    workspacePath: workspace.worktreePath,
    name: 'Retry Agent',
    model: undefined,
    provider: undefined,
    agentType: undefined,
    prompt: undefined,
    specialist: undefined,
    metadata: { agentType: undefined, source: 'api' },
    workspaceContext: undefined,
  };

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

  beforeEach(() => createAgentMock.mockReset());
  afterAll(() => {
    disposeStore?.();
    vi.clearAllMocks();
  });

  it('rejects a workspace without an id before calling the daemon', async () => {
    const result = await factory.createAgent(null as unknown as Workspace, {
      workspaceId: workspace.id,
      name: 'Retry Agent',
    });

    expect(result).toMatchObject({ success: false, error: expect.stringContaining('workspace') });
    expect(createAgentMock).not.toHaveBeenCalled();
  });

  it('surfaces a daemon failure and permits a later protocol-shaped success', async () => {
    createAgentMock.mockRejectedValueOnce(new Error('provider unavailable')).mockResolvedValueOnce({
      id: 'agent-retry-daemon',
      backendSessionId: null,
      workspaceId: workspace.id,
      name: 'Retry Agent',
      status: 'pending',
      messages: [],
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z',
    });

    const failed = await factory.createAgent(workspace, {
      workspaceId: workspace.id,
      name: 'Retry Agent',
    });
    const recovered = await factory.createAgent(workspace, {
      workspaceId: workspace.id,
      name: 'Retry Agent',
    });

    expect(failed).toMatchObject({ success: false, error: 'provider unavailable' });
    expect(recovered).toMatchObject({ success: true, agentId: 'agent-retry-daemon' });
    expect(createAgentMock).toHaveBeenNthCalledWith(1, request);
    expect(createAgentMock).toHaveBeenNthCalledWith(2, request);
  });
});
