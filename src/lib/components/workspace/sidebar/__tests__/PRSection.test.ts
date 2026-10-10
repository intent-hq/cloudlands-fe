import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { store as appStore } from '$store/renderer/store';
import { repositoryContextReducer } from '$store/renderer/slices/repository-context/repository-context-slice';
import {
  gitReducer,
  gitReadRequested,
  gitReadStarted,
  gitReadCompleted,
  releaseGitRead,
  setGitOperationFlag,
} from '$store/renderer/slices/git/git-slice';
import { gitReadKey } from '$store/renderer/slices/git/utils/git-read-key';
import {
  prWorkflowReducer,
  prWorkflowRequested,
  setPRWorkflowDrawer,
} from '$store/renderer/slices/pr-workflow/pr-workflow-slice';
import type { PRWorkflowCommand } from '$store/renderer/slices/pr-workflow/pr-workflow-types';
import { warmImport } from '../../../../../test/warm-import';
import {
  configuredVisualStates,
  exerciseVisualStates,
} from '$lib/components/__tests__/helpers/visual-state-characterization';

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
      gitOperations: {
        isPushing: false,
        isPulling: false,
        isForcePushing: false,
        isRebasing: false,
        isRefreshingPR: false,
      },
    },
    acceptChanges: { prTitle: '', prDescription: '' },
    executor: { pr: { isExecuting: false, agentId: null } },
    postMerge: { aheadOfTrunk: null, behindTrunk: 0, hasConflicts: false },
  };
  const selector = <T>(getter: () => T) => {
    const fn = () => ({
      subscribe(run: (v: T) => void) {
        run(getter());
        return () => {};
      },
    });
    return Object.assign(fn, { select: () => getter() });
  };
  return { dispatch, workspaceEntity, state, selector };
});

let reduxState = {
  git: gitReducer(undefined, { type: 'test/init' }),
  prWorkflow: prWorkflowReducer(undefined, { type: 'test/init' }),
  repositoryContext: repositoryContextReducer(undefined, { type: 'test/init' }),
};

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => reduxState,
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
  selectSidebarCreatePRWhenReady: mocks.selector(
    () => mocks.state.sidebarChanges.createPRWhenReady,
  ),
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceActionContext: mocks.selector(() => 'owner-context'),
  selectWorkspaceListLoadedForBackend: mocks.selector(() => true),
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

vi.mock('$store/renderer/slices/principal/principal-selectors', () => ({
  selectPrincipalActionContext: mocks.selector(() => 'owner-context'),
  selectCanAdministerHost: mocks.selector(() => true),
  selectHostRole: mocks.selector(() => 'owner'),
}));

vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', () => ({
  selectLabsMultiplayerEnabled: mocks.selector(() => false),
}));

vi.mock(
  '$store/renderer/slices/background-agent-executor/background-agent-executor-selectors',
  () => ({
    selectExecutorState: mocks.selector(() => mocks.state.executor),
  }),
);

vi.mock('$store/renderer/slices/background-agent-executor/background-agent-executor-slice', () => ({
  executeBackgroundAgent: vi.fn((...args: unknown[]) => ({
    type: 'backgroundAgentExecutor/execute',
    payload: args,
  })),
  cancelExecution: vi.fn((...args: unknown[]) => ({
    type: 'backgroundAgentExecutor/cancel',
    payload: args,
  })),
}));

vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAllWorkspaceAgents: mocks.selector(() => []),
}));

vi.mock('$store/renderer/slices/pr-status/pr-status-slice', () => ({
  refreshPRStatusRequested: vi.fn((...args: unknown[]) => ({
    type: 'prStatus/refreshRequested',
    payload: args,
  })),
}));

vi.mock('$store/renderer/slices/terminals/terminals-slice', () => ({
  addTerminal: vi.fn((...args: unknown[]) => ({ type: 'terminals/addTerminal', payload: args })),
  openTerminalOverlay: vi.fn((...args: unknown[]) => ({ type: 'terminals/open', payload: args })),
}));

vi.mock('$store/renderer/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: {
    update: vi.fn().mockResolvedValue({ ok: true, data: mocks.workspaceEntity }),
    updateWorkspace: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockCreatePR = vi.fn().mockResolvedValue({ success: true });

vi.mock('$features/accept-changes/background-git-actions.service', () => ({
  backgroundGitActionsService: {
    createPR: mockCreatePR,
    commit: vi.fn().mockResolvedValue({ success: true }),
  },
}));

const mockExecute = vi.hoisted(() => vi.fn());
vi.mock('$features/accept-changes/accept-changes.client', () => ({
  AcceptChangesClient: { execute: mockExecute },
}));

vi.mock('$features/git/git-cache', () => ({
  gitCache: { invalidate: vi.fn(), invalidateWorkspace: vi.fn(), set: vi.fn() },
}));

vi.mock('$features/git/git.client', () => ({
  gitClient: {
    fetch: vi.fn().mockResolvedValue({ ok: true }),
    push: vi.fn().mockResolvedValue({ ok: true }),
    showFile: vi.fn().mockResolvedValue({ ok: true, data: '' }),
  },
}));

// PROTOCOL §5.6 — lazy per-commit file fetch for the metadata-only list payload.
const mockCommitDetails = vi.hoisted(() => vi.fn());
vi.mock('$lib/client', () => ({
  appClient: {
    git: { commitDetails: mockCommitDetails, pull: vi.fn().mockResolvedValue({ success: true }) },
  },
}));

vi.mock('$features/layout/panel-layout-adapter', () => ({
  getPanelLayoutManager: () => ({ openTab: vi.fn() }),
}));

vi.mock('$features/navigation/link-handler', () => ({ handleLink: vi.fn() }));

vi.mock('$lib/utils/client-logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock('$lib/components/patterns/notify', () => ({
  notify: { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn(), custom: vi.fn() },
}));

vi.mock('$lib/components/GitHubAuthBanner.svelte', async () => ({
  default: (await import('./mocks/MockSimple.svelte')).default,
}));
vi.mock('$lib/components/workspace/initializer/BranchSelector.svelte', async () => ({
  default: (await import('./mocks/MockBranchSelector.svelte')).default,
}));
vi.mock('$lib/components/file-tracking/accept-changes/FileRow.svelte', async () => ({
  default: (await import('./mocks/MockFileRow.svelte')).default,
}));

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

const testPR = {
  number: 7,
  title: 'feat: something',
  url: 'https://github.com/o/r/pull/7',
  htmlUrl: 'https://github.com/o/r/pull/7',
  status: 'open',
};

const crossRepoPR = {
  ...testPR,
  crossRepo: 'acme/other',
  crossRepoDisplay: 'other',
  monitorSnapshot: {
    state: 'open',
    isDraft: false,
    hasConflicts: false,
    isBehind: false,
    checks: { total: 2, passed: 1, failed: 1, pending: 0 },
    approvals: {
      decision: 'REVIEW_REQUIRED',
      have: 0,
      needed: 1,
      changesRequested: 0,
    },
    threads: { unresolved: 0 },
    rulesKnown: false,
  },
};

function makePushedCommit(hash: string, overrides: Record<string, unknown> = {}) {
  return {
    hash,
    message: `commit ${hash}`,
    author: 'Test',
    timestamp: Date.now(),
    stage: 'pushed',
    isPushed: true,
    ...overrides,
  };
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('./mocks/MockSimple.svelte'));
warmImport(() => import('./mocks/MockBranchSelector.svelte'));
warmImport(() => import('./mocks/MockFileRow.svelte'));
warmImport(() => import('./mocks/Fa.svelte'));
warmImport(() => import('../PRSection.svelte'));

function expectWorkflow(workspaceId: string, command: PRWorkflowCommand) {
  expect(mocks.dispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      type: prWorkflowRequested.type,
      payload: { workspaceId, command, requestId: expect.any(String) },
    }),
  );
}

function readRequests(hash: string) {
  return mocks.dispatch.mock.calls
    .map(([action]) => action)
    .filter(
      (action): action is ReturnType<typeof gitReadRequested> =>
        action.type === gitReadRequested.type && action.payload[2] === hash,
    );
}

function completeCommitFiles(hash: string, path: string | null) {
  const request = readRequests(hash).at(-1)!;
  const [wsId, , , read] = request.payload;
  const key = gitReadKey(read);
  appStore.dispatch(gitReadStarted(wsId, key, 'result'));
  appStore.dispatch(
    gitReadCompleted(
      wsId,
      key,
      'result',
      {
        kind: 'commitDetails',
        details: path
          ? {
              commitHash: hash,
              author: 'Test',
              authorEmail: 't@example.com',
              date: '2026-07-21T00:00:00Z',
              message: `commit ${hash}`,
              files: [path],
              fileDetails: [{ path, additions: 3, deletions: 1 }],
            }
          : null,
      },
      path ? null : 'Unavailable',
    ),
  );
}

describe('PRSection', () => {
  beforeEach(() => {
    mocks.dispatch.mockReset();
    reduxState = {
      git: gitReducer(undefined, { type: 'test/init' }),
      prWorkflow: prWorkflowReducer(undefined, { type: 'test/init' }),
      repositoryContext: repositoryContextReducer(undefined, { type: 'test/init' }),
    };
    mocks.dispatch.mockImplementation((action) => {
      reduxState = {
        git: gitReducer(reduxState.git, action),
        prWorkflow: prWorkflowReducer(reduxState.prWorkflow, action),
        repositoryContext: repositoryContextReducer(reduxState.repositoryContext, action),
      };
      (appStore as unknown as { emitState(): void }).emitState();
      return action;
    });
    mockCreatePR.mockClear();
    mockCreatePR.mockResolvedValue({ success: true });
    mockExecute.mockReset().mockResolvedValue({ success: true });
    mockCommitDetails.mockReset();
    mocks.state.githubAuthed = true;
    mocks.state.acceptChanges.prTitle = '';
    mocks.state.acceptChanges.prDescription = '';
  });

  it('dispatches pull intent for the current workspace without calling the transport', async () => {
    const view = await renderPR({
      workspaceId: 'a',
      hasOpenPR: true,
      isBehind: true,
      behindCount: 1,
    });
    await fireEvent.click(view.getByTestId('pr-pull-button'));
    expectWorkflow('a', { kind: 'pull' });
    await view.rerender({ workspaceId: 'b' });
    await fireEvent.click(view.getByTestId('pr-pull-button'));
    expectWorkflow('b', { kind: 'pull' });
    const { appClient } = await import('$lib/client');
    expect(appClient.git.pull).not.toHaveBeenCalled();
  });

  it('renders saga-owned pull flags and does not clear them on presentation unmount', async () => {
    const view = await renderPR({ hasOpenPR: true, isBehind: true, behindCount: 1 });
    const pull = view.getByTestId('pr-pull-button') as HTMLButtonElement;
    appStore.dispatch(setGitOperationFlag('ws-1', 'isPulling', true));
    await waitFor(() => expect(pull.disabled).toBe(true));
    appStore.dispatch(setGitOperationFlag('ws-1', 'isPulling', false));
    await waitFor(() => expect(pull.disabled).toBe(false));
    appStore.dispatch(setGitOperationFlag('ws-1', 'isPulling', true));
    mocks.dispatch.mockClear();
    view.unmount();
    expect(mocks.dispatch.mock.calls.map(([action]) => action.type)).not.toContain(
      setGitOperationFlag.type,
    );
  });

  it('affirms the linked PR action in every required visual state', async () => {
    const observed = await exerciseVisualStates(async () => {
      const view = await renderPR({
        hasPRs: true,
        pullRequests: [crossRepoPR],
      });
      const target = await waitFor(() => view.container.querySelector<HTMLElement>('div[title]')!);
      target.tabIndex = 0;
      return {
        ...view,
        target,
        assertCapability: () => {
          expect(view.container.textContent).toContain('other:');
          expect(target.getAttribute('title')).toContain('Checks: 1 passed, 1 failed, 0 pending');
        },
      };
    });
    expect(observed).toEqual(configuredVisualStates);
  });

  it('triggerCreatePR dispatches the typed create intent with provided draft and target', async () => {
    const { component } = await renderPR();
    await (
      component as unknown as {
        triggerCreatePR: (o: {
          workspaceId?: string;
          targetBranch?: string;
          prTitle?: string;
          prDescription?: string;
        }) => void;
      }
    ).triggerCreatePR({
      workspaceId: 'ws-1',
      targetBranch: 'develop',
      prTitle: 'Add X',
      prDescription: 'Details',
    });

    expectWorkflow('ws-1', {
      kind: 'create-pr',
      prTitle: 'Add X',
      prDescription: 'Details',
      targetBranch: 'develop',
      hasStaged: false,
      requireAuth: true,
    });
    expect(mockCreatePR).not.toHaveBeenCalled();
  });

  it('delegates unauthenticated creation to the workflow with requireAuth instead of starting auth locally', async () => {
    mocks.state.githubAuthed = false;
    const { component } = await renderPR();
    await (
      component as unknown as {
        triggerCreatePR: (o: { prTitle?: string; prDescription?: string }) => void;
      }
    ).triggerCreatePR({ prTitle: 'Add X', prDescription: 'd' });
    expectWorkflow('ws-1', {
      kind: 'create-pr',
      prTitle: 'Add X',
      prDescription: 'd',
      targetBranch: 'main',
      hasStaged: false,
      requireAuth: true,
    });
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'githubAuth/initialize' }),
    );
    expect(mockCreatePR).not.toHaveBeenCalled();
  });

  it('dispatches the pushed commit boundary and branch, leaving refresh orchestration to the owner', async () => {
    const { container } = await renderPR({
      hasOpenPR: true,
      hasUnpushedCommits: true,
      unpushedCount: 1,
      commits: [makePushedCommit('abc')],
    });
    mocks.dispatch.mockClear();
    const push = await waitFor(() => {
      const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
        candidate.textContent?.includes('Push 1 Commit'),
      );
      expect(button).toBeDefined();
      return button!;
    });

    await fireEvent.click(push);
    expectWorkflow('ws-1', { kind: 'push', targetBranch: 'feature/branch', upToCommitHash: 'abc' });
    expect(mockExecute).not.toHaveBeenCalled();
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
    expect(mocks.dispatch).toHaveBeenCalledWith(
      setPRWorkflowDrawer('ws-1', 'connectRemoteDrawerOpen', true),
    );
    await waitFor(() => expect(container.textContent).toContain('Add a git remote'));
  });

  it('PR expand requests commit details, renders selector results, and releases its read on unmount', async () => {
    const { container, unmount } = await renderPR({
      hasPRs: true,
      hasOpenPR: true,
      pullRequests: [testPR],
      pushedCommits: [makePushedCommit('abc')],
      hasPushedCommits: true,
    });
    const toggle = await waitFor(() => {
      const btn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.getAttribute('title') === 'Toggle file list',
      );
      expect(btn).toBeDefined();
      return btn as HTMLButtonElement;
    });
    await fireEvent.click(toggle);

    expect(readRequests('abc').at(-1)?.payload).toEqual([
      'ws-1',
      expect.any(String),
      'abc',
      { kind: 'commitDetails', commitHash: 'abc' },
    ]);
    completeCommitFiles('abc', 'src/a.ts');
    await waitFor(() => {
      const fileRow = container.querySelector('[data-testid="file-row"]');
      expect(fileRow?.getAttribute('data-file-path')).toBe('src/a.ts');
    });

    // Collapse + re-expand does not refetch (cache by hash).
    const count = readRequests('abc').length;
    await fireEvent.click(toggle);
    await fireEvent.click(toggle);
    expect(readRequests('abc')).toHaveLength(count);
    const [workspaceId, consumerId, requestId] = readRequests('abc').at(-1)!.payload;
    unmount();
    expect(mocks.dispatch).toHaveBeenCalledWith(releaseGitRead(workspaceId, consumerId, requestId));
    expect(mockCommitDetails).not.toHaveBeenCalled();
  });

  it('PR expand does not fetch details when pushed commits already carry files', async () => {
    const { container } = await renderPR({
      hasPRs: true,
      hasOpenPR: true,
      pullRequests: [testPR],
      pushedCommits: [
        makePushedCommit('abc', { files: [{ path: 'src/a.ts', additions: 2, deletions: 0 }] }),
      ],
      hasPushedCommits: true,
    });
    const toggle = await waitFor(() => {
      const btn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.getAttribute('title') === 'Toggle file list',
      );
      expect(btn).toBeDefined();
      return btn as HTMLButtonElement;
    });
    await fireEvent.click(toggle);
    await waitFor(() => {
      const fileRow = container.querySelector('[data-testid="file-row"]');
      expect(fileRow?.getAttribute('data-file-path')).toBe('src/a.ts');
    });
    expect(mockCommitDetails).not.toHaveBeenCalled();
    expect(readRequests('abc')).toHaveLength(0);
  });

  it('retains details across equivalent commit lists and releases them on workspace switch', async () => {
    const { container, rerender } = await renderPR({
      hasPRs: true,
      hasOpenPR: true,
      pullRequests: [testPR],
      pushedCommits: [makePushedCommit('abc')],
      hasPushedCommits: true,
    });
    const toggle = await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('[title="Toggle file list"]');
      expect(button).not.toBeNull();
      return button!;
    });
    await fireEvent.click(toggle);
    completeCommitFiles('abc', 'src/abc.ts');
    await waitFor(() =>
      expect(container.querySelector('[data-file-path="src/abc.ts"]')).not.toBeNull(),
    );
    const count = readRequests('abc').length;
    const [wsId, consumerId, requestId] = readRequests('abc').at(-1)!.payload;

    await rerender({ pushedCommits: [makePushedCommit('abc', { message: 'updated metadata' })] });
    expect(mocks.dispatch).not.toHaveBeenCalledWith(releaseGitRead(wsId, consumerId, requestId));
    expect(readRequests('abc')).toHaveLength(count);
    expect(container.querySelector('[data-file-path="src/abc.ts"]')).not.toBeNull();

    await fireEvent.click(toggle);
    await rerender({ pushedCommits: [makePushedCommit('abc')] });
    await fireEvent.click(toggle);
    expect(readRequests('abc')).toHaveLength(count);
    expect(container.querySelector('[data-file-path="src/abc.ts"]')).not.toBeNull();

    await rerender({ workspaceId: 'ws-2' });
    expect(mocks.dispatch).toHaveBeenCalledWith(releaseGitRead(wsId, consumerId, requestId));
    await waitFor(() =>
      expect(container.querySelector('[data-file-path="src/abc.ts"]')).toBeNull(),
    );
  });

  it('fetches only added commits while expanded and releases only removed commits', async () => {
    const { container, rerender } = await renderPR({
      hasPRs: true,
      hasOpenPR: true,
      pullRequests: [testPR],
      pushedCommits: [makePushedCommit('abc')],
      hasPushedCommits: true,
    });
    const toggle = await waitFor(() => {
      const btn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.getAttribute('title') === 'Toggle file list',
      );
      expect(btn).toBeDefined();
      return btn as HTMLButtonElement;
    });
    await fireEvent.click(toggle);
    await waitFor(() => expect(readRequests('abc').length).toBeGreaterThan(0));
    completeCommitFiles('abc', 'src/abc.ts');
    const count = readRequests('abc').length;
    const [wsId, consumerId, requestId] = readRequests('abc').at(-1)!.payload;

    // A new push lands while the PR stays expanded — the new commit's files
    // are fetched without another expand interaction.
    await rerender({ pushedCommits: [makePushedCommit('abc'), makePushedCommit('def')] });
    await waitFor(() => expect(readRequests('def').length).toBeGreaterThan(0));
    expect(readRequests('abc')).toHaveLength(count);
    expect(mocks.dispatch).not.toHaveBeenCalledWith(releaseGitRead(wsId, consumerId, requestId));
    completeCommitFiles('def', 'src/def.ts');
    await waitFor(() => {
      const paths = Array.from(container.querySelectorAll('[data-testid="file-row"]')).map((r) =>
        r.getAttribute('data-file-path'),
      );
      expect(paths).toEqual(expect.arrayContaining(['src/abc.ts', 'src/def.ts']));
    });
    const defCount = readRequests('def').length;
    await rerender({ pushedCommits: [makePushedCommit('def')] });
    expect(mocks.dispatch).toHaveBeenCalledWith(releaseGitRead(wsId, consumerId, requestId));
    expect(readRequests('def')).toHaveLength(defCount);
    expect(container.querySelector('[data-file-path="src/abc.ts"]')).toBeNull();
    expect(container.querySelector('[data-file-path="src/def.ts"]')).not.toBeNull();
  });

  it('a failed lazy PR details fetch is retried on the next expand', async () => {
    const { container } = await renderPR({
      hasPRs: true,
      hasOpenPR: true,
      pullRequests: [testPR],
      pushedCommits: [makePushedCommit('abc')],
      hasPushedCommits: true,
    });
    const toggle = await waitFor(() => {
      const btn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.getAttribute('title') === 'Toggle file list',
      );
      expect(btn).toBeDefined();
      return btn as HTMLButtonElement;
    });
    await fireEvent.click(toggle);
    expect(readRequests('abc').length).toBeGreaterThan(0);
    completeCommitFiles('abc', null);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="file-row"]')).toBeNull();
    });

    // Collapse + re-expand retries and succeeds this time.
    const count = readRequests('abc').length;
    await fireEvent.click(toggle);
    await fireEvent.click(toggle);
    expect(readRequests('abc').length).toBeGreaterThan(count);
    completeCommitFiles('abc', 'src/a.ts');
    await waitFor(() => {
      const fileRow = container.querySelector('[data-testid="file-row"]');
      expect(fileRow?.getAttribute('data-file-path')).toBe('src/a.ts');
    });
  });

  it('suppresses the PR refresh action in listOnly mode (read-only secondary-root browsing)', async () => {
    // Baseline: the refresh action renders in the normal (primary) mode.
    const primary = await renderPR({ hasPRs: true, pullRequests: [testPR] });
    await waitFor(() => {
      const btn = Array.from(primary.container.querySelectorAll('button')).find(
        (b) => b.getAttribute('title') === 'Refresh PR status',
      );
      expect(btn).toBeDefined();
    });
    primary.unmount();

    // listOnly: refresh would fetch/refresh the PRIMARY workspace's git and
    // PR state, so the read-only secondary-root view must not offer it.
    const { container } = await renderPR({
      hasPRs: true,
      pullRequests: [testPR],
      listOnly: true,
    });
    await waitFor(() => expect(container.textContent).toContain('Pull Requests'));
    const refreshBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.getAttribute('title') === 'Refresh PR status',
    );
    expect(refreshBtn).toBeUndefined();
  });

  it('renders the PR section when PRs exist even though the primary workspace has no remote', async () => {
    // listOnly with a remoteless primary: the selected secondary root's PRs
    // must still render.
    const { container, unmount } = await renderPR({
      hasRemote: false,
      hasPRs: true,
      pullRequests: [testPR],
      listOnly: true,
    });
    await waitFor(() => expect(container.textContent).toContain('Pull Requests'));
    expect(container.textContent).toContain('feat: something');
    // Primary-only affordances stay gated on the primary remote.
    expect(container.textContent).not.toContain('Create PR');
    unmount();

    // Same for monitor-attributed rows in the normal (primary) mode.
    const second = await renderPR({
      hasRemote: false,
      hasPRs: false,
      pullRequests: [],
      otherTrackedPRs: [{ ...testPR, monitorOnly: true }],
    });
    await waitFor(() => expect(second.container.textContent).toContain('Pull Requests'));
    expect(second.container.textContent).toContain('feat: something');
    expect(second.container.textContent).not.toContain('Create PR');
  });

  it('renders the short crossRepoDisplay prefix and a hover status tooltip on the PR row', async () => {
    const { container } = await renderPR({
      hasPRs: true,
      pullRequests: [
        {
          ...testPR,
          crossRepo: 'acme/other',
          crossRepoDisplay: 'other',
          monitorSnapshot: {
            state: 'open',
            isDraft: false,
            hasConflicts: false,
            isBehind: false,
            checks: {
              total: 2,
              passed: 1,
              failed: 1,
              pending: 0,
              failingRequired: 0,
              pendingRequired: 0,
              requiredKnown: false,
            },
            approvals: { decision: 'REVIEW_REQUIRED', have: 0, needed: 1, changesRequested: 0 },
            threads: { unresolved: 0 },
            rulesKnown: false,
          },
        },
      ],
    });

    const prefix = await waitFor(() => {
      const el = Array.from(container.querySelectorAll('span.text-ghost')).find(
        (s) => s.textContent === 'other:',
      );
      expect(el).toBeDefined();
      return el as HTMLElement;
    });
    expect(prefix.textContent).toBe('other:');

    const rowHeader = container.querySelector('div[title]');
    expect(rowHeader?.getAttribute('title')).toContain('Open');
    expect(rowHeader?.getAttribute('title')).toContain('Checks: 1 passed, 1 failed, 0 pending');
    expect(rowHeader?.getAttribute('title')).toContain('Approvals: 0 of 1');
  });
});
