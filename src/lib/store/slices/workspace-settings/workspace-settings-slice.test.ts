import { describe, it, expect } from "vitest";
import {
  workspaceSettingsReducer,
  setAutoCommitEnabled,
  toggleAutoCommit,
  refreshAutoCommitSettings,
  syncWorkspaceSettings,
  loadAutoCommitSettings,
  type WorkspaceSettingsState,
} from "./workspace-settings-slice";

describe("workspaceSettingsReducer", () => {
  const initialState: WorkspaceSettingsState = {
    autoCommitEnabled: true,
  };

  it("should return initial state", () => {
    const state = workspaceSettingsReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("setAutoCommitEnabled", () => {
    it("should set autoCommitEnabled to false", () => {
      const state = workspaceSettingsReducer(initialState, setAutoCommitEnabled("ws-1", false));
      expect(state.autoCommitEnabled).toBe(false);
    });

    it("should set autoCommitEnabled to true", () => {
      const disabled = { ...initialState, autoCommitEnabled: false };
      const state = workspaceSettingsReducer(disabled, setAutoCommitEnabled("ws-1", true));
      expect(state.autoCommitEnabled).toBe(true);
    });
  });

  describe("toggleAutoCommit", () => {
    it("should toggle autoCommitEnabled from true to false", () => {
      const state = workspaceSettingsReducer(initialState, toggleAutoCommit("ws-1"));
      expect(state.autoCommitEnabled).toBe(false);
    });

    it("should toggle autoCommitEnabled from false to true", () => {
      const disabled = { ...initialState, autoCommitEnabled: false };
      const state = workspaceSettingsReducer(disabled, toggleAutoCommit("ws-1"));
      expect(state.autoCommitEnabled).toBe(true);
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

  describe("loadAutoCommitSettings", () => {
    it("should set autoCommitEnabled to false", () => {
      const state = workspaceSettingsReducer(initialState, loadAutoCommitSettings(false));
      expect(state.autoCommitEnabled).toBe(false);
    });

    it("should set autoCommitEnabled to true", () => {
      const disabled = { ...initialState, autoCommitEnabled: false };
      const state = workspaceSettingsReducer(disabled, loadAutoCommitSettings(true));
      expect(state.autoCommitEnabled).toBe(true);
    });
  });
});

