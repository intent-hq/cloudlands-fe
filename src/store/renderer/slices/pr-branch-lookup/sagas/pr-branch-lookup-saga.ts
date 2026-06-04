import { invoke } from '$lib/electron-bridge';
import { call, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import {
  prBranchLookupFailed,
  prBranchLookupStarted,
  prBranchLookupSucceeded,
  requestPrBranchLookup,
} from '../pr-branch-lookup-slice';
import { selectPrBranchLookupEntry } from '../pr-branch-lookup-selectors';
import type { PrBranchLookupPayload } from '../pr-branch-lookup-types';

type PullRequestLookupResponse = {
  success: boolean;
  data?: { sourceBranch?: string };
  error?: string;
};

const inFlightKeys = new Set<string>();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'PR branch lookup failed';
}

export function clearPrBranchLookupInFlightForTests(): void {
  inFlightKeys.clear();
}

export function* handleRequestPrBranchLookup(
  action: ReturnType<typeof requestPrBranchLookup>,
): SagaGenerator<void> {
  const request: PrBranchLookupPayload = action.payload;
  if (inFlightKeys.has(request.key)) return;

  const cached = yield* selectPrBranchLookupEntry.effect(request.key);
  if (cached) return;

  inFlightKeys.add(request.key);
  yield* put(prBranchLookupStarted(request));

  try {
    const response = yield* call(
      invoke<PullRequestLookupResponse>,
      'git-tracking:get-pull-request',
      {
        owner: request.owner,
        repo: request.repo,
        number: request.prNumber,
      },
    );
    const branch = response?.success ? response.data?.sourceBranch?.trim() : undefined;

    if (branch) {
      yield* put(prBranchLookupSucceeded(request, branch));
      return;
    }

    yield* put(prBranchLookupFailed(request, response?.error ?? 'Could not detect PR branch'));
  } catch (error) {
    yield* put(prBranchLookupFailed(request, errorMessage(error)));
  } finally {
    inFlightKeys.delete(request.key);
  }
}

export function* prBranchLookupSaga(): SagaGenerator<void> {
  yield* takeEvery(requestPrBranchLookup, handleRequestPrBranchLookup);
}
