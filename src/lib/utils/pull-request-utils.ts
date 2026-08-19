/**
 * Pure helper functions for displaying pull request information.
 * These extract common PR display logic from components.
 */

import type { PullRequestInfo } from '$shared/types';

export function getPRDisplayTitle(pr: PullRequestInfo): string {
  return pr.title || `PR #${pr.number}`;
}
