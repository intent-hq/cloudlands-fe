import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { warmImport } from '../../../../../test/warm-import';

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
}));

vi.mock('$store/renderer/slices/accept-workflow/accept-workflow-selectors', () => ({
  selectAcceptOperationPending: mocks.selector(() => mocks.gitOps.isResettingToTrunk),
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
}));

vi.mock('$store/renderer/slices/sidebar-nav/sidebar-nav-slice', () => ({
  setShowCreateModal: vi.fn((val: boolean) => ({
    type: 'sidebarNav/setShowCreateModal',
    payload: val,
  })),
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

vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn(), info: vi.fn(), custom: vi.fn() },
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
    mockResetToTrunk.mockReset();
    mockWorkspaceUpdate.mockReset().mockResolvedValue({ ok: true, data: mocks.workspaceEntity });
    mockArchive.mockReset().mockResolvedValue({ ok: true });
    mockUnarchive.mockReset().mockResolvedValue({ ok: true });
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

  it('dispatches a reset intent without executing or refreshing from the component', async () => {
    const { container } = await renderPostMerge();
    const resetBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Reset and continue'),
    ) as HTMLButtonElement;
    await fireEvent.click(resetBtn);

    expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        type: 'acceptWorkflow/resetAndContinueRequested',
        payload: ['ws-1'],
      }),
    );
    expect(mockResetToTrunk).not.toHaveBeenCalled();
    expect(mockWorkspaceUpdate).not.toHaveBeenCalled();
  });

  it('does not replay reset or navigation side effects on remount', async () => {
    const first = await renderPostMerge();
    first.unmount();
    mocks.dispatch.mockClear();
    await renderPostMerge();
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mockResetToTrunk).not.toHaveBeenCalled();
    expect(mockArchive).not.toHaveBeenCalled();
  });

  it('dispatches archive-and-start intent without persistence or navigation in the component', async () => {
    mocks.workspaceEntity.worktreePath = '/worktrees/ws-1';
    const { container } = await renderPostMerge();
    const archiveBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Archive and start new'),
    ) as HTMLButtonElement;
    await fireEvent.click(archiveBtn);

    expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        type: 'acceptWorkflow/archiveAndStartRequested',
        payload: ['ws-1'],
      }),
    );
    expect(mockArchive).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('workspace-prefill')).toBeNull();
  });

  it('scopes archive intent to the explicit component workspace', async () => {
    const { container } = await renderPostMerge({ workspaceId: 'ws-2' });
    const archiveBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Archive and start new'),
    ) as HTMLButtonElement;
    await fireEvent.click(archiveBtn);

    expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        type: 'acceptWorkflow/archiveAndStartRequested',
        payload: ['ws-2'],
      }),
    );
  });
});
