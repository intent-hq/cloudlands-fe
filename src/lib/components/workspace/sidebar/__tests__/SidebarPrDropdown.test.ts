import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { faCodePullRequest } from '@fortawesome/free-solid-svg-icons';
import { ensureWorkspacePullRequestPool } from '$features/workspace/workspace-detail-hydration';
import { handleLink } from '$features/navigation/link-handler';
import { m } from '$shared/paraglide/messages.js';
import SidebarPrDropdown from '../SidebarPrDropdown.svelte';
import type { WorkspacePRPresentationRow } from '../workspace-pr-presentation';

vi.mock('$features/workspace/workspace-detail-hydration', () => ({
  ensureWorkspacePullRequestPool: vi.fn(),
}));
vi.mock('$features/navigation/link-handler', () => ({ handleLink: vi.fn() }));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  isWorkspacePullRequestPoolTruncated: () => false,
}));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
const row: WorkspacePRPresentationRow = {
  identity: 'repo#12',
  number: 12,
  title: 'Keep visible',
  url: 'https://github.com/owner/repo/pull/12',
  repo: 'owner/repo',
  repoContext: undefined,
  status: 'open',
  queued: false,
  statusIcon: faCodePullRequest,
  foregroundClass: '',
  backgroundClass: '',
  accessibleStateLabel: 'Open',
  details: '',
  monitorAgentId: undefined,
  monitorOnly: false,
};

describe('SidebarPrDropdown hydration', () => {
  it('retains links during refresh, surfaces failure and retries without closing', async () => {
    let reject!: (reason: Error) => void;
    vi.mocked(ensureWorkspacePullRequestPool).mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    render(SidebarPrDropdown, { rows: [row], workspaceId: 'ws-pr' });
    await fireEvent.click(screen.getByRole('button'));
    expect(ensureWorkspacePullRequestPool).toHaveBeenCalledWith('ws-pr');
    expect(screen.getByRole('menuitem', { name: /Keep visible/ })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(
      m.workspace_sidebarPrDropdown_refreshing_label(),
    );
    reject(new Error('offline'));
    const retry = await screen.findByRole('menuitem', {
      name: m.workspace_repoSelector_retrySuggestions_label(),
    });
    vi.mocked(ensureWorkspacePullRequestPool).mockResolvedValueOnce({} as never);
    await fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(ensureWorkspacePullRequestPool).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('menu')).toBeTruthy();
    await fireEvent.click(screen.getByRole('menuitem', { name: /Keep visible/ }));
    expect(handleLink).toHaveBeenCalledWith(row.url, { workspaceId: 'ws-pr' });
  });

  it('does not create a fake empty menu or fetch until a PR exists', () => {
    render(SidebarPrDropdown, { rows: [], workspaceId: 'ws-pr' });
    expect(screen.queryByRole('button')).toBeNull();
    expect(ensureWorkspacePullRequestPool).not.toHaveBeenCalled();
  });
});
