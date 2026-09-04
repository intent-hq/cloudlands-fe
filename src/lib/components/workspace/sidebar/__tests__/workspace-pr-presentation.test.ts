import type { PrMonitorRow, PrMonitorSnapshot } from '$features/pr-monitor/pr-monitor-service';
import type { PullRequestInfo } from '$shared/types';
import { PullRequestStatus } from '$shared/types';
import { describe, expect, it } from 'vitest';
import { buildWorkspacePRPresentationModel } from '../workspace-pr-presentation';

const workspaceRepo = 'acme/widgets';
const buildPrUrl = (number: number, fallback?: string) =>
  fallback ?? `https://github.com/${workspaceRepo}/pull/${number}`;
const getDisplayTitle = (pr: PullRequestInfo) => pr.title;

function makePR(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 'pr-1',
    number: 1,
    url: 'https://github.com/acme/widgets/pull/1',
    title: 'Workspace PR',
    status: PullRequestStatus.Open,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-02T00:00:00Z',
    ...overrides,
  };
}

function makeMonitor(overrides: Partial<PrMonitorRow> = {}): PrMonitorRow {
  return {
    monitorId: 'mon-1',
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    repo: workspaceRepo,
    prNumber: 1,
    state: 'active',
    pendingChanges: [],
    hasPendingChanges: false,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-02T00:00:00Z',
    title: 'Monitored PR',
    url: 'https://github.com/acme/widgets/pull/1',
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<PrMonitorSnapshot> = {}): PrMonitorSnapshot {
  return {
    state: 'open',
    isDraft: false,
    hasConflicts: false,
    isBehind: false,
    checks: {
      total: 0,
      passed: 0,
      failed: 0,
      pending: 0,
      failingRequired: 0,
      pendingRequired: 0,
      requiredKnown: false,
    },
    approvals: { decision: '', have: 0, changesRequested: 0 },
    threads: { unresolved: 0 },
    rulesKnown: false,
    ...overrides,
  };
}

function build(
  workspacePRs: PullRequestInfo[] | undefined,
  activePR: PullRequestInfo | null,
  monitors: PrMonitorRow[],
) {
  return buildWorkspacePRPresentationModel({
    workspacePRs,
    activePR,
    monitors,
    workspaceRepo,
    buildPrUrl,
    getDisplayTitle,
  });
}

describe('buildWorkspacePRPresentationModel', () => {
  it('returns every branch-linked PR in lifecycle order, earliest state first', () => {
    const rows = build(
      [
        makePR({ id: 'closed', number: 4, status: PullRequestStatus.Closed }),
        makePR({ id: 'merged', number: 3, status: PullRequestStatus.Merged }),
        makePR({ id: 'draft', number: 2, isDraft: true }),
        makePR({ id: 'open', number: 1 }),
      ],
      null,
      [],
    );

    expect(rows.map(({ status }) => status)).toEqual(['draft', 'open', 'merged', 'closed']);
    expect(rows.map(({ number }) => number)).toEqual([2, 1, 3, 4]);
  });

  it('breaks same-status ties by most recent update, then higher PR number', () => {
    const rows = build(
      [
        makePR({ id: 'older', number: 12, updatedAt: '2026-08-01T00:00:00Z' }),
        makePR({ id: 'newer', number: 5, updatedAt: '2026-08-09T00:00:00Z' }),
        makePR({ id: 'no-timestamp', number: 20, updatedAt: undefined }),
        makePR({ id: 'same-time-low', number: 7, updatedAt: '2026-08-09T00:00:00Z' }),
      ],
      null,
      [],
    );

    expect(rows.every(({ status }) => status === 'open')).toBe(true);
    expect(rows.map(({ number }) => number)).toEqual([7, 5, 12, 20]);
  });

  it('uses the active PR only as the legacy fallback', () => {
    const active = makePR({ number: 9, title: 'Active fallback' });
    expect(build([], active, [])).toMatchObject([{ number: 9, title: 'Active fallback' }]);
    expect(build([makePR({ number: 7 })], active, []).map(({ number }) => number)).toEqual([7]);
  });

  it('deduplicates duplicate same-repo monitors onto the branch row', () => {
    const rows = build([makePR()], null, [
      makeMonitor({ monitorId: 'mon-1', agentId: 'agent-1' }),
      makeMonitor({ monitorId: 'mon-2', agentId: 'agent-2' }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      identity: 'acme/widgets#1',
      title: 'Workspace PR',
      monitorAgentId: 'agent-2',
      monitorOnly: false,
    });
  });

  it('preserves repo-qualified identity when PR numbers collide across repos', () => {
    const rows = build([makePR({ number: 42 })], null, [
      makeMonitor({
        repo: 'other/tools',
        prNumber: 42,
        title: 'Cross-repo PR',
        url: 'https://github.com/other/tools/pull/42',
      }),
    ]);

    expect(rows.map(({ identity }) => identity)).toEqual(['acme/widgets#42', 'other/tools#42']);
    expect(rows[1]).toMatchObject({ repo: 'other/tools', repoContext: 'other/tools' });
  });

  it('keeps repo context on a cross-repo pool entry (intent-hq/intent#3964)', () => {
    const rows = build(
      [
        makePR({ id: 'own', number: 7 }),
        makePR({
          id: 'cross',
          number: 16,
          title: 'Cross-repo PR',
          url: 'https://github.com/other-org/tools/pull/16',
        }),
      ],
      null,
      [],
    );

    expect(rows.map(({ identity }) => identity).sort()).toEqual([
      'acme/widgets#7',
      'other-org/tools#16',
    ]);
    expect(rows.find((row) => row.number === 16)).toMatchObject({
      repo: 'other-org/tools',
      repoContext: 'other-org/tools',
      url: 'https://github.com/other-org/tools/pull/16',
    });
    expect(rows.find((row) => row.number === 7)?.repoContext).toBeUndefined();
  });

  it('annotates a cross-repo pool entry with its monitor instead of duplicating it', () => {
    const rows = build(
      [
        makePR({
          id: 'cross',
          number: 16,
          title: 'Cross-repo PR',
          url: 'https://github.com/other-org/tools/pull/16',
        }),
      ],
      null,
      [
        makeMonitor({
          repo: 'other-org/tools',
          prNumber: 16,
          title: 'Monitored cross-repo PR',
          url: 'https://github.com/other-org/tools/pull/16',
        }),
      ],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      identity: 'other-org/tools#16',
      repo: 'other-org/tools',
      repoContext: 'other-org/tools',
      monitorAgentId: 'agent-1',
      monitorOnly: false,
    });
  });

  it('does not let same-numbered PRs collide across repos in the isDraft lookup', () => {
    const rows = build(
      [
        makePR({ id: 'own', number: 5, isDraft: true }),
        makePR({
          id: 'cross',
          number: 5,
          title: 'Cross-repo PR',
          url: 'https://github.com/other-org/tools/pull/5',
        }),
      ],
      null,
      [],
    );

    const own = rows.find((row) => row.identity === 'acme/widgets#5');
    const cross = rows.find((row) => row.identity === 'other-org/tools#5');
    expect(own?.status).toBe('draft');
    expect(cross?.status).toBe('open');
  });

  it('keeps source-backed details when the workspace repo is unknown', () => {
    const rows = buildWorkspacePRPresentationModel({
      workspacePRs: [
        makePR({
          number: 3,
          isDraft: true,
          reviewDecision: 'CHANGES_REQUESTED',
        }),
      ],
      activePR: null,
      monitors: [],
      workspaceRepo: undefined,
      buildPrUrl,
      getDisplayTitle,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ identity: '3', status: 'draft' });
    expect(rows[0].details).toContain('Changes requested');
  });

  it('presents a snapshotless monitor without inventing merge state', () => {
    const [row] = build([], null, [makeMonitor({ prNumber: 8, lastSnapshot: undefined })]);
    expect(row).toMatchObject({
      status: 'open',
      queued: false,
      accessibleStateLabel: 'Open',
      details: 'Open',
    });
  });

  describe('merge-queued rows', () => {
    it('labels an open PR Queued when its monitor snapshot reports it in the merge queue', () => {
      const [row] = build([makePR()], null, [
        makeMonitor({ lastSnapshot: makeSnapshot({ isInMergeQueue: true }) }),
      ]);

      expect(row).toMatchObject({ status: 'open', queued: true, accessibleStateLabel: 'Queued' });
      expect(row.details.split('\n')[0]).toBe('Queued');
      expect(row.details).not.toContain('Open');
    });

    it('keeps Open for an open PR whose snapshot carries no queue flag', () => {
      const [row] = build([makePR()], null, [makeMonitor({ lastSnapshot: makeSnapshot() })]);

      expect(row).toMatchObject({ status: 'open', queued: false, accessibleStateLabel: 'Open' });
      expect(row.details.split('\n')[0]).toBe('Open');
    });

    it('ignores a stale queue flag on a merged PR', () => {
      const [row] = build([makePR({ status: PullRequestStatus.Merged })], null, [
        makeMonitor({ lastSnapshot: makeSnapshot({ state: 'merged', isInMergeQueue: true }) }),
      ]);

      expect(row).toMatchObject({
        status: 'merged',
        queued: false,
        accessibleStateLabel: 'Merged',
        details: 'Merged',
      });
    });

    it('ignores a stale queue flag on a draft PR', () => {
      const [row] = build([makePR({ isDraft: true })], null, [
        makeMonitor({ lastSnapshot: makeSnapshot({ isInMergeQueue: true }) }),
      ]);

      expect(row).toMatchObject({ status: 'draft', queued: false, accessibleStateLabel: 'Draft' });
    });

    it('keeps the open sort position and colour treatment for a queued row', () => {
      const rows = build(
        [
          makePR({
            id: 'draft',
            number: 2,
            url: 'https://github.com/acme/widgets/pull/2',
            isDraft: true,
          }),
          makePR({ id: 'queued', number: 1 }),
        ],
        null,
        [makeMonitor({ prNumber: 1, lastSnapshot: makeSnapshot({ isInMergeQueue: true }) })],
      );

      expect(rows.map(({ number, status }) => [number, status])).toEqual([
        [2, 'draft'],
        [1, 'open'],
      ]);
      expect(rows[1]).toMatchObject({
        queued: true,
        foregroundClass: 'text-success',
        backgroundClass: 'bg-success/10',
      });
    });

    it('labels a monitor-only row Queued from its snapshot', () => {
      const [row] = build([], null, [
        makeMonitor({ prNumber: 9, lastSnapshot: makeSnapshot({ isInMergeQueue: true }) }),
      ]);

      expect(row).toMatchObject({
        number: 9,
        monitorOnly: true,
        status: 'open',
        queued: true,
        accessibleStateLabel: 'Queued',
      });
      expect(row.details.split('\n')[0]).toBe('Queued');
    });

    it('labels a cross-repo monitor-only row Queued from its snapshot', () => {
      const [row] = build([], null, [
        makeMonitor({
          repo: 'other/tools',
          prNumber: 5,
          url: 'https://github.com/other/tools/pull/5',
          lastSnapshot: makeSnapshot({ isInMergeQueue: true }),
        }),
      ]);

      expect(row).toMatchObject({
        identity: 'other/tools#5',
        repoContext: 'other/tools',
        monitorOnly: true,
        status: 'open',
        queued: true,
        accessibleStateLabel: 'Queued',
      });
    });

    it('ignores a stale queue flag on a settled monitor-only row', () => {
      const rows = build([], null, [
        makeMonitor({
          monitorId: 'mon-merged',
          prNumber: 3,
          url: 'https://github.com/acme/widgets/pull/3',
          lastSnapshot: makeSnapshot({ state: 'merged', isInMergeQueue: true }),
        }),
        makeMonitor({
          monitorId: 'mon-closed',
          prNumber: 4,
          url: 'https://github.com/acme/widgets/pull/4',
          lastSnapshot: makeSnapshot({ state: 'closed', isInMergeQueue: true }),
        }),
      ]);

      expect(rows.find((row) => row.number === 3)).toMatchObject({
        monitorOnly: true,
        status: 'merged',
        queued: false,
        accessibleStateLabel: 'Merged',
        details: 'Merged',
      });
      expect(rows.find((row) => row.number === 4)).toMatchObject({
        monitorOnly: true,
        status: 'closed',
        queued: false,
        accessibleStateLabel: 'Closed',
        details: 'Closed',
      });
    });
  });

  it('returns one semantic icon and color treatment for each state', () => {
    const rows = build(
      [
        makePR({ id: 'open', number: 1 }),
        makePR({ id: 'draft', number: 2, status: PullRequestStatus.Draft }),
        makePR({ id: 'merged', number: 3, status: PullRequestStatus.Merged }),
        makePR({ id: 'closed', number: 4, status: PullRequestStatus.Closed }),
      ],
      null,
      [],
    );

    expect(
      rows.map(({ status, foregroundClass, backgroundClass, accessibleStateLabel }) => ({
        status,
        foregroundClass,
        backgroundClass,
        accessibleStateLabel,
      })),
    ).toEqual([
      {
        status: 'draft',
        foregroundClass: 'text-muted-foreground',
        backgroundClass: 'bg-muted',
        accessibleStateLabel: 'Draft',
      },
      {
        status: 'open',
        foregroundClass: 'text-success',
        backgroundClass: 'bg-success/10',
        accessibleStateLabel: 'Open',
      },
      {
        status: 'merged',
        foregroundClass: 'text-purple-500',
        backgroundClass: 'bg-purple-500/10',
        accessibleStateLabel: 'Merged',
      },
      {
        status: 'closed',
        foregroundClass: 'text-error-foreground',
        backgroundClass: 'bg-destructive/10',
        accessibleStateLabel: 'Closed',
      },
    ]);
    expect(rows.every((row) => row.statusIcon !== undefined)).toBe(true);
  });

  it('includes conflict, CI, and review details from the existing PR utility', () => {
    const [row] = build(
      [
        makePR({
          mergeConflicts: true,
          ciStatus: { total: 3, passed: 1, failed: 1, pending: 1 },
          reviewDecision: 'CHANGES_REQUESTED',
        }),
      ],
      null,
      [],
    );

    expect(row.details).toContain('Merge conflicts');
    expect(row.details).toContain('1/3 checks failing (1 running)');
    expect(row.details).toContain('Changes requested');
  });
});
