/**
 * Tests for the lightweight agent-rename helper.
 *
 * Covers both the user-driven rename path (no skipIfExplicitlySet) and the
 * MCP agent-driven path (skipIfExplicitlySet=true). Disk I/O is issued as
 * direct daemon RPCs (`agent.get` for the existence check, `agent.update`
 * for the whitelisted patch — PROTOCOL.md §5.5). These tests mock
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

  it('sends agent.update with the whitelisted patch and broadcasts', async () => {
    mockRequest.mockResolvedValueOnce({ success: true });

    const { renameAgentOnDisk } = await import('../agent-rename');

    const result = await renameAgentOnDisk({ workspaceId, agentId, name: 'New Name' });

    expect(result).toEqual({ ok: true, name: 'New Name' });
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith('agent.update', {
      agentId,
      workspaceId,
      changes: { name: 'New Name', nameExplicitlySet: true },
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

  it('honours skipIfExplicitlySet by consulting agent.get first', async () => {
    mockRequest.mockResolvedValueOnce({
      agent: { name: 'User Chosen', nameExplicitlySet: true },
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
    expect(mockRequest).toHaveBeenCalledWith('agent.get', { agentId, workspaceId });
    expect(mainDispatch).not.toHaveBeenCalled();
  });

  it('proceeds with agent.update when skipIfExplicitlySet and existing name is not locked', async () => {
    mockRequest
      .mockResolvedValueOnce({ agent: { name: 'Auto Name', nameExplicitlySet: false } })
      .mockResolvedValueOnce({ success: true });

    const { renameAgentOnDisk } = await import('../agent-rename');

    const result = await renameAgentOnDisk({
      workspaceId,
      agentId,
      name: 'Agent Suggested',
      skipIfExplicitlySet: true,
    });

    expect(result).toEqual({ ok: true, name: 'Agent Suggested' });
    expect(mockRequest).toHaveBeenNthCalledWith(1, 'agent.get', { agentId, workspaceId });
    expect(mockRequest).toHaveBeenNthCalledWith(2, 'agent.update', {
      agentId,
      workspaceId,
      changes: { name: 'Agent Suggested', nameExplicitlySet: true },
    });
  });

  it('throws when the daemon rejects agent.update', async () => {
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
