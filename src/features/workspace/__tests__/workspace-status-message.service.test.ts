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
// PROTOCOL-shaped results instead of reaching the real UDS socket.
vi.mock('../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({
    request: vi.fn(async (method: string) => {
      if (method === 'note.list') return { notes: [] };
      if (method === 'agent.list') return { agents: [] };
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
    const repository = new InMemoryWorkspaceRepository();
    const service = new WorkspaceService(repository);
    const workspace = makeWorkspace();
    await repository.save(workspace);

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
