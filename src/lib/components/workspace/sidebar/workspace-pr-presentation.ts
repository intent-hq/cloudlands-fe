import type {
  ReviewMonitorRow as PrMonitorRow,
  ReviewMonitorExtension,
} from '$shared/types/pr-monitor';
import { monitorNumber } from '$lib/utils/review-monitor-presentation';
import type { PRInfo } from '$lib/components/file-tracking/accept-changes/types';
import { getPRTooltipContent } from '$lib/utils/pr-status';
import { m } from '$shared/paraglide/messages.js';
import type { PullRequestInfo } from '$shared/types';
import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
import { faCodeMerge, faCodePullRequest } from '@fortawesome/free-solid-svg-icons';
import {
  getPRStatusTooltip,
  isPRQueued,
  mapWorkspacePRs,
  mergeMonitoredPRs,
  prRepoFromUrl,
  type GitRootPRSource,
} from './sidebar-changes-utils';

export interface WorkspacePRPresentationOptions {
  workspacePRs: PullRequestInfo[] | undefined;
  activePR: PullRequestInfo | null | undefined;
  monitors: PrMonitorRow[];
  workspaceRepo: string | undefined;
  buildPrUrl: (prNumber: number, fallbackUrl?: string) => string;
  getDisplayTitle: (pr: PullRequestInfo) => string;
  secondaryRoots?: GitRootPRSource[];
}

export interface WorkspacePRPresentationRow extends ReviewMonitorExtension {
  numberLabel?: string;
  identity: string;
  number: number;
  title: string;
  url: string;
  repo: string | undefined;
  repoContext: string | undefined;
  status: PRInfo['status'];
  /** Open PR sitting in the merge queue, per its monitor snapshot or, without
   * one, the daemon pool entry's `isInMergeQueue`. The `status` stays `open`
   * (`data-pr-status` is unchanged); the row sorts ahead of every other PR
   * and `accessibleStateLabel` / `details` say "Queued". */
  queued: boolean;
  statusIcon: IconDefinition;
  foregroundClass: string;
  backgroundClass: string;
  accessibleStateLabel: string;
  details: string;
  monitorAgentId: string | undefined;
  monitorOnly: boolean;
}

/**
 * PR ranking: a merge-queued PR comes first — it is the one about to land,
 * so the workspace card's single pill names it. The rest sort earliest-in-flow
 * first, so the next row is the least-progressed PR (a draft ahead of an open
 * PR ahead of a merged one). The workspace card renders only the first row,
 * so the same-rank tie-breaker is user-visible: the most recently updated PR
 * wins (`updatedAt` desc, missing timestamps last), then the higher PR number,
 * then the repo-qualified identity. Other merge-readiness signals from a
 * monitor snapshot do not take part in the ranking.
 */
const PR_RANK: Record<PRInfo['status'] | 'queued', number> = {
  queued: 0,
  draft: 1,
  open: 2,
  merged: 3,
  closed: 4,
};

function prIdentity(repo: string | undefined, number: number): string {
  return repo ? `${repo}#${number}` : String(number);
}

function normalizedPrIdentity(repo: string | undefined, number: number): string {
  return prIdentity(repo?.toLowerCase(), number);
}

function compareMissingLast(a: string | undefined, b: string | undefined): number {
  if (a && b) return b.localeCompare(a);
  if (a) return -1;
  if (b) return 1;
  return 0;
}

function getPRStatusPresentation(
  status: PRInfo['status'],
  queued: boolean,
): Pick<
  WorkspacePRPresentationRow,
  'statusIcon' | 'foregroundClass' | 'backgroundClass' | 'accessibleStateLabel'
> {
  if (status === 'merged') {
    return {
      statusIcon: faCodeMerge,
      foregroundClass: 'text-purple-500',
      backgroundClass: 'bg-purple-500/10',
      accessibleStateLabel: m.workspace_prSection_merged_label(),
    };
  }
  if (status === 'closed') {
    return {
      statusIcon: faCodePullRequest,
      foregroundClass: 'text-danger',
      backgroundClass: 'bg-danger-background/10',
      accessibleStateLabel: m.workspace_prSection_closed_label(),
    };
  }
  if (status === 'draft') {
    return {
      statusIcon: faCodePullRequest,
      foregroundClass: 'text-muted-foreground',
      backgroundClass: 'bg-muted',
      accessibleStateLabel: m.workspace_prSection_statusDraft_label(),
    };
  }
  return {
    statusIcon: faCodePullRequest,
    foregroundClass: 'text-success',
    backgroundClass: 'bg-success/10',
    accessibleStateLabel: queued
      ? m.workspace_prSection_statusQueued_label()
      : m.workspace_prSection_statusOpen_label(),
  };
}

/**
 * Build presentation rows for every PR attributable to a workspace. The pool
 * keeps the existing branch/active fallback and monitor wire semantics, then
 * deduplicates by case-insensitive, repo-qualified GitHub identity. Rows are
 * sorted merge-queued first, then earliest-in-flow (see `PR_RANK`).
 */
export function buildWorkspacePRPresentationModel({
  workspacePRs,
  activePR,
  monitors,
  workspaceRepo,
  buildPrUrl,
  getDisplayTitle,
  secondaryRoots = [],
}: WorkspacePRPresentationOptions): WorkspacePRPresentationRow[] {
  const branchSources = [
    ...(workspacePRs?.length ? workspacePRs : activePR ? [activePR] : []),
    ...secondaryRoots.flatMap((root) =>
      root.repoOwner && root.repoName
        ? (root.pullRequests ?? []).map((pr) => ({
            ...pr,
            url:
              pr.url || `https://github.com/${root.repoOwner}/${root.repoName}/pull/${pr.number}`,
          }))
        : [],
    ),
  ];
  // The daemon-merged `pullRequests` pool can contain cross-repo entries whose
  // `url` is authoritative for their repo (intent-hq/intentd#1330) — key each
  // source by its own repo so a cross-repo entry never collides with a
  // same-numbered workspace-repo PR (intent-hq/intent#3964).
  const sourceByIdentity = new Map(
    branchSources.map((pr) => [
      normalizedPrIdentity(prRepoFromUrl(pr.url) ?? workspaceRepo, pr.number),
      pr,
    ]),
  );
  const combined = mergeMonitoredPRs(
    mapWorkspacePRs(branchSources, activePR, buildPrUrl, getDisplayTitle, workspaceRepo),
    monitors,
    workspaceRepo,
  );
  const deduplicated = new Map<string, PRInfo>();
  for (const pr of combined) {
    const key =
      pr.monitorIdentity ?? normalizedPrIdentity(pr.crossRepo ?? workspaceRepo, pr.number);
    const existing = deduplicated.get(key);
    if (!existing) {
      deduplicated.set(key, pr);
      continue;
    }
    existing.monitorAgentId = pr.monitorAgentId ?? existing.monitorAgentId;
    existing.monitorSnapshot = pr.monitorSnapshot ?? existing.monitorSnapshot;
    existing.isInMergeQueue = existing.isInMergeQueue || pr.isInMergeQueue;
  }

  // Resolve each row's source, display status and queue state once, then
  // sort and present from those values.
  const decorated = [...deduplicated.values()].map((pr) => {
    const repo = pr.crossRepo ?? workspaceRepo;
    const identity = normalizedPrIdentity(repo, pr.number);
    const source = pr.resource ? undefined : sourceByIdentity.get(identity);
    const status: PRInfo['status'] = source?.isDraft ? 'draft' : pr.status;
    const queued = isPRQueued({ ...pr, status });
    return {
      pr,
      repo,
      identity,
      source,
      status,
      queued,
      rank: PR_RANK[queued ? 'queued' : status],
    };
  });

  return decorated
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        compareMissingLast(a.pr.updatedAt, b.pr.updatedAt) ||
        b.pr.number - a.pr.number ||
        a.identity.localeCompare(b.identity),
    )
    .map(({ pr, repo, source, status, queued }) => {
      const sourceDetails = pr.monitorSnapshot ? '' : getPRTooltipContent(source);
      return {
        identity: pr.monitorIdentity ?? prIdentity(repo, pr.number),
        resource: pr.resource,
        monitorAvailability: pr.monitorAvailability,
        numberLabel: monitorNumber(pr, pr.number),
        number: pr.number,
        title: pr.title,
        url: pr.url,
        repo,
        repoContext: pr.crossRepo ? (pr.crossRepoDisplay ?? pr.crossRepo) : undefined,
        status,
        queued,
        ...getPRStatusPresentation(status, queued),
        details: [getPRStatusTooltip({ ...pr, status }), sourceDetails].filter(Boolean).join('\n'),
        monitorAgentId: pr.monitorAgentId,
        monitorOnly: pr.monitorOnly === true,
      };
    });
}
