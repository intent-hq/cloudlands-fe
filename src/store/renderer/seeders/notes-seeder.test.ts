import { describe, expect, it, vi } from 'vitest';
import { Store } from '$lib/store-shim/svelte-store';
import type { AppClient } from '$lib/client';
import { WorkspaceStatusEnum, type Workspace } from '$shared/types';
import { reducers } from '../reducer';
import { seedMockStore } from '../mock-bootstrap';
import { replaceWorkspaceList, setActiveWorkspaceId } from '../slices/workspace/workspace-slice';
import './notes-seeder';

const workspace = {
  id: 'ws-1',
  title: 'Workspace',
  branch: 'main',
  status: WorkspaceStatusEnum.Active,
  changesets: [],
  timeline: [],
  conversationInfo: [],
  createdAt: '2026-08-07T00:00:00.000Z',
  updatedAt: '2026-08-07T00:00:00.000Z',
} as Workspace;

describe('notes-seeder', () => {
  it('defers workspace hydration to workspaceMounted without making bootstrap requests', async () => {
    const store = new Store(reducers, []);
    store.init();
    store.dispatch(
      replaceWorkspaceList([workspace, { ...workspace, id: 'ws-inactive' } as Workspace]),
    );
    store.dispatch(setActiveWorkspaceId('ws-1'));

    const workspaceList = vi.fn().mockRejectedValue(new Error('workspace.list timed out'));
    const notesList = vi.fn().mockResolvedValue([]);
    const tasksList = vi.fn().mockResolvedValue({ tasks: [], stats: {} });
    const client = {
      workspaces: { list: workspaceList },
      notes: { list: notesList },
      tasks: { list: tasksList },
      comments: { list: vi.fn() },
    } as unknown as AppClient;

    await expect(seedMockStore(store, client)).resolves.toBeUndefined();

    expect(workspaceList).not.toHaveBeenCalled();
    expect(notesList).not.toHaveBeenCalled();
    expect(tasksList).not.toHaveBeenCalled();
    expect(client.comments.list).not.toHaveBeenCalled();
  });
});
