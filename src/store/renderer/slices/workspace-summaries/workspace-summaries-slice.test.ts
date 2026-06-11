import { describe, expect, it } from "vitest";
import type { WorkspaceDiffSummary, WorkspaceGitSummary } from "$shared/types";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";
import { removeWorkspaceEntity } from "../workspace/workspace-slice";
import {
  clearWorkspaceSummaries,
  initialState,
  loadWorkspaceSummariesFailed,
  loadWorkspaceSummariesRequested,
  loadWorkspaceSummariesSucceeded,
  workspaceSummariesReducer,
} from "./workspace-summaries-slice";

const WS = "ws-1";

const diffSummary: WorkspaceDiffSummary = {
  schemaVersion: 1,
  updatedAt: "2026-01-01T00:00:00.000Z",
  totalFiles: 3,
  totalAdditions: 10,
  totalDeletions: 4,
  files: [],
};

const gitSummary: WorkspaceGitSummary = {
  ahead: 2,
  behind: 0,
  hasUnpushed: true,
};

function loadedState() {
  return workspaceSummariesReducer(
    initialState,
    loadWorkspaceSummariesSucceeded(WS, diffSummary, gitSummary)
  );
}

describe("workspaceSummariesReducer", () => {
  it("starts with no workspace entries", () => {
    expect(initialState.byWorkspaceId).toEqual({});
  });

  describe("loadWorkspaceSummariesRequested", () => {
    it("marks the workspace as loading and clears errors", () => {
      const failed = workspaceSummariesReducer(
        initialState,
        loadWorkspaceSummariesFailed(WS, "nope")
      );
      const state = workspaceSummariesReducer(failed, loadWorkspaceSummariesRequested(WS));

      expect(state.byWorkspaceId[WS]).toMatchObject({ loading: true, error: null });
    });

    it("keeps stale summaries while loading", () => {
      const state = workspaceSummariesReducer(loadedState(), loadWorkspaceSummariesRequested(WS));

      expect(state.byWorkspaceId[WS]).toMatchObject({
        loading: true,
        diffSummary,
        gitSummary,
      });
    });

    it("is a no-op when a request is already in flight", () => {
      const loading = workspaceSummariesReducer(initialState, loadWorkspaceSummariesRequested(WS));
      const again = workspaceSummariesReducer(loading, loadWorkspaceSummariesRequested(WS));

      expect(again).toBe(loading);
    });
  });

  describe("loadWorkspaceSummariesSucceeded", () => {
    it("stores summaries and marks the workspace initialized", () => {
      const ws = loadedState().byWorkspaceId[WS];

      expect(ws).toEqual({
        diffSummary,
        gitSummary,
        loading: false,
        error: null,
        initialized: true,
      });
    });

    it("accepts null summaries when data is unavailable", () => {
      const state = workspaceSummariesReducer(
        loadedState(),
        loadWorkspaceSummariesSucceeded(WS, null, null)
      );

      expect(state.byWorkspaceId[WS]).toMatchObject({
        diffSummary: null,
        gitSummary: null,
        initialized: true,
      });
    });
  });

  describe("loadWorkspaceSummariesFailed", () => {
    it("records the error and stops loading", () => {
      const loading = workspaceSummariesReducer(initialState, loadWorkspaceSummariesRequested(WS));
      const state = workspaceSummariesReducer(loading, loadWorkspaceSummariesFailed(WS, "boom"));

      expect(state.byWorkspaceId[WS]).toMatchObject({ loading: false, error: "boom" });
    });

    it("keeps previously loaded summaries on failure", () => {
      const state = workspaceSummariesReducer(loadedState(), loadWorkspaceSummariesFailed(WS, "boom"));

      expect(state.byWorkspaceId[WS]).toMatchObject({ diffSummary, gitSummary, error: "boom" });
    });
  });

  describe("cleanup", () => {
    it("clears workspace state on clearWorkspaceSummaries", () => {
      const state = workspaceSummariesReducer(loadedState(), clearWorkspaceSummaries(WS));

      expect(state.byWorkspaceId[WS]).toBeUndefined();
    });

    it("clears workspace state on workspaceUnmounted", () => {
      const state = workspaceSummariesReducer(loadedState(), workspaceUnmounted(WS));

      expect(state.byWorkspaceId[WS]).toBeUndefined();
    });

    it("clears workspace state on removeWorkspaceEntity", () => {
      const state = workspaceSummariesReducer(loadedState(), removeWorkspaceEntity(WS));

      expect(state.byWorkspaceId[WS]).toBeUndefined();
    });
  });
});

