import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stored: new Set<string>(),
  dispatch: vi.fn(),
  show: vi.fn(async () => true),
  open: vi.fn(),
  notifyError: vi.fn(),
  state: { tabState: { currentTabId: 'ws-start' as string | null } },
}));

vi.mock('$lib/components/patterns/notify', () => ({ notify: { error: mocks.notifyError } }));
vi.mock('$lib/utils/show-workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/utils/show-workspace')>()),
  openAndShowWorkspace: mocks.show,
}));
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
vi.mock('$store/renderer/store', () => ({
  store: {
    get state() {
      return mocks.state;
    },
    dispatch: mocks.dispatch,
  },
}));

import { bumpNavigationEpoch } from '$lib/utils/navigation-epoch';
import { openCreatedWorkspace } from './open-created-workspace';

beforeEach(() => {
  mocks.stored.clear();
  mocks.state.tabState.currentTabId = 'ws-start';
  window.history.replaceState({}, '', '/workspace/ws-start');
  vi.clearAllMocks();
});

/** A lookup that stays pending until the test resolves it. */
function pendingLookup(workspace: { id: string }): () => void {
  let resolve!: (value: unknown) => void;
  mocks.open.mockReturnValueOnce(new Promise((r) => (resolve = r)));
  return () => resolve({ ok: true, data: workspace });
}

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

  describe('a navigation made while the lookup is pending wins', () => {
    const workspace = { id: 'ws-slow' };

    it('opens nothing after a later in-app navigation', async () => {
      const resolve = pendingLookup(workspace);
      const opening = openCreatedWorkspace('ws-slow');
      bumpNavigationEpoch();
      resolve();
      await expect(opening).resolves.toBe(false);
      expect(mocks.show).not.toHaveBeenCalled();
      expect(mocks.notifyError).not.toHaveBeenCalled();
    });

    it('opens nothing after the window went Home', async () => {
      const resolve = pendingLookup(workspace);
      const opening = openCreatedWorkspace('ws-slow');
      window.history.pushState({}, '', '/');
      resolve();
      await expect(opening).resolves.toBe(false);
      expect(mocks.show).not.toHaveBeenCalled();
    });

    it('opens nothing after another workspace tab was selected', async () => {
      const resolve = pendingLookup(workspace);
      const opening = openCreatedWorkspace('ws-slow');
      mocks.state.tabState.currentTabId = 'ws-other';
      resolve();
      await expect(opening).resolves.toBe(false);
      expect(mocks.show).not.toHaveBeenCalled();
    });

    it('still opens when nothing else navigated meanwhile', async () => {
      const resolve = pendingLookup(workspace);
      const opening = openCreatedWorkspace('ws-slow');
      resolve();
      await expect(opening).resolves.toBe(true);
      expect(mocks.show).toHaveBeenCalledWith('ws-slow');
    });
  });
});
