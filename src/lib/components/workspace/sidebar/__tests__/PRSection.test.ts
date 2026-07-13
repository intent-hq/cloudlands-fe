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
  } as Record<string, unknown>;
  const state = {
    githubAuthed: true,
    sidebarChanges: {
      commitWhenReady: false,
      createPRWhenReady: false,
      mergeWhenReady: false,
      pendingAutoAction: null,
      postMergeState: null,
      gitOperations: { isPushing: false, isPulling: false, isForcePushing: false, isRebasing: false, isRefreshingPR: false },
    },
    acceptChanges: { prTitle: '', prDescription: '' },
    executor: { pr: { isExecuting: false, agentId: null } },
    postMerge: { aheadOfTrunk: null, behindTrunk: 0, hasConflicts: false },
  };
  const selector = <T>(getter: () => T) => {
    const fn = () => ({ subscribe(run: (v: T) => void) { run(getter()); return () => {}; } });
    return Object.assign(fn, { select: () => getter() });
  };
  return { dispatch, workspaceEntity, state, selector };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/github-auth/github-auth-selectors', () => ({
  selectGitHubAuthIsAuthenticated: mocks.selector(() => mocks.state.githubAuthed),
}));

vi.mock('$store/renderer/slices/github-auth/github-auth-slice', () => ({
  initializeGitHubAuth: vi.fn(() => ({ type: 'githubAuth/initialize' })),
}));

vi.mock('$store/renderer/slices/changes/changes-selectors', () => ({
  selectAcceptChangesState: mocks.selector(() => mocks.state.acceptChanges),
  selectSidebarCreatePRWhenReady: mocks.selector(() => mocks.state.sidebarChanges.createPRWhenReady),
}));

vi.mock('$store/renderer/slices/changes/changes-slice', () => ({
  refreshAcceptChangesStatus: vi.fn((...args: unknown[]) => ({ type: 'changes/refreshAcceptChangesStatus', payload: args })),
  setSidebarCreatePRWhenReady: vi.fn((...args: unknown[]) => ({ type: 'changes/setSidebarCreatePRWhenReady', payload: args })),
  refreshRequested: vi.fn((wsId: string) => ({ type: 'changes/refreshRequested', payload: [wsId] })),
  clearOlderCommits: vi.fn((wsId: string) => ({ type: 'changes/clearOlderCommits', payload: wsId })),
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: Object.assign(
    () => ({ subscribe(run: (v: unknown) => void) { run(mocks.workspaceEntity); return () => {}; } }),
    { select: () => mocks.workspaceEntity },
  ),
}));

vi.mock('$store/renderer/slices/background-agent-executor/background-agent-executor-selectors', () => ({
  selectExecutorState: mocks.selector(() => mocks.state.executor),
}));

vi.mock('$store/renderer/slices/background-agent-executor/background-agent-executor-slice', () => ({
  executeBackgroundAgent: vi.fn((...args: unknown[]) => ({ type: 'backgroundAgentExecutor/execute', payload: args })),
  cancelExecution: vi.fn((...args: unknown[]) => ({ type: 'backgroundAgentExecutor/cancel', payload: args })),
}));

vi.mock('$store/renderer/slices/git/git-selectors', () => ({
  selectGitAhead: mocks.selector(() => 0),
  selectGitBehind: mocks.selector(() => 0),
  selectPostMergeState: mocks.selector(() => mocks.state.postMerge),
  selectGitOperationFlags: mocks.selector(() => mocks.state.sidebarChanges.gitOperations),
}));

vi.mock('$store/renderer/slices/git/git-slice', () => ({
  loadGitStatus: vi.fn((...args: unknown[]) => ({ type: 'git/loadStatus', payload: args })),
  setGitOperationFlag: vi.fn((...args: unknown[]) => ({ type: 'git/setGitOperationFlag', payload: args })),
}));

vi.mock('$store/renderer/slices/pr-status/pr-status-slice', () => ({
  refreshPRStatusRequested: vi.fn((...args: unknown[]) => ({ type: 'prStatus/refreshRequested', payload: args })),
}));

vi.mock('$store/renderer/slices/terminals/terminals-slice', () => ({
  addTerminal: vi.fn((...args: unknown[]) => ({ type: 'terminals/addTerminal', payload: args })),
  openTerminalOverlay: vi.fn((...args: unknown[]) => ({ type: 'terminals/open', payload: args })),
}));

vi.mock('$store/renderer/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: { update: vi.fn().mockResolvedValue({ ok: true, data: mocks.workspaceEntity }), updateWorkspace: vi.fn().mockResolvedValue(undefined) },
}));

const mockCreatePR = vi.fn().mockResolvedValue({ success: true });

vi.mock('$features/accept-changes/background-git-actions.service', () => ({
  backgroundGitActionsService: { createPR: mockCreatePR, commit: vi.fn().mockResolvedValue({ success: true }) },
}));

vi.mock('$features/accept-changes/accept-changes.client', () => ({
  AcceptChangesClient: { execute: vi.fn().mockResolvedValue({ success: true }) },
}));

vi.mock('$features/git/git-cache', () => ({
  gitCache: { invalidate: vi.fn(), invalidateWorkspace: vi.fn(), set: vi.fn() },
}));

vi.mock('$features/git/git.client', () => ({
  gitClient: { fetch: vi.fn().mockResolvedValue({ ok: true }), push: vi.fn().mockResolvedValue({ ok: true }) },
}));

vi.mock('$features/layout/panel-layout-adapter', () => ({
  getPanelLayoutManager: () => ({ openTab: vi.fn() }),
}));

vi.mock('$features/navigation/link-handler', () => ({ handleLink: vi.fn() }));

vi.mock('$lib/services/analytics', () => ({ track: vi.fn(), trackGitOp: vi.fn(), getFileExtension: () => '.ts' }));

vi.mock('$lib/utils/client-logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock('$lib/components/ui/toast', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn(), custom: vi.fn() } }));

vi.mock('$lib/components/GitHubAuthBanner.svelte', async () => ({ default: (await import('./mocks/MockSimple.svelte')).default }));
vi.mock('$lib/components/workspace/initializer/BranchSelector.svelte', async () => ({ default: (await import('./mocks/MockBranchSelector.svelte')).default }));
vi.mock('$lib/components/file-tracking/accept-changes/FileRow.svelte', async () => ({ default: (await import('./mocks/MockFileRow.svelte')).default }));

vi.mock('svelte-fa', async () => ({ default: (await import('./mocks/Fa.svelte')).default }));

vi.mock('@fortawesome/free-solid-svg-icons', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return new Proxy(actual, {
    get: (target, prop) => {
      if (prop in target) return (target as Record<string | symbol, unknown>)[prop];
      return { iconName: String(prop), prefix: 'fas', icon: [0, 0, [], '', ''] };
    },
  });
});

async function renderPR(overrides: Partial<Record<string, unknown>> = {}) {
  const PRSection = (await import('../PRSection.svelte')).default;
  const onMergeDrawerToggle = vi.fn();
  const defaults = {
    workspaceId: 'ws-1',
    hasStaged: false,
    hasUnstaged: false,
    hasCommits: true,
    hasOpenPR: false,
    hasRemote: true,
    hasPRs: false,
    pullRequests: [],
    commits: [],
    pushedCommits: [],
    allCommits: [],
    stagedChanges: [],
    trunkBranch: 'main',
    targetBranch: 'main',
    repoPath: '/repo',
    repoType: 'github',
    commitMessage: '',
    hasUnpushedCommits: false,
    unpushedCount: 0,
    hasPushedCommits: false,
    isDiverged: false,
    isBehind: false,
    behindCount: 0,
    isMergedToTrunk: false,
    areAllPRsMerged: false,
    hasResetToTrunk: false,
    isContentMergedToTrunk: false,
    hasNewWorkAfterMerge: false,
    isPRMerged: false,
    mergeDrawerOpen: false,
    onMergeDrawerToggle,
  };
  const r = render(PRSection, { props: { ...defaults, ...overrides } });
  return { ...r, onMergeDrawerToggle };
}

describe('PRSection', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mockCreatePR.mockClear();
    mockCreatePR.mockResolvedValue({ success: true });
    mocks.state.githubAuthed = true;
    mocks.state.acceptChanges.prTitle = '';
    mocks.state.acceptChanges.prDescription = '';
  });

  it('triggerCreatePR calls backgroundGitActionsService.createPR with provided title and description when authenticated', async () => {
    const { component } = await renderPR();
    await (component as unknown as {
      triggerCreatePR: (o: { workspaceId?: string; targetBranch?: string; prTitle?: string; prDescription?: string }) => void;
    }).triggerCreatePR({ workspaceId: 'ws-1', targetBranch: 'develop', prTitle: 'Add X', prDescription: 'Details' });

    await waitFor(() => expect(mockCreatePR).toHaveBeenCalled());
    expect(mockCreatePR).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        prTitle: 'Add X',
        prDescription: 'Details',
        targetBranch: 'develop',
      }),
    );
  });

  it('triggerCreatePR dispatches initializeGitHubAuth when unauthenticated and does NOT call createPR', async () => {
    mocks.state.githubAuthed = false;
    const { component } = await renderPR();
    await (component as unknown as {
      triggerCreatePR: (o: { prTitle?: string; prDescription?: string }) => void;
    }).triggerCreatePR({ prTitle: 'Add X', prDescription: 'd' });
    await waitFor(() => {
      expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'githubAuth/initialize' }));
    });
    expect(mockCreatePR).not.toHaveBeenCalled();
  });

  it('toggles the Connect Remote drawer when the button is clicked', async () => {
    const { container } = await renderPR({ hasRemote: false, hasCommits: true });
    await waitFor(() => {
      const buttons = Array.from(container.querySelectorAll('button'));
      expect(buttons.some((b) => b.textContent?.includes('Connect Remote'))).toBe(true);
    });
    expect(container.textContent).not.toContain('Add a git remote');
    const buttons = Array.from(container.querySelectorAll('button'));
    const connectBtn = buttons.find((b) => b.textContent?.includes('Connect Remote'));
    await fireEvent.click(connectBtn!);
    await waitFor(() => expect(container.textContent).toContain('Add a git remote'));
  });
});
