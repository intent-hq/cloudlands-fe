import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import type { CommitInfo } from '$features/file-tracking/types';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const workspaceEntity = {
    id: 'ws-1',
    branch: 'feature/branch',
    baseRef: 'main',
    baseCommitSha: '',
    repositoryPath: '/repo',
    repositoryOwner: 'octocat',
    repositoryName: 'demo',
    worktreePath: '/repo',
  } as Record<string, unknown>;
  const ftCommits: CommitInfo[] = [];
  const boundarySha: string | null = null;
  const olderCommits: CommitInfo[] = [];
  const loadingOlderCommits = false;
  const postMergeState = { hasRemote: true };
  const gitOps = { isPushing: false };
  const selector = <T>(getter: () => T) => {
    const fn = () => ({
      subscribe(run: (v: T) => void) {
        run(getter());
        return () => {};
      },
    });
    return Object.assign(fn, { select: () => getter() });
  };
  return {
    dispatch, workspaceEntity, ftCommits, boundarySha, olderCommits,
    loadingOlderCommits, postMergeState, gitOps, selector,
  };
});

vi.mock('$lib/store/utils/svelte-context', () => ({
  getDispatch: () => mocks.dispatch,
  getStoreContext: vi.fn(),
}));

const reduxDispatch = vi.fn();
vi.mock('$lib/store/redux-dispatch-bridge', () => ({
  getReduxStore: () => ({ getState: () => ({}), dispatch: reduxDispatch }),
}));

vi.mock('$lib/store/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: mocks.selector(() => mocks.workspaceEntity),
}));

vi.mock('$lib/store/slices/workspace/workspace-slice', () => ({
  setWorkspaceEntity: vi.fn((entity: unknown) => ({ type: 'workspace/setWorkspaceEntity', payload: entity })),
}));

vi.mock('$lib/store/slices/file-tracking/file-tracking-selectors', () => ({
  selectFileTrackingCommits: mocks.selector(() => mocks.ftCommits),
  selectFileTrackingBoundarySha: mocks.selector(() => mocks.boundarySha),
  selectFileTrackingOlderCommits: mocks.selector(() => mocks.olderCommits),
  selectFileTrackingLoadingOlderCommits: mocks.selector(() => mocks.loadingOlderCommits),
}));

vi.mock('$lib/store/slices/file-tracking/file-tracking-slice', () => ({
  clearOlderCommits: vi.fn((wsId: string) => ({ type: 'fileTracking/clearOlderCommits', payload: wsId })),
  refreshRequested: vi.fn((wsId: string) => ({ type: 'fileTracking/refreshRequested', payload: wsId })),
  loadOlderCommitsRequested: vi.fn((wsId: string) => ({ type: 'fileTracking/loadOlderCommitsRequested', payload: wsId })),
}));

vi.mock('$lib/store/slices/git/git-slice', () => ({
  loadGitStatus: vi.fn((wsId: string, force: boolean) => ({ type: 'git/loadStatus', payload: [wsId, force] })),
}));

vi.mock('$lib/store/slices/transient-ui/transient-ui-selectors', () => ({
  selectPostMergeState: mocks.selector(() => mocks.postMergeState),
  selectGitOperationFlags: mocks.selector(() => mocks.gitOps),
}));

vi.mock('$lib/store/slices/transient-ui/transient-ui-slice', () => ({
  setGitOperationFlag: vi.fn((wsId: string, flag: string, val: boolean) => ({ type: 'transientUi/setGitOperationFlag', payload: [wsId, flag, val] })),
}));

vi.mock('$lib/store/slices/terminals/terminals-slice', () => ({
  addTerminal: vi.fn((...a: unknown[]) => ({ type: 'terminals/addTerminal', payload: a })),
  openTerminalOverlay: vi.fn((...a: unknown[]) => ({ type: 'terminals/openTerminalOverlay', payload: a })),
}));

const mockExecute = vi.fn();
const mockUndoPushed = vi.fn();
const mockUndoLocal = vi.fn();
vi.mock('$features/accept-changes/accept-changes.client', () => ({
  AcceptChangesClient: {
    execute: mockExecute,
    undoPushedCommits: mockUndoPushed,
    undoLocalCommit: mockUndoLocal,
  },
}));

const mockWorkspaceUpdate = vi.fn();
vi.mock('$lib/store/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: { update: mockWorkspaceUpdate },
}));

const mockInvoke = vi.fn();
vi.mock('$lib/electron-bridge', () => ({
  invoke: mockInvoke,
}));

vi.mock('$features/git/git-cache', () => ({
  gitCache: { invalidate: vi.fn(), invalidateWorkspace: vi.fn(), set: vi.fn() },
}));

vi.mock('$features/layout/panel-layout-adapter', () => ({
  getPanelLayoutManager: () => ({ openTab: vi.fn() }),
}));

vi.mock('$features/navigation/link-handler', () => ({
  handleLink: vi.fn(),
}));

vi.mock('$lib/services/analytics', () => ({
  track: vi.fn(),
  trackGitOp: vi.fn(),
  getFileExtension: (p: string) => p.split('.').pop() ?? '',
}));

vi.mock('$lib/utils/client-logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('$lib/components/ui/toast', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    custom: vi.fn(),
  },
}));

vi.mock('$lib/components/file-tracking/accept-changes/FileRow.svelte', async () => {
  const { default: MockComponent } = await import('./mocks/MockFileRow.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte', async () => {
  const { default: MockComponent } = await import('./mocks/MockSidebarContextMenu.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/ui/Header.svelte', async () => {
  const { default: MockComponent } = await import('./mocks/MockSimple.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/ui/auggie-avatar/AuggieAvatar.svelte', async () => {
  const { default: MockComponent } = await import('./mocks/MockSimple.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared/LineChangesBadge.svelte', async () => {
  const { default: MockComponent } = await import('./mocks/MockSimple.svelte');
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

function makeCommit(hash: string, message: string, overrides: Partial<CommitInfo> = {}): CommitInfo {
  return {
    hash,
    message,
    author: 'Test',
    timestamp: Date.now(),
    files: [],
    stage: 'local',
    isPushed: false,
    ...overrides,
  } as CommitInfo;
}

async function renderTimeline(overrides: Partial<Record<string, unknown>> = {}) {
  const CommitsTimeline = (await import('../CommitsTimeline.svelte')).default;
  const defaults = {
    workspaceId: 'ws-1',
    activeFilePath: null,
    activeFileStaged: null,
    pullRequestCount: 0,
  };
  return render(CommitsTimeline, { props: { ...defaults, ...overrides } });
}

describe('CommitsTimeline', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    reduxDispatch.mockClear();
    mockExecute.mockReset();
    mockWorkspaceUpdate.mockReset().mockResolvedValue({ ok: true, data: mocks.workspaceEntity });
    mockInvoke.mockReset();
    mocks.ftCommits.splice(0, mocks.ftCommits.length);
    mocks.workspaceEntity.baseCommitSha = '';
    mocks.postMergeState.hasRemote = true;
    mocks.gitOps.isPushing = false;
  });

  it('renders commits from the selector with correct messages', async () => {
    mocks.ftCommits.push(
      makeCommit('abc', 'feat: one'),
      makeCommit('def', 'fix: two', { isPushed: true }),
    );
    const { container } = await renderTimeline();
    expect(container.textContent).toContain('feat: one');
    expect(container.textContent).toContain('fix: two');
  });

  it('right-click builds context menu items with "Set as base commit" when not current base', async () => {
    mocks.ftCommits.push(makeCommit('abc', 'feat: one'));
    const { container } = await renderTimeline();

    const commitRow = container.querySelector('[oncontextmenu], .group') as HTMLElement ||
      container.querySelector('.group') as HTMLElement;
    // Find row by message
    const rows = Array.from(container.querySelectorAll('div.group'));
    const row = rows[0] as HTMLElement;
    expect(row).toBeDefined();
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 20 });

    await waitFor(() => {
      const items = container.querySelectorAll('[data-testid="menu-item"]');
      expect(items.length).toBeGreaterThan(0);
      const labels = Array.from(items).map((i) => i.textContent?.trim());
      expect(labels).toContain('Set as base commit');
    });
    void commitRow;
  });

  it('context menu "Set as base commit" dispatches workspaceClient.update + refresh', async () => {
    mocks.ftCommits.push(makeCommit('abc', 'feat: one'));
    const { container } = await renderTimeline();

    const row = container.querySelector('div.group') as HTMLElement;
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 20 });

    await waitFor(() => expect(container.querySelector('[data-testid="menu-item"]')).toBeTruthy());
    const setBaseBtn = Array.from(container.querySelectorAll('[data-testid="menu-item"]')).find(
      (b) => b.textContent?.trim() === 'Set as base commit',
    ) as HTMLButtonElement;
    await fireEvent.click(setBaseBtn);

    await waitFor(() =>
      expect(mockWorkspaceUpdate).toHaveBeenCalledWith(expect.objectContaining({ baseCommitSha: 'abc' })),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'fileTracking/clearOlderCommits', payload: 'ws-1' }),
    );
    expect(reduxDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'fileTracking/refreshRequested' }),
    );
  });

  it('context menu includes "Reset to default base" when baseCommitSha is already set', async () => {
    mocks.workspaceEntity.baseCommitSha = 'abc';
    mocks.ftCommits.push(makeCommit('abc', 'feat: one'));
    const { container } = await renderTimeline();

    const row = container.querySelector('div.group') as HTMLElement;
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 20 });

    await waitFor(() => {
      const labels = Array.from(container.querySelectorAll('[data-testid="menu-item"]')).map(
        (i) => i.textContent?.trim(),
      );
      expect(labels).toContain('Reset to default base');
    });

    // Setting current base is disabled
    const items = Array.from(container.querySelectorAll('[data-testid="menu-item"]'));
    const setBaseBtn = items.find((b) => b.textContent?.trim() === 'Base commit (current)');
    expect(setBaseBtn?.getAttribute('data-disabled')).toBe('true');

    const resetBtn = items.find((b) => b.textContent?.trim() === 'Reset to default base') as HTMLButtonElement;
    await fireEvent.click(resetBtn);
    await waitFor(() =>
      expect(mockWorkspaceUpdate).toHaveBeenCalledWith(expect.objectContaining({ baseCommitSha: '' })),
    );
  });

  it('handlePushCommits: sets isPushing flag, calls AcceptChangesClient.execute(push), refreshes on success', async () => {
    mocks.ftCommits.push(makeCommit('abc', 'feat: one'));
    mockExecute.mockResolvedValue({ success: true });

    const { container } = await renderTimeline();

    // Tooltip wraps the Button, so the bits-ui trigger creates an outer button.
    // Select the inner button (has data-slot="button") that owns the onclick.
    const buttons = Array.from(container.querySelectorAll('button[data-slot="button"]'));
    const pushBtn = buttons.find((b) => b.querySelector('[data-icon="arrow-up-from-bracket"]')) as HTMLButtonElement;
    expect(pushBtn).toBeDefined();
    await fireEvent.click(pushBtn);

    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'transientUi/setGitOperationFlag', payload: ['ws-1', 'isPushing', true] }),
    );
    await waitFor(() =>
      expect(mockExecute).toHaveBeenCalledWith(
        'ws-1',
        'push',
        expect.objectContaining({ upToCommitHash: 'abc' }),
      ),
    );
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'transientUi/setGitOperationFlag', payload: ['ws-1', 'isPushing', false] }),
      ),
    );
  });

  it('toggleCommitExpanded shows file list for commit when commit has files', async () => {
    mocks.ftCommits.push(
      makeCommit('abc', 'feat: one', {
        files: [{ path: 'src/a.ts', additions: 1, deletions: 0 } as unknown as CommitInfo['files'][number]],
      }),
    );
    const { container } = await renderTimeline();

    const toggle = Array.from(container.querySelectorAll('button')).find((b) =>
      b.getAttribute('title') === 'Toggle file list',
    ) as HTMLButtonElement;
    expect(toggle).toBeDefined();
    await fireEvent.click(toggle);

    await waitFor(() => {
      const fileRow = container.querySelector('[data-testid="file-row"]');
      expect(fileRow).toBeTruthy();
      expect(fileRow?.getAttribute('data-file-path')).toBe('src/a.ts');
    });
  });

  it('handleCommitFileClick: fetches file contents and dispatches workspace:open-diff CustomEvent', async () => {
    mocks.ftCommits.push(
      makeCommit('abc', 'feat: one', {
        files: [{ path: 'src/a.ts', additions: 1, deletions: 0 } as unknown as CommitInfo['files'][number]],
      }),
    );
    mockInvoke.mockImplementation(async (channel: string, args: unknown) => {
      if (channel === 'git:show-file') {
        const ref = (args as { ref: string }).ref;
        return { success: true, data: ref.includes('^') ? 'old' : 'new' };
      }
      return { success: true };
    });

    const diffEvents: CustomEvent[] = [];
    const listener = (e: Event) => diffEvents.push(e as CustomEvent);
    window.addEventListener('workspace:open-diff', listener);

    const { container } = await renderTimeline();
    const toggle = Array.from(container.querySelectorAll('button')).find((b) =>
      b.getAttribute('title') === 'Toggle file list',
    ) as HTMLButtonElement;
    await fireEvent.click(toggle);
    await waitFor(() => expect(container.querySelector('[data-testid="file-row"]')).toBeTruthy());

    const fileClick = container.querySelector('[data-testid="file-click"]') as HTMLButtonElement;
    await fireEvent.click(fileClick);

    await waitFor(() => expect(diffEvents.length).toBeGreaterThan(0));
    const detail = diffEvents[0].detail as { change: Record<string, unknown>; filePath: string };
    expect(detail.filePath).toBe('src/a.ts');
    expect(detail.change.commitHash).toBe('abc');
    expect(detail.change.stage).toBeDefined();
    expect((detail.change.content as { newContent: string }).newContent).toBe('new');
    expect((detail.change.content as { oldContent: string }).oldContent).toBe('old');

    window.removeEventListener('workspace:open-diff', listener);
  });
});
