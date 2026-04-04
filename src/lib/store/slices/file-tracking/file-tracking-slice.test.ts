import { describe, expect, it } from "vitest";
import { ChangeStage } from "$features/file-tracking/types";
import type { TrackedChange, StageTransition, CommitInfo, MainPanelViewState } from "./file-tracking-types";
import type { StoreState } from "../../types";
import {
  fileTrackingReducer,
  initialState,
  clearWorkspace,
  setLoading,
  setError,
  setHasLoadedInitialData,
  setChangesData,
  setTransitions,
  setCommitsData,
  appendOlderCommits,
  clearOlderCommits,
  setLoadingOlderCommits,
  setChanges,
  clearAllChanges,
  setMainPanelView,
  clearMainPanelView,
} from "./file-tracking-slice";
import {
  selectCurrentWorkspaceId,
  selectFileTrackingLoading,
  selectFileTrackingError,
  selectFileTrackingIsInitialized,
  selectFileTrackingChanges,
  selectMainPanelView,
  selectStagedWorkingChanges,
  selectUnstagedWorkingChanges,
} from "./file-tracking-selectors";

const WS = "ws-1";

function mockChange(id: string, stage: ChangeStage = ChangeStage.Unstaged): TrackedChange {
  return {
    id,
    file: `src/${id}.ts`,
    relativePath: `src/${id}.ts`,
    stage,
    stats: { additions: 1, deletions: 0 },
    attribution: { manual: true, timestamp: Date.now() },
  };
}

function mockCommit(hash: string): CommitInfo {
  return {
    hash,
    message: `commit ${hash}`,
    author: "test",
    timestamp: Date.now(),
    files: [],
    stage: "local" as const,
  };
}

function asStoreState(ft: ReturnType<typeof fileTrackingReducer>, activeWorkspaceId: string | null = null): StoreState {
  return { fileTracking: ft, workspace: { activeWorkspaceId } } as unknown as StoreState;
}

describe("fileTrackingReducer", () => {
  it("returns initial state", () => {
    expect(fileTrackingReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("clearWorkspace removes workspace state", () => {
    let state = fileTrackingReducer(initialState, setLoading(WS, true));
    state = fileTrackingReducer(state, clearWorkspace(WS));
    expect(state.byWorkspaceId[WS]).toBeUndefined();
  });

  it("setLoading updates loading flag", () => {
    const state = fileTrackingReducer(initialState, setLoading(WS, true));
    expect(state.byWorkspaceId[WS].loading).toBe(true);
  });

  it("setError updates error", () => {
    const state = fileTrackingReducer(initialState, setError(WS, "oops"));
    expect(state.byWorkspaceId[WS].error).toBe("oops");
  });

  it("setHasLoadedInitialData updates flag", () => {
    const state = fileTrackingReducer(initialState, setHasLoadedInitialData(WS, true));
    expect(state.byWorkspaceId[WS].hasLoadedInitialData).toBe(true);
  });

  it("setChangesData stores changes, truncated, and totalCount", () => {
    const changes = [mockChange("a"), mockChange("b")];
    const state = fileTrackingReducer(initialState, setChangesData(WS, changes, true, 100));
    const ws = state.byWorkspaceId[WS];
    expect(ws.changes).toEqual(changes);
    expect(ws.changesTruncated).toBe(true);
    expect(ws.totalChangesCount).toBe(100);
    expect(ws.error).toBeNull();
  });

  it("setTransitions stores transitions", () => {
    const t: StageTransition = {
      id: "t1",
      changeId: "c1",
      fromStage: ChangeStage.Unstaged,
      toStage: ChangeStage.Staged,
      timestamp: Date.now(),
      actor: { type: "user", id: "u1" },
    };
    const state = fileTrackingReducer(initialState, setTransitions(WS, [t]));
    expect(state.byWorkspaceId[WS].transitions).toEqual([t]);
  });

  it("setCommitsData stores commits, boundarySha, and clears olderCommits", () => {
    let state = fileTrackingReducer(initialState, appendOlderCommits(WS, [mockCommit("old1")]));
    state = fileTrackingReducer(state, setCommitsData(WS, [mockCommit("c1")], "sha-boundary"));
    const ws = state.byWorkspaceId[WS];
    expect(ws.commits).toHaveLength(1);
    expect(ws.boundarySha).toBe("sha-boundary");
    expect(ws.olderCommits).toEqual([]);
  });

  it("appendOlderCommits deduplicates by hash", () => {
    let state = fileTrackingReducer(initialState, appendOlderCommits(WS, [mockCommit("h1")]));
    state = fileTrackingReducer(state, appendOlderCommits(WS, [mockCommit("h1"), mockCommit("h2")]));
    expect(state.byWorkspaceId[WS].olderCommits).toHaveLength(2);
  });

  it("appendOlderCommits returns same ref when all duplicates", () => {
    const state = fileTrackingReducer(initialState, appendOlderCommits(WS, [mockCommit("h1")]));
    const next = fileTrackingReducer(state, appendOlderCommits(WS, [mockCommit("h1")]));
    expect(next).toBe(state);
  });

  it("clearOlderCommits empties olderCommits", () => {
    let state = fileTrackingReducer(initialState, appendOlderCommits(WS, [mockCommit("h1")]));
    state = fileTrackingReducer(state, clearOlderCommits(WS));
    expect(state.byWorkspaceId[WS].olderCommits).toEqual([]);
  });

  it("clearOlderCommits returns same ref when already empty", () => {
    const next = fileTrackingReducer(initialState, clearOlderCommits(WS));
    expect(next).toBe(initialState);
  });

  it("setLoadingOlderCommits updates flag", () => {
    const state = fileTrackingReducer(initialState, setLoadingOlderCommits(WS, true));
    expect(state.byWorkspaceId[WS].loadingOlderCommits).toBe(true);
  });

  it("setChanges replaces changes array", () => {
    const c1 = [mockChange("a")];
    const c2 = [mockChange("b")];
    let state = fileTrackingReducer(initialState, setChanges(WS, c1));
    state = fileTrackingReducer(state, setChanges(WS, c2));
    expect(state.byWorkspaceId[WS].changes).toEqual(c2);
  });

  it("clearAllChanges empties changes and transitions", () => {
    const t: StageTransition = {
      id: "t1", changeId: "c1",
      fromStage: ChangeStage.Unstaged, toStage: ChangeStage.Staged,
      timestamp: Date.now(), actor: { type: "user", id: "u1" },
    };
    let state = fileTrackingReducer(initialState, setChanges(WS, [mockChange("a")]));
    state = fileTrackingReducer(state, setTransitions(WS, [t]));
    state = fileTrackingReducer(state, clearAllChanges(WS));
    expect(state.byWorkspaceId[WS].changes).toEqual([]);
    expect(state.byWorkspaceId[WS].transitions).toEqual([]);
  });

  it("setMainPanelView sets view", () => {
    const view: MainPanelViewState = { type: "diff", changeId: "c1" };
    const state = fileTrackingReducer(initialState, setMainPanelView(view));
    expect(state.mainPanelView).toEqual(view);
  });

  it("clearMainPanelView clears view", () => {
    const view: MainPanelViewState = { type: "diff" };
    let state = fileTrackingReducer(initialState, setMainPanelView(view));
    state = fileTrackingReducer(state, clearMainPanelView());
    expect(state.mainPanelView).toBeNull();
  });
});

describe("file-tracking selectors", () => {
  it("selectCurrentWorkspaceId returns null when no active workspace", () => {
    expect(selectCurrentWorkspaceId.select(asStoreState(initialState))).toBeNull();
  });

  it("selectCurrentWorkspaceId returns active workspace id", () => {
    expect(selectCurrentWorkspaceId.select(asStoreState(initialState, WS))).toBe(WS);
  });

  it("selectFileTrackingLoading returns false by default", () => {
    expect(selectFileTrackingLoading.select(asStoreState(initialState), WS)).toBe(false);
  });

  it("selectFileTrackingError returns null by default", () => {
    expect(selectFileTrackingError.select(asStoreState(initialState), WS)).toBeNull();
  });

  it("selectFileTrackingIsInitialized returns false by default", () => {
    expect(selectFileTrackingIsInitialized.select(asStoreState(initialState), WS)).toBe(false);
  });

  it("selectFileTrackingChanges returns empty by default", () => {
    expect(selectFileTrackingChanges.select(asStoreState(initialState), WS)).toEqual([]);
  });

  it("selectStagedWorkingChanges and selectUnstagedWorkingChanges separate staged and unstaged", () => {
    const changes = [
      mockChange("a", ChangeStage.Unstaged),
      mockChange("b", ChangeStage.Staged),
      mockChange("c", ChangeStage.Committed),
    ];
    const state = fileTrackingReducer(initialState, setChanges(WS, changes));
    const unstaged = selectUnstagedWorkingChanges.select(asStoreState(state), WS);
    const staged = selectStagedWorkingChanges.select(asStoreState(state), WS);
    expect(unstaged).toHaveLength(1);
    expect(staged).toHaveLength(1);
    expect(unstaged[0].id).toBe("a");
    expect(staged[0].id).toBe("b");
  });

  it("selectMainPanelView returns null by default", () => {
    expect(selectMainPanelView.select(asStoreState(initialState))).toBeNull();
  });
});

