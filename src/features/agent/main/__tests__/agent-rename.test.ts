/**
 * Tests for the lightweight agent-rename helper.
 *
 * Covers both the user-driven rename path (no skipIfExplicitlySet) and the
 * MCP agent-driven path (skipIfExplicitlySet=true). Disk I/O is delegated to
 * `daemonAgentBridge.saveAgent` (which maps to `agent.update`, PROTOCOL.md
 * §5.5); these tests mock that method so they assert only the helper's
 * orchestration (validation, delegation, in-memory sync, broadcast).
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

const saveAgent = vi.fn<
  (agent: { id: string; workspaceId: string; name?: string; nameExplicitlySet?: boolean }) =>
    Promise<{ success: boolean; error?: string }>
>();
const loadAgentSummary = vi.fn<
  (agentId: string, workspaceId: string) => Promise<{
    success: boolean;
    data?: { name?: string; nameExplicitlySet?: boolean };
    error?: string;
  }>
>();
vi.mock('../daemon-agent-bridge', () => ({
  daemonAgentBridge: { saveAgent, loadAgentSummary },
}));

const getSession = vi.fn();
vi.mock('../consolidated-backend.service', () => ({
  ConsolidatedBackendService: {
    getInstance: () => ({ getSession }),
  },
}));

describe('renameAgentOnDisk', () => {
  const workspaceId = 'ws-rename-test';
  const agentId = 'agent-rename-1';

  beforeEach(() => {
    vi.clearAllMocks();
    saveAgent.mockReset();
    loadAgentSummary.mockReset();
    getSession.mockReset();
  });

  it('delegates to daemonAgentBridge.saveAgent and broadcasts', async () => {
    saveAgent.mockResolvedValue({ success: true });
    const session: { name?: string; nameExplicitlySet?: boolean } = { name: 'Old Name' };
    getSession.mockReturnValue(session);

    const { renameAgentOnDisk } = await import('../agent-rename');

    const result = await renameAgentOnDisk({ workspaceId, agentId, name: 'New Name' });

    expect(result).toEqual({ ok: true, name: 'New Name' });
    expect(loadAgentSummary).not.toHaveBeenCalled();
    expect(saveAgent).toHaveBeenCalledWith({
      id: agentId,
      workspaceId,
      name: 'New Name',
      nameExplicitlySet: true,
    });
    expect(session.name).toBe('New Name');
    expect(session.nameExplicitlySet).toBe(true);
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

  it('honours skipIfExplicitlySet by consulting the daemon summary first', async () => {
    loadAgentSummary.mockResolvedValue({
      success: true,
      data: { name: 'User Chosen', nameExplicitlySet: true },
    });
    const session: { name?: string; nameExplicitlySet?: boolean } = { name: 'Old' };
    getSession.mockReturnValue(session);

    const { renameAgentOnDisk } = await import('../agent-rename');

    const result = await renameAgentOnDisk({
      workspaceId,
      agentId,
      name: 'Agent Suggested',
      skipIfExplicitlySet: true,
    });

    expect(result).toEqual({ ok: true, name: 'User Chosen', skipped: true });
    expect(loadAgentSummary).toHaveBeenCalledWith(agentId, workspaceId);
    expect(saveAgent).not.toHaveBeenCalled();
    expect(session.name).toBe('User Chosen');
    expect(session.nameExplicitlySet).toBe(true);
    expect(mainDispatch).not.toHaveBeenCalled();
  });

  it('throws when the daemon reports a save failure', async () => {
    saveAgent.mockResolvedValue({ success: false, error: 'daemon offline' });

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
    expect(saveAgent).not.toHaveBeenCalled();
    expect(loadAgentSummary).not.toHaveBeenCalled();
  });
});
