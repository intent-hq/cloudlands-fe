import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/svelte';
import { warmImport } from '../../../../../test/warm-import';
import type { WorkspaceGitRootEntry } from '$store/renderer/slices/git-roots/git-roots-selectors';
import type { CommitInfo, GitStatus } from '$shared/types';

type RootGitTestState = {
  status: GitStatus | null;
  commits: CommitInfo[];
  nextToken?: string;
  commitFiles: Record<string, Array<{ path: string; additions: number; deletions: number }> | null>;
  loading: boolean;
  error: string | null;
};

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getHistory: vi.fn(),
  commitDetails: vi.fn(),
  dispatch: vi.fn(),
  writeTextToClipboard: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  rootGitRoots: (() => {
    let value: Record<string, RootGitTestState> = {};
    const subscribers = new Set<(next: typeof value) => void>();
    return {
      subscribe(run: (next: typeof value) => void) {
        subscribers.add(run);
        run(value);
        return () => subscribers.delete(run);
      },
      reset() {
        value = {};
        subscribers.forEach((run) => run(value));
      },
      setRoot(rootId: string, next: RootGitTestState) {
        value = { ...value, [rootId]: next };
        subscribers.forEach((run) => run(value));
      },
      getRoot(rootId: string) {
        return value[rootId];
      },
    };
  })(),
}));

// gitRootId-scoped read-only per-root reads (PROTOCOL §5.6, monorepo#2053).
vi.mock('$features/git/git.client', () => ({
  gitClient: { getStatus: mocks.getStatus, getHistory: mocks.getHistory },
}));

// Saga-owned per-commit file reads (`git.commitDetails`, gitRootId-scoped).
vi.mock('$lib/client', () => ({
  appClient: { git: { commitDetails: mocks.commitDetails } },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/git/git-selectors', () => ({
  emptySecondaryRootState: {
    status: null,
    commits: [],
    commitFiles: {},
    loading: false,
    error: null,
  },
  selectSecondaryRootGitRoots: vi.fn(() => ({
    subscribe(run: (value: Record<string, unknown>) => void) {
      return mocks.rootGitRoots.subscribe(run);
    },
  })),
}));

vi.mock('$store/renderer/slices/git/git-slice', () => ({
  loadSecondaryRootGit: vi.fn(
    (wsId: string, gitRootId: string, registeredCommitSha?: string, limit = 30) => ({
      type: 'git/loadSecondaryRoot',
      payload: [wsId, gitRootId, registeredCommitSha, limit],
    }),
  ),
  loadSecondaryRootCommitFiles: vi.fn((wsId: string, gitRootId: string, commitHash: string) => ({
    type: 'git/loadSecondaryRootCommitFiles',
    payload: [wsId, gitRootId, commitHash],
  })),
}));

vi.mock('$store/renderer/slices/workspace-navigation/workspace-navigation-slice', () => ({
  openWorkspaceLocalChanges: vi.fn((...args: unknown[]) => ({
    type: 'workspaceNavigation/openWorkspaceLocalChanges',
    payload: args,
  })),
  openWorkspaceCommitChangeset: vi.fn((...args: unknown[]) => ({
    type: 'workspaceNavigation/openWorkspaceCommitChangeset',
    payload: args,
  })),
}));

vi.mock('$lib/utils/clipboard', () => ({
  writeTextToClipboard: mocks.writeTextToClipboard,
}));

vi.mock('$lib/utils/client-logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('svelte-sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock('svelte-fa', async () => ({ default: (await import('./mocks/Fa.svelte')).default }));

// The avatar pulls agent-session/theme selectors (Svelte store context);
// mock it to the marker div — the only 'mock-component' testid in this suite.
vi.mock('$features/agent/components/agent-avatar/AgentAvatar.svelte', async () => ({
  default: (await import('./mocks/MockSimple.svelte')).default,
}));

vi.mock('$lib/components/file-tracking/accept-changes/FileRow.svelte', async () => ({
  default: (await import('./mocks/MockFileRow.svelte')).default,
}));

function makeStatus(branch: string): GitStatus {
  return {
    branch,
    ahead: 0,
    behind: 0,
    diverged: false,
    files: [],
    hasUncommittedChanges: false,
    hasUntrackedFiles: false,
  };
}

function makeEntry(
  branch: string | undefined,
  rootId = 'root-1',
  registeredCommitSha?: string,
): WorkspaceGitRootEntry {
  return {
    key: rootId,
    isPrimary: false,
    path: 'packages/sub',
    branch,
    gitRoot: { id: rootId, ...(registeredCommitSha ? { registeredCommitSha } : {}) },
  } as WorkspaceGitRootEntry;
}

function makeCommit(
  hash: string,
  message: string,
  overrides: Partial<CommitInfo> = {},
): CommitInfo {
  return {
    hash,
    sha: hash.slice(0, 7),
    author: 'Dev',
    email: 'dev@example.com',
    date: '2026-07-01T00:00:00Z',
    message,
    ...overrides,
  } as CommitInfo;
}

async function renderView(entry: WorkspaceGitRootEntry) {
  const SecondaryRootChangesView = (await import('../SecondaryRootChangesView.svelte')).default;
  return render(SecondaryRootChangesView, { props: { workspaceId: 'ws-1', entry } });
}

warmImport(() => import('./mocks/Fa.svelte'));
warmImport(() => import('../SecondaryRootChangesView.svelte'));

describe('SecondaryRootChangesView', () => {
  const requestEpochs = new Map<string, number>();

  beforeEach(() => {
    mocks.getStatus.mockReset();
    mocks.getHistory.mockReset();
    mocks.commitDetails.mockReset();
    mocks.dispatch.mockReset();
    mocks.writeTextToClipboard.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    mocks.getHistory.mockResolvedValue({ ok: true, data: { items: [] } });
    mocks.commitDetails.mockResolvedValue(null);
    mocks.writeTextToClipboard.mockResolvedValue(undefined);
    mocks.rootGitRoots.reset();
    requestEpochs.clear();
    mocks.dispatch.mockImplementation((action) => {
      if (action.type === 'git/loadSecondaryRootCommitFiles') {
        const [wsId, gitRootId, commitHash] = action.payload;
        void mocks.commitDetails(wsId, commitHash, { gitRootId }).then((detail) => {
          if (!detail) return;
          const current = mocks.rootGitRoots.getRoot(gitRootId);
          if (!current) return;
          mocks.rootGitRoots.setRoot(gitRootId, {
            ...current,
            commitFiles: {
              ...current.commitFiles,
              [commitHash]:
                detail.fileDetails.length > 0
                  ? detail.fileDetails
                  : detail.files.map((path) => ({ path, additions: 0, deletions: 0 })),
            },
          });
        });
        return;
      }
      if (action.type !== 'git/loadSecondaryRoot') return;
      const [wsId, gitRootId, registeredCommitSha, limit] = action.payload;
      const requestKey = `${wsId}:${gitRootId}`;
      const epoch = (requestEpochs.get(requestKey) ?? 0) + 1;
      requestEpochs.set(requestKey, epoch);
      mocks.rootGitRoots.setRoot(gitRootId, {
        status: null,
        commits: [],
        commitFiles: {},
        loading: true,
        error: null,
      });
      void (async () => {
        const [statusResult, firstPage] = await Promise.all([
          mocks.getStatus(wsId, { gitRootId }),
          mocks.getHistory(wsId, limit, { gitRootId }),
        ]);
        if (epoch !== requestEpochs.get(requestKey)) return;
        if (!statusResult.ok || !firstPage.ok) {
          mocks.rootGitRoots.setRoot(gitRootId, {
            status: null,
            commits: [],
            commitFiles: {},
            loading: false,
            error: statusResult.error ?? firstPage.error,
          });
          return;
        }
        const commits = [...firstPage.data.items];
        let nextToken = firstPage.data.nextToken;
        while (
          nextToken &&
          (!registeredCommitSha || !commits.some((commit) => commit.hash === registeredCommitSha))
        ) {
          const page = await mocks.getHistory(wsId, limit, { gitRootId, nextToken });
          if (epoch !== requestEpochs.get(requestKey)) return;
          if (!page.ok) {
            mocks.rootGitRoots.setRoot(gitRootId, {
              status: null,
              commits: [],
              commitFiles: {},
              loading: false,
              error: page.error,
            });
            return;
          }
          const seen = new Set(commits.map((commit) => commit.hash));
          commits.push(...page.data.items.filter((commit) => !seen.has(commit.hash)));
          nextToken = page.data.nextToken;
        }
        const boundaryIndex = registeredCommitSha
          ? commits.findIndex((commit) => commit.hash === registeredCommitSha)
          : -1;
        const recent = boundaryIndex >= 0 ? commits.slice(0, boundaryIndex) : commits;
        const details = await Promise.all(
          recent.map((commit) => mocks.commitDetails(wsId, commit.hash, { gitRootId })),
        );
        if (epoch !== requestEpochs.get(requestKey)) return;
        mocks.rootGitRoots.setRoot(gitRootId, {
          status: statusResult.data,
          commits,
          commitFiles: Object.fromEntries(
            recent.map((commit, index) => {
              const detail = details[index];
              return [
                commit.hash,
                detail
                  ? detail.fileDetails.length > 0
                    ? detail.fileDetails
                    : detail.files.map((path) => ({ path, additions: 0, deletions: 0 }))
                  : null,
              ];
            }),
          ),
          loading: false,
          error: null,
        });
      })();
    });
  });

  it('prefers the freshly loaded status.branch over the cached entry.branch', async () => {
    // A refresh after a branch checkout must show the new branch, not the
    // stale one cached in the git-root list entry.
    mocks.getStatus.mockResolvedValue({ ok: true, data: makeStatus('fresh-branch') });
    const { container } = await renderView(makeEntry('stale-branch'));
    await waitFor(() => expect(container.textContent).toContain('fresh-branch'));
    expect(container.textContent).not.toContain('stale-branch');
  });

  it('shows an exact unique-file summary and opens all changes scoped to the root', async () => {
    const status = makeStatus('main');
    status.files = [
      { path: 'src/shared.ts', status: 'M', staged: false },
      { path: 'src/working.ts', status: '?', staged: false },
    ];
    mocks.getStatus.mockResolvedValue({ ok: true, data: status });
    mocks.getHistory.mockResolvedValueOnce({
      ok: true,
      data: {
        items: [makeCommit('newer222', 'feat: newest')],
        nextToken: 'page-2',
      },
    });
    mocks.getHistory.mockResolvedValueOnce({
      ok: true,
      data: {
        items: [
          makeCommit('newer111', 'feat: older post-registration'),
          makeCommit('bound111', 'chore: registration boundary'),
        ],
      },
    });
    mocks.commitDetails.mockImplementation((_ws, hash) =>
      Promise.resolve({
        files:
          hash === 'newer222'
            ? ['src/shared.ts', 'src/committed.ts']
            : ['src/committed.ts', 'src/second-commit.ts'],
        fileDetails: [],
      }),
    );
    const { getByTestId } = await renderView(makeEntry('main', 'root-9', 'bound111'));

    const summary = await waitFor(() => getByTestId('secondary-root-all-changes'));
    expect(summary.textContent).toContain('4 files changed in Workspace');
    await fireEvent.click(summary);
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'workspaceNavigation/openWorkspaceLocalChanges',
      payload: ['ws-1', { gitRootId: 'root-9' }],
    });
    expect(mocks.commitDetails).toHaveBeenCalledTimes(2);
  });

  it('does not expose a partial summary while the boundary page is pending', async () => {
    const status = makeStatus('main');
    status.files = [{ path: 'src/working.ts', status: 'M', staged: false }];
    mocks.getStatus.mockResolvedValue({ ok: true, data: status });
    mocks.getHistory.mockResolvedValueOnce({
      ok: true,
      data: { items: [makeCommit('newer222', 'feat: newest')], nextToken: 'page-2' },
    });
    let resolveBoundaryPage!: (value: unknown) => void;
    mocks.getHistory.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveBoundaryPage = resolve;
      }),
    );
    mocks.commitDetails.mockResolvedValue({
      files: ['src/committed.ts'],
      fileDetails: [],
    });
    const { getByTestId, queryByTestId } = await renderView(
      makeEntry('main', 'root-9', 'bound111'),
    );

    await waitFor(() => expect(mocks.getHistory).toHaveBeenCalledTimes(2));
    expect(queryByTestId('secondary-root-all-changes')).toBeNull();

    resolveBoundaryPage({
      ok: true,
      data: { items: [makeCommit('bound111', 'chore: registration boundary')] },
    });

    const summary = await waitFor(() => getByTestId('secondary-root-all-changes'));
    expect(summary.textContent).toContain('2 files changed in Workspace');
  });

  it('shows the summary for working-tree-only changes', async () => {
    const status = makeStatus('main');
    status.files = [{ path: 'src/working.ts', status: 'M', staged: false }];
    mocks.getStatus.mockResolvedValue({ ok: true, data: status });

    const { getByTestId } = await renderView(makeEntry('main', 'root-9', 'bound111'));

    const summary = await waitFor(() => getByTestId('secondary-root-all-changes'));
    expect(summary.textContent).toContain('1 file changed in Workspace');
    expect(mocks.commitDetails).not.toHaveBeenCalled();
  });

  it('shows the summary for commit-only changes after registration', async () => {
    mocks.getStatus.mockResolvedValue({ ok: true, data: makeStatus('main') });
    mocks.getHistory.mockResolvedValue({
      ok: true,
      data: {
        items: [
          makeCommit('newer222', 'feat: after registration'),
          makeCommit('bound111', 'chore: registration boundary'),
        ],
      },
    });
    mocks.commitDetails.mockResolvedValue({
      files: ['src/a.ts', 'src/b.ts'],
      fileDetails: [],
    });

    const { getByTestId } = await renderView(makeEntry('main', 'root-9', 'bound111'));

    const summary = await waitFor(() => getByTestId('secondary-root-all-changes'));
    expect(summary.textContent).toContain('2 files changed in Workspace');
  });

  it('treats a transient null commit detail as settled while keeping its retry path', async () => {
    const status = makeStatus('main');
    status.files = [{ path: 'working.ts', status: 'M', staged: false }];
    mocks.getStatus.mockResolvedValue({ ok: true, data: status });
    mocks.getHistory.mockResolvedValue({
      ok: true,
      data: {
        items: [
          makeCommit('aaaa111', 'feat: transient detail miss'),
          makeCommit('bound111', 'boundary'),
        ],
      },
    });
    mocks.commitDetails.mockImplementation(async (_wsId, hash) =>
      hash === 'aaaa111' ? null : { files: [], fileDetails: [] },
    );

    const { getByTestId } = await renderView(makeEntry('main', 'root-9', 'bound111'));
    await waitFor(() =>
      expect(getByTestId('secondary-root-all-changes').textContent).toContain(
        '1 file changed in Workspace',
      ),
    );
  });

  it('keeps an empty root in the no-changes state without a summary affordance', async () => {
    mocks.getStatus.mockResolvedValue({ ok: true, data: makeStatus('main') });

    const { container, queryByTestId } = await renderView(makeEntry('main', 'root-9', 'bound111'));

    await waitFor(() => expect(container.textContent).toContain('No changes'));
    expect(queryByTestId('secondary-root-all-changes')).toBeNull();
  });

  it('refreshes the exact working-tree summary', async () => {
    const initial = makeStatus('main');
    initial.files = [{ path: 'src/a.ts', status: 'M', staged: false }];
    const refreshed = makeStatus('main');
    refreshed.files = [
      { path: 'src/a.ts', status: 'M', staged: false },
      { path: 'src/b.ts', status: '?', staged: false },
    ];
    mocks.getStatus.mockResolvedValueOnce({ ok: true, data: initial });
    mocks.getStatus.mockResolvedValueOnce({ ok: true, data: refreshed });
    const { getByTestId, getByTitle } = await renderView(makeEntry('main', 'root-9', 'bound111'));
    await waitFor(() =>
      expect(getByTestId('secondary-root-all-changes').textContent).toContain(
        '1 file changed in Workspace',
      ),
    );

    await fireEvent.click(getByTitle('Refresh git status'));

    await waitFor(() =>
      expect(getByTestId('secondary-root-all-changes').textContent).toContain(
        '2 files changed in Workspace',
      ),
    );
  });

  it('falls back to entry.branch while the status is still loading', async () => {
    mocks.getStatus.mockReturnValue(new Promise(() => {}));
    mocks.getHistory.mockReturnValue(new Promise(() => {}));
    const { container } = await renderView(makeEntry('cached-branch'));
    await waitFor(() => expect(container.textContent).toContain('cached-branch'));
  });

  it('shows the no-branch placeholder when neither source has a branch', async () => {
    mocks.getStatus.mockReturnValue(new Promise(() => {}));
    mocks.getHistory.mockReturnValue(new Promise(() => {}));
    const { container } = await renderView(makeEntry(undefined));
    await waitFor(() => expect(container.textContent).toContain('no branch'));
  });

  it('surfaces a git.commits failure as the error state instead of "No commits"', async () => {
    // A transient daemon error on the commits read must not render a
    // plausible-but-wrong empty history.
    mocks.getStatus.mockResolvedValue({ ok: true, data: makeStatus('main') });
    mocks.getHistory.mockResolvedValue({ ok: false, error: 'daemon error' });
    const { container } = await renderView(makeEntry('main'));
    await waitFor(() => expect(container.textContent).toContain('Failed to load git root state'));
    expect(container.textContent).not.toContain('No commits');
  });

  it('copies the exact branch name and shows a success toast on branch label click', async () => {
    mocks.getStatus.mockResolvedValue({ ok: true, data: makeStatus('feature/copy-me') });
    const { getByTestId } = await renderView(makeEntry('stale-branch'));
    const button = await waitFor(() => {
      const el = getByTestId('secondary-root-branch-copy');
      expect(el.textContent).toContain('feature/copy-me');
      return el;
    });
    expect(button.tagName).toBe('BUTTON');
    // WCAG 2.5.3: the accessible name must contain the visible label (the branch name).
    expect(button.getAttribute('aria-label')).toBe('Copy branch name: feature/copy-me');
    expect(button.getAttribute('title')).toBe('Copy branch name');

    await fireEvent.click(button);
    await waitFor(() => expect(mocks.writeTextToClipboard).toHaveBeenCalledWith('feature/copy-me'));
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Branch name copied to clipboard'),
    );
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('shows an error toast when the clipboard write fails', async () => {
    mocks.getStatus.mockResolvedValue({ ok: true, data: makeStatus('main') });
    mocks.writeTextToClipboard.mockRejectedValue(new Error('clipboard unavailable'));
    const { getByTestId } = await renderView(makeEntry('main'));
    const button = await waitFor(() => getByTestId('secondary-root-branch-copy'));

    await fireEvent.click(button);
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('Failed to copy branch name'),
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it('renders no copy affordance when there is no branch', async () => {
    mocks.getStatus.mockReturnValue(new Promise(() => {}));
    mocks.getHistory.mockReturnValue(new Promise(() => {}));
    const { container, queryByTestId } = await renderView(makeEntry(undefined));
    await waitFor(() => expect(container.textContent).toContain('no branch'));
    expect(queryByTestId('secondary-root-branch-copy')).toBeNull();
  });

  it('ignores a stale response resolving after a newer load for the same root', async () => {
    const statusResolvers: Array<(v: unknown) => void> = [];
    mocks.getStatus.mockImplementation(
      () => new Promise((resolve) => statusResolvers.push(resolve)),
    );
    const { container, rerender } = await renderView(makeEntry('cached'));
    await waitFor(() => expect(statusResolvers).toHaveLength(1));

    // Switch away and back: the return trip starts a newer load for the
    // same root while the original one is still in flight.
    await rerender({ workspaceId: 'ws-1', entry: makeEntry('cached', 'root-2') });
    await rerender({ workspaceId: 'ws-1', entry: makeEntry('cached', 'root-1') });
    await waitFor(() => expect(statusResolvers).toHaveLength(3));

    // The newer load resolves first…
    statusResolvers[2]({ ok: true, data: makeStatus('fresh-branch') });
    await waitFor(() => expect(container.textContent).toContain('fresh-branch'));

    // …then the stale original resolves and must be discarded (the id-only
    // guard would pass here — same root — so this pins the epoch guard).
    statusResolvers[0]({ ok: true, data: makeStatus('stale-branch') });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(container.textContent).toContain('fresh-branch');
    expect(container.textContent).not.toContain('stale-branch');
  });

  it('splits the list at registeredCommitSha: divider + dimmed older commits behind the expander', async () => {
    mocks.getStatus.mockResolvedValue({ ok: true, data: makeStatus('main') });
    mocks.getHistory.mockResolvedValue({
      ok: true,
      data: {
        items: [
          makeCommit('newer222', 'feat: after registration'),
          makeCommit('bound111', 'chore: at registration'),
          makeCommit('older000', 'feat: before registration'),
        ],
      },
    });
    const { container, getByTestId, queryByTestId } = await renderView(
      makeEntry('main', 'root-1', 'bound111'),
    );

    // Commits newer than the boundary render normally; the boundary commit
    // and older ones are hidden behind the collapsed expander.
    await waitFor(() => expect(container.textContent).toContain('feat: after registration'));
    expect(container.textContent).not.toContain('chore: at registration');
    expect(container.textContent).not.toContain('feat: before registration');
    expect(queryByTestId('secondary-root-older-commits')).toBeNull();

    const toggle = getByTestId('secondary-root-boundary-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('Show older commits');
    expect(toggle.textContent).toContain('Root registered');

    await fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('true'));
    const older = getByTestId('secondary-root-older-commits');
    // Boundary commit renders inside the dimmed older section (inclusive).
    expect(older.textContent).toContain('chore: at registration');
    expect(older.textContent).toContain('feat: before registration');
    expect(older.className).toContain('opacity-60');

    // Collapse again
    await fireEvent.click(toggle);
    await waitFor(() => expect(queryByTestId('secondary-root-older-commits')).toBeNull());
  });

  it('falls open to the flat list when there is no registeredCommitSha', async () => {
    mocks.getStatus.mockResolvedValue({ ok: true, data: makeStatus('main') });
    mocks.getHistory.mockResolvedValue({
      ok: true,
      data: { items: [makeCommit('aaaa111', 'feat: one'), makeCommit('bbbb222', 'fix: two')] },
    });
    const { container, queryByTestId } = await renderView(makeEntry('main'));

    await waitFor(() => expect(container.textContent).toContain('feat: one'));
    expect(container.textContent).toContain('fix: two');
    expect(queryByTestId('secondary-root-boundary-toggle')).toBeNull();
    expect(queryByTestId('secondary-root-show-more')).toBeNull();
  });

  it('falls open to the flat list when the boundary SHA is not in history and no next page exists', async () => {
    // Rebased-away boundary: SHA never found, nextToken exhausted ⇒ flat list.
    mocks.getStatus.mockResolvedValue({ ok: true, data: makeStatus('main') });
    mocks.getHistory.mockResolvedValue({
      ok: true,
      data: { items: [makeCommit('aaaa111', 'feat: one')] },
    });
    const { container, queryByTestId } = await renderView(makeEntry('main', 'root-1', 'gone9999'));

    await waitFor(() => expect(container.textContent).toContain('feat: one'));
    expect(queryByTestId('secondary-root-boundary-toggle')).toBeNull();
    expect(queryByTestId('secondary-root-show-more')).toBeNull();
  });

  it('pages via nextToken when the boundary is beyond the loaded page', async () => {
    mocks.getStatus.mockResolvedValue({ ok: true, data: makeStatus('main') });
    mocks.getHistory.mockResolvedValueOnce({
      ok: true,
      data: { items: [makeCommit('aaaa111', 'feat: page one')], nextToken: 'tok-2' },
    });
    mocks.getHistory.mockResolvedValueOnce({
      ok: true,
      data: {
        items: [makeCommit('bound111', 'chore: at registration')],
      },
    });
    const { container, queryByTestId } = await renderView(makeEntry('main', 'root-1', 'bound111'));

    // The boundary page is loaded eagerly so the summary cannot expose a
    // partial or pre-registration count.
    await waitFor(() =>
      expect(mocks.getHistory).toHaveBeenCalledWith('ws-1', expect.any(Number), {
        gitRootId: 'root-1',
        nextToken: 'tok-2',
      }),
    );

    // Boundary found in the appended page: divider appears, "Show more" goes.
    await waitFor(() => expect(queryByTestId('secondary-root-boundary-toggle')).toBeTruthy());
    expect(queryByTestId('secondary-root-show-more')).toBeNull();
    expect(container.textContent).toContain('feat: page one');
    expect(container.textContent).not.toContain('chore: at registration');
  });

  it('de-dups appended commits so an offset-shifted page cannot repeat hashes', async () => {
    // The daemon token is an offset skip token: a commit landing between
    // pages shifts offsets, so page 2 can repeat page 1's tail.
    mocks.getStatus.mockResolvedValue({ ok: true, data: makeStatus('main') });
    mocks.getHistory.mockResolvedValueOnce({
      ok: true,
      data: {
        items: [makeCommit('aaaa111', 'feat: one'), makeCommit('bbbb222', 'fix: two')],
        nextToken: 'tok-2',
      },
    });
    mocks.getHistory.mockResolvedValueOnce({
      ok: true,
      data: {
        items: [
          makeCommit('bbbb222', 'fix: two'),
          makeCommit('bound111', 'chore: at registration'),
        ],
      },
    });
    const { container, getByTestId } = await renderView(makeEntry('main', 'root-1', 'bound111'));

    // Duplicate hash filtered on append (a duplicate key would crash the
    // keyed {#each}); the boundary from the appended page still applies.
    await waitFor(() => expect(getByTestId('secondary-root-boundary-toggle')).toBeTruthy());
    expect(container.textContent).toContain('feat: one');
    const matches = container.textContent?.match(/fix: two/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('renders the commit icon for human commits and the agent avatar for agent commits', async () => {
    mocks.getStatus.mockResolvedValue({ ok: true, data: makeStatus('main') });
    mocks.getHistory.mockResolvedValue({
      ok: true,
      data: {
        items: [
          makeCommit('aaaa111', 'feat: human commit'),
          makeCommit('bbbb222', 'feat: agent commit', {
            agentId: 'agent-1',
          } as Partial<CommitInfo>),
        ],
      },
    });
    const { container, queryAllByTestId } = await renderView(makeEntry('main'));
    await waitFor(() => expect(container.textContent).toContain('feat: human commit'));

    // Exactly one AgentAvatar (the agent commit); the human commit gets faCodeCommit.
    expect(queryAllByTestId('mock-component')).toHaveLength(1);
    expect(container.querySelectorAll('[data-icon="code-commit"]')).toHaveLength(1);
  });

  it('opens the gitRootId-scoped commit changeset when the message is clicked', async () => {
    mocks.getStatus.mockResolvedValue({ ok: true, data: makeStatus('main') });
    mocks.getHistory.mockResolvedValue({
      ok: true,
      data: { items: [makeCommit('aaaa111', 'feat: clickable')] },
    });
    const { getAllByTestId } = await renderView(makeEntry('main', 'root-9'));
    const open = await waitFor(() => getAllByTestId('secondary-root-commit-open')[0]);

    await fireEvent.click(open);
    // The dispatched action must carry the gitRootId so the changes tab scopes
    // its commitDetails/diffs/showFile reads to this secondary root.
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith({
        type: 'workspaceNavigation/openWorkspaceCommitChangeset',
        payload: ['ws-1', 'aaaa111', 'feat: clickable', { gitRootId: 'root-9' }],
      }),
    );
  });

  it('renders the saga-loaded gitRootId-scoped file list on expand', async () => {
    mocks.getStatus.mockResolvedValue({ ok: true, data: makeStatus('main') });
    mocks.getHistory.mockResolvedValue({
      ok: true,
      data: { items: [makeCommit('aaaa111', 'feat: expandable')] },
    });
    mocks.commitDetails.mockResolvedValue({
      commitHash: 'aaaa111',
      author: 'Dev',
      authorEmail: 'dev@example.com',
      date: '2026-07-01T00:00:00Z',
      message: 'feat: expandable',
      files: ['src/a.ts', 'src/b.ts'],
      fileDetails: [
        { path: 'src/a.ts', additions: 3, deletions: 1 },
        { path: 'src/b.ts', additions: 0, deletions: 2 },
      ],
    });
    const { getAllByTestId, queryAllByTestId } = await renderView(makeEntry('main', 'root-9'));
    const toggle = await waitFor(() => getAllByTestId('secondary-root-commit-toggle')[0]);
    expect(queryAllByTestId('file-row')).toHaveLength(0);

    await fireEvent.click(toggle);
    // The saga-owned details read is gitRootId-scoped (PROTOCOL §5.6).
    await waitFor(() =>
      expect(mocks.commitDetails).toHaveBeenCalledWith('ws-1', 'aaaa111', { gitRootId: 'root-9' }),
    );
    const rows = await waitFor(() => {
      const fileRows = queryAllByTestId('file-row');
      expect(fileRows).toHaveLength(2);
      return fileRows;
    });
    expect(rows[0].getAttribute('data-file-path')).toBe('src/a.ts');
    expect(rows[1].getAttribute('data-file-path')).toBe('src/b.ts');

    // Collapse hides the list; a second expand reuses the saga cache (no refetch).
    await fireEvent.click(toggle);
    await waitFor(() => expect(queryAllByTestId('file-row')).toHaveLength(0));
    await fireEvent.click(toggle);
    await waitFor(() => expect(queryAllByTestId('file-row')).toHaveLength(2));
    expect(mocks.commitDetails).toHaveBeenCalledTimes(1);
  });

  it('retries the file fetch on a later expand after a failed (null) details read', async () => {
    mocks.getStatus.mockResolvedValue({ ok: true, data: makeStatus('main') });
    mocks.getHistory.mockResolvedValue({
      ok: true,
      data: { items: [makeCommit('aaaa111', 'feat: retryable')] },
    });
    // The eager saga read fails (folds to null); expanding dispatches a
    // recoverable saga retry without turning the whole root into an error.
    mocks.commitDetails.mockResolvedValueOnce(null);
    const { getAllByTestId, queryAllByTestId } = await renderView(makeEntry('main', 'root-9'));
    const toggle = await waitFor(() => getAllByTestId('secondary-root-commit-toggle')[0]);

    await fireEvent.click(toggle);
    await waitFor(() => expect(mocks.commitDetails).toHaveBeenCalledTimes(2));
    expect(queryAllByTestId('file-row')).toHaveLength(0);

    mocks.commitDetails.mockResolvedValueOnce({
      commitHash: 'aaaa111',
      author: 'Dev',
      authorEmail: 'dev@example.com',
      date: '2026-07-01T00:00:00Z',
      message: 'feat: retryable',
      files: ['src/a.ts'],
      fileDetails: [{ path: 'src/a.ts', additions: 1, deletions: 0 }],
    });
    await fireEvent.click(toggle); // collapse
    await fireEvent.click(toggle); // expand again → retry
    await waitFor(() => expect(mocks.commitDetails).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(queryAllByTestId('file-row')).toHaveLength(1));
  });

  it('keeps root-keyed state isolated when an old root read resolves late', async () => {
    mocks.getStatus.mockResolvedValue({ ok: true, data: makeStatus('main') });
    mocks.getHistory.mockResolvedValue({
      ok: true,
      data: { items: [makeCommit('aaaa111', 'feat: shared commit')] },
    });
    // Old root's details read stays in flight across the root switch.
    let resolveDetails!: (value: unknown) => void;
    mocks.commitDetails.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDetails = resolve;
      }),
    );
    mocks.commitDetails.mockResolvedValueOnce({
      commitHash: 'aaaa111',
      author: 'Dev',
      authorEmail: 'dev@example.com',
      date: '2026-07-01T00:00:00Z',
      message: 'feat: shared commit',
      files: ['src/fresh.ts'],
      fileDetails: [{ path: 'src/fresh.ts', additions: 1, deletions: 0 }],
    });
    const { getAllByTestId, queryAllByTestId, rerender } = await renderView(
      makeEntry('main', 'root-9'),
    );
    await waitFor(() =>
      expect(mocks.commitDetails).toHaveBeenCalledWith('ws-1', 'aaaa111', { gitRootId: 'root-9' }),
    );

    await rerender({ workspaceId: 'ws-1', entry: makeEntry('main', 'root-10') });
    const newToggle = await waitFor(() => getAllByTestId('secondary-root-commit-toggle')[0]);
    await fireEvent.click(newToggle);
    const rows = await waitFor(() => {
      const fileRows = queryAllByTestId('file-row');
      expect(fileRows).toHaveLength(1);
      return fileRows;
    });
    expect(rows[0].getAttribute('data-file-path')).toBe('src/fresh.ts');

    resolveDetails({
      commitHash: 'aaaa111',
      author: 'Dev',
      authorEmail: 'dev@example.com',
      date: '2026-07-01T00:00:00Z',
      message: 'feat: shared commit',
      files: ['src/stale.ts'],
      fileDetails: [{ path: 'src/stale.ts', additions: 9, deletions: 9 }],
    });
    await waitFor(() =>
      expect(queryAllByTestId('file-row')[0]?.getAttribute('data-file-path')).toBe('src/fresh.ts'),
    );
  });
});
