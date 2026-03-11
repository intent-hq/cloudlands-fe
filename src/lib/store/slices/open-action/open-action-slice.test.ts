import { describe, it, expect } from "vitest";
import {
  openActionReducer,
  setOpenAction,
  isSpecialAction,
  type OpenActionState,
} from "./open-action-slice";

describe("openActionReducer", () => {
  const initialState: OpenActionState = {
    action: "vscode",
  };

  it("should return initial state", () => {
    const state = openActionReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("setOpenAction", () => {
    it("should set the open action", () => {
      const state = openActionReducer(initialState, setOpenAction("cursor"));
      expect(state.action).toBe("cursor");
    });

    it("should handle special actions", () => {
      const state = openActionReducer(initialState, setOpenAction("copy"));
      expect(state.action).toBe("copy");
    });

    it("should overwrite existing action", () => {
      const stateWithAction: OpenActionState = { action: "cursor" };
      const state = openActionReducer(stateWithAction, setOpenAction("vscode"));
      expect(state.action).toBe("vscode");
    });
  });

});

describe("isSpecialAction", () => {
  it("should return true for copy", () => {
    expect(isSpecialAction("copy")).toBe(true);
  });

  it("should return true for copy-branch", () => {
    expect(isSpecialAction("copy-branch")).toBe(true);
  });

  it("should return false for editor actions", () => {
    expect(isSpecialAction("vscode")).toBe(false);
    expect(isSpecialAction("cursor")).toBe(false);
    expect(isSpecialAction("jetbrains")).toBe(false);
  });

  it("should return false for arbitrary strings", () => {
    expect(isSpecialAction("unknown")).toBe(false);
    expect(isSpecialAction("")).toBe(false);
  });
});

