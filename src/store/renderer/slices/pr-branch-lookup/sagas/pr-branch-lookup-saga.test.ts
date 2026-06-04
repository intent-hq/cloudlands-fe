import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectSaga } from 'redux-saga-test-plan';
import * as sagaEffects from 'redux-saga/effects';

vi.mock('typed-redux-saga', () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
}));

vi.mock('$lib/electron-bridge', () => ({ invoke: vi.fn() }));

import { invoke } from '$lib/electron-bridge';
import type { StoreAction } from '../../../types';
import {
  initialState,
  prBranchLookupReducer,
  requestPrBranchLookup,
} from '../pr-branch-lookup-slice';
import type { PrBranchLookupState } from '../pr-branch-lookup-types';
import {
  clearPrBranchLookupInFlightForTests,
  handleRequestPrBranchLookup,
  prBranchLookupSaga,
} from './pr-branch-lookup-saga';

type TestState = { prBranchLookup: PrBranchLookupState };

function testReducer(
  state: TestState = { prBranchLookup: initialState },
  action: StoreAction<any>,
): TestState {
  return { prBranchLookup: prBranchLookupReducer(state.prBranchLookup, action) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

const request = requestPrBranchLookup({ owner: 'augmentcode', repo: 'intent', prNumber: 648 });

describe('prBranchLookupSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPrBranchLookupInFlightForTests();
  });

  it('requests a lookup once, caches the branch, and skips a second identical request', async () => {
    vi.mocked(invoke).mockResolvedValue({
      success: true,
      data: { sourceBranch: 'install-local-package' },
    });

    const first = await expectSaga(handleRequestPrBranchLookup, request)
      .withReducer(testReducer)
      .silentRun(100);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(first.storeState.prBranchLookup.byKey[request.payload.key]).toEqual({
      status: 'succeeded',
      branch: 'install-local-package',
    });

    await expectSaga(handleRequestPrBranchLookup, request).withState(first.storeState).silentRun(0);

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('dedupes two in-flight requests for the same PR branch', async () => {
    const lookup = deferred<{ success: boolean; data: { sourceBranch: string } }>();
    vi.mocked(invoke).mockReturnValue(lookup.promise as any);

    const run = expectSaga(prBranchLookupSaga)
      .withReducer(testReducer)
      .dispatch(request)
      .dispatch(request)
      .silentRun(100);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(invoke).toHaveBeenCalledTimes(1);

    lookup.resolve({ success: true, data: { sourceBranch: 'install-local-package' } });
    const result = await run;

    expect(result.storeState.prBranchLookup.byKey[request.payload.key]).toEqual({
      status: 'succeeded',
      branch: 'install-local-package',
    });
  });
});
