import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  update: vi.fn(),
  toastError: vi.fn(),
  state: { workspace: { workspaces: { map: {} as Record<string, Workspace> } } },
}));

vi.mock('$store/renderer/store', () => ({
  store: {
    dispatch: mocks.dispatch,
    get state() {
      return mocks.state;
    },
  },
}));

vi.mock('$store/renderer/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: { update: mocks.update },
}));

vi.mock('svelte-sonner', () => ({
  toast: { error: mocks.toastError },
}));

import { renameWorkspaceTitle } from './rename-workspace-title';
import { resetWorkspaceTitleMutationsForTests } from './workspace-title-mutation-registry';

const workspace = {
  id: 'ws-1',
  title: 'Original title',
  status: WorkspaceStatusEnum.Active,
  createdAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:00:00.000Z',
  changesets: [],
  timeline: [],
  conversationInfo: [],
} as Workspace;

describe('renameWorkspaceTitle', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.update.mockReset();
    mocks.toastError.mockReset();
    mocks.state.workspace.workspaces.map = { [workspace.id]: workspace };
    mocks.dispatch.mockImplementation((action) => {
      if (action.type === 'workspace/bulkUpdateWorkspaceEntities') {
        for (const update of action.payload[0]) {
          const [workspaceId, changes] = update.payload;
          const current = mocks.state.workspace.workspaces.map[workspaceId];
          if (current)
            mocks.state.workspace.workspaces.map[workspaceId] = { ...current, ...changes };
        }
      } else if (action.type === 'workspace/setWorkspaceEntity') {
        const updated = action.payload[0] as Workspace;
        mocks.state.workspace.workspaces.map[updated.id] = updated;
      }
    });
  });

  afterEach(resetWorkspaceTitleMutationsForTests);

  it('updates the list immediately, sends the exact request, and reconciles the response', async () => {
    const updated = { ...workspace, title: 'Renamed title' };
    mocks.update.mockResolvedValue({ ok: true, data: updated });

    await expect(renameWorkspaceTitle(workspace, 'Renamed title')).resolves.toEqual({ ok: true });

    expect(mocks.update).toHaveBeenCalledWith({ id: 'ws-1', title: 'Renamed title' });
    expect(mocks.dispatch.mock.calls.map(([action]) => action)).toEqual([
      {
        type: 'workspace/bulkUpdateWorkspaceEntities',
        payload: [
          [
            {
              type: 'workspace/updateWorkspaceEntity',
              payload: ['ws-1', { title: 'Renamed title' }],
            },
          ],
        ],
      },
      { type: 'workspace/setWorkspaceEntity', payload: [updated] },
    ]);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('rolls back only the title when the daemon rejects the rename', async () => {
    mocks.update.mockResolvedValue({ ok: false, error: 'Rename rejected' });

    await expect(renameWorkspaceTitle(workspace, 'Rejected title')).resolves.toEqual({
      ok: false,
      error: 'Rename rejected',
    });

    const actions = mocks.dispatch.mock.calls.map(([action]) => action);
    expect(actions.at(-1)).toEqual({
      type: 'workspace/bulkUpdateWorkspaceEntities',
      payload: [
        [
          {
            type: 'workspace/updateWorkspaceEntity',
            payload: ['ws-1', { title: 'Original title' }],
          },
        ],
      ],
    });
    expect(mocks.toastError).toHaveBeenCalledWith('Rename rejected');
  });

  it('keeps the newer optimistic title when an older success resolves last', async () => {
    let resolveFirst!: (value: { ok: true; data: Workspace }) => void;
    let resolveSecond!: (value: { ok: true; data: Workspace }) => void;
    mocks.update
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockReturnValueOnce(new Promise((resolve) => (resolveSecond = resolve)));

    const first = renameWorkspaceTitle(workspace, 'First title');
    const second = renameWorkspaceTitle({ ...workspace, title: 'First title' }, 'Second title');
    resolveFirst({ ok: true, data: { ...workspace, title: 'First title' } });
    await first;

    expect(mocks.state.workspace.workspaces.map[workspace.id]?.title).toBe('Second title');
    expect(mocks.toastError).not.toHaveBeenCalled();

    resolveSecond({ ok: true, data: { ...workspace, title: 'Second title' } });
    await second;
    expect(mocks.state.workspace.workspaces.map[workspace.id]?.title).toBe('Second title');
    expect(mocks.update.mock.calls).toEqual([
      [{ id: 'ws-1', title: 'First title' }],
      [{ id: 'ws-1', title: 'Second title' }],
    ]);
  });

  it('ignores an older failure and rolls back only the latest failed title', async () => {
    let resolveFirst!: (value: { ok: false; error: string }) => void;
    let resolveSecond!: (value: { ok: false; error: string }) => void;
    mocks.update
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockReturnValueOnce(new Promise((resolve) => (resolveSecond = resolve)));

    const first = renameWorkspaceTitle(workspace, 'First title');
    const second = renameWorkspaceTitle({ ...workspace, title: 'First title' }, 'Second title');
    resolveFirst({ ok: false, error: 'Old failure' });
    await first;

    expect(mocks.state.workspace.workspaces.map[workspace.id]?.title).toBe('Second title');
    expect(mocks.toastError).not.toHaveBeenCalled();

    resolveSecond({ ok: false, error: 'Current failure' });
    await second;
    expect(mocks.state.workspace.workspaces.map[workspace.id]?.title).toBe('First title');
    expect(mocks.toastError).toHaveBeenCalledOnce();
    expect(mocks.toastError).toHaveBeenCalledWith('Current failure');
  });

  it('handles thrown client errors with a localized fallback', async () => {
    mocks.update.mockRejectedValue(new Error('transport detail'));

    await expect(renameWorkspaceTitle(workspace, 'Failed title')).resolves.toEqual({
      ok: false,
      error: 'Failed to update workspace',
    });
    expect(mocks.state.workspace.workspaces.map[workspace.id]?.title).toBe('Original title');
    expect(mocks.toastError).toHaveBeenCalledWith('Failed to update workspace');
  });

  it('uses the localized fallback for blank daemon errors and non-Error rejections', async () => {
    mocks.update.mockResolvedValueOnce({ ok: false, error: '  ' });
    await expect(renameWorkspaceTitle(workspace, 'Blank failure')).resolves.toEqual({
      ok: false,
      error: 'Failed to update workspace',
    });

    mocks.update.mockRejectedValueOnce('offline');
    await expect(renameWorkspaceTitle(workspace, 'Thrown failure')).resolves.toEqual({
      ok: false,
      error: 'Failed to update workspace',
    });
    expect(mocks.toastError).toHaveBeenCalledTimes(2);
  });

  it('does not roll back an unrelated title that replaced the optimistic value', async () => {
    let resolveUpdate!: (value: { ok: false; error: string }) => void;
    mocks.update.mockReturnValue(new Promise((resolve) => (resolveUpdate = resolve)));
    const rename = renameWorkspaceTitle(workspace, 'Optimistic title');
    mocks.state.workspace.workspaces.map[workspace.id] = { ...workspace, title: 'External title' };

    resolveUpdate({ ok: false, error: 'Rename rejected' });
    await rename;

    expect(mocks.state.workspace.workspaces.map[workspace.id]?.title).toBe('External title');
  });

  it('resolves the failure result even when the toast implementation throws', async () => {
    mocks.update.mockResolvedValue({ ok: false, error: 'Rename rejected' });
    mocks.toastError.mockImplementationOnce(() => {
      throw new Error('toast unavailable');
    });

    await expect(renameWorkspaceTitle(workspace, 'Rejected title')).resolves.toEqual({
      ok: false,
      error: 'Rename rejected',
    });
  });
});
