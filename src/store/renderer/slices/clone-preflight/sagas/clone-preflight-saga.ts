/**
 * clone-preflight saga — debounces `checkClonePreflight` dispatches,
 * validates the URL shape, and calls `workspaceClient.preflightCloneCheck`
 * to verify reachability + auth before the user submits the onboarding
 * form.
 *
 * Flow:
 *   1. Component dispatches `checkClonePreflight(url)` whenever the URL
 *      changes.
 *   2. `debounce(400ms, ...)` coalesces keystrokes so only the final
 *      quiet-period URL drives a network call.
 *   3. The handler short-circuits invalid/incomplete URLs with a `clear`
 *      so the form shows no inline error for partial input.
 *   4. On success/failure, the status flips to 'ok'/'error' and the
 *      renderer reads the error through `selectClonePreflightError`,
 *      then runs it through `diagnoseCloneError` for structured guidance.
 */
import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';
import {
  call,
  debounce,
  put,
  type SagaGenerator,
} from 'typed-redux-saga';
import type { StoreAction } from '@augmentcode/ag-redux-toolkit/types';
import {
  checkClonePreflight,
  clearClonePreflight,
  setClonePreflightError,
  setClonePreflightLoading,
  setClonePreflightOk,
} from '../clone-preflight-slice';

/** Debounce window. Slightly longer than a typical search-as-you-type because
 *  the preflight also performs a network round-trip to github. */
export const PREFLIGHT_DEBOUNCE_MS = 400;

/**
 * Minimum shape a candidate URL must have before we bother hitting the
 * network. Any string that passes this will produce a meaningful
 * server-side diagnosis (even 404s are useful). Any string that fails
 * this is almost certainly still being typed.
 */
const GITHUB_URL_RE = /^https?:\/\/github\.com\/[^/\s]+\/[^/\s#?]+/i;

export function isLikelyCompleteGithubUrl(url: string): boolean {
  return GITHUB_URL_RE.test(url.trim());
}

export function* handleCheckClonePreflight(
  action: StoreAction<[githubUrl: string]>,
): SagaGenerator<void> {
  const [rawUrl] = action.payload;
  const url = rawUrl.trim();

  if (!isLikelyCompleteGithubUrl(url)) {
    yield* put(clearClonePreflight());
    return;
  }

  yield* put(setClonePreflightLoading(url));

  try {
    const result = yield* call(
      [workspaceClient, workspaceClient.preflightCloneCheck],
      url,
    );

    if (result.ok) {
      yield* put(setClonePreflightOk(url));
      return;
    }

    yield* put(setClonePreflightError(url, result.error));
  } catch (error) {
    const message = (error as Error)?.message ?? 'Preflight check failed';
    yield* put(setClonePreflightError(url, message));
  }
}

export function* clonePreflightSaga(): SagaGenerator<void> {
  yield* debounce(
    PREFLIGHT_DEBOUNCE_MS,
    checkClonePreflight.type,
    handleCheckClonePreflight,
  );
}
