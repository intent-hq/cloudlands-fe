import {
  describe,
  it,
  expect,
} from "vitest";
import { gitReducer, initialState, setGitStatus, getGitWorkspaceState } from "./git-slice";
import type { GitStatus } from "$shared/types";

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

  describe("setGitStatus", () => {

    it("should default ahead/behind to 0 when missing", () => {
      const status = makeGitStatus({ ahead: 0, behind: 0, branch: "main" });
      const state = reduce(initialState, setGitStatus("ws-1", status));
      const ws = getGitWorkspaceState(state, "ws-1");
      expect(ws.ahead).toBe(0);
      expect(ws.behind).toBe(0);
    });
  });
});

