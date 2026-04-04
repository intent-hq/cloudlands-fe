import { describe, it, expect } from "vitest";
import {
  prStatusReducer,
  initialState,
  prStatusRefreshStarted,
  prStatusRefreshCompleted,
  cleanupPRStatusWorkspace,
} from "./pr-status-slice";

describe("prStatusReducer", () => {
  it("returns initial state", () => {
    expect(prStatusReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("sets isRefreshing on refreshStarted", () => {
    const state = prStatusReducer(initialState, prStatusRefreshStarted("ws-1"));
    const ws = state.byWorkspaceId["ws-1"];
    expect(ws.isRefreshing).toBe(true);
    expect(ws.lastError).toBeNull();
  });

  it("clears isRefreshing and sets lastRefreshTime on successful completion", () => {
    const startedState = prStatusReducer(initialState, prStatusRefreshStarted("ws-1"));
    const state = prStatusReducer(startedState, prStatusRefreshCompleted("ws-1", true));
    const ws = state.byWorkspaceId["ws-1"];
    expect(ws.isRefreshing).toBe(false);
    expect(ws.lastRefreshTime).toBeTypeOf("number");
    expect(ws.lastError).toBeNull();
  });

  it("sets lastError on failed completion", () => {
    const startedState = prStatusReducer(initialState, prStatusRefreshStarted("ws-1"));
    const state = prStatusReducer(
      startedState,
      prStatusRefreshCompleted("ws-1", false, "Network error"),
    );
    const ws = state.byWorkspaceId["ws-1"];
    expect(ws.isRefreshing).toBe(false);
    expect(ws.lastError).toBe("Network error");
  });

  it("does not update lastRefreshTime on failure", () => {
    const startedState = prStatusReducer(initialState, prStatusRefreshStarted("ws-1"));
    const state = prStatusReducer(
      startedState,
      prStatusRefreshCompleted("ws-1", false, "err"),
    );
    expect(state.byWorkspaceId["ws-1"].lastRefreshTime).toBeNull();
  });

  it("clears workspace state on cleanup", () => {
    let state = prStatusReducer(initialState, prStatusRefreshStarted("ws-1"));
    state = prStatusReducer(state, prStatusRefreshCompleted("ws-1", true));
    state = prStatusReducer(state, cleanupPRStatusWorkspace("ws-1"));
    // After cleanup, workspace state should be the default empty state
    const ws = state.byWorkspaceId["ws-1"];
    expect(ws).toBeUndefined();
  });

  it("handles multiple workspaces independently", () => {
    let state = prStatusReducer(initialState, prStatusRefreshStarted("ws-1"));
    state = prStatusReducer(state, prStatusRefreshStarted("ws-2"));
    state = prStatusReducer(state, prStatusRefreshCompleted("ws-1", true));

    expect(state.byWorkspaceId["ws-1"].isRefreshing).toBe(false);
    expect(state.byWorkspaceId["ws-2"].isRefreshing).toBe(true);
  });
});

