import {
  describe,
  it,
  expect,
} from "vitest";
import {
  gitReducer,
  initialState,
  setGitLoading,
  setGitStatus,
  setGitError,
  clearGitError,
  setGitDiffs,
  getGitWorkspaceState,
} from "./git-slice";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";
import type { GitStatus, DiffChunk } from "$shared/types";

const reduce = gitReducer;

const makeGitStatus = (overrides: Partial<GitStatus> = {}): GitStatus => ({
  branch: "main",
  ahead: 1,
  behind: 0,
  diverged: false,
  files: [],
  hasUncommittedChanges: false,
  hasUntrackedFiles: false,
  ...overrides,
});

describe("gitReducer", () => {
  it("should return initial state", () => {
    const state = reduce(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("setGitLoading", () => {
    it("should set loading to true", () => {
      const state = reduce(initialState, setGitLoading("ws-1", true));
      expect(getGitWorkspaceState(state, "ws-1").loading).toBe(true);
    });

    it("should set loading to false", () => {
      let state = reduce(initialState, setGitLoading("ws-1", true));
      state = reduce(state, setGitLoading("ws-1", false));
      expect(getGitWorkspaceState(state, "ws-1").loading).toBe(false);
    });
  });

  describe("setGitStatus", () => {
    it("should set status and clear loading/error", () => {
      let state = reduce(initialState, setGitLoading("ws-1", true));
      state = reduce(state, setGitError("ws-1", "previous error"));
      const status = makeGitStatus({ branch: "feature", ahead: 2, behind: 1 });
      state = reduce(state, setGitStatus("ws-1", status));

      const ws = getGitWorkspaceState(state, "ws-1");
      expect(ws.status).toEqual(status);
      expect(ws.loading).toBe(false);
      expect(ws.error).toBeNull();
      expect(ws.branch).toBe("feature");
      expect(ws.ahead).toBe(2);
      expect(ws.behind).toBe(1);
    });

    it("should default ahead/behind to 0 when missing", () => {
      const status = makeGitStatus({ ahead: 0, behind: 0, branch: "main" });
      const state = reduce(initialState, setGitStatus("ws-1", status));
      const ws = getGitWorkspaceState(state, "ws-1");
      expect(ws.ahead).toBe(0);
      expect(ws.behind).toBe(0);
    });
  });

  describe("setGitError", () => {
    it("should set error and clear loading", () => {
      let state = reduce(initialState, setGitLoading("ws-1", true));
      state = reduce(state, setGitError("ws-1", "something failed"));
      const ws = getGitWorkspaceState(state, "ws-1");
      expect(ws.error).toBe("something failed");
      expect(ws.loading).toBe(false);
    });
  });

  describe("clearGitError", () => {
    it("should clear error", () => {
      let state = reduce(initialState, setGitError("ws-1", "err"));
      state = reduce(state, clearGitError("ws-1"));
      expect(getGitWorkspaceState(state, "ws-1").error).toBeNull();
    });

    it("should return same state if error is already null", () => {
      const state = reduce(initialState, clearGitError("ws-1"));
      // workspace is lazily created, but error starts null
      expect(getGitWorkspaceState(state, "ws-1").error).toBeNull();
    });
  });

  describe("setGitDiffs", () => {
    it("should set diffs and clear loading", () => {
      const diffs: DiffChunk[] = [{ file: "a.ts", chunks: [] }];
      let state = reduce(initialState, setGitLoading("ws-1", true));
      state = reduce(state, setGitDiffs("ws-1", diffs));
      const ws = getGitWorkspaceState(state, "ws-1");
      expect(ws.diffs).toEqual(diffs);
      expect(ws.loading).toBe(false);
    });
  });

  it("should isolate workspaces", () => {
    let state = reduce(initialState, setGitLoading("ws-1", true));
    state = reduce(state, setGitError("ws-2", "error"));
    expect(getGitWorkspaceState(state, "ws-1").loading).toBe(true);
    expect(getGitWorkspaceState(state, "ws-1").error).toBeNull();
    expect(getGitWorkspaceState(state, "ws-2").loading).toBe(false);
    expect(getGitWorkspaceState(state, "ws-2").error).toBe("error");
  });

  it("workspaceUnmounted clears workspace state", () => {
    let state = reduce(initialState, setGitLoading("ws-1", true));
    state = reduce(state, setGitError("ws-2", "error"));

    const nextState = reduce(state, workspaceUnmounted("ws-1"));

    expect(nextState.byWorkspaceId["ws-1"]).toBeUndefined();
    expect(nextState.byWorkspaceId["ws-2"]).toBeDefined();
  });
});

