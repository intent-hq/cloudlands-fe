import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import type { CommitInfo } from '$features/file-tracking/types';
import { warmImport } from '../../../../../test/warm-import';

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
  const commitDetailsEntries: any[] = [];
  const fileReads: Record<string, any> = {};
  const selectorListeners = new Set<() => void>();
  const selector = <T>(getter: () => T) => {
    const fn = () => ({
      subscribe(run: (v: T) => void) {
        const notify = () => run(getter());
        selectorListeners.add(notify);
        notify();
        return () => selectorListeners.delete(notify);
      },
    });
    return Object.assign(fn, { select: () => getter() });
  };
  const parameterizedSelector = <T>(getter: (...args: any[]) => T) => {
    const fn = (...inputs: any[]) => ({
      subscribe(run: (value: T) => void) {
        const values = new Array(inputs.length);
        const ready = new Array(inputs.length).fill(false);
        const notify = () => {
          if (ready.every(Boolean)) run(getter(...values));
        };
        const unsubscribes = inputs.map((input, index) => {
          if (input && typeof input.subscribe === 'function') {
            return input.subscribe((value: unknown) => {
              values[index] = value;
              ready[index] = true;
              notify();
            });
          }
          values[index] = input;
          ready[index] = true;
          return () => {};
        });
        selectorListeners.add(notify);
        notify();
        return () => {
          selectorListeners.delete(notify);
          unsubscribes.forEach((unsubscribe) => unsubscribe());
        };
      },
    });
    return Object.assign(fn, { select: (_state: unknown, ...args: any[]) => getter(...args) });
  };
  return {
    dispatch,
    workspaceEntity,
    ftCommits,
    boundarySha,
    olderCommits,
    loadingOlderCommits,
    postMergeState,
    gitOps,
    commitDetailsEntries,
    fileReads,
    notifySelectors: () => selectorListeners.forEach((notify) => notify()),
    selector,
    parameterizedSelector,
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
}));

vi.mock('$store/renderer/slices/workspace/workspace-slice', () => ({
  updateWorkspaceRequested: vi.fn((...args: unknown[]) => ({
    type: 'workspace/updateRequested',
    payload: args,
    promise: Promise.resolve(mocks.workspaceEntity),
  })),
}));

vi.mock('$store/renderer/slices/changes/changes-selectors', () => ({
  selectFileTrackingCommits: mocks.selector(() => mocks.ftCommits),
  selectFileTrackingBoundarySha: mocks.selector(() => mocks.boundarySha),
  selectFileTrackingOlderCommits: mocks.selector(() => mocks.olderCommits),
  selectFileTrackingLoadingOlderCommits: mocks.selector(() => mocks.loadingOlderCommits),
}));

vi.mock('$store/renderer/slices/changes/changes-slice', () => ({
  clearOlderCommits: vi.fn((wsId: string) => ({
    type: 'changes/clearOlderCommits',
    payload: wsId,
  })),
  refreshRequested: vi.fn((wsId: string) => ({ type: 'changes/refreshRequested', payload: wsId })),
  loadOlderCommitsRequested: vi.fn((wsId: string) => ({
    type: 'changes/loadOlderCommitsRequested',
    payload: wsId,
  })),
}));

vi.mock('$store/renderer/slices/git/git-slice', () => ({
  amendCommitMessageRequested: vi.fn((...args: unknown[]) => ({
    type: 'git/amendCommitMessageRequested',
    payload: args,
    promise: Promise.resolve({ success: true }),
  })),
  executeAcceptChangesRequested: vi.fn((...args: unknown[]) => ({
    type: 'git/executeAcceptChangesRequested',
    payload: args,
    promise: Promise.resolve({ success: true, steps: [] }),
  })),
  loadCommitDetails: vi.fn((wsId: string, commitHash: string) => {
    const entry = mocks.commitDetailsEntries.find((item) => item.commitHash === commitHash) ?? {
      commitHash,
      data: null,
      loading: true,
      error: null,
    };
    if (!mocks.commitDetailsEntries.includes(entry)) mocks.commitDetailsEntries.push(entry);
    entry.loading = true;
    const request = mockCommitDetails(wsId, commitHash);
    Promise.resolve(request).then((result) => {
      entry.loading = false;
      if (result) {
        entry.data = { ...result, files: result.fileDetails ?? result.files ?? [] };
      }
      mocks.notifySelectors();
    });
    return { type: 'git/loadCommitDetails', payload: [wsId, commitHash] };
  }),
  loadGitStatus: vi.fn((wsId: string, force: boolean) => ({
    type: 'git/loadStatus',
    payload: [wsId, force],
  })),
  readCommitDetailsRequested: vi.fn((wsId: string, commitHash: string) => ({
    type: 'git/readCommitDetails',
    payload: [wsId, commitHash],
    promise: Promise.resolve(mockCommitDetails(wsId, commitHash)).then((result) => ({
      ...result,
      files: result?.fileDetails ?? result?.files ?? [],
    })),
  })),
  readGitFileRequested: vi.fn((wsId: string, path: string, ref: string) => {
    const key = JSON.stringify([wsId, path, ref]);
    mocks.fileReads[key] = { path, ref, data: null, loading: true, error: null };
    Promise.resolve(mockShowFile(wsId, path, ref)).then(
      (result) => {
        mocks.fileReads[key] = {
          path,
          ref,
          data: result.data ?? '',
          loading: false,
          error: null,
        };
        mocks.notifySelectors();
      },
      (error) => {
        mocks.fileReads[key] = {
          path,
          ref,
          data: null,
          loading: false,
          error: String(error),
        };
        mocks.notifySelectors();
      },
    );
    return { type: 'git/readFile', payload: [wsId, path, ref] };
  }),
  setGitOperationFlag: vi.fn((wsId: string, flag: string, val: boolean) => ({
    type: 'git/setGitOperationFlag',
    payload: [wsId, flag, val],
  })),
}));

vi.mock('$store/renderer/slices/git/git-selectors', () => ({
  selectPostMergeState: mocks.selector(() => mocks.postMergeState),
  selectGitOperationFlags: mocks.selector(() => mocks.gitOps),
  selectCommitDetailsEntries: mocks.selector(() => mocks.commitDetailsEntries),
  selectGitFileRead: mocks.parameterizedSelector(
    (wsId, path, ref) => mocks.fileReads[JSON.stringify([wsId, path, ref])],
  ),
  selectGitMutationRequest: mocks.parameterizedSelector(() => undefined),
}));

vi.mock('$store/renderer/slices/terminals/terminals-slice', () => ({
  createTerminalWithCommandRequested: vi.fn((...args: unknown[]) => ({
    type: 'terminals/createWithCommandRequested',
    payload: args,
    promise: Promise.resolve('terminal-1'),
  })),
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

vi.mock('$lib/components/patterns/notify', () => ({
  notify: {
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

vi.mock('$features/agent/components/agent-avatar/AgentAvatar.svelte', async () => {
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

function makeCommit(
  hash: string,
  message: string,
  overrides: Partial<CommitInfo> = {},
): CommitInfo {
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

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('./mocks/MockFileRow.svelte'));
warmImport(() => import('./mocks/MockSidebarContextMenu.svelte'));
warmImport(() => import('./mocks/MockSimple.svelte'));
warmImport(() => import('./mocks/Fa.svelte'));
warmImport(() => import('../CommitsTimeline.svelte'));

describe('CommitsTimeline', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    reduxDispatch.mockReset().mockImplementation((action) => action);
    mockShowFile.mockReset();
    mockCommitDetails.mockReset().mockResolvedValue(null);
    mocks.commitDetailsEntries.splice(0, mocks.commitDetailsEntries.length);
    for (const key of Object.keys(mocks.fileReads)) delete mocks.fileReads[key];
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

    const commitRow =
      (container.querySelector('[oncontextmenu], .group') as HTMLElement) ||
      (container.querySelector('.group') as HTMLElement);
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

  it('context menu "Set as base commit" dispatches the saga-owned update + refresh', async () => {
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
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'workspace/updateRequested',
          payload: ['ws-1', { baseCommitSha: 'abc' }],
        }),
      ),
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
      const labels = Array.from(container.querySelectorAll('[data-testid="menu-item"]')).map((i) =>
        i.textContent?.trim(),
      );
      expect(labels).toContain('Reset to default base');
    });

    // Setting current base is disabled
    const items = Array.from(container.querySelectorAll('[data-testid="menu-item"]'));
    const setBaseBtn = items.find((b) => b.textContent?.trim() === 'Base commit (current)');
    expect(setBaseBtn?.getAttribute('data-disabled')).toBe('true');

    const resetBtn = items.find(
      (b) => b.textContent?.trim() === 'Reset to default base',
    ) as HTMLButtonElement;
    await fireEvent.click(resetBtn);
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'workspace/updateRequested',
          payload: ['ws-1', { baseCommitSha: '' }],
        }),
      ),
    );
  });

  it('handlePushCommits dispatches the saga-owned push request', async () => {
    mocks.ftCommits.push(makeCommit('abc', 'feat: one'));
    const { container } = await renderTimeline();

    // Tooltip wraps the Button, so the bits-ui trigger creates an outer button.
    // Select the inner button (has data-slot="button") that owns the onclick.
    const buttons = Array.from(container.querySelectorAll('button[data-slot="button"]'));
    const pushBtn = buttons.find((b) =>
      b.querySelector('[data-icon="arrow-up-from-bracket"]'),
    ) as HTMLButtonElement;
    expect(pushBtn).toBeDefined();
    await fireEvent.click(pushBtn);

    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'git/executeAcceptChangesRequested',
          payload: ['ws-1', 'push', expect.objectContaining({ upToCommitHash: 'abc' })],
        }),
      ),
    );
  });

  it('toggleCommitExpanded shows file list for commit when commit has files', async () => {
    mocks.ftCommits.push(
      makeCommit('abc', 'feat: one', {
        files: [
          {
            path: 'src/a.ts',
            additions: 1,
            deletions: 0,
          } as unknown as CommitInfo['files'][number],
        ],
      }),
    );
    const { container } = await renderTimeline();

    const toggle = Array.from(container.querySelectorAll('button')).find(
      (b) => b.getAttribute('title') === 'Toggle file list',
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
    const toggle = Array.from(container.querySelectorAll('button')).find(
      (b) => b.getAttribute('title') === 'Toggle file list',
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
    const toggle = Array.from(container.querySelectorAll('button')).find(
      (b) => b.getAttribute('title') === 'Toggle file list',
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
    const undoBtn = buttons.find((b) =>
      b.querySelector('[data-icon="rotate-left"]'),
    ) as HTMLButtonElement;
    expect(undoBtn).toBeDefined();
    await fireEvent.click(undoBtn);

    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'git/executeAcceptChangesRequested',
          payload: [
            'ws-1',
            'undo-commit',
            expect.objectContaining({
              upToCommitHash: 'base',
              undoCommitsMetadata: [expect.objectContaining({ hash: 'abc', files: ['src/a.ts'] })],
            }),
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
    const { container } = await renderTimeline();
    await editCommitMessage(container, 'feat: one', 'feat: better');

    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'git/amendCommitMessageRequested',
          payload: ['ws-1', '/repo', 'feat: better', false],
        }),
      ),
    );
  });

  it('saveCommitEdit passes backticks, $(...), and quotes literally via single-quote escaping (monorepo#579)', async () => {
    mocks.ftCommits.push(makeCommit('abc', 'feat: one'));
    const { container } = await renderTimeline();
    const hostile =
      'fix: handle `rm -rf /tmp` and $(whoami) with "double" and \'single\' quotes and back\\slash';
    await editCommitMessage(container, 'feat: one', hostile);

    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'git/amendCommitMessageRequested',
          payload: ['ws-1', '/repo', hostile, false],
        }),
      ),
    );
  });

  it('pushed-commit edit carries workspaceId on every execute-command payload, including the upstream fallback (monorepo#537)', async () => {
    mocks.ftCommits.push(makeCommit('abc', 'feat: one', { isPushed: true }));
    const { container } = await renderTimeline();
    await editCommitMessage(container, 'feat: one', 'feat: better');

    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'git/amendCommitMessageRequested',
          payload: ['ws-1', '/repo', 'feat: better', true],
        }),
      ),
    );
  });

  it('handleCommitFileClick: fetches file contents and dispatches openWorkspaceDiff', async () => {
    mocks.ftCommits.push(
      makeCommit('abc', 'feat: one', {
        files: [
          {
            path: 'src/a.ts',
            additions: 1,
            deletions: 0,
          } as unknown as CommitInfo['files'][number],
        ],
      }),
    );
    mockShowFile.mockImplementation(async (_wsId: string, _filePath: string, ref: string) => ({
      ok: true,
      data: ref.includes('^') ? 'old' : 'new',
    }));

    const { container } = await renderTimeline();
    const toggle = Array.from(container.querySelectorAll('button')).find(
      (b) => b.getAttribute('title') === 'Toggle file list',
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
