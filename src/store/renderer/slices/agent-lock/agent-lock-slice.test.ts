import {
  describe,
  expect,
  it,
} from "vitest";
import type { AgentLockState } from "./agent-lock-types";
import type { StoreState } from "../../types";
import {
  agentLockReducer,
  initialState,
  setAgentLockState,
} from "./agent-lock-slice";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";
import { selectLockedAgentIds } from "./agent-lock-selectors";

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
  it("selectLockedAgentIds returns locked agent IDs", () => {
    const agentLock: AgentLockState = {
      byWorkspaceId: { "ws-1": { lockedAgentIds: { "a-1": true }, lockedFilePaths: {} } },
    };
    expect(selectLockedAgentIds.select(storeWith(agentLock), "ws-1")).toEqual({ "a-1": true });
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

