import {
  describe,
  expect,
  it,
} from "vitest";
import type { AgentLockState } from "./agent-lock-types";
import type { StoreState } from "../../types";
import { initialState } from "./agent-lock-slice";
import { selectLockedAgentIds } from "./agent-lock-selectors";

function storeWith(agentLock: AgentLockState): StoreState {
  return { agentLock } as unknown as StoreState;
}

describe("agent-lock-slice reducer", () => {
  it("has correct initial state", () => {
    expect(initialState).toEqual({ byWorkspaceId: {} });
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

