import {
  describe,
  it,
  expect,
} from "vitest";
import { workspaceSettingsReducer, setAutoCommitEnabled, refreshAutoCommitSettings, syncWorkspaceSettings, type WorkspaceSettingsState } from "./workspace-settings-slice";

describe("workspaceSettingsReducer", () => {
  const initialState: WorkspaceSettingsState = {
    byWorkspaceId: {},
  };

  it("should return initial state", () => {
    const state = workspaceSettingsReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("setAutoCommitEnabled", () => {
    it("should set autoCommitEnabled to false", () => {
      const state = workspaceSettingsReducer(initialState, setAutoCommitEnabled("ws-1", false));
      expect(state.byWorkspaceId["ws-1"]?.autoCommitEnabled).toBe(false);
    });

    it("should set autoCommitEnabled to true", () => {
      const disabled: WorkspaceSettingsState = {
        byWorkspaceId: { "ws-1": { autoCommitEnabled: false } },
      };
      const state = workspaceSettingsReducer(disabled, setAutoCommitEnabled("ws-1", true));
      expect(state.byWorkspaceId["ws-1"]?.autoCommitEnabled).toBe(true);
    });
  });

  describe("refreshAutoCommitSettings", () => {
    it("should not change state (handled by saga)", () => {
      const state = workspaceSettingsReducer(initialState, refreshAutoCommitSettings());
      expect(state).toEqual(initialState);
    });
  });

  describe("syncWorkspaceSettings", () => {
    it("should not change state (handled by saga)", () => {
      const state = workspaceSettingsReducer(initialState, syncWorkspaceSettings("ws-1"));
      expect(state).toEqual(initialState);
    });
  });
});

