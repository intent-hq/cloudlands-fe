import {
  describe,
  it,
  expect,
} from "vitest";
import {
  backgroundAgentExecutorReducer,
  initialState,
  setExecutorState,
  resetExecutor,
  clearWorkspaceExecutors,
} from "./background-agent-executor-slice";
import { emptyExecutorState } from "./background-agent-executor-types";

describe("backgroundAgentExecutorReducer", () => {
  it("returns initial state", () => {
    expect(backgroundAgentExecutorReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("sets executor state for a workspace and type", () => {
    const state = backgroundAgentExecutorReducer(
      initialState,
      setExecutorState("ws-1", "commit", { status: "initializing", progress: 0 }),
    );
    const executor = state.byWorkspaceId["ws-1"].executors["commit"];
    expect(executor.status).toBe("initializing");
    expect(executor.progress).toBe(0);
    // Other fields remain at defaults
    expect(executor.result).toBeNull();
    expect(executor.error).toBeNull();
    expect(executor.agentId).toBeNull();
  });

  it("merges partial updates into existing executor state", () => {
    let state = backgroundAgentExecutorReducer(
      initialState,
      setExecutorState("ws-1", "commit", { status: "running", agentId: "agent-1", progress: 10 }),
    );
    state = backgroundAgentExecutorReducer(
      state,
      setExecutorState("ws-1", "commit", { progress: 50 }),
    );
    const executor = state.byWorkspaceId["ws-1"].executors["commit"];
    expect(executor.status).toBe("running");
    expect(executor.agentId).toBe("agent-1");
    expect(executor.progress).toBe(50);
  });

  it("sets result and success status", () => {
    let state = backgroundAgentExecutorReducer(
      initialState,
      setExecutorState("ws-1", "commit", { status: "running", agentId: "agent-1" }),
    );
    state = backgroundAgentExecutorReducer(
      state,
      setExecutorState("ws-1", "commit", { status: "success", result: "feat: add login", progress: 100 }),
    );
    const executor = state.byWorkspaceId["ws-1"].executors["commit"];
    expect(executor.status).toBe("success");
    expect(executor.result).toBe("feat: add login");
    expect(executor.progress).toBe(100);
  });

  it("sets error state", () => {
    const state = backgroundAgentExecutorReducer(
      initialState,
      setExecutorState("ws-1", "pr", { status: "error", error: "Model not available" }),
    );
    const executor = state.byWorkspaceId["ws-1"].executors["pr"];
    expect(executor.status).toBe("error");
    expect(executor.error).toBe("Model not available");
  });

  it("resets executor to empty state", () => {
    let state = backgroundAgentExecutorReducer(
      initialState,
      setExecutorState("ws-1", "commit", { status: "success", result: "msg", progress: 100 }),
    );
    state = backgroundAgentExecutorReducer(state, resetExecutor("ws-1", "commit"));
    const executor = state.byWorkspaceId["ws-1"].executors["commit"];
    expect(executor).toEqual(emptyExecutorState);
  });

  it("clears all executors for a workspace", () => {
    let state = backgroundAgentExecutorReducer(
      initialState,
      setExecutorState("ws-1", "commit", { status: "running" }),
    );
    state = backgroundAgentExecutorReducer(
      state,
      setExecutorState("ws-1", "pr", { status: "running" }),
    );
    state = backgroundAgentExecutorReducer(state, clearWorkspaceExecutors("ws-1"));
    expect(state.byWorkspaceId["ws-1"]).toBeUndefined();
  });

  it("handles multiple workspaces independently", () => {
    let state = backgroundAgentExecutorReducer(
      initialState,
      setExecutorState("ws-1", "commit", { status: "running" }),
    );
    state = backgroundAgentExecutorReducer(
      state,
      setExecutorState("ws-2", "pr", { status: "initializing" }),
    );
    expect(state.byWorkspaceId["ws-1"].executors["commit"].status).toBe("running");
    expect(state.byWorkspaceId["ws-2"].executors["pr"].status).toBe("initializing");

    // Clearing ws-1 doesn't affect ws-2
    state = backgroundAgentExecutorReducer(state, clearWorkspaceExecutors("ws-1"));
    expect(state.byWorkspaceId["ws-1"]).toBeUndefined();
    expect(state.byWorkspaceId["ws-2"].executors["pr"].status).toBe("initializing");
  });

  it("handles multiple executor types per workspace independently", () => {
    let state = backgroundAgentExecutorReducer(
      initialState,
      setExecutorState("ws-1", "commit", { status: "success", result: "commit msg" }),
    );
    state = backgroundAgentExecutorReducer(
      state,
      setExecutorState("ws-1", "pr", { status: "running", progress: 30 }),
    );

    expect(state.byWorkspaceId["ws-1"].executors["commit"].status).toBe("success");
    expect(state.byWorkspaceId["ws-1"].executors["pr"].status).toBe("running");

    // Resetting commit doesn't affect pr
    state = backgroundAgentExecutorReducer(state, resetExecutor("ws-1", "commit"));
    expect(state.byWorkspaceId["ws-1"].executors["commit"]).toEqual(emptyExecutorState);
    expect(state.byWorkspaceId["ws-1"].executors["pr"].status).toBe("running");
  });

  it("stores executionContext in executor state", () => {
    const context = { files: ["a.ts"], changes: "diff content" };
    const state = backgroundAgentExecutorReducer(
      initialState,
      setExecutorState("ws-1", "commit", { status: "running", executionContext: context }),
    );
    expect(state.byWorkspaceId["ws-1"].executors["commit"].executionContext).toEqual(context);
  });
});

