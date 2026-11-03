import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stored: new Set<string>(),
  dispatch: vi.fn(),
  show: vi.fn(async () => true),
  open: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock('$lib/components/patterns/notify', () => ({ notify: { error: mocks.notifyError } }));
vi.mock('$lib/utils/show-workspace', () => ({ openAndShowWorkspace: mocks.show }));
vi.mock('$store/renderer/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: { open: mocks.open },
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: {
    select: (_state: unknown, id: string) => (mocks.stored.has(id) ? { id } : undefined),
  },
}));
vi.mock('$store/renderer/slices/workspace/workspace-slice', () => ({
  setWorkspaceEntity: (workspace: unknown) => ({ type: 'workspace/set', payload: [workspace] }),
}));
vi.mock('$store/renderer/store', () => ({ store: { state: {}, dispatch: mocks.dispatch } }));

import { openCreatedWorkspace } from './open-created-workspace';

beforeEach(() => {
  mocks.stored.clear();
  vi.clearAllMocks();
});

describe('openCreatedWorkspace', () => {
  it('opens a workspace this window already has', async () => {
    mocks.stored.add('ws-known');
    await expect(openCreatedWorkspace('ws-known')).resolves.toBe(true);
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.show).toHaveBeenCalledWith('ws-known');
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it('loads a workspace created elsewhere, then opens it', async () => {
    const workspace = { id: 'ws-from-agent', title: 'Follow up' };
    mocks.open.mockResolvedValueOnce({ ok: true, data: workspace });
    await expect(openCreatedWorkspace('ws-from-agent')).resolves.toBe(true);
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'workspace/set', payload: [workspace] });
    expect(mocks.show).toHaveBeenCalledWith('ws-from-agent');
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it('tells the user when the created workspace no longer exists', async () => {
    mocks.open.mockResolvedValueOnce({ ok: false, error: 'Workspace not found: ws-gone' });
    await expect(openCreatedWorkspace('ws-gone')).resolves.toBe(false);
    expect(mocks.show).not.toHaveBeenCalled();
    expect(mocks.notifyError).toHaveBeenCalledWith(
      'That workspace no longer exists or could not be opened.',
      { description: 'Workspace not found: ws-gone' },
    );
  });

  it('reports a failed lookup instead of doing nothing', async () => {
    mocks.open.mockRejectedValueOnce(new Error('daemon unavailable'));
    await expect(openCreatedWorkspace('ws-offline')).resolves.toBe(false);
    expect(mocks.show).not.toHaveBeenCalled();
    expect(mocks.notifyError).toHaveBeenCalledWith(
      'That workspace no longer exists or could not be opened.',
      { description: 'daemon unavailable' },
    );
  });
});
