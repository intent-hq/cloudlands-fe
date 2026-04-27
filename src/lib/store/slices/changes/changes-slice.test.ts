import { describe, expect, it } from "vitest";
import { ChangeStage } from "$features/file-tracking/types";
import type { TrackedChange, StageTransition, CommitInfo, MainPanelViewState } from "./changes-types";
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
  updateAgentStats,
  updateAgentStatsBatch,
  clearAgentStats,
  setCommitMessage,
  setTargetBranch,
  setPendingCommitAction,
  setIsAutofillAndCommitting,
  setIsAutofillAndCreatingPR,
  startBackgroundOperation,
  resetAcceptChangesOperations,
  setCachedGitStatus,
} from "./changes-slice";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";
import {
  selectCurrentWorkspaceId,
  selectFileTrackingLoading,
  selectFileTrackingError,
  selectFileTrackingIsInitialized,
  selectFileTrackingChanges,
  selectMainPanelView,
  selectStagedWorkingChanges,
  selectUnstagedWorkingChanges,
  selectAgentLineStats,
  selectAllAgentStats,
} from "./changes-selectors";
import type { LineChangeStats } from "./changes-types";

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
  return { changes: ft, workspace: { activeWorkspaceId } } as unknown as StoreState;
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

  // Agent stats tests (absorbed from line-changes)
  it("updateAgentStats sets agent stats", () => {
    const stats: LineChangeStats = { additions: 3, deletions: 1, timestamp: "2025-01-01T00:00:00Z" };
    const state = fileTrackingReducer(initialState, updateAgentStats("agent-1", stats));
    expect(state.agentStats["agent-1"]).toEqual(stats);
  });

  it("updateAgentStats overwrites existing agent stats", () => {
    const stats1: LineChangeStats = { additions: 3, deletions: 1, timestamp: "2025-01-01T00:00:00Z" };
    const stats2: LineChangeStats = { additions: 10, deletions: 5, timestamp: "2025-01-02T00:00:00Z" };
    let state = fileTrackingReducer(initialState, updateAgentStats("agent-1", stats1));
    state = fileTrackingReducer(state, updateAgentStats("agent-1", stats2));
    expect(state.agentStats["agent-1"]).toEqual(stats2);
  });

  it("clearAgentStats removes agent stats", () => {
    let state = fileTrackingReducer(initialState, updateAgentStats("agent-1", { additions: 1, deletions: 0, timestamp: "" }));
    state = fileTrackingReducer(state, clearAgentStats("agent-1"));
    expect(state.agentStats["agent-1"]).toBeUndefined();
  });

  it("workspaceUnmounted clears workspace state", () => {
    let state = fileTrackingReducer(initialState, setLoading(WS, true));
    state = fileTrackingReducer(state, setChanges(WS, [mockChange("a")]));
    expect(state.byWorkspaceId[WS]).toBeDefined();
    state = fileTrackingReducer(state, workspaceUnmounted(WS));
    expect(state.byWorkspaceId[WS]).toBeUndefined();
  });

  it("clearAgentStats does not affect other agents", () => {
    let state = fileTrackingReducer(initialState, updateAgentStats("agent-1", { additions: 1, deletions: 0, timestamp: "" }));
    state = fileTrackingReducer(state, updateAgentStats("agent-2", { additions: 2, deletions: 0, timestamp: "" }));
    state = fileTrackingReducer(state, clearAgentStats("agent-1"));
    expect(state.agentStats["agent-1"]).toBeUndefined();
    expect(state.agentStats["agent-2"]).toBeDefined();
  });

  it("updateAgentStatsBatch with empty batch returns the same state reference", () => {
    const next = fileTrackingReducer(initialState, updateAgentStatsBatch({}));
    expect(next).toBe(initialState);
  });

  it("updateAgentStatsBatch merges multiple agents in one update", () => {
    const stats1: LineChangeStats = { additions: 1, deletions: 0, timestamp: "t1" };
    const stats2: LineChangeStats = { additions: 5, deletions: 2, timestamp: "t2" };
    const state = fileTrackingReducer(
      initialState,
      updateAgentStatsBatch({ "agent-1": stats1, "agent-2": stats2 }),
    );
    expect(state.agentStats["agent-1"]).toEqual(stats1);
    expect(state.agentStats["agent-2"]).toEqual(stats2);
  });

  it("updateAgentStatsBatch merges with pre-existing entries (overwrites overlap, preserves others)", () => {
    const existing1: LineChangeStats = { additions: 1, deletions: 0, timestamp: "t1" };
    const existing2: LineChangeStats = { additions: 2, deletions: 0, timestamp: "t2" };
    let state = fileTrackingReducer(initialState, updateAgentStats("agent-1", existing1));
    state = fileTrackingReducer(state, updateAgentStats("agent-2", existing2));

    const updated1: LineChangeStats = { additions: 10, deletions: 5, timestamp: "t3" };
    const new3: LineChangeStats = { additions: 7, deletions: 3, timestamp: "t4" };
    state = fileTrackingReducer(
      state,
      updateAgentStatsBatch({ "agent-1": updated1, "agent-3": new3 }),
    );

    expect(state.agentStats["agent-1"]).toEqual(updated1);
    expect(state.agentStats["agent-2"]).toEqual(existing2);
    expect(state.agentStats["agent-3"]).toEqual(new3);
  });

  // Accept changes tests (moved from transient-ui slice)
  it("setCommitMessage stores the commit message on acceptChanges", () => {
    const state = fileTrackingReducer(initialState, setCommitMessage(WS, "feat: add reducer"));
    expect(state.byWorkspaceId[WS].acceptChanges.commitMessage).toBe("feat: add reducer");
  });

  it("resetAcceptChangesOperations clears coordination state without touching target branch", () => {
    let state = fileTrackingReducer(initialState, setTargetBranch(WS, "release/next"));
    state = fileTrackingReducer(state, setPendingCommitAction(WS, "commit"));
    state = fileTrackingReducer(state, setIsAutofillAndCommitting(WS, true));
    state = fileTrackingReducer(state, setIsAutofillAndCreatingPR(WS, true));
    state = fileTrackingReducer(
      state,
      startBackgroundOperation(WS, "commit", Date.now(), "Generating...")
    );

    const nextState = fileTrackingReducer(state, resetAcceptChangesOperations(WS));

    expect(nextState.byWorkspaceId[WS].acceptChanges.pendingCommitAction).toBeNull();
    expect(nextState.byWorkspaceId[WS].acceptChanges.isAutofillAndCommitting).toBe(false);
    expect(nextState.byWorkspaceId[WS].acceptChanges.isAutofillAndCreatingPR).toBe(false);
    expect(nextState.byWorkspaceId[WS].acceptChanges.backgroundOperation).toBeNull();
    expect(nextState.byWorkspaceId[WS].acceptChanges.targetBranch).toBe("release/next");
  });

  it("uses payload timestamps for background operation and cached git status", () => {
    const gitStatus = {
      currentBranch: "feature/changes",
      files: [],
      isClean: true,
      ahead: 0,
      behind: 0,
      hasConflicts: false,
    } as any;

    let state = fileTrackingReducer(
      initialState,
      startBackgroundOperation(WS, "create-pr", 123_456, "Creating PR")
    );
    state = fileTrackingReducer(state, setCachedGitStatus(WS, gitStatus, 234_567));

    expect(state.byWorkspaceId[WS].acceptChanges.backgroundOperation).toEqual({
      type: "create-pr",
      startedAt: 123_456,
      phase: "generating",
      label: "Creating PR",
    });
    expect(state.byWorkspaceId[WS].acceptChanges.cachedGitStatusTimestamp).toBe(234_567);
  });
});

describe("changes selectors", () => {
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

  // Agent stats selector tests
  it("selectAgentLineStats returns undefined for unknown agent", () => {
    expect(selectAgentLineStats.select(asStoreState(initialState), "unknown")).toBeUndefined();
  });

  it("selectAgentLineStats returns stats for known agent", () => {
    const stats: LineChangeStats = { additions: 5, deletions: 2, timestamp: "t" };
    const state = fileTrackingReducer(initialState, updateAgentStats("agent-1", stats));
    expect(selectAgentLineStats.select(asStoreState(state), "agent-1")).toEqual(stats);
  });

  it("selectAllAgentStats returns all agent stats", () => {
    let state = fileTrackingReducer(initialState, updateAgentStats("a1", { additions: 1, deletions: 0, timestamp: "" }));
    state = fileTrackingReducer(state, updateAgentStats("a2", { additions: 2, deletions: 0, timestamp: "" }));
    const all = selectAllAgentStats.select(asStoreState(state));
    expect(Object.keys(all)).toHaveLength(2);
  });
});

