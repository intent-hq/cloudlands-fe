import {
  describe,
  expect,
  test,
} from "vitest";
import { createWorkspaceScopedHelpers } from "./workspace-scoped";

type TestWorkspaceState = {
  value: number;
  label: string;
};

type TestRootState = {
  byWorkspaceId: Record<string, TestWorkspaceState>;
  untouched: string;
};

const emptyWorkspaceState: TestWorkspaceState = {
  value: 0,
  label: "empty",
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceState);

describe("createWorkspaceScopedHelpers", () => {
  test("getWorkspaceState returns the configured empty state for missing workspaces", () => {
    const state: TestRootState = {
      byWorkspaceId: {},
      untouched: "keep",
    };

    expect(getWorkspaceState(state, "ws-1")).toBe(emptyWorkspaceState);
  });

  test("getWorkspaceState returns existing workspace state", () => {
    const existingWorkspaceState: TestWorkspaceState = { value: 3, label: "present" };
    const state: TestRootState = {
      byWorkspaceId: { "ws-1": existingWorkspaceState },
      untouched: "keep",
    };

    expect(getWorkspaceState(state, "ws-1")).toBe(existingWorkspaceState);
  });

  test("setWorkspaceState immutably writes a workspace state", () => {
    const existingWorkspaceState: TestWorkspaceState = { value: 1, label: "existing" };
    const nextWorkspaceState: TestWorkspaceState = { value: 2, label: "updated" };
    const state: TestRootState = {
      byWorkspaceId: { "ws-1": existingWorkspaceState },
      untouched: "keep",
    };

    const result = setWorkspaceState(state, "ws-2", nextWorkspaceState);

    expect(result).not.toBe(state);
    expect(result.byWorkspaceId).not.toBe(state.byWorkspaceId);
    expect(result.byWorkspaceId["ws-1"]).toBe(existingWorkspaceState);
    expect(result.byWorkspaceId["ws-2"]).toBe(nextWorkspaceState);
    expect(result.untouched).toBe("keep");
  });

  test("clearWorkspaceState removes a workspace state immutably", () => {
    const retainedWorkspaceState: TestWorkspaceState = { value: 1, label: "retain" };
    const state: TestRootState = {
      byWorkspaceId: {
        "ws-1": { value: 2, label: "remove" },
        "ws-2": retainedWorkspaceState,
      },
      untouched: "keep",
    };

    const result = clearWorkspaceState(state, "ws-1");

    expect(result).not.toBe(state);
    expect(result.byWorkspaceId).not.toBe(state.byWorkspaceId);
    expect(result.byWorkspaceId["ws-1"]).toBeUndefined();
    expect(result.byWorkspaceId["ws-2"]).toBe(retainedWorkspaceState);
    expect(result.untouched).toBe("keep");
  });

  test("clearWorkspaceState returns the original state when the workspace is missing", () => {
    const state: TestRootState = {
      byWorkspaceId: { "ws-1": { value: 1, label: "present" } },
      untouched: "keep",
    };

    expect(clearWorkspaceState(state, "ws-2")).toBe(state);
  });
});