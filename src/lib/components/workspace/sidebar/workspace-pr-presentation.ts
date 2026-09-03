import type { PrMonitorRow } from '$features/pr-monitor/pr-monitor-service';
import type { PRInfo } from '$lib/components/file-tracking/accept-changes/types';
import { getPRTooltipContent } from '$lib/utils/pr-status';
import { m } from '$shared/paraglide/messages.js';
import type { PullRequestInfo } from '$shared/types';
import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
import { faCodeMerge, faCodePullRequest } from '@fortawesome/free-solid-svg-icons';
import {
  getPRStatusTooltip,
  mapWorkspacePRs,
  mergeMonitoredPRs,
  prRepoFromUrl,
} from './sidebar-changes-utils';

export interface WorkspacePRPresentationOptions {
  workspacePRs: PullRequestInfo[] | undefined;
  activePR: PullRequestInfo | null | undefined;
  monitors: PrMonitorRow[];
  workspaceRepo: string | undefined;
  buildPrUrl: (prNumber: number, fallbackUrl?: string) => string;
  getDisplayTitle: (pr: PullRequestInfo) => string;
}

export interface WorkspacePRPresentationRow {
  identity: string;
  number: number;
  title: string;
  url: string;
  repo: string | undefined;
  repoContext: string | undefined;
  status: PRInfo['status'];
  statusIcon: IconDefinition;
  foregroundClass: string;
  backgroundClass: string;
  accessibleStateLabel: string;
  details: string;
  monitorAgentId: string | undefined;
  monitorOnly: boolean;
}

/**
 * PR lifecycle order: rows sort earliest-in-flow first, so the first row is
 * the least-progressed PR (a draft ahead of an open PR ahead of a merged one).
 * The workspace card renders only that first row.
 */
const PR_STATUS_ORDER: Record<PRInfo['status'], number> = {
  draft: 0,
  open: 1,
  merged: 2,
  closed: 3,
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
      foregroundClass: 'text-error-foreground',
      backgroundClass: 'bg-destructive/10',
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
    accessibleStateLabel: m.workspace_prSection_statusOpen_label(),
  };
}

/**
 * Build presentation rows for every PR attributable to a workspace. The pool
 * keeps the existing branch/active fallback and monitor wire semantics, then
 * deduplicates by case-insensitive, repo-qualified GitHub identity. Rows are
 * sorted earliest-in-flow first (see `PR_STATUS_ORDER`).
 */
export function buildWorkspacePRPresentationModel({
  workspacePRs,
  activePR,
  monitors,
  workspaceRepo,
  buildPrUrl,
  getDisplayTitle,
}: WorkspacePRPresentationOptions): WorkspacePRPresentationRow[] {
  const branchSources = workspacePRs?.length ? workspacePRs : activePR ? [activePR] : [];
  // The daemon-merged `pullRequests` pool can contain cross-repo entries whose
  // `url` is authoritative for their repo (intent-hq/intentd#1330) — key each
  // source by its own repo so a cross-repo entry never collides with a
  // same-numbered workspace-repo PR (intent-hq/intent#3964). Without a
  // workspace repo, mapWorkspacePRs leaves every row unqualified and lookups
  // key by bare number, so the sources must too.
  const sourceByIdentity = new Map(
    branchSources.map((pr) => [
      normalizedPrIdentity(
        workspaceRepo === undefined ? undefined : (prRepoFromUrl(pr.url) ?? workspaceRepo),
        pr.number,
      ),
      pr,
    ]),
  );
  const combined = mergeMonitoredPRs(
    mapWorkspacePRs(workspacePRs, activePR, buildPrUrl, getDisplayTitle, workspaceRepo),
    monitors,
    workspaceRepo,
  );
  const deduplicated = new Map<string, PRInfo>();
  for (const pr of combined) {
    const key = normalizedPrIdentity(pr.crossRepo ?? workspaceRepo, pr.number);
    const existing = deduplicated.get(key);
    if (!existing) {
      deduplicated.set(key, pr);
      continue;
    }
    existing.monitorAgentId = pr.monitorAgentId ?? existing.monitorAgentId;
    existing.monitorSnapshot = pr.monitorSnapshot ?? existing.monitorSnapshot;
  }

  const statusOf = (pr: PRInfo): PRInfo['status'] => {
    const repo = pr.crossRepo ?? workspaceRepo;
    return sourceByIdentity.get(normalizedPrIdentity(repo, pr.number))?.isDraft
      ? 'draft'
      : pr.status;
  };

  return [...deduplicated.values()]
    .sort(
      (a, b) =>
        PR_STATUS_ORDER[statusOf(a)] - PR_STATUS_ORDER[statusOf(b)] ||
        compareMissingLast(a.updatedAt, b.updatedAt) ||
        b.number - a.number ||
        normalizedPrIdentity(a.crossRepo ?? workspaceRepo, a.number).localeCompare(
          normalizedPrIdentity(b.crossRepo ?? workspaceRepo, b.number),
        ),
    )
    .map((pr) => {
      const repo = pr.crossRepo ?? workspaceRepo;
      const source = sourceByIdentity.get(normalizedPrIdentity(repo, pr.number));
      const status = statusOf(pr);
      const sourceDetails = pr.monitorSnapshot ? '' : getPRTooltipContent(source);
      return {
        identity: prIdentity(repo, pr.number),
        number: pr.number,
        title: pr.title,
        url: pr.url,
        repo,
        repoContext: pr.crossRepo ? (pr.crossRepoDisplay ?? pr.crossRepo) : undefined,
        status,
        ...getPRStatusPresentation(status),
        details: [getPRStatusTooltip({ ...pr, status }), sourceDetails].filter(Boolean).join('\n'),
        monitorAgentId: pr.monitorAgentId,
        monitorOnly: pr.monitorOnly === true,
      };
    });
}
