/**
 * Pure helper functions for displaying pull request information.
 * These extract common PR display logic from components.
 */

import { PullRequestStatus } from '$shared/types';
import type { PullRequestInfo, Workspace } from '$shared/types';

export function getPRDisplayTitle(pr: PullRequestInfo): string {
  return pr.title || `PR #${pr.number}`;
}

export function getPRUrl(
  pr: PullRequestInfo,
  workspace?: Pick<Workspace, 'prUrl'> | null,
): string {
  if (pr.url) return pr.url;
  if (workspace?.prUrl) return workspace.prUrl;
  return '';
}

export function getPRDisplayStatus(
  pr: PullRequestInfo,
  workspace?: Pick<Workspace, 'prStatus'> | null,
): string {
  return pr.status || workspace?.prStatus || PullRequestStatus.Open;
}

export function isPRActive(pr: PullRequestInfo): boolean {
  return pr.status === PullRequestStatus.Open || pr.status === PullRequestStatus.Draft;
}

export function isPRMerged(pr: PullRequestInfo): boolean {
  return pr.status === PullRequestStatus.Merged;
}

