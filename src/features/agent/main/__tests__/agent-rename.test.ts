/**
 * Tests for the lightweight agent-rename helper.
 *
 * Covers both the `skipIfExplicitlySet: false` path (tests only — no
 * production caller today) and the MCP agent-driven path
 * (skipIfExplicitlySet=true). Renames are issued as a
 * single `agent.rename` daemon RPC (PROTOCOL.md §5.5), which enforces the
 * skip-if-explicitly-set guard natively and returns
 * `{ success: true, name, skipped? }`. These tests mock
 * `getBackendClient().request` and assert the exact request-on-wire.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
} from 'vitest';

const { mainDispatch, emitWorkspaceEvent, createWorkspaceEvent } = vi.hoisted(() => ({
  mainDispatch: vi.fn(),
  emitWorkspaceEvent: vi.fn((payload: unknown) => ({
    type: 'workspaceEvents/emitWorkspaceEvent',
    payload,
  })),
  createWorkspaceEvent: vi.fn(
    (eventType: string, workspaceId: string, actor: unknown, data: unknown) => ({
      eventType,
      workspaceId,
      actor,
      data,
    }),
  ),
}));

vi.mock('../../../../store/main/redux-store-bridge', () => ({
  mainDispatch,
}));

vi.mock('../../../../store/main/slices/workspace-events/workspace-events-slice', () => ({
  emitWorkspaceEvent,
}));

vi.mock('$features/events/types', () => ({
  createWorkspaceEvent,
  WorkspaceEventType: { AgentRenamed: 'agent:renamed' },
}));

const mockRequest = vi.fn();
vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: mockRequest }),
}));

describe('renameAgentOnDisk', () => {
  const workspaceId = 'ws-rename-test';
  const agentId = 'agent-rename-1';

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequest.mockReset();
  });

  it('sends a single agent.rename (user path, no guard) and broadcasts', async () => {
    mockRequest.mockResolvedValueOnce({ success: true, name: 'New Name' });

    const { renameAgentOnDisk } = await import('../agent-rename');

    const result = await renameAgentOnDisk({ workspaceId, agentId, name: 'New Name' });

    expect(result).toEqual({ ok: true, name: 'New Name' });
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith('agent.rename', {
      agentId,
      name: 'New Name',
      skipIfExplicitlySet: false,
    });
    expect(createWorkspaceEvent).toHaveBeenCalledWith('agent:renamed', workspaceId, {
      type: 'user',
      id: 'user',
    }, {
      agentId,
      workspaceId,
      name: 'New Name',
    });
    expect(mainDispatch).toHaveBeenCalledWith({
      type: 'workspaceEvents/emitWorkspaceEvent',
      payload: {
        eventType: 'agent:renamed',
        workspaceId,
        actor: { type: 'user', id: 'user' },
        data: { agentId, workspaceId, name: 'New Name' },
      },
    });
  });

  it('maps a skipped agent.rename onto the existing name without broadcasting', async () => {
    mockRequest.mockResolvedValueOnce({
      success: true,
      name: 'User Chosen',
      skipped: true,
    });

    const { renameAgentOnDisk } = await import('../agent-rename');

    const result = await renameAgentOnDisk({
      workspaceId,
      agentId,
      name: 'Agent Suggested',
      skipIfExplicitlySet: true,
    });

    expect(result).toEqual({ ok: true, name: 'User Chosen', skipped: true });
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith('agent.rename', {
      agentId,
      name: 'Agent Suggested',
      skipIfExplicitlySet: true,
    });
    expect(mainDispatch).not.toHaveBeenCalled();
  });

  it('applies a guarded rename when the daemon does not skip', async () => {
    mockRequest.mockResolvedValueOnce({ success: true, name: 'Agent Suggested' });

    const { renameAgentOnDisk } = await import('../agent-rename');

    const result = await renameAgentOnDisk({
      workspaceId,
      agentId,
      name: 'Agent Suggested',
      skipIfExplicitlySet: true,
    });

    expect(result).toEqual({ ok: true, name: 'Agent Suggested' });
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith('agent.rename', {
      agentId,
      name: 'Agent Suggested',
      skipIfExplicitlySet: true,
    });
    expect(mainDispatch).toHaveBeenCalledTimes(1);
  });

  it('throws when the daemon rejects agent.rename', async () => {
    mockRequest.mockRejectedValueOnce(new Error('daemon offline'));

    const { renameAgentOnDisk } = await import('../agent-rename');

    await expect(
      renameAgentOnDisk({ workspaceId, agentId, name: 'New' }),
    ).rejects.toThrow('daemon offline');
    expect(mainDispatch).not.toHaveBeenCalled();
  });

  it('rejects empty and whitespace-only names before touching the daemon', async () => {
    const { renameAgentOnDisk } = await import('../agent-rename');

    await expect(renameAgentOnDisk({ workspaceId, agentId, name: '' })).rejects.toThrow(
      'name is required',
    );
    await expect(renameAgentOnDisk({ workspaceId, agentId, name: '   ' })).rejects.toThrow(
      'name must not be empty or whitespace-only',
    );
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
