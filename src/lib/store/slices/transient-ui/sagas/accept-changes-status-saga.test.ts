import { describe, expect, it, vi } from "vitest";
import { expectSaga } from "redux-saga-test-plan";
import * as matchers from "redux-saga-test-plan/matchers";
import * as sagaEffects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => ({
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
  takeLatest: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeLatest(pattern, worker);
  },
}));

vi.mock("$lib/utils/client-logger", () => ({
  createLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

import { AcceptChangesClient } from "$features/accept-changes/accept-changes.client";
import { workspaceMounted } from "../../workspace-lifecycle/workspace-lifecycle-slice";
import {
  refreshAcceptChangesStatus,
  setPostMergeState,
} from "../transient-ui-slice";
import { selectPostMergeState } from "../transient-ui-selectors";
import {
  handleFetchAcceptChangesStatus,
  acceptChangesStatusSaga,
} from "./accept-changes-status-saga";

const defaultPostMerge = {
  aheadOfTrunk: null,
  behindTrunk: 0,
  hasConflicts: false,
  isContentMergedToTrunk: false,
  hasRemote: true,
  isMergedToTrunk: false,
  mergeHeadSha: null,
  hasResetToTrunk: false,
};

describe("acceptChangesStatusSaga", () => {
  it("watches workspaceMounted and refreshAcceptChangesStatus with takeLatest", () => {
    const iterator = acceptChangesStatusSaga();

    expect(iterator.next().value).toEqual(
      sagaEffects.takeLatest(workspaceMounted, expect.any(Function)),
    );
    expect(iterator.next().value).toEqual(
      sagaEffects.takeLatest(refreshAcceptChangesStatus, expect.any(Function)),
    );
  });
});

describe("handleFetchAcceptChangesStatus", () => {
  const wsId = "ws-1";

  it("fetches status and dispatches setPostMergeState on success", async () => {
    const mockStatus = {
      aheadOfTrunk: 2,
      behindTrunk: 1,
      hasConflicts: false,
      hasRemote: true,
      isContentMergedToTrunk: true,
      branch: "main",
      trunkBranch: "main",
      isPushed: true,
      uncommittedCount: 0,
      stagedCount: 0,
      localCommits: [],
      canMergeDirectly: true,
      hasDivergedFromRemote: false,
    };

    await expectSaga(handleFetchAcceptChangesStatus, wsId)
      .provide([
        [matchers.call.fn(AcceptChangesClient.getStatus), mockStatus],
        [matchers.select.selector(selectPostMergeState.select), defaultPostMerge],
      ])
      .put(
        setPostMergeState(wsId, {
          ...defaultPostMerge,
          aheadOfTrunk: 2,
          behindTrunk: 1,
          hasConflicts: false,
          hasRemote: true,
          isContentMergedToTrunk: true,
        }),
      )
      .silentRun(0);
  });

  it("dispatches fallback state on error", async () => {
    await expectSaga(handleFetchAcceptChangesStatus, wsId)
      .provide({
        call(effect, next) {
          if (effect.fn === AcceptChangesClient.getStatus) {
            throw new Error("fail");
          }
          return next();
        },
        select() {
          return defaultPostMerge;
        },
      })
      .put(
        setPostMergeState(wsId, {
          ...defaultPostMerge,
          aheadOfTrunk: null,
          behindTrunk: 0,
          hasConflicts: false,
          isContentMergedToTrunk: false,
        }),
      )
      .silentRun(0);
  });
});
