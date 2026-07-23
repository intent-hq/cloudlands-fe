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
import type { CommitInfo } from '$features/file-tracking/types';
import { SYSTEM_CHANNELS } from '$shared/ipc/channels';

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

vi.mock('$store/renderer/slices/workspace/workspace-slice', () => ({
  setWorkspaceEntity: vi.fn((entity: unknown) => ({ type: 'workspace/setWorkspaceEntity', payload: entity })),
}));

vi.mock('$store/renderer/slices/changes/changes-selectors', () => ({
  selectFileTrackingCommits: mocks.selector(() => mocks.ftCommits),
  selectFileTrackingBoundarySha: mocks.selector(() => mocks.boundarySha),
  selectFileTrackingOlderCommits: mocks.selector(() => mocks.olderCommits),
  selectFileTrackingLoadingOlderCommits: mocks.selector(() => mocks.loadingOlderCommits),
}));

vi.mock('$store/renderer/slices/changes/changes-slice', () => ({
  clearOlderCommits: vi.fn((wsId: string) => ({ type: 'changes/clearOlderCommits', payload: wsId })),
  refreshRequested: vi.fn((wsId: string) => ({ type: 'changes/refreshRequested', payload: wsId })),
  loadOlderCommitsRequested: vi.fn((wsId: string) => ({ type: 'changes/loadOlderCommitsRequested', payload: wsId })),
}));

vi.mock('$store/renderer/slices/git/git-slice', () => ({
  loadGitStatus: vi.fn((wsId: string, force: boolean) => ({ type: 'git/loadStatus', payload: [wsId, force] })),
  setGitOperationFlag: vi.fn((wsId: string, flag: string, val: boolean) => ({ type: 'git/setGitOperationFlag', payload: [wsId, flag, val] })),
}));

vi.mock('$store/renderer/slices/git/git-selectors', () => ({
  selectPostMergeState: mocks.selector(() => mocks.postMergeState),
  selectGitOperationFlags: mocks.selector(() => mocks.gitOps),
}));

vi.mock('$store/renderer/slices/terminals/terminals-slice', () => ({
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
vi.mock('$store/renderer/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: { update: mockWorkspaceUpdate },
}));

const mockInvoke = vi.fn();
vi.mock('$lib/electron-bridge', () => ({
  invoke: mockInvoke,
}));

const mockShowFile = vi.hoisted(() => vi.fn());
vi.mock('$features/git/git.client', () => ({
  gitClient: { showFile: mockShowFile },
}));

// PROTOCOL §5.6 — lazy per-commit file fetch for the metadata-only list payload.
const mockCommitDetails = vi.hoisted(() => vi.fn());
vi.mock('$lib/client', () => ({
  appClient: { git: { commitDetails: mockCommitDetails } },
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

// Metadata-only list entry (PROTOCOL §5.19): no `files`/`filesChanged`.
function makeCommit(hash: string, message: string, overrides: Partial<CommitInfo> = {}): CommitInfo {
  return {
    hash,
    message,
    author: 'Test',
    timestamp: Date.now(),
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
    mockShowFile.mockReset();
    mockCommitDetails.mockReset().mockResolvedValue(null);
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
      expect.objectContaining({ type: 'changes/clearOlderCommits', payload: 'ws-1' }),
    );
    expect(reduxDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'changes/refreshRequested' }),
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
      expect.objectContaining({ type: 'git/setGitOperationFlag', payload: ['ws-1', 'isPushing', true] }),
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
        expect.objectContaining({ type: 'git/setGitOperationFlag', payload: ['ws-1', 'isPushing', false] }),
      ),
    );
  });

  it('toggleCommitExpanded shows file list for commit when commit has files', async () => {
    mocks.ftCommits.push(
      makeCommit('abc', 'feat: one', {
        files: [{ path: 'src/a.ts', additions: 1, deletions: 0 }],
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
    // Files already present — no lazy details fetch.
    expect(mockCommitDetails).not.toHaveBeenCalled();
  });

  it('expansion lazily fetches git.commitDetails for metadata-only commits', async () => {
    mocks.ftCommits.push(makeCommit('abc', 'feat: one'));
    mockCommitDetails.mockResolvedValue({
      hash: 'abc',
      author: 'Test',
      email: 't@example.com',
      date: '2026-07-21T00:00:00Z',
      message: 'feat: one',
      files: ['src/a.ts'],
      fileDetails: [{ path: 'src/a.ts', additions: 3, deletions: 1 }],
    });

    const { container } = await renderTimeline();
    const toggle = Array.from(container.querySelectorAll('button')).find((b) =>
      b.getAttribute('title') === 'Toggle file list',
    ) as HTMLButtonElement;
    expect(toggle).toBeDefined();
    await fireEvent.click(toggle);

    expect(mockCommitDetails).toHaveBeenCalledWith('ws-1', 'abc');
    await waitFor(() => {
      const fileRow = container.querySelector('[data-testid="file-row"]');
      expect(fileRow?.getAttribute('data-file-path')).toBe('src/a.ts');
    });

    // Collapse + re-expand does not refetch (cache by hash).
    await fireEvent.click(toggle);
    await fireEvent.click(toggle);
    expect(mockCommitDetails).toHaveBeenCalledTimes(1);
  });

  it('a failed lazy details fetch is retried on the next expand', async () => {
    mocks.ftCommits.push(makeCommit('abc', 'feat: one'));
    // `commitDetails` folds transport errors to `null` — the marker must be
    // cleared so a later expand refetches instead of getting stuck.
    mockCommitDetails.mockResolvedValueOnce(null).mockResolvedValue({
      hash: 'abc',
      author: 'Test',
      email: 't@example.com',
      date: '2026-07-21T00:00:00Z',
      message: 'feat: one',
      files: ['src/a.ts'],
      fileDetails: [{ path: 'src/a.ts', additions: 3, deletions: 1 }],
    });

    const { container } = await renderTimeline();
    const toggle = Array.from(container.querySelectorAll('button')).find((b) =>
      b.getAttribute('title') === 'Toggle file list',
    ) as HTMLButtonElement;
    await fireEvent.click(toggle);
    expect(mockCommitDetails).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="file-row"]')).toBeNull();
    });

    // Collapse + re-expand retries and succeeds this time.
    await fireEvent.click(toggle);
    await fireEvent.click(toggle);
    expect(mockCommitDetails).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      const fileRow = container.querySelector('[data-testid="file-row"]');
      expect(fileRow?.getAttribute('data-file-path')).toBe('src/a.ts');
    });
  });

  it('undo-commit resolves file paths via git.commitDetails for metadata-only commits', async () => {
    mocks.ftCommits.push(makeCommit('abc', 'feat: one'));
    mocks.workspaceEntity.baseCommitSha = 'base';
    mockExecute.mockResolvedValue({ success: true });
    mockCommitDetails.mockResolvedValue({
      hash: 'abc',
      author: 'Test',
      email: 't@example.com',
      date: '2026-07-21T00:00:00Z',
      message: 'feat: one',
      files: ['src/a.ts'],
      fileDetails: [{ path: 'src/a.ts', additions: 3, deletions: 1 }],
    });

    const { container } = await renderTimeline();
    const buttons = Array.from(container.querySelectorAll('button[data-slot="button"]'));
    const undoBtn = buttons.find((b) => b.querySelector('[data-icon="rotate-left"]')) as HTMLButtonElement;
    expect(undoBtn).toBeDefined();
    await fireEvent.click(undoBtn);

    await waitFor(() =>
      expect(mockExecute).toHaveBeenCalledWith(
        'ws-1',
        'undo-commit',
        expect.objectContaining({
          upToCommitHash: 'base',
          undoCommitsMetadata: [
            expect.objectContaining({ hash: 'abc', files: ['src/a.ts'] }),
          ],
        }),
      ),
    );
  });

  // Double-click the rendered message into edit mode, type a new message, and
  // commit with Enter (saveCommitEdit).
  async function editCommitMessage(container: HTMLElement, from: string, to: string) {
    const message = container.querySelector(`[title="${from}"]`) as HTMLElement;
    expect(message).toBeTruthy();
    await fireEvent.dblClick(message);
    const input = await waitFor(() => {
      const el = container.querySelector('input[type="text"]') as HTMLInputElement;
      expect(el).toBeTruthy();
      return el;
    });
    await fireEvent.input(input, { target: { value: to } });
    await fireEvent.keyDown(input, { key: 'Enter' });
  }

  it('saveCommitEdit amends with cwd + workspaceId on the execute-command payload (monorepo#537)', async () => {
    mocks.ftCommits.push(makeCommit('abc', 'feat: one'));
    mockInvoke.mockResolvedValue({ success: true });

    const { container } = await renderTimeline();
    await editCommitMessage(container, 'feat: one', 'feat: better');

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(1));
    expect(mockInvoke.mock.calls).toEqual([
      [
        SYSTEM_CHANNELS.EXECUTE_COMMAND,
        {
          command: 'git commit --amend -m "feat: better"',
          cwd: '/repo',
          workspaceId: 'ws-1',
        },
      ],
    ]);
  });

  it('pushed-commit edit carries workspaceId on every execute-command payload, including the upstream fallback (monorepo#537)', async () => {
    mocks.ftCommits.push(makeCommit('abc', 'feat: one', { isPushed: true }));
    mockInvoke
      .mockResolvedValueOnce({ success: true }) // amend
      .mockResolvedValueOnce({
        success: false,
        data: { stderr: 'fatal: The current branch feature/branch has no upstream branch\n' },
      }) // force-push without upstream
      .mockResolvedValueOnce({ success: true, data: { stdout: 'feature/branch\n' } }) // rev-parse
      .mockResolvedValueOnce({ success: true }); // set-upstream force-push

    const { container } = await renderTimeline();
    await editCommitMessage(container, 'feat: one', 'feat: better');

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(4));
    const expectedPayload = (command: string) => ({
      command,
      cwd: '/repo',
      workspaceId: 'ws-1',
    });
    expect(mockInvoke.mock.calls).toEqual([
      [SYSTEM_CHANNELS.EXECUTE_COMMAND, expectedPayload('git commit --amend -m "feat: better"')],
      [SYSTEM_CHANNELS.EXECUTE_COMMAND, expectedPayload('git push --force-with-lease')],
      [SYSTEM_CHANNELS.EXECUTE_COMMAND, expectedPayload('git rev-parse --abbrev-ref HEAD')],
      [
        SYSTEM_CHANNELS.EXECUTE_COMMAND,
        expectedPayload('git push --force-with-lease --set-upstream origin feature/branch'),
      ],
    ]);
  });

  it('handleCommitFileClick: fetches file contents and dispatches openWorkspaceDiff', async () => {
    mocks.ftCommits.push(
      makeCommit('abc', 'feat: one', {
        files: [{ path: 'src/a.ts', additions: 1, deletions: 0 }],
      }),
    );
    mockShowFile.mockImplementation(async (_wsId: string, _filePath: string, ref: string) => ({
      ok: true,
      data: ref.includes('^') ? 'old' : 'new',
    }));

    const { container } = await renderTimeline();
    const toggle = Array.from(container.querySelectorAll('button')).find((b) =>
      b.getAttribute('title') === 'Toggle file list',
    ) as HTMLButtonElement;
    await fireEvent.click(toggle);
    await waitFor(() => expect(container.querySelector('[data-testid="file-row"]')).toBeTruthy());

    const fileClick = container.querySelector('[data-testid="file-click"]') as HTMLButtonElement;
    await fireEvent.click(fileClick);

    await waitFor(() => {
      const diffCall = reduxDispatch.mock.calls.find(
        ([action]) => action?.type === 'workspaceNavigation/openWorkspaceDiff',
      );
      expect(diffCall).toBeDefined();
    });

    const diffCall = reduxDispatch.mock.calls.find(
      ([action]) => action?.type === 'workspaceNavigation/openWorkspaceDiff',
    )!;
    const [, change, options] = diffCall[0].payload as [
      string,
      Record<string, unknown>,
      { filePath?: string },
    ];
    expect(options.filePath).toBe('src/a.ts');
    expect(change.commitHash).toBe('abc');
    expect(change.stage).toBeDefined();
    expect((change.content as { newContent: string }).newContent).toBe('new');
    expect((change.content as { oldContent: string }).oldContent).toBe('old');
  });
});
