import {
  describe,
  expect,
  it,
} from "vitest";
import {
  initialState,
  setSystemStatus,
  systemStatusReducer,
  type SystemStatusState,
} from "./system-status-slice";

describe("systemStatusReducer", () => {
  it("returns the initial state", () => {
    expect(systemStatusReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("hydrates all system status fields", () => {
    const nextState: SystemStatusState = {
      nodeVersionOk: false,
      nodeVersion: "v18.0.0",
      auggieInstalled: true,
      binaryInstallAvailable: true,
    };

    expect(systemStatusReducer(initialState, setSystemStatus(nextState))).toEqual(nextState);
  });
});