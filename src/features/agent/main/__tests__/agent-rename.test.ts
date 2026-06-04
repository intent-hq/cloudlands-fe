/**
 * Tests for the lightweight agent-rename helper.
 *
 * Covers both the user-driven rename path (no skipIfExplicitlySet) and the
 * MCP agent-driven path (skipIfExplicitlySet=true). Disk I/O is delegated to
 * `UnifiedPersistence.renameAgent`; these tests mock that method so they
 * assert only the helper's orchestration (validation, delegation, in-memory
 * sync, broadcast). Actual write-queue / checksum behaviour is covered by
 * `unified-persistence-rename.test.ts`.
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

const renameAgent = vi.fn<
  (
    agentId: string,
    workspaceId: string,
    name: string,
    options?: { skipIfExplicitlySet?: boolean; workspacePath?: string },
  ) => Promise<{ ok: boolean; name: string; skipped?: boolean; error?: string }>
>();
const invalidateLoadCache = vi.fn();
vi.mock('../agent-persistence', () => ({
  UnifiedPersistence: {
    getInstance: () => ({ renameAgent, invalidateLoadCache }),
  },
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
    renameAgent.mockReset();
    invalidateLoadCache.mockReset();
    getSession.mockReset();
  });

  it('delegates to UnifiedPersistence.renameAgent, invalidates cache, and broadcasts', async () => {
    renameAgent.mockResolvedValue({ ok: true, name: 'New Name' });
    const session: { name?: string; nameExplicitlySet?: boolean } = { name: 'Old Name' };
    getSession.mockReturnValue(session);

    const { renameAgentOnDisk } = await import('../agent-rename');

    const result = await renameAgentOnDisk({ workspaceId, agentId, name: 'New Name' });

    expect(result).toEqual({ ok: true, name: 'New Name' });
    expect(renameAgent).toHaveBeenCalledWith(agentId, workspaceId, 'New Name', {
      skipIfExplicitlySet: false,
    });
    expect(invalidateLoadCache).toHaveBeenCalledTimes(1);
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
    expect(emitWorkspaceEvent).toHaveBeenCalledWith({
      eventType: 'agent:renamed',
      workspaceId,
      actor: { type: 'user', id: 'user' },
      data: { agentId, workspaceId, name: 'New Name' },
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

  it('passes skipIfExplicitlySet through for the MCP path and honours skipped results', async () => {
    renameAgent.mockResolvedValue({ ok: true, name: 'User Chosen', skipped: true });
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
    expect(renameAgent).toHaveBeenCalledWith(agentId, workspaceId, 'Agent Suggested', {
      skipIfExplicitlySet: true,
    });
    // Skipped path still syncs the in-memory session with the disk name.
    expect(session.name).toBe('User Chosen');
    expect(session.nameExplicitlySet).toBe(true);
    // No broadcast on skip — other windows already have the correct name.
    expect(mainDispatch).not.toHaveBeenCalled();
    // Skipped path must not invalidate the cache (nothing changed on disk).
    expect(invalidateLoadCache).not.toHaveBeenCalled();
  });

  it('throws when the persistence layer reports failure', async () => {
    renameAgent.mockResolvedValue({ ok: false, name: 'New', error: 'disk full' });

    const { renameAgentOnDisk } = await import('../agent-rename');

    await expect(
      renameAgentOnDisk({ workspaceId, agentId, name: 'New' }),
    ).rejects.toThrow('disk full');
    expect(mainDispatch).not.toHaveBeenCalled();
  });

  it('rejects empty and whitespace-only names before touching persistence', async () => {
    const { renameAgentOnDisk } = await import('../agent-rename');

    await expect(renameAgentOnDisk({ workspaceId, agentId, name: '' })).rejects.toThrow(
      'name is required',
    );
    await expect(renameAgentOnDisk({ workspaceId, agentId, name: '   ' })).rejects.toThrow(
      'name must not be empty or whitespace-only',
    );
    expect(renameAgent).not.toHaveBeenCalled();
  });
});
