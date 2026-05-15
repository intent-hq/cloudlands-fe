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
import type { TrackedChange, CommitInfo } from '$features/file-tracking/types';
import { ChangeStage } from '$features/file-tracking/types';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const workspaceEntity = {
    id: 'ws-1',
    branch: 'feature/branch',
    baseRef: 'main',
    repositoryPath: '/repo',
  } as Record<string, unknown>;
  const sidebarChanges = {
    commitWhenReady: false,
    createPRWhenReady: false,
    mergeWhenReady: false,
    pendingAutoAction: null as unknown,
    postMergeState: null as unknown,
    gitOperations: {},
  };
  const executorState = { status: 'idle', result: null, error: null, agentId: null };
  const selector = <T>(getter: () => T) => {
    const fn = () => ({
      subscribe(run: (v: T) => void) {
        run(getter());
        return () => {};
      },
    });
    return Object.assign(fn, { select: () => getter() });
  };
  return { dispatch, workspaceEntity, sidebarChanges, executorState, selector };
});

vi.mock('$lib/store/utils/svelte-context', () => ({
  getDispatch: () => mocks.dispatch,
  getStoreContext: vi.fn(),
}));

vi.mock('$lib/store/redux-dispatch-bridge', () => ({
  getReduxStore: () => ({ getState: () => ({}), dispatch: mocks.dispatch }),
}));

vi.mock('$lib/store/slices/changes/changes-selectors', () => ({
  selectSidebarMergeWhenReady: mocks.selector(() => mocks.sidebarChanges.mergeWhenReady),
}));

vi.mock('$lib/store/slices/changes/changes-slice', () => ({
  setSidebarMergeWhenReady: vi.fn((...args: unknown[]) => ({ type: 'changes/setSidebarMergeWhenReady', payload: args })),
  refreshRequested: vi.fn((wsId: string) => ({ type: 'changes/refreshRequested', payload: [wsId] })),
  clearOlderCommits: vi.fn((wsId: string) => ({ type: 'changes/clearOlderCommits', payload: wsId })),
}));

vi.mock('$lib/store/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: Object.assign(
    () => ({
      subscribe(run: (v: unknown) => void) {
        run(mocks.workspaceEntity);
        return () => {};
      },
    }),
    { select: () => mocks.workspaceEntity },
  ),
}));

vi.mock('$lib/store/slices/workspace/workspace-slice', () => ({
  setWorkspaceEntity: vi.fn((...args: unknown[]) => ({ type: 'workspace/setWorkspaceEntity', payload: args })),
}));

vi.mock('$lib/store/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: { update: vi.fn().mockResolvedValue({ ok: true, data: mocks.workspaceEntity }) },
}));

vi.mock('$lib/store/slices/background-agent-executor/background-agent-executor-selectors', () => ({
  selectExecutorState: mocks.selector(() => mocks.executorState),
}));

vi.mock('$lib/store/slices/background-agent-executor/background-agent-executor-slice', () => ({
  executeBackgroundAgent: vi.fn((...args: unknown[]) => ({ type: 'backgroundAgentExecutor/execute', payload: args })),
  cancelExecution: vi.fn((...args: unknown[]) => ({ type: 'backgroundAgentExecutor/cancel', payload: args })),
}));

vi.mock('$lib/store/slices/git/git-slice', () => ({
  loadGitStatus: vi.fn((...args: unknown[]) => ({ type: 'git/loadStatus', payload: args })),
}));

vi.mock('$lib/store/slices/pr-status/pr-status-slice', () => ({
  refreshPRStatusRequested: vi.fn((...args: unknown[]) => ({ type: 'prStatus/refreshRequested', payload: args })),
}));

const mockExecute = vi.fn().mockResolvedValue({ success: true, result: { newHeadSha: 'h1' } });
const mockMergePR = vi.fn().mockResolvedValue({ success: true });

vi.mock('$features/accept-changes/accept-changes.client', () => ({
  AcceptChangesClient: { execute: mockExecute, mergePR: mockMergePR },
}));

vi.mock('$features/git/git-cache', () => ({
  gitCache: { invalidate: vi.fn(), invalidateWorkspace: vi.fn(), set: vi.fn() },
}));

vi.mock('$lib/services/analytics', () => ({
  track: vi.fn(),
  trackGitOp: vi.fn(),
}));

vi.mock('$lib/utils/client-logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('$lib/components/ui/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), custom: vi.fn() },
}));

vi.mock('$lib/components/workspace/initializer/BranchSelector.svelte', async () => {
  const { default: MockComponent } = await import('./mocks/MockBranchSelector.svelte');
  return { default: MockComponent };
});

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

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

function makeChange(path: string): TrackedChange {
  return {
    id: `change-${path}`,
    file: path,
    relativePath: path,
    stage: ChangeStage.Staged,
    stats: { additions: 1, deletions: 0 },
    attribution: { timestamp: Date.now() },
  };
}

function makeCommit(hash: string, message: string): CommitInfo {
  return {
    hash,
    message,
    author: 'Test',
    timestamp: Date.now(),
    files: [],
    stage: 'local',
    isPushed: false,
  };
}

async function renderMerge(overrides: Partial<Record<string, unknown>> = {}) {
  const MergePanel = (await import('../MergePanel.svelte')).default;
  const onMergeComplete = vi.fn();
  const onCommitMessageChange = vi.fn();
  const onOpenRebaseTerminal = vi.fn();
  const defaults = {
    workspaceId: 'ws-1',
    hasOpenPR: false,
    hasRemote: false,
    pullRequests: [],
    hasStaged: false,
    hasCommits: true,
    allCommits: [makeCommit('abc', 'feat: test')],
    stagedChanges: [],
    trunkBranch: 'main',
    targetBranch: 'main',
    repoPath: '/repo',
    repoType: 'github',
    commitMessage: '',
    onCommitMessageChange,
    onMergeComplete,
    onOpenRebaseTerminal,
  };
  const renderResult = render(MergePanel, { props: { ...defaults, ...overrides } });
  return { ...renderResult, onMergeComplete, onCommitMessageChange, onOpenRebaseTerminal };
}

describe('MergePanel', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mockExecute.mockClear();
    mockExecute.mockResolvedValue({ success: true, result: { newHeadSha: 'h1' } });
    mockMergePR.mockClear();
    mocks.sidebarChanges.mergeWhenReady = false;
    mocks.executorState.status = 'idle';
    mocks.executorState.agentId = null;
  });

  it('triggerMerge invokes AcceptChangesClient.execute with merge target branch and strategy', async () => {
    const { component } = await renderMerge({ targetBranch: 'develop' });
    await (component as unknown as { triggerMerge: (opts?: { squash?: boolean }) => void }).triggerMerge({
      squash: true,
    });
    await waitFor(() => expect(mockExecute).toHaveBeenCalled());
    expect(mockExecute).toHaveBeenCalledWith(
      'ws-1',
      'merge',
      expect.objectContaining({ targetBranch: 'develop', mergeStrategy: 'squash' }),
    );
  });

  it('getMergeOptions reflects viaPR and pushAfter defaults based on props', async () => {
    const { component } = await renderMerge({ hasOpenPR: true, hasRemote: true });
    await waitFor(() => {
      const opts = (component as unknown as { getMergeOptions: () => Record<string, boolean> }).getMergeOptions();
      expect(opts.viaPR).toBe(true);
      expect(opts.pushAfter).toBe(true);
    });
  });

  it('dispatches setSidebarMergeWhenReady when stop-generating is clicked while generating a merge commit', async () => {
    mocks.executorState.status = 'running';
    mocks.executorState.agentId = 'agent-merge';
    const { container } = await renderMerge({
      hasStaged: true,
      stagedChanges: [makeChange('src/a.ts')],
      commitMessage: 'chore: msg',
    });
    await waitFor(() => {
      const buttons = Array.from(container.querySelectorAll('button'));
      const stopBtn = buttons.find((b) => b.textContent?.includes('Auto-fill') && b.querySelector('[data-icon="stop"]'));
      expect(stopBtn).toBeDefined();
    });
    const buttons = Array.from(container.querySelectorAll('button'));
    const stopBtn = buttons.find(
      (b) => b.textContent?.includes('Auto-fill') && b.querySelector('[data-icon="stop"]'),
    );
    await fireEvent.click(stopBtn!);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'backgroundAgentExecutor/cancel' }),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'changes/setSidebarMergeWhenReady',
        payload: ['ws-1', false],
      }),
    );
  });
});
