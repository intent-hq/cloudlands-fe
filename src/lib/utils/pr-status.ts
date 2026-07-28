/**
 * PR status utilities for determining mergeability and generating tooltip content.
 * Extracted from Svelte components to enable testing and reduce duplication.
 */
import { m } from '$shared/paraglide/messages.js';
import { formatInteger } from '$lib/i18n/format';

export interface PRForMergeability {
  status?: string;
  mergeable?: boolean;
  mergeConflicts?: boolean;
  mergeableState?: string;
  ciStatus?: { failed: number; pending: number };
  reviewDecision?: string | null;
}

export interface PRForTooltip {
  status?: string;
  mergeConflicts?: boolean;
  mergeableState?: string;
  mergeable?: boolean;
  ciStatus?: { total: number; passed: number; failed: number; pending: number };
  reviewDecision?: string | null;
  reviewComments?: number;
  approvedBy?: string[];
}

/**
 * Determine if a pull request is mergeable.
 * Returns true (optimistic) if no PR or PR is not open.
 * Returns false for any known blocking issues.
 */
export function isPRMergeable(pr: PRForMergeability | null | undefined): boolean {
  if (!pr) return true;
  if (pr.status !== 'Open') return true;

  // If we have no enrichment data at all, treat as unknown (not yet mergeable)
  // This prevents new PRs from flashing as "mergeable" before data is fetched
  const hasEnrichmentData =
    pr.mergeableState !== undefined || pr.ciStatus !== undefined || pr.reviewDecision !== undefined;
  if (!hasEnrichmentData) return false;

  // mergeableState is the primary indicator - if we have other enrichment data
  // but not mergeableState, we can't determine mergeability yet
  if (pr.mergeableState === undefined) return false;

  if (pr.mergeable === false) return false;
  if (pr.mergeConflicts === true) return false;
  if (pr.mergeableState === 'blocked') return false;
  if (pr.mergeableState === 'behind') return false;
  if (pr.mergeableState === 'dirty') return false;
  if (pr.mergeableState === 'unstable') return false;
  if (pr.mergeableState === 'unknown') return false;
  if ((pr.ciStatus?.failed ?? 0) > 0) return false;
  if ((pr.ciStatus?.pending ?? 0) > 0) return false;
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return false;
  if (pr.reviewDecision === 'REVIEW_REQUIRED') return false;
  return true;
}

/**
 * Generate tooltip content for a pull request showing its status details.
 * Returns empty string if no PR, PR is not open, or no issues/positives to show.
 */
export function getPRTooltipContent(pr: PRForTooltip | null | undefined): string {
  if (!pr) return '';
  if (pr.status !== 'Open') return '';

  const issues: string[] = [];
  const positives: string[] = [];

  // Check for merge conflicts (only when explicitly flagged, not when mergeable === false which is too broad)
  if (pr.mergeConflicts || pr.mergeableState === 'dirty') {
    issues.push(m.workspace_prStatus_mergeConflicts_tooltip());
  }
  // Check if branch is behind base (standalone check, can coexist with other issues)
  if (pr.mergeableState === 'behind') {
    issues.push(m.workspace_prStatus_behindBase_tooltip());
  }
  // Check for unstable state (non-required checks failing)
  if (pr.mergeableState === 'unstable') {
    issues.push(m.workspace_prStatus_checksUnstable_tooltip());
  }
  // Check for unknown state (GitHub hasn't computed mergeability yet)
  if (pr.mergeableState === 'unknown') {
    issues.push(m.workspace_prStatus_mergeabilityUnknown_tooltip());
  }

  // CI status - show single line with most important status
  if (pr.ciStatus && pr.ciStatus.total > 0) {
    const total = formatInteger(pr.ciStatus.total);
    if (pr.ciStatus.failed > 0) {
      const failed = formatInteger(pr.ciStatus.failed);
      issues.push(
        pr.ciStatus.pending > 0
          ? m.workspace_prStatus_checksFailingRunning_tooltip({
              failed,
              total,
              pending: formatInteger(pr.ciStatus.pending),
            })
          : m.workspace_prStatus_checksFailing_tooltip({ failed, total }),
      );
    } else if (pr.ciStatus.pending > 0) {
      issues.push(
        m.workspace_prStatus_checksRunning_tooltip({
          pending: formatInteger(pr.ciStatus.pending),
          total,
        }),
      );
    } else {
      positives.push(
        m.workspace_prStatus_checksPassing_tooltip({
          passed: formatInteger(pr.ciStatus.passed),
          total,
        }),
      );
    }
  }

  if (pr.reviewDecision === 'CHANGES_REQUESTED')
    issues.push(m.workspace_prStatus_changesRequested_tooltip());
  if (pr.reviewDecision === 'REVIEW_REQUIRED')
    issues.push(m.workspace_prStatus_awaitingReview_tooltip());
  // If mergeableState is 'blocked' but we don't have a specific reviewDecision explaining why,
  // it's likely blocked by required reviews
  if (pr.mergeableState === 'blocked' && !pr.reviewDecision) {
    issues.push(m.workspace_prStatus_awaitingReview_tooltip());
  }
  if (pr.reviewComments && pr.reviewComments > 0) {
    const count = formatInteger(pr.reviewComments);
    issues.push(
      pr.reviewComments === 1
        ? m.workspace_prStatus_reviewComments_one({ count })
        : m.workspace_prStatus_reviewComments_many({ count }),
    );
  }

  // Add positives when approved
  if (pr.reviewDecision === 'APPROVED') {
    if (pr.approvedBy && pr.approvedBy.length > 0) {
      positives.push(m.workspace_prStatus_approvedBy_tooltip({ names: pr.approvedBy.join(', ') }));
    }
  }

  // Combine issues and positives together
  const parts: string[] = [...issues, ...positives];
  if (parts.length > 0) {
    return parts.join('\n');
  }

  // No issues or positives = unknown state, show no tooltip
  return '';
}
