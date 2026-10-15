/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PullRequestStatus,
  WorkspaceStatusEnum,
  type PullRequestInfo,
  type Workspace,
} from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import HomeWorkspacePullBadge from './HomeWorkspacePullBadge.svelte';

const pr = (number: number, overrides: Partial<PullRequestInfo> = {}): PullRequestInfo => ({
  id: `pr-${number}`,
  number,
  url: `https://github.com/intent-hq/cloudlands-fe/pull/${number}`,
  title: `PR ${number}`,
  status: PullRequestStatus.Open,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...overrides,
});
const workspace = (
  pullRequests: PullRequestInfo[],
  overrides: Partial<Workspace> = {},
): Workspace => ({
  id: WorkspaceId('home-pr-priority'),
  title: 'Paginate and virtualize notes',
  branch: 'notes',
  status: WorkspaceStatusEnum.Active,
  changesets: [],
  timeline: [],
  conversationInfo: [],
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  repositoryOwner: 'intent-hq',
  repositoryName: 'intent',
  pullRequests,
  ...overrides,
});
const merged = pr(6693, {
  status: PullRequestStatus.Merged,
  url: 'https://github.com/intent-hq/intent/pull/6693',
  updatedAt: '2026-10-15T00:00:00Z',
});

afterEach(cleanup);

describe('Home representative PR', () => {
  it('shows an older open component PR ahead of the first merged PR', () => {
    render(HomeWorkspacePullBadge, { workspace: workspace([merged, pr(3239), pr(3261)]) });
    expect(screen.getByText('#3261')).toBeTruthy();
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.queryByText('#6693')).toBeNull();
  });

  it('prefers a draft but ignores stale draft bits on terminal PRs', () => {
    render(HomeWorkspacePullBadge, {
      workspace: workspace([{ ...merged, isDraft: true }, pr(3261), pr(3239, { isDraft: true })]),
    });
    expect(screen.getByText('#3239')).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
  });

  it('uses recency before number among open PRs', () => {
    render(HomeWorkspacePullBadge, {
      workspace: workspace([pr(3261), pr(3239, { updatedAt: '2026-10-14T00:00:00Z' })]),
    });
    expect(screen.getByText('#3239')).toBeTruthy();
  });

  it.each([true, false])(
    'keeps same-number cross-repository PRs distinct (repo known: %s)',
    (known) => {
      render(HomeWorkspacePullBadge, {
        workspace: workspace(
          [{ ...merged, number: 3239 }, pr(3239, { mergeConflicts: true })],
          known ? {} : { repositoryOwner: undefined, repositoryName: undefined },
        ),
      });
      expect(screen.getByText('#3239')).toBeTruthy();
      expect(screen.getByText('Conflict')).toBeTruthy();
    },
  );

  it('preserves queue enrichment on the selected open PR', () => {
    render(HomeWorkspacePullBadge, {
      workspace: workspace([merged, pr(3239, { isInMergeQueue: true })]),
    });
    expect(screen.getByText('Queued')).toBeTruthy();
    expect(screen.getByText('#3239')).toBeTruthy();
  });

  it('reselects when the current PR merges', async () => {
    const { rerender } = render(HomeWorkspacePullBadge, {
      workspace: workspace([pr(3261), pr(3239)]),
    });
    expect(screen.getByText('#3261')).toBeTruthy();
    await rerender({
      workspace: workspace([pr(3261, { status: PullRequestStatus.Merged }), pr(3239)]),
    });
    expect(screen.getByText('#3239')).toBeTruthy();
    expect(screen.getByText('Open')).toBeTruthy();
  });

  it('prefers merged over closed when all PRs are terminal', () => {
    render(HomeWorkspacePullBadge, {
      workspace: workspace([pr(9999, { status: PullRequestStatus.Closed }), merged]),
    });
    expect(screen.getByText('#6693')).toBeTruthy();
    expect(screen.getByText('Merged')).toBeTruthy();
  });

  it('falls back to the active PR for an empty pool', () => {
    render(HomeWorkspacePullBadge, { workspace: workspace([], { activePullRequest: pr(3239) }) });
    expect(screen.getByText('#3239')).toBeTruthy();
  });

  it('renders no badge when no PR is available', () => {
    const { container } = render(HomeWorkspacePullBadge, { workspace: workspace([]) });
    expect(container.querySelector('[data-home-workspace-pr-badge]')).toBeNull();
  });
});
