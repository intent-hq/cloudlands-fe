import { describe, expect, it } from "vitest";
import type { StoreState } from "../../types";
import { initialState } from "./system-status-slice";
import {
  selectAuggieInstalled,
  selectBinaryInstallAvailable,
  selectNodeVersion,
  selectNodeVersionOk,
  selectShowNodeWarning,
} from "./system-status-selectors";

function mockState(overrides = {}): StoreState {
  return {
    systemStatus: {
      ...initialState,
      ...overrides,
    },
  } as StoreState;
}

describe("system-status selectors", () => {
  it("returns the raw system status fields", () => {
    const state = mockState({
      nodeVersionOk: false,
      nodeVersion: "v18.0.0",
      auggieInstalled: true,
      binaryInstallAvailable: false,
    });

    expect(selectNodeVersionOk.select(state)).toBe(false);
    expect(selectNodeVersion.select(state)).toBe("v18.0.0");
    expect(selectAuggieInstalled.select(state)).toBe(true);
    expect(selectBinaryInstallAvailable.select(state)).toBe(false);
  });

  it("shows the node warning only when node is unsupported and no install path exists", () => {
    expect(
      selectShowNodeWarning.select(
        mockState({
          nodeVersionOk: false,
          auggieInstalled: false,
          binaryInstallAvailable: false,
        })
      )
    ).toBe(true);

    expect(
      selectShowNodeWarning.select(
        mockState({
          nodeVersionOk: false,
          auggieInstalled: true,
          binaryInstallAvailable: false,
        })
      )
    ).toBe(false);
  });
});