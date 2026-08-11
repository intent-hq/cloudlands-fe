import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppClient } from '$lib/client';
import { Store } from '$lib/store-shim/svelte-store';
import { WorkspaceStatusEnum, type Workspace } from '$shared/types';
import { reducers } from '../reducer';
import { replaceWorkspaceList, setActiveWorkspaceId } from '../slices/workspace/workspace-slice';
import { clearMockSeeders, seedMockStore } from '../mock-bootstrap';

describe('files-git-seeder', () => {
  beforeEach(() => clearMockSeeders());

  it('defers workspace hydration without making bootstrap requests', async () => {
    const store = new Store(reducers, []);
    store.init();
    store.dispatch(
      replaceWorkspaceList(
        ['ws-1', 'ws-inactive'].map(
          (id) =>
            ({
              id,
              title: 'Workspace',
              branch: 'main',
              status: WorkspaceStatusEnum.Active,
              changesets: [],
              timeline: [],
              conversationInfo: [],
              createdAt: '2026-08-07T00:00:00.000Z',
              updatedAt: '2026-08-07T00:00:00.000Z',
            }) as Workspace,
        ),
      ),
    );
    store.dispatch(setActiveWorkspaceId('ws-1'));
    const client = {
      workspaces: { list: vi.fn().mockRejectedValue(new Error('workspace.list timed out')) },
      files: { explorerTree: vi.fn().mockRejectedValue(new Error('tree boom')) },
      git: {
        status: vi.fn().mockResolvedValue(null),
        diffs: vi.fn().mockResolvedValue([]),
        trackedChanges: vi.fn().mockResolvedValue([]),
        commitsWithBoundary: vi.fn().mockResolvedValue({ commits: [], boundarySha: null }),
        prStatus: vi.fn().mockResolvedValue(null),
      },
    } as unknown as AppClient;

    await import('./files-git-seeder');

    await expect(seedMockStore(store, client)).resolves.toBeUndefined();
    expect(client.workspaces.list).not.toHaveBeenCalled();
    expect(client.files.explorerTree).not.toHaveBeenCalled();
    expect(client.git.status).not.toHaveBeenCalled();
    expect(store.state.fileExplorer.byWorkspaceId['ws-1']).toBeUndefined();
  });
});
