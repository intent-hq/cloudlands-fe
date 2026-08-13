import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
} from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import { warmImport } from '../../../../../test/warm-import';
import type { WorkspaceGitRootEntry } from '$store/renderer/slices/git-roots/git-roots-selectors';
import type { GitStatus } from '$shared/types';

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getHistory: vi.fn(),
}));

// gitRootId-scoped read-only per-root reads (PROTOCOL §5.6, monorepo#2053).
vi.mock('$features/git/git.client', () => ({
  gitClient: { getStatus: mocks.getStatus, getHistory: mocks.getHistory },
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

function makeEntry(branch: string | undefined): WorkspaceGitRootEntry {
  return {
    key: 'root-1',
    isPrimary: false,
    path: 'packages/sub',
    branch,
    gitRoot: { id: 'root-1' },
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
    mocks.getHistory.mockResolvedValue({ ok: true, data: [] });
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
});
