import { describe, expect, it, vi } from 'vitest';

import { mainDispatch } from '../../../store/main/redux-store-bridge';
import { WorkspaceStatus, type Workspace, type WorkspaceId } from '../../../shared/types';
import { InMemoryWorkspaceRepository } from '../main/workspace.repository';
import { WorkspaceService } from '../main/workspace.service';

vi.mock('../../../store/main/redux-store-bridge', () => ({
  mainDispatch: vi.fn((action: unknown) => action),
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
