import type {
  NativeReviewBranchTarget,
  NativeReviewDetails,
  NativeReviewExecuteExtension,
  NativeReviewExecution,
  NativeReviewPreparation,
} from '$shared/types/native-review';
import {
  compareRepositoryContextRevisions,
  repositoryRootKey,
  repositoryTargetKey,
  sameRepositoryConnectionScope,
} from '$shared/types/repository-context';
import type { AcceptChangesResult } from './types';

type ReviewResponse = AcceptChangesResult & Pick<NativeReviewExecuteExtension, 'reviewExecution'>;

interface ResultHistory {
  response: ReviewResponse;
  /** Keep separate requests intact, including legacy results and failed stages. */
  history: readonly ReviewResponse[];
}

type ReviewResultPresentation =
  | (ResultHistory & { kind: 'legacy' })
  | (ResultHistory & {
      kind: 'native';
      execution: NativeReviewExecution;
      /** Display grouping only; unmatched/unknown responses remain in raw history. */
      compatibleHistory: readonly ReviewResponse[];
      review: NativeReviewDetails | null;
      formDisposition: 'complete' | 'retain';
      requiresReconciliation: boolean;
    });

function sameBranchTarget(
  left: NativeReviewBranchTarget,
  right: NativeReviewBranchTarget,
): boolean {
  return (
    repositoryTargetKey(left.repository) === repositoryTargetKey(right.repository) &&
    left.branch === right.branch &&
    left.providerProjectId !== null &&
    left.providerProjectId === right.providerProjectId &&
    left.connection !== null &&
    right.connection !== null &&
    sameRepositoryConnectionScope(left.connection, right.connection)
  );
}

/** Conservative correlation of captured observations, never an admission check. */
function compatiblePreparations(
  left: NativeReviewPreparation,
  right: NativeReviewPreparation,
): boolean {
  return (
    repositoryRootKey(left.root) === repositoryRootKey(right.root) &&
    left.worktreeId === right.worktreeId &&
    compareRepositoryContextRevisions(
      { scope: left.scope, revision: left.contextRevision },
      { scope: right.scope, revision: right.contextRevision },
    ) === 0 &&
    sameBranchTarget(left.source, right.source) &&
    sameBranchTarget(left.target, right.target)
  );
}

/**
 * Inactive presentation seam for a validated native response. The caller owns
 * admission, stale-response checks and the history of this captured UI attempt.
 * Compatibility groups only the same captured context and known project/account
 * bindings. It proves neither authority nor that retry is permitted.
 *
 * A sidebar commit and its following create stay separate in history. Their
 * receipts are never transferred, and publication remains the producer's
 * observation on each execution. Legacy responses retain their existing path;
 * an absent extension supplies no native outcome or completion evidence.
 */
export function projectNativeReviewResult(
  response: ReviewResponse,
  previousResponses: readonly ReviewResponse[] = [],
): ReviewResultPresentation {
  const history = [...previousResponses, response];
  const execution = response.reviewExecution;
  if (execution === undefined) return { kind: 'legacy', response, history };

  const { outcome } = execution;
  const review =
    outcome.status === 'created' || outcome.status === 'reused' ? outcome.review : null;
  const hasFailure =
    !response.success ||
    response.error !== undefined ||
    response.steps.some((step) => step.status === 'failed' || step.error !== undefined);
  const compatibleHistory = previousResponses.filter(
    (previous) =>
      previous.reviewExecution !== undefined &&
      compatiblePreparations(previous.reviewExecution.preparation, execution.preparation),
  );

  return {
    kind: 'native',
    response,
    history,
    execution,
    compatibleHistory: [...compatibleHistory, response],
    review,
    formDisposition: !hasFailure && review !== null ? 'complete' : 'retain',
    requiresReconciliation: outcome.status === 'uncertain',
  };
}
