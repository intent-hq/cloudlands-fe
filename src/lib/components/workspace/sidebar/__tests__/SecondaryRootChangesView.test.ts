import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
} from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/svelte';
import { warmImport } from '../../../../../test/warm-import';
import type { WorkspaceGitRootEntry } from '$store/renderer/slices/git-roots/git-roots-selectors';
import type { GitStatus } from '$shared/types';

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getHistory: vi.fn(),
  writeTextToClipboard: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

// gitRootId-scoped read-only per-root reads (PROTOCOL §5.6, monorepo#2053).
vi.mock('$features/git/git.client', () => ({
  gitClient: { getStatus: mocks.getStatus, getHistory: mocks.getHistory },
}));

vi.mock('$lib/utils/clipboard', () => ({
  writeTextToClipboard: mocks.writeTextToClipboard,
}));

vi.mock('svelte-sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock('svelte-fa', async () => ({ default: (await import('./mocks/Fa.svelte')).default }));

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

function makeEntry(branch: string | undefined, rootId = 'root-1'): WorkspaceGitRootEntry {
  return {
    key: rootId,
    isPrimary: false,
    path: 'packages/sub',
    branch,
    gitRoot: { id: rootId },
  } as WorkspaceGitRootEntry;
}

async function renderView(entry: WorkspaceGitRootEntry) {
  const SecondaryRootChangesView = (await import('../SecondaryRootChangesView.svelte')).default;
  return render(SecondaryRootChangesView, { props: { workspaceId: 'ws-1', entry } });
}

warmImport(() => import('./mocks/Fa.svelte'));
warmImport(() => import('../SecondaryRootChangesView.svelte'));

describe('SecondaryRootChangesView', () => {
  beforeEach(() => {
    mocks.getStatus.mockReset();
    mocks.getHistory.mockReset();
    mocks.writeTextToClipboard.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    mocks.getHistory.mockResolvedValue({ ok: true, data: [] });
    mocks.writeTextToClipboard.mockResolvedValue(undefined);
  });

  it('prefers the freshly loaded status.branch over the cached entry.branch', async () => {
    // A refresh after a branch checkout must show the new branch, not the
    // stale one cached in the git-root list entry.
    mocks.getStatus.mockResolvedValue({ ok: true, data: makeStatus('fresh-branch') });
    const { container } = await renderView(makeEntry('stale-branch'));
    await waitFor(() => expect(container.textContent).toContain('fresh-branch'));
    expect(container.textContent).not.toContain('stale-branch');
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
    await waitFor(() =>
      expect(container.textContent).toContain('Failed to load git root state'),
    );
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
});
