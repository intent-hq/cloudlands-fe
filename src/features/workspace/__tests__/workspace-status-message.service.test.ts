import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { mainDispatch } from '../../../store/main/redux-store-bridge';
import {
  WorkspaceStatus,
  type Workspace,
  type WorkspaceId,
} from '../../../shared/types';
import { InMemoryWorkspaceRepository } from '../main/workspace.repository';
import { WorkspaceService } from '../main/workspace.service';

vi.mock('../../../store/main/redux-store-bridge', () => ({
  mainDispatch: vi.fn((action: unknown) => action),
}));

// Stub the daemon client so WorkspaceService's activity-repair path
// (`note.list` / `agent.list` per PROTOCOL.md §5.4/§5.5) resolves to empty
// PROTOCOL-shaped results instead of reaching the real UDS socket. Also
// serves the `workspace.get` / `workspace.update` calls the write path
// now delegates to the daemon.
const workspaceStore = new Map<string, Record<string, unknown>>();
vi.mock('../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({
    request: vi.fn(async (method: string, params: unknown) => {
      if (method === 'note.list') return { notes: [] };
      if (method === 'agent.list') return { agents: [] };
      const workspaceId =
        params && typeof params === 'object' && 'workspaceId' in params
          ? String((params as { workspaceId?: unknown }).workspaceId ?? '')
          : '';
      if (method === 'workspace.get') {
        const ws = workspaceStore.get(workspaceId);
        if (!ws) throw new Error('Workspace not found');
        return { workspace: ws };
      }
      if (method === 'workspace.update') {
        const existing = workspaceStore.get(workspaceId);
        if (!existing) throw new Error('Workspace not found');
        const { workspaceId: _wid, ...updates } = (params ?? {}) as Record<string, unknown>;
        const next = { ...existing, ...updates, updatedAt: new Date().toISOString() };
        workspaceStore.set(workspaceId, next);
        return { workspace: next };
      }
      return {};
    }),
  }),
}));

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  const now = new Date().toISOString();

  return {
    id: 'amber-forest' as WorkspaceId,
    title: 'Status Test Workspace',
    branch: 'status-test',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('WorkspaceService statusMessage updates', () => {
  it('stores statusMessage without changing lifecycle status', async () => {
    workspaceStore.clear();
    const repository = new InMemoryWorkspaceRepository();
    const service = new WorkspaceService(repository);
    const workspace = makeWorkspace();
    await repository.save(workspace);
    workspaceStore.set(workspace.id, { ...workspace });

    const result = await service.updateWorkspace({
      id: workspace.id,
      statusMessage: 'Investigating verification results.',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe(WorkspaceStatus.Active);
      expect(result.data.statusMessage).toBe('Investigating verification results.');
    }
    expect(mainDispatch).toHaveBeenCalled();

    service.cleanup();
  });
});
