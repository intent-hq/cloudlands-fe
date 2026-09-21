/**
 * Workspace operation integration coverage against a PROTOCOL-shaped daemon.
 * The daemon owns creation and filesystem/worktree lifecycle; this suite keeps
 * the FE service integration focused on the supported workspace.* wire paths.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceService } from '../../src/features/workspace/main/workspace.service';
import { InMemoryWorkspaceRepository } from '../../src/features/workspace/main/workspace.repository';
import { WorkspaceStatus, type Workspace, type WorkspaceId } from '../../src/shared/types';

const backend = vi.hoisted(() => {
  const workspaces = new Map<string, Record<string, unknown>>();
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    const workspaceId = String(params?.workspaceId ?? '');
    if (method === 'agent.list') return { agents: [] };
    if (method === 'note.list') return { notes: [] };
    if (method === 'settings.get') return { value: {} };
    if (method === 'workspace.list') return { workspaces: [...workspaces.values()] };
    if (method === 'workspace.get') {
      const workspace = workspaces.get(workspaceId);
      if (!workspace) throw new Error('Workspace not found');
      return { workspace };
    }
    if (method === 'workspace.update') {
      const current = workspaces.get(workspaceId);
      if (!current) throw new Error('Workspace not found');
      const { workspaceId: _ignored, ...changes } = params ?? {};
      const workspace = { ...current, ...changes, updatedAt: '2026-01-02T00:00:00.000Z' };
      workspaces.set(workspaceId, workspace);
      return { workspace };
    }
    if (method === 'workspace.duplicate') {
      const current = workspaces.get(workspaceId);
      if (!current) throw new Error('Workspace not found');
      const workspace = {
        ...current,
        id: `${workspaceId}-copy`,
        title: params?.newTitle,
        branch: `${workspaceId}-copy`,
      };
      workspaces.set(String(workspace.id), workspace);
      return { workspace };
    }
    if (method === 'workspace.archive') {
      const current = workspaces.get(workspaceId);
      const workspace = { ...current, status: WorkspaceStatus.Archived, archived: true };
      workspaces.set(workspaceId, workspace);
      return { workspace };
    }
    if (method === 'workspace.unarchive') {
      const current = workspaces.get(workspaceId);
      const workspace = { ...current, status: WorkspaceStatus.Active, archived: false };
      workspaces.set(workspaceId, workspace);
      return { workspace };
    }
    if (method === 'workspace.delete') {
      workspaces.delete(workspaceId);
      return { success: true };
    }
    throw new Error(`Unexpected method: ${method}`);
  });
  return { request, workspaces };
});

vi.mock('../../src/features/backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: backend.request }),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('../../src/store/main/redux-store-bridge', () => ({
  mainDispatch: vi.fn((action: unknown) => action),
}));

function createWorkspace(): Workspace {
  return {
    id: 'ws-integration' as WorkspaceId,
    title: 'Integration Workspace',
    branch: 'workspace-integration',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('Workspace Operations Integration Tests', () => {
  let workspaceService: WorkspaceService;
  let workspace: Workspace;

  beforeEach(() => {
    backend.request.mockClear();
    backend.workspaces.clear();
    workspace = createWorkspace();
    backend.workspaces.set(workspace.id, { ...workspace });
    workspaceService = new WorkspaceService(new InMemoryWorkspaceRepository());
  });

  afterEach(() => workspaceService.cleanup());

  it('updates and lists daemon-owned workspace metadata', async () => {
    const update = await workspaceService.updateWorkspace({ id: workspace.id, title: 'Updated' });
    const list = await workspaceService.listWorkspaces();

    expect(update.ok && update.data.title === 'Updated').toBe(true);
    expect(list.ok && list.data.workspaces.some(({ title }) => title === 'Updated')).toBe(true);
    expect(backend.request.mock.calls).toContainEqual([
      'workspace.update',
      { workspaceId: workspace.id, title: 'Updated' },
    ]);
    expect(backend.request.mock.calls.filter(([method]) => method === 'workspace.list')).toEqual([
      ['workspace.list', { includeArchived: false }],
    ]);
  });

  it('duplicates a workspace through the daemon', async () => {
    const result = await workspaceService.duplicateWorkspace(workspace.id, 'Copy');

    expect(result.ok && result.data.title === 'Copy').toBe(true);
    expect(backend.request.mock.calls).toContainEqual([
      'workspace.duplicate',
      { workspaceId: workspace.id, newTitle: 'Copy' },
    ]);
  });

  it('archives and unarchives a workspace through the daemon', async () => {
    const archived = await workspaceService.archiveWorkspace(workspace.id);
    const unarchived = await workspaceService.unarchiveWorkspace(workspace.id);

    expect(archived.ok && archived.data.status).toBe(WorkspaceStatus.Archived);
    expect(unarchived.ok && unarchived.data.status).toBe(WorkspaceStatus.Active);
    expect(backend.request.mock.calls.filter(([method]) => method === 'workspace.archive')).toEqual(
      [['workspace.archive', { workspaceId: workspace.id }]],
    );
    expect(
      backend.request.mock.calls.filter(([method]) => method === 'workspace.unarchive'),
    ).toEqual([['workspace.unarchive', { workspaceId: workspace.id }]]);
  });

  it('deletes a workspace through the daemon', async () => {
    const result = await workspaceService.deleteWorkspace(workspace.id);

    expect(result.ok).toBe(true);
    expect(backend.request.mock.calls).toContainEqual([
      'workspace.delete',
      { workspaceId: workspace.id },
    ]);
    expect(backend.workspaces.has(workspace.id)).toBe(false);
  });
});
