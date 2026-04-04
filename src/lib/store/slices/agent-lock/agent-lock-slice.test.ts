import { describe, expect, it } from "vitest";
import type { AgentLockState } from "./agent-lock-types";
import type { StoreState } from "../../types";
import {
  agentLockReducer,
  initialState,
  emptyWorkspaceState,
  setAgentLockState,
} from "./agent-lock-slice";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";
import {
  selectAgentLockState,
  selectLockedAgentIds,
  selectLockedFilePaths,
  selectIsAgentLocked,
  selectIsFileLocked,
} from "./agent-lock-selectors";

function storeWith(agentLock: AgentLockState): StoreState {
  return { agentLock } as unknown as StoreState;
}

describe("agent-lock-slice reducer", () => {
  it("has correct initial state", () => {
    expect(initialState).toEqual({ byWorkspaceId: {} });
  });

  it("setAgentLockState sets locks for a workspace", () => {
    const lockedAgentIds = { "agent-1": true as const };
    const lockedFilePaths = { "src/foo.ts": true as const };
    const state = agentLockReducer(
      initialState,
      setAgentLockState("ws-1", lockedAgentIds, lockedFilePaths),
    );
    expect(state.byWorkspaceId["ws-1"]).toEqual({ lockedAgentIds, lockedFilePaths });
  });

  it("setAgentLockState returns same reference when nothing changed", () => {
    const lockedAgentIds = { "agent-1": true as const };
    const lockedFilePaths = { "src/foo.ts": true as const };
    const state1 = agentLockReducer(
      initialState,
      setAgentLockState("ws-1", lockedAgentIds, lockedFilePaths),
    );
    const state2 = agentLockReducer(
      state1,
      setAgentLockState("ws-1", lockedAgentIds, lockedFilePaths),
    );
    expect(state2).toBe(state1);
  });

  it("setAgentLockState clears locks with empty records", () => {
    const state1 = agentLockReducer(
      initialState,
      setAgentLockState("ws-1", { "agent-1": true }, { "src/foo.ts": true }),
    );
    const state2 = agentLockReducer(state1, setAgentLockState("ws-1", {}, {}));
    expect(state2.byWorkspaceId["ws-1"]).toEqual({ lockedAgentIds: {}, lockedFilePaths: {} });
  });

  it("handles multiple workspaces independently", () => {
    let state = agentLockReducer(
      initialState,
      setAgentLockState("ws-1", { "agent-1": true }, {}),
    );
    state = agentLockReducer(state, setAgentLockState("ws-2", { "agent-2": true }, {}));
    expect(state.byWorkspaceId["ws-1"]?.lockedAgentIds).toEqual({ "agent-1": true });
    expect(state.byWorkspaceId["ws-2"]?.lockedAgentIds).toEqual({ "agent-2": true });
  });
});

describe("agent-lock-slice selectors", () => {
  it("selectAgentLockState returns empty state for unknown workspace", () => {
    const state = storeWith(initialState);
    expect(selectAgentLockState.select(state, "ws-unknown")).toEqual(emptyWorkspaceState);
  });

  it("selectLockedAgentIds returns locked agent IDs", () => {
    const agentLock: AgentLockState = {
      byWorkspaceId: { "ws-1": { lockedAgentIds: { "a-1": true }, lockedFilePaths: {} } },
    };
    expect(selectLockedAgentIds.select(storeWith(agentLock), "ws-1")).toEqual({ "a-1": true });
  });

  it("selectLockedFilePaths returns locked file paths", () => {
    const agentLock: AgentLockState = {
      byWorkspaceId: { "ws-1": { lockedAgentIds: {}, lockedFilePaths: { "src/x.ts": true } } },
    };
    expect(selectLockedFilePaths.select(storeWith(agentLock), "ws-1")).toEqual({ "src/x.ts": true });
  });

  it("selectIsAgentLocked returns true for locked agent", () => {
    const agentLock: AgentLockState = {
      byWorkspaceId: { "ws-1": { lockedAgentIds: { "a-1": true }, lockedFilePaths: {} } },
    };
    expect(selectIsAgentLocked.select(storeWith(agentLock), "ws-1", "a-1")).toBe(true);
    expect(selectIsAgentLocked.select(storeWith(agentLock), "ws-1", "a-2")).toBe(false);
  });

  it("selectIsFileLocked returns true for locked file", () => {
    const agentLock: AgentLockState = {
      byWorkspaceId: { "ws-1": { lockedAgentIds: {}, lockedFilePaths: { "src/x.ts": true } } },
    };
    expect(selectIsFileLocked.select(storeWith(agentLock), "ws-1", "src/x.ts")).toBe(true);
    expect(selectIsFileLocked.select(storeWith(agentLock), "ws-1", "src/y.ts")).toBe(false);
  });

  it("selectIsAgentLocked returns false for unknown workspace", () => {
    expect(selectIsAgentLocked.select(storeWith(initialState), "ws-x", "a-1")).toBe(false);
  });
});

describe("agent-lock workspaceUnmounted", () => {
  it("clears workspace state on workspaceUnmounted", () => {
    let state = agentLockReducer(
      initialState,
      setAgentLockState("ws-1", { "agent-1": true }, {}),
    );
    state = agentLockReducer(state, setAgentLockState("ws-2", { "agent-2": true }, {}));

    const nextState = agentLockReducer(state, workspaceUnmounted("ws-1"));

    expect(nextState.byWorkspaceId["ws-1"]).toBeUndefined();
    expect(nextState.byWorkspaceId["ws-2"]).toBeDefined();
  });
});

