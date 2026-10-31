import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Workspace } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';
import { buildWorkspacePRPresentationModel } from '../workspace-pr-presentation';
import WorkspacePullRequests from '../WorkspacePullRequests.svelte';

const { hydrate, openLink } = vi.hoisted(() => ({ hydrate: vi.fn(), openLink: vi.fn() }));
vi.mock('$features/workspace/workspace-detail-hydration', () => ({
  ensureWorkspacePullRequestPool: hydrate,
}));
vi.mock('$features/navigation/link-handler', () => ({ handleLink: openLink }));

beforeEach(() => vi.clearAllMocks());

it('loads truncated PR records and allows retry after a failed read', async () => {
  hydrate.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ pullRequests: [] });
  const view = render(WorkspacePullRequests, {
    workspaceId: 'workspace',
    rows: [],
    truncated: true,
  });
  const retry = await view.findByRole('button', {
    name: m.workspace_repoSelector_retrySuggestions_label(),
  });
  expect(hydrate).toHaveBeenCalledWith('workspace');
  await fireEvent.click(retry);
  await waitFor(() => expect(hydrate).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(view.queryByRole('status')).toBeNull());
});

it('ignores a hydration result after switching workspaces', async () => {
  let complete!: (value: Workspace | undefined) => void;
  hydrate.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const view = render(WorkspacePullRequests, { workspaceId: 'first', rows: [], truncated: true });
  await waitFor(() => expect(hydrate).toHaveBeenCalledWith('first'));
  await view.rerender({ workspaceId: 'second', rows: [], truncated: false });
  complete(undefined);
  await waitFor(() => expect(view.queryByRole('status')).toBeNull());
  expect(hydrate).toHaveBeenCalledTimes(1);
});

it('opens the selected submodule PR through its own URL', async () => {
  const rows = buildWorkspacePRPresentationModel({
    workspacePRs: [],
    activePR: null,
    workspaceRepo: 'acme/main',
    buildPrUrl: () => '',
    getDisplayTitle: (pr) => pr.title,
    monitors: [
      {
        monitorId: 'monitor',
        workspaceId: 'workspace',
        agentId: 'agent',
        repo: 'acme/backend',
        prNumber: 42,
        state: 'active',
        pendingChanges: [],
        hasPendingChanges: false,
        createdAt: '',
        updatedAt: '',
        title: 'Backend changes',
        url: 'https://github.com/acme/backend/pull/42',
      },
    ],
  });
  const view = render(WorkspacePullRequests, { workspaceId: 'workspace', rows });
  await fireEvent.click(view.getByRole('button', { name: /Backend changes/ }));
  expect(openLink).toHaveBeenCalledWith('https://github.com/acme/backend/pull/42', {
    workspaceId: 'workspace',
  });
  expect(hydrate).not.toHaveBeenCalled();
});
