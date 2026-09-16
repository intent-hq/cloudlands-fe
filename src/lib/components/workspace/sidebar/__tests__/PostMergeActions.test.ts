import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { warmImport } from '../../../../../test/warm-import';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const subscribers = new Set<() => void>();
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
        const notify = () => run(getter());
        notify();
        subscribers.add(notify);
        return () => subscribers.delete(notify);
      },
    });
    return Object.assign(fn, { select: () => getter() });
  };
  return {
    dispatch,
    workspaceEntity,
    gitOps,
    postMerge,
    selector,
    resetRequest: { value: null as any },
    archiveMutation: { value: { loading: false, error: null, version: 0 } as any },
    emit: () => subscribers.forEach((subscriber) => subscriber()),
  };
});

const reduxDispatch = vi.fn();
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
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
  selectWorkspaceMutation: mocks.selector(() => mocks.archiveMutation.value),
}));

vi.mock('$store/renderer/slices/git/git-selectors', () => ({
  selectGitOperationFlags: mocks.selector(() => mocks.gitOps),
  selectPostMergeState: Object.assign(
    () => ({
      subscribe: (run: (v: unknown) => void) => {
        run(mocks.postMerge);
        return () => {};
      },
    }),
    { select: () => mocks.postMerge },
  ),
  selectGitMutationRequest: mocks.selector(() => mocks.resetRequest.value),
}));

vi.mock('$store/renderer/slices/git/git-slice', () => ({
  loadGitStatus: vi.fn((wsId: string, force: boolean) => ({
    type: 'git/loadStatus',
    payload: [wsId, force],
  })),
  setPostMergeState: vi.fn((wsId: string, state: unknown) => ({
    type: 'git/setPostMergeState',
    payload: [wsId, state],
  })),
  setGitOperationFlag: vi.fn((wsId: string, flag: string, val: boolean) => ({
    type: 'git/setGitOperationFlag',
    payload: [wsId, flag, val],
  })),
  executeAcceptChangesRequested: vi.fn((...args: unknown[]) => ({
    type: 'git/executeAcceptChangesRequested',
    payload: args,
  })),
}));

vi.mock('$store/renderer/slices/changes/changes-slice', () => ({
  refreshAcceptChangesStatus: vi.fn((wsId: string) => ({
    type: 'changes/refreshAcceptChangesStatus',
    payload: wsId,
  })),
  clearOlderCommits: vi.fn((wsId: string) => ({
    type: 'changes/clearOlderCommits',
    payload: wsId,
  })),
  refreshRequested: vi.fn((wsId: string) => ({ type: 'changes/refreshRequested', payload: wsId })),
}));

vi.mock('$store/renderer/slices/workspace/workspace-slice', () => ({
  setWorkspaceEntity: vi.fn((entity: unknown) => ({
    type: 'workspace/setWorkspaceEntity',
    payload: entity,
  })),
  loadWorkspacesRequested: vi.fn(() => ({ type: 'workspace/loadWorkspacesRequested' })),
  archiveWorkspaceRequested: vi.fn((id: string) => ({
    type: 'workspace/archiveRequested',
    payload: [id],
  })),
  unarchiveWorkspaceRequested: vi.fn((id: string) => ({
    type: 'workspace/unarchiveRequested',
    payload: [id],
  })),
  updateWorkspaceRequested: vi.fn((...args: unknown[]) => ({
    type: 'workspace/updateRequested',
    payload: args,
  })),
}));

vi.mock('$store/renderer/slices/sidebar-nav/sidebar-nav-slice', () => ({
  setShowCreateModal: vi.fn((val: boolean) => ({
    type: 'sidebarNav/setShowCreateModal',
    payload: val,
  })),
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

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('./mocks/Fa.svelte'));
warmImport(() => import('../PostMergeActions.svelte'));

describe('PostMergeActions', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    reduxDispatch.mockClear();
    mocks.resetRequest.value = null;
    mocks.archiveMutation.value = { loading: false, error: null, version: 0 };
    mocks.gitOps.isResettingToTrunk = false;
    mocks.workspaceEntity.archived = false;
    mocks.workspaceEntity.repositoryPath = '/repo';
    delete mocks.workspaceEntity.worktreePath;
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
    const { container } = await renderPostMerge();
    const resetBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Reset and continue'),
    ) as HTMLButtonElement;
    await fireEvent.click(resetBtn);

    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'git/executeAcceptChangesRequested',
      payload: ['ws-1', 'reset-to-trunk'],
    });
    mocks.resetRequest.value = {
      loading: false,
      error: null,
      data: { success: true, result: { newHeadSha: 'new-sha' } },
      version: 1,
    };
    mocks.emit();

    // baseCommitSha persisted
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith({
        type: 'workspace/updateRequested',
        payload: ['ws-1', { baseCommitSha: 'new-sha' }, 'base-commit'],
      }),
    );

    // refresh dispatches
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'changes/clearOlderCommits', payload: 'ws-1' }),
    );
    expect(
      reduxDispatch.mock.calls
        .map(([action]) => action)
        .filter(
          (action) =>
            action.type === 'git/loadStatus' || action.type === 'changes/refreshRequested',
        ),
    ).toEqual([
      { type: 'git/loadStatus', payload: ['ws-1', true] },
      { type: 'changes/refreshRequested', payload: 'ws-1' },
    ]);
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
    const { toast } = await import('$lib/components/ui/toast');

    const { container } = await renderPostMerge();
    const resetBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Reset and continue'),
    ) as HTMLButtonElement;
    await fireEvent.click(resetBtn);
    mocks.resetRequest.value = {
      loading: false,
      error: null,
      data: { success: false, error: 'boom' },
      version: 1,
    };
    mocks.emit();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('boom'));
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'git/setPostMergeState' }),
    );
  });

  it('archive and start new: delegates the workflow to the workspace operations saga', async () => {
    mocks.workspaceEntity.worktreePath = '/worktrees/ws-1';
    const { container } = await renderPostMerge();
    const archiveBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Archive and start new'),
    ) as HTMLButtonElement;
    await fireEvent.click(archiveBtn);

    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'workspaceOperations/startPostMergeWorkspaceRequested',
      payload: ['ws-1', '/repo', '/worktrees/ws-1'],
    });
    expect(sessionStorage.getItem('workspace-prefill')).toBeNull();
  });

  it('archive and start new: does not prefill a workspace-owned standalone checkout (GitHub pick)', async () => {
    // GitHub-pick workspaces: repositoryPath IS the worktreePath — a
    // daemon-owned standalone checkout, not a copyable local source.
    mocks.workspaceEntity.repositoryPath = '/workspaces/ws-1/repo';
    mocks.workspaceEntity.worktreePath = '/workspaces/ws-1/repo';
    const { container } = await renderPostMerge();
    const archiveBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Archive and start new'),
    ) as HTMLButtonElement;
    await fireEvent.click(archiveBtn);

    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'workspaceOperations/startPostMergeWorkspaceRequested',
      payload: ['ws-1', '/workspaces/ws-1/repo', '/workspaces/ws-1/repo'],
    });
    expect(sessionStorage.getItem('workspace-prefill')).toBeNull();
  });

  it('archive and start new: does not prefill a daemon-managed repo path (.repo-cache)', async () => {
    mocks.workspaceEntity.repositoryPath = '/workspaces/.repo-cache/owner/repo';
    mocks.workspaceEntity.worktreePath = '/worktrees/ws-1';
    const { container } = await renderPostMerge();
    const archiveBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Archive and start new'),
    ) as HTMLButtonElement;
    await fireEvent.click(archiveBtn);

    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'workspaceOperations/startPostMergeWorkspaceRequested',
      payload: ['ws-1', '/workspaces/.repo-cache/owner/repo', '/worktrees/ws-1'],
    });
    expect(sessionStorage.getItem('workspace-prefill')).toBeNull();
  });
});
