import { beforeEach, describe, expect, it, vi } from "vitest";
import { testSaga } from "redux-saga-test-plan";
import * as sagaEffects from "redux-saga/effects";
import type { WorkspaceDiffSummary, WorkspaceGitSummary } from "$shared/types";

// Must mock typed-redux-saga BEFORE importing saga modules
vi.mock("typed-redux-saga", () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
}));

const { mockGetDiffSummary, mockGetGitSummary } = vi.hoisted(() => ({
  mockGetDiffSummary: vi.fn(),
  mockGetGitSummary: vi.fn(),
}));

vi.mock("$store/renderer/slices/workspace/utils/workspace.client", () => ({
  workspaceClient: { getDiffSummary: mockGetDiffSummary, getGitSummary: mockGetGitSummary },
}));

import { workspaceClient } from "$store/renderer/slices/workspace/utils/workspace.client";
import { WorkspaceId } from "$shared/types/branded-ids";
import {
  loadWorkspaceSummariesFailed,
  loadWorkspaceSummariesRequested,
  loadWorkspaceSummariesSucceeded,
} from "../workspace-summaries-slice";
import {
  handleLoadWorkspaceSummariesRequested,
  watchLoadWorkspaceSummariesRequestedSaga,
  workspaceSummariesSaga,
} from "./workspace-summaries-saga";

const diffSummary: WorkspaceDiffSummary = {
  schemaVersion: 1,
  updatedAt: "2026-01-01T00:00:00.000Z",
  totalFiles: 2,
  totalAdditions: 5,
  totalDeletions: 1,
  files: [],
};

const gitSummary: WorkspaceGitSummary = { ahead: 1, behind: 0, hasUnpushed: true };

describe("workspace-summaries-saga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forks the load watcher", () => {
    testSaga(workspaceSummariesSaga)
      .next()
      .fork(watchLoadWorkspaceSummariesRequestedSaga)
      .next()
      .isDone();
  });

  describe("handleLoadWorkspaceSummariesRequested", () => {
    function start() {
      const iterator = handleLoadWorkspaceSummariesRequested(
        loadWorkspaceSummariesRequested("ws-1")
      );
      expect(iterator.next().value).toEqual(
        sagaEffects.call([workspaceClient, workspaceClient.getDiffSummary], WorkspaceId("ws-1"))
      );
      return iterator;
    }

    it("loads both summaries and dispatches success", () => {
      const iterator = start();

      expect(iterator.next({ ok: true, data: diffSummary }).value).toEqual(
        sagaEffects.call([workspaceClient, workspaceClient.getGitSummary], WorkspaceId("ws-1"))
      );
      expect(iterator.next({ ok: true, data: gitSummary })).toEqual({
        value: sagaEffects.put(loadWorkspaceSummariesSucceeded("ws-1", diffSummary, gitSummary)),
        done: false,
      });
      expect(iterator.next().done).toBe(true);
    });

    it("succeeds with nulls when one endpoint fails", () => {
      const iterator = start();

      iterator.next({ ok: false, error: "diff nope" });
      expect(iterator.next({ ok: true, data: gitSummary })).toEqual({
        value: sagaEffects.put(loadWorkspaceSummariesSucceeded("ws-1", null, gitSummary)),
        done: false,
      });
    });

    it("dispatches failure when both endpoints fail", () => {
      const iterator = start();

      iterator.next({ ok: false, error: "diff nope" });
      expect(iterator.next({ ok: false, error: "git nope" })).toEqual({
        value: sagaEffects.put(loadWorkspaceSummariesFailed("ws-1", "diff nope")),
        done: false,
      });
    });

    it("dispatches failure when the call throws", () => {
      const iterator = start();

      expect(iterator.throw(new Error("boom"))).toEqual({
        value: sagaEffects.put(loadWorkspaceSummariesFailed("ws-1", "boom")),
        done: false,
      });
    });

    it("is a no-op without a workspace ID", () => {
      const iterator = handleLoadWorkspaceSummariesRequested(loadWorkspaceSummariesRequested(""));

      expect(iterator.next().done).toBe(true);
      expect(mockGetDiffSummary).not.toHaveBeenCalled();
    });
  });
});

