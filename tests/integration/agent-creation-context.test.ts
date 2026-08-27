import type { Workspace } from '$shared/types';
import { UnifiedAgentFactory } from '$features/agent/services/agent-factory';
import { initAppStore, store } from '$store/renderer/store';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { backendRequestMock, createAgentMock } = vi.hoisted(() => {
  if (!globalThis.window) {
    Object.defineProperty(globalThis, 'window', { value: {}, writable: true, configurable: true });
  }
  return {
    backendRequestMock: vi.fn(),
    createAgentMock: vi.fn(),
  };
});

vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: backendRequestMock }));
vi.mock('$lib/client', () => ({ appClient: { agents: { create: createAgentMock } } }));

describe('Agent creation with context references', () => {
  let factory: UnifiedAgentFactory;
  let disposeStore: () => void;

  const workspace = {
    id: 'ws-context',
    title: 'Context workspace',
    worktreePath: '/worktrees/context',
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
  } as Workspace;

  beforeAll(() => {
    disposeStore = initAppStore(store).dispose;
    factory = UnifiedAgentFactory.getInstance();
  }, 30_000);

  beforeEach(() => {
    createAgentMock.mockReset();
    backendRequestMock.mockReset();
    createAgentMock.mockResolvedValue({
      id: 'agent-context-daemon',
      backendSessionId: null,
      workspaceId: workspace.id,
      name: 'Context Agent',
      status: 'pending',
      messages: [],
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z',
    });
    backendRequestMock.mockResolvedValue({ success: true, queued: false, messageId: 'msg-1' });
  });

  afterAll(() => {
    disposeStore();
    vi.clearAllMocks();
  });

  it('forwards context references on the initial message without inventing create metadata', async () => {
    const contextReferences = [
      { type: 'file', path: '/src/app.ts' },
      { type: 'note', id: 'note-1' },
    ];
    const result = await factory.createAgent(workspace, {
      workspaceId: workspace.id,
      name: 'Context Agent',
      agentType: 'code-review',
      source: 'contextual-menu',
      initialMessage: 'Review this code',
      contextReferences,
    });

    expect(result).toMatchObject({
      success: true,
      agentId: 'agent-context-daemon',
      agent: { id: 'agent-context-daemon', workspaceId: workspace.id },
    });
    expect(createAgentMock).toHaveBeenCalledWith({
      workspaceId: workspace.id,
      workspacePath: workspace.worktreePath,
      name: 'Context Agent',
      model: undefined,
      provider: undefined,
      agentType: 'code-review',
      prompt: undefined,
      specialist: undefined,
      metadata: { agentType: 'code-review', source: 'contextual-menu' },
      workspaceContext: undefined,
    });
    await vi.waitFor(() => expect(backendRequestMock).toHaveBeenCalledOnce());
    expect(backendRequestMock).toHaveBeenCalledWith('agent.sendMessage', {
      agentId: 'agent-context-daemon',
      workspaceId: workspace.id,
      content: 'Review this code',
      contextReferences,
      imageBlocks: [],
      userAppMessageId: expect.any(String),
    });
  });

  it('omits message transport work when no context or initial message is supplied', async () => {
    const result = await factory.createAgent(workspace, {
      workspaceId: workspace.id,
      name: 'Context Agent',
    });

    expect(result.success).toBe(true);
    expect(createAgentMock).toHaveBeenCalledOnce();
    expect(backendRequestMock).not.toHaveBeenCalled();
  });
});
