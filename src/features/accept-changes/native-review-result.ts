import type {
  NativeReviewDetails,
  NativeReviewExecuteExtension,
  NativeReviewExecution,
} from '$shared/types/native-review';
import type { AcceptChangesResult } from './types';

type ReviewResponse = AcceptChangesResult & NativeReviewExecuteExtension;

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
      review: NativeReviewDetails | null;
      formDisposition: 'complete' | 'retain';
      requiresReconciliation: boolean;
    });

/**
 * Inactive presentation seam for a validated native response. The caller owns
 * admission, stale-response checks and the history of this captured UI attempt.
 * This function neither makes requests nor decides whether retry is permitted.
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

  return {
    kind: 'native',
    response,
    history,
    execution,
    review,
    formDisposition: response.success && review !== null ? 'complete' : 'retain',
    requiresReconciliation: outcome.status === 'uncertain',
  };
}
