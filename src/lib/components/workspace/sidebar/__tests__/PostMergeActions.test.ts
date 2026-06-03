import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
} from 'vitest';
import {
  render,
  fireEvent,
  waitFor,
} from '@testing-library/svelte';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const workspaceEntity = {
    id: 'ws-1',
    branch: 'feature/branch',
    baseRef: 'main',
    repositoryPath: '/repo',
    archived: false,
  } as Record<string, unknown>;
  const gitOps = { isResettingToTrunk: false } as Record<string, boolean>;
  const postMerge = {} as Record<string, unknown>;
  const selector = <T>(getter: () => T) => {
    const fn = () => ({
      subscribe(run: (v: T) => void) {
        run(getter());
        return () => {};
      },
    });
    return Object.assign(fn, { select: () => getter() });
  };
  return { dispatch, workspaceEntity, gitOps, postMerge, selector };
});

const reduxDispatch = vi.fn();
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');
  const dispatch = (...args: any[]) => {
    mocks.dispatch(...args);
    return reduxDispatch(...args);
  };

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch,
  });
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: mocks.selector(() => mocks.workspaceEntity),
}));

vi.mock('$store/renderer/slices/git/git-selectors', () => ({
  selectGitOperationFlags: mocks.selector(() => mocks.gitOps),
  selectPostMergeState: Object.assign(
    () => ({ subscribe: (run: (v: unknown) => void) => { run(mocks.postMerge); return () => {}; } }),
    { select: () => mocks.postMerge },
  ),
}));

vi.mock('$store/renderer/slices/git/git-slice', () => ({
  loadGitStatus: vi.fn((wsId: string, force: boolean) => ({ type: 'git/loadStatus', payload: [wsId, force] })),
  setPostMergeState: vi.fn((wsId: string, state: unknown) => ({ type: 'git/setPostMergeState', payload: [wsId, state] })),
  setGitOperationFlag: vi.fn((wsId: string, flag: string, val: boolean) => ({ type: 'git/setGitOperationFlag', payload: [wsId, flag, val] })),
}));

vi.mock('$store/renderer/slices/changes/changes-slice', () => ({
  refreshAcceptChangesStatus: vi.fn((wsId: string) => ({ type: 'changes/refreshAcceptChangesStatus', payload: wsId })),
  clearOlderCommits: vi.fn((wsId: string) => ({ type: 'changes/clearOlderCommits', payload: wsId })),
  refreshRequested: vi.fn((wsId: string) => ({ type: 'changes/refreshRequested', payload: wsId })),
}));

vi.mock('$store/renderer/slices/workspace/workspace-slice', () => ({
  setWorkspaceEntity: vi.fn((entity: unknown) => ({ type: 'workspace/setWorkspaceEntity', payload: entity })),
  loadWorkspacesRequested: vi.fn(() => ({ type: 'workspace/loadWorkspacesRequested' })),
}));

vi.mock('$store/renderer/slices/sidebar-nav/sidebar-nav-slice', () => ({
  setShowCreateModal: vi.fn((val: boolean) => ({ type: 'sidebarNav/setShowCreateModal', payload: val })),
}));

const mockResetToTrunk = vi.fn();
vi.mock('$features/accept-changes/accept-changes.client', () => ({
  AcceptChangesClient: { resetToTrunk: mockResetToTrunk },
}));

const mockWorkspaceUpdate = vi.fn();
const mockArchive = vi.fn();
const mockUnarchive = vi.fn();
vi.mock('$store/renderer/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: { update: mockWorkspaceUpdate, archive: mockArchive, unarchive: mockUnarchive },
}));

vi.mock('$lib/components/ui/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), custom: vi.fn() },
}));

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('./mocks/Fa.svelte')).default;
  return { default: MockFa };
});

vi.mock('@fortawesome/free-solid-svg-icons', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return new Proxy(actual, {
    get: (target, prop) => {
      if (prop in target) return (target as Record<string | symbol, unknown>)[prop];
      return { iconName: String(prop), prefix: 'fas', icon: [0, 0, [], '', ''] };
    },
  });
});

async function renderPostMerge(overrides: Partial<Record<string, unknown>> = {}) {
  const PostMergeActions = (await import('../PostMergeActions.svelte')).default;
  const defaults = {
    workspaceId: 'ws-1',
    hasNoLocalChanges: true,
    trunkBranch: 'main',
  };
  return render(PostMergeActions, { props: { ...defaults, ...overrides } });
}

describe('PostMergeActions', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    reduxDispatch.mockClear();
    mockResetToTrunk.mockReset();
    mockWorkspaceUpdate.mockReset().mockResolvedValue({ ok: true, data: mocks.workspaceEntity });
    mockArchive.mockReset().mockResolvedValue({ ok: true });
    mockUnarchive.mockReset().mockResolvedValue({ ok: true });
    mocks.gitOps.isResettingToTrunk = false;
    mocks.workspaceEntity.archived = false;
    sessionStorage.clear();
  });

  it('renders nothing when hasNoLocalChanges is false', async () => {
    const { container } = await renderPostMerge({ hasNoLocalChanges: false });
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('renders both buttons when hasNoLocalChanges is true and workspace is not archived', async () => {
    const { container } = await renderPostMerge();
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.some((b) => b.textContent?.includes('Reset and continue'))).toBe(true);
    expect(buttons.some((b) => b.textContent?.includes('Archive and start new'))).toBe(true);
  });

  it('hides archive button when workspace is archived', async () => {
    mocks.workspaceEntity.archived = true;
    const { container } = await renderPostMerge();
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.some((b) => b.textContent?.includes('Reset and continue'))).toBe(true);
    expect(buttons.some((b) => b.textContent?.includes('Archive and start new'))).toBe(false);
  });

  it('disables reset button and shows spinner while resetting', async () => {
    mocks.gitOps.isResettingToTrunk = true;
    const { container } = await renderPostMerge();
    const resetBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Resetting'),
    ) as HTMLButtonElement;
    expect(resetBtn).toBeDefined();
    expect(resetBtn.disabled).toBe(true);
  });

  it('reset success path: updates baseCommitSha, refreshes, and dispatches post-merge cleanup', async () => {
    mockResetToTrunk.mockResolvedValue({ success: true, result: { newHeadSha: 'new-sha' } });

    const { container } = await renderPostMerge();
    const resetBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Reset and continue'),
    ) as HTMLButtonElement;
    await fireEvent.click(resetBtn);

    await waitFor(() => expect(mockResetToTrunk).toHaveBeenCalledWith('ws-1'));

    // flag flipped on then off
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'git/setGitOperationFlag', payload: ['ws-1', 'isResettingToTrunk', true] }),
    );
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'git/setGitOperationFlag', payload: ['ws-1', 'isResettingToTrunk', false] }),
      ),
    );

    // baseCommitSha persisted
    await waitFor(() =>
      expect(mockWorkspaceUpdate).toHaveBeenCalledWith(expect.objectContaining({ baseCommitSha: 'new-sha' })),
    );

    // refresh dispatches
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'changes/clearOlderCommits', payload: 'ws-1' }),
    );
    expect(reduxDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'git/loadStatus' }),
    );
    expect(reduxDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'changes/refreshRequested' }),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'changes/refreshAcceptChangesStatus' }),
    );

    // post-merge state updated with hasResetToTrunk=true
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'git/setPostMergeState',
        payload: expect.arrayContaining([
          'ws-1',
          expect.objectContaining({ hasResetToTrunk: true, isMergedToTrunk: false }),
        ]),
      }),
    );
  });

  it('reset failure path: shows toast error and does not update post-merge', async () => {
    mockResetToTrunk.mockResolvedValue({ success: false, error: 'boom' });
    const { toast } = await import('$lib/components/ui/toast');

    const { container } = await renderPostMerge();
    const resetBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Reset and continue'),
    ) as HTMLButtonElement;
    await fireEvent.click(resetBtn);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('boom'));
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'git/setPostMergeState' }),
    );
  });

  it('archive and start new: archives workspace, writes prefill, opens create modal', async () => {
    const { container } = await renderPostMerge();
    const archiveBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Archive and start new'),
    ) as HTMLButtonElement;
    await fireEvent.click(archiveBtn);

    await waitFor(() => expect(mockArchive).toHaveBeenCalledWith('ws-1'));
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workspace/loadWorkspacesRequested' }),
    );
    await waitFor(() => {
      const prefill = sessionStorage.getItem('workspace-prefill');
      expect(prefill).not.toBeNull();
      expect(JSON.parse(prefill as string)).toEqual({ repoPath: '/repo' });
    });
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'sidebarNav/setShowCreateModal', payload: true }),
      ),
    );
  });
});
