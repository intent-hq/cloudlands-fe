import { describe, expect, it } from "vitest";
import type { StoreState } from "../../types";
import {
  resetAcceptChangesOperations,
  initialState,
  setCachedGitStatus,
  setChatDraft,
  setCommitMessage,
  setIsAutofillAndCommitting,
  setIsAutofillAndCreatingPR,
  setPendingCommitAction,
  setSidebarActiveTab,
  startBackgroundOperation,
  setTargetBranch,
  setGitOperationFlag,
  defaultGitOperationFlags,
  transientUiReducer,
} from "./transient-ui-slice";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";
import {
  selectSidebarActiveTab,
  selectGitOperationFlags,
  selectGitOperationFlag,
} from "./transient-ui-selectors";

const WS_1 = "ws-1";
const WS_2 = "ws-2";

function mockState(overrides: Partial<StoreState["transientUi"]> = {}): StoreState {
  return {
    transientUi: {
      ...initialState,
      ...overrides,
    },
  } as StoreState;
}

describe("transientUiReducer", () => {
  it("returns the initial state", () => {
    expect(transientUiReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("stores workspace-scoped values independently", () => {
    let state = transientUiReducer(initialState, setCommitMessage(WS_1, "feat: add reducer"));
    state = transientUiReducer(state, setSidebarActiveTab(WS_2, "agents"));

    expect(state.byWorkspaceId[WS_1].acceptChanges.commitMessage).toBe("feat: add reducer");
    expect(state.byWorkspaceId[WS_1].sidebarActiveTab).toBe("notes");
    expect(state.byWorkspaceId[WS_2].sidebarActiveTab).toBe("agents");
  });

  it("removes chat drafts when set to an empty string", () => {
    let state = transientUiReducer(initialState, setChatDraft(WS_1, "agent-1", "draft"));
    state = transientUiReducer(state, setChatDraft(WS_1, "agent-1", ""));

    expect(state.byWorkspaceId[WS_1].chatDrafts).toEqual({});
  });

  it("clears coordination state without touching target branch", () => {
    let state = transientUiReducer(initialState, setTargetBranch(WS_1, "release/next"));
    state = transientUiReducer(state, setPendingCommitAction(WS_1, "commit"));
    state = transientUiReducer(state, setIsAutofillAndCommitting(WS_1, true));
    state = transientUiReducer(state, setIsAutofillAndCreatingPR(WS_1, true));
    state = transientUiReducer(
      state,
      startBackgroundOperation(WS_1, "commit", Date.now(), "Generating...")
    );

    const nextState = transientUiReducer(state, resetAcceptChangesOperations(WS_1));

    expect(nextState.byWorkspaceId[WS_1].acceptChanges.pendingCommitAction).toBeNull();
    expect(nextState.byWorkspaceId[WS_1].acceptChanges.isAutofillAndCommitting).toBe(false);
    expect(nextState.byWorkspaceId[WS_1].acceptChanges.isAutofillAndCreatingPR).toBe(false);
    expect(nextState.byWorkspaceId[WS_1].acceptChanges.backgroundOperation).toBeNull();
    expect(nextState.byWorkspaceId[WS_1].acceptChanges.targetBranch).toBe("release/next");
  });

  it("uses payload timestamps for background operation and cached git status", () => {
    const gitStatus = {
      currentBranch: "feature/transient-ui",
      files: [],
      isClean: true,
      ahead: 0,
      behind: 0,
      hasConflicts: false,
    };

    let state = transientUiReducer(
      initialState,
      startBackgroundOperation(WS_1, "create-pr", 123_456, "Creating PR")
    );
    state = transientUiReducer(state, setCachedGitStatus(WS_1, gitStatus, 234_567));

    expect(state.byWorkspaceId[WS_1].acceptChanges.backgroundOperation).toEqual({
      type: "create-pr",
      startedAt: 123_456,
      phase: "generating",
      label: "Creating PR",
    });
    expect(state.byWorkspaceId[WS_1].acceptChanges.cachedGitStatusTimestamp).toBe(234_567);
  });

  it("sets a git operation flag", () => {
    const state = transientUiReducer(
      initialState,
      setGitOperationFlag(WS_1, "isPushing", true)
    );
    expect(state.byWorkspaceId[WS_1].sidebarChanges.gitOperations.isPushing).toBe(true);
    // Other flags remain false
    expect(state.byWorkspaceId[WS_1].sidebarChanges.gitOperations.isPulling).toBe(false);
  });

  it("resets a git operation flag", () => {
    let state = transientUiReducer(
      initialState,
      setGitOperationFlag(WS_1, "isRebasing", true)
    );
    state = transientUiReducer(state, setGitOperationFlag(WS_1, "isRebasing", false));
    expect(state.byWorkspaceId[WS_1].sidebarChanges.gitOperations.isRebasing).toBe(false);
  });

  it("scopes git operation flags per workspace", () => {
    let state = transientUiReducer(
      initialState,
      setGitOperationFlag(WS_1, "isPushing", true)
    );
    state = transientUiReducer(state, setGitOperationFlag(WS_2, "isPulling", true));
    expect(state.byWorkspaceId[WS_1].sidebarChanges.gitOperations.isPushing).toBe(true);
    expect(state.byWorkspaceId[WS_1].sidebarChanges.gitOperations.isPulling).toBe(false);
    expect(state.byWorkspaceId[WS_2].sidebarChanges.gitOperations.isPulling).toBe(true);
    expect(state.byWorkspaceId[WS_2].sidebarChanges.gitOperations.isPushing).toBe(false);
  });

  it("clears git operation flags on workspaceUnmounted", () => {
    let state = transientUiReducer(
      initialState,
      setGitOperationFlag(WS_1, "isPushing", true)
    );
    state = transientUiReducer(state, setGitOperationFlag(WS_1, "isRebasing", true));
    const nextState = transientUiReducer(state, workspaceUnmounted(WS_1));
    expect(nextState.byWorkspaceId[WS_1]).toBeUndefined();
  });

  it("initializes git operation flags to all false", () => {
    const state = transientUiReducer(initialState, setSidebarActiveTab(WS_1, "changes"));
    expect(state.byWorkspaceId[WS_1].sidebarChanges.gitOperations).toEqual(
      defaultGitOperationFlags
    );
  });

  it("clears workspace state on workspaceUnmounted", () => {
    let state = transientUiReducer(initialState, setCommitMessage(WS_1, "feat: something"));
    state = transientUiReducer(state, setSidebarActiveTab(WS_1, "files"));
    state = transientUiReducer(state, setCommitMessage(WS_2, "fix: other"));

    const nextState = transientUiReducer(state, workspaceUnmounted(WS_1));

    expect(nextState.byWorkspaceId[WS_1]).toBeUndefined();
    expect(nextState.byWorkspaceId[WS_2].acceptChanges.commitMessage).toBe("fix: other");
  });
});

describe("transientUi selectors", () => {
  it("returns the default sidebar tab for missing workspaces", () => {
    const state = mockState();

    expect(selectSidebarActiveTab.select(state, WS_1)).toBe("notes");
  });

  it("selectGitOperationFlags returns all flags", () => {
    const reducerState = transientUiReducer(
      initialState,
      setGitOperationFlag(WS_1, "isPushing", true)
    );
    const state = mockState(reducerState);
    const flags = selectGitOperationFlags.select(state, WS_1);
    expect(flags.isPushing).toBe(true);
    expect(flags.isPulling).toBe(false);
  });

  it("selectGitOperationFlag returns a single flag", () => {
    const reducerState = transientUiReducer(
      initialState,
      setGitOperationFlag(WS_1, "isRefreshingPR", true)
    );
    const state = mockState(reducerState);
    expect(selectGitOperationFlag.select(state, WS_1, "isRefreshingPR")).toBe(true);
    expect(selectGitOperationFlag.select(state, WS_1, "isPushing")).toBe(false);
  });

  it("selectGitOperationFlags returns defaults for missing workspace", () => {
    const state = mockState();
    const flags = selectGitOperationFlags.select(state, "nonexistent");
    expect(flags).toEqual(defaultGitOperationFlags);
  });
});