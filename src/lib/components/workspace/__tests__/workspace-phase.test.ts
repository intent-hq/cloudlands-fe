import { describe, expect, it } from 'vitest';
import type { PullRequestInfo, Workspace, WorkspaceId } from '$shared/types';
import { PullRequestStatus, WorkspaceStatusEnum } from '$shared/types';
import { deriveWorkspacePhase, deriveWorkspaceStats } from '../workspace-phase';

const timestamp = '2026-01-01T00:00:00.000Z';

function makePR(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 'pr-1',
    number: 1,
    url: 'https://example.com/pull/1',
    title: 'Test PR',
    status: PullRequestStatus.Open,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws-1' as WorkspaceId,
    title: 'Test Workspace',
    branch: 'feature/test',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatusEnum.Active,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe('deriveWorkspacePhase', () => {
  it('returns shipped when activePullRequest is merged even if prStatus is stale open', () => {
    const phase = deriveWorkspacePhase(
      makeWorkspace({
        prStatus: PullRequestStatus.Open,
        activePullRequest: makePR({ status: PullRequestStatus.Merged }),
      }),
    );

    expect(phase.phase).toBe('shipped');
  });

  it('returns shipped when activePullRequest is merged and prStatus is absent', () => {
    const phase = deriveWorkspacePhase(
      makeWorkspace({
        activePullRequest: makePR({ status: PullRequestStatus.Merged }),
      }),
    );

    expect(phase.phase).toBe('shipped');
  });

  it('returns reviewing for an open activePullRequest', () => {
    const phase = deriveWorkspacePhase(
      makeWorkspace({
        activePullRequest: makePR({ status: PullRequestStatus.Open }),
      }),
    );

    expect(phase.phase).toBe('reviewing');
  });

  it('returns shipped for a merged pullRequests entry', () => {
    const phase = deriveWorkspacePhase(
      makeWorkspace({
        pullRequests: [makePR({ status: PullRequestStatus.Merged })],
      }),
    );

    expect(phase.phase).toBe('shipped');
  });
});

describe('deriveWorkspaceStats', () => {
  it('counts a merged activePullRequest as merged without marking it open', () => {
    const stats = deriveWorkspaceStats(
      makeWorkspace({
        activePullRequest: makePR({ status: PullRequestStatus.Merged }),
      }),
    );

    expect(stats.pr.hasMerged).toBe(true);
    expect(stats.pr.hasOpen).toBe(false);
  });

  it('does not count a closed activePullRequest as open', () => {
    const stats = deriveWorkspaceStats(
      makeWorkspace({
        activePullRequest: makePR({ status: PullRequestStatus.Closed }),
      }),
    );

    expect(stats.pr.hasClosed).toBe(true);
    expect(stats.pr.hasOpen).toBe(false);
  });

  it('continues to count an open activePullRequest as open', () => {
    const stats = deriveWorkspaceStats(
      makeWorkspace({
        activePullRequest: makePR({ status: PullRequestStatus.Open }),
      }),
    );

    expect(stats.pr.hasOpen).toBe(true);
  });
});
