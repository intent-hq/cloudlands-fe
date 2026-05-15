/**
 * PR Status Utilities
 *
 * Pure utility functions for PR data normalization and merging.
 * No side effects, no store access, no IPC — safe to import anywhere.
 */

import {
  PullRequestStatus,
  type PullRequestInfo,
} from "$shared/types";

/**
 * Sanitize data for IPC by converting any Svelte reactive proxies to plain objects.
 * Returns undefined on serialization failure rather than an empty object.
 */
export function sanitizeForIpc<T>(data: T): T | undefined {
  if (data === null || data === undefined) {
    return data;
  }
  try {
    return JSON.parse(JSON.stringify(data));
  } catch {
    return undefined;
  }
}

export function normalizePullRequestStatus(pr: any): PullRequestStatus {
  const isMerged = Boolean(pr?.merged ?? pr?.merged_at ?? pr?.mergedAt);
  if (isMerged) return PullRequestStatus.Merged;

  const state = String(pr?.state ?? pr?.status ?? "").toLowerCase();
  if (pr?.draft === true || pr?.isDraft === true || state === "draft") {
    return PullRequestStatus.Draft;
  }

  if (state === "closed") return PullRequestStatus.Closed;
  return PullRequestStatus.Open;
}

export function normalizePullRequestInfo(
  pr: any,
  existing: PullRequestInfo | null,
  status: PullRequestStatus,
): PullRequestInfo {
  const number = pr?.number ?? existing?.number ?? 0;
  const url = pr?.html_url ?? pr?.htmlUrl ?? pr?.url ?? existing?.url ?? "";
  const createdAt = pr?.created_at ?? pr?.createdAt ?? existing?.createdAt ?? new Date().toISOString();
  const updatedAt = pr?.updated_at ?? pr?.updatedAt ?? existing?.updatedAt ?? new Date().toISOString();

  const mergeable = pr?.mergeable ?? existing?.mergeable;
  const mergeableState = pr?.mergeable_state ?? pr?.mergeableState ?? existing?.mergeableState;
  const mergeConflicts = mergeableState !== undefined
    ? mergeableState === "dirty"
    : (existing?.mergeConflicts ?? false);

  const reviewComments = pr?.review_comments ?? pr?.reviewComments ?? existing?.reviewComments;
  const comments = pr?.comments ?? existing?.comments;
  const reviewDecision = pr?.review_decision ?? pr?.reviewDecision ?? existing?.reviewDecision;

  const additions = pr?.additions ?? existing?.additions;
  const deletions = pr?.deletions ?? existing?.deletions;
  const changedFiles = pr?.changed_files ?? pr?.changedFiles ?? existing?.changedFiles;
  const baseRef = pr?.base_ref ?? pr?.baseRef ?? pr?.targetBranch ?? pr?.base?.ref ?? existing?.baseRef;
  const headRef = pr?.head_ref ?? pr?.headRef ?? pr?.sourceBranch ?? pr?.head?.ref ?? existing?.headRef;
  const headSha = pr?.head_sha ?? pr?.headSha ?? pr?.head?.sha ?? existing?.headSha;
  const ciStatus = pr?.ciStatus ?? existing?.ciStatus;

  return {
    ...(existing ?? {}),
    id: String(pr?.id ?? existing?.id ?? number),
    number,
    url,
    title: pr?.title || existing?.title || `PR #${number}`,
    status,
    createdAt,
    updatedAt,
    mergedAt: pr?.merged_at ?? pr?.mergedAt ?? existing?.mergedAt,
    closedAt: pr?.closed_at ?? pr?.closedAt ?? existing?.closedAt,
    isDraft: pr?.draft ?? pr?.isDraft ?? existing?.isDraft,
    mergeable,
    mergeableState,
    mergeConflicts,
    reviewComments,
    comments,
    reviewDecision,
    additions,
    deletions,
    changedFiles,
    baseRef,
    headRef,
    headSha,
    ciStatus,
  };
}

/**
 * Merge two arrays of pull requests by PR number.
 * Discovered PRs take precedence; existing PRs not in discovered are preserved.
 */
export function mergePullRequestArrays(
  existing: PullRequestInfo[],
  discovered: PullRequestInfo[],
): PullRequestInfo[] {
  const merged = new Map<number, PullRequestInfo>();

  for (const pr of existing) {
    merged.set(pr.number, pr);
  }
  for (const pr of discovered) {
    merged.set(pr.number, pr);
  }

  return Array.from(merged.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/**
 * Find the most recent open PR from an array.
 */
export function findMostRecentOpenPR(pullRequests: PullRequestInfo[]): PullRequestInfo | null {
  const openPRs = pullRequests.filter(
    (pr) => pr.status === PullRequestStatus.Open || pr.status === PullRequestStatus.Draft,
  );

  if (openPRs.length === 0) return null;

  return openPRs.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0];
}

