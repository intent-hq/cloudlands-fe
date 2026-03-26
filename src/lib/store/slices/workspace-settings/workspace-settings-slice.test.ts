import { describe, it, expect } from "vitest";
import {
  workspaceSettingsReducer,
  setAutoCommitEnabled,
  toggleAutoCommit,
  refreshAutoCommitSettings,
  syncWorkspaceSettings,
  loadAutoCommitSettings,
  clearWorkspaceSettings,
  type WorkspaceSettingsState,
} from "./workspace-settings-slice";

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

  describe("toggleAutoCommit", () => {
    it("should toggle autoCommitEnabled from true to false", () => {
      const withEnabled: WorkspaceSettingsState = {
        byWorkspaceId: { "ws-1": { autoCommitEnabled: true } },
      };
      const state = workspaceSettingsReducer(withEnabled, toggleAutoCommit("ws-1"));
      expect(state.byWorkspaceId["ws-1"]?.autoCommitEnabled).toBe(false);
    });

    it("should toggle autoCommitEnabled from false to true", () => {
      const disabled: WorkspaceSettingsState = {
        byWorkspaceId: { "ws-1": { autoCommitEnabled: false } },
      };
      const state = workspaceSettingsReducer(disabled, toggleAutoCommit("ws-1"));
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

  describe("loadAutoCommitSettings", () => {
    it("should set autoCommitEnabled to false", () => {
      const state = workspaceSettingsReducer(initialState, loadAutoCommitSettings("ws-1", false));
      expect(state.byWorkspaceId["ws-1"]?.autoCommitEnabled).toBe(false);
    });

    it("should set autoCommitEnabled to true", () => {
      const disabled: WorkspaceSettingsState = {
        byWorkspaceId: { "ws-1": { autoCommitEnabled: false } },
      };
      const state = workspaceSettingsReducer(disabled, loadAutoCommitSettings("ws-1", true));
      expect(state.byWorkspaceId["ws-1"]?.autoCommitEnabled).toBe(true);
    });
  });

  describe("clearWorkspaceSettings", () => {
    it("should remove workspace state", () => {
      const withWs: WorkspaceSettingsState = {
        byWorkspaceId: { "ws-1": { autoCommitEnabled: false } },
      };
      const state = workspaceSettingsReducer(withWs, clearWorkspaceSettings("ws-1"));
      expect(state.byWorkspaceId["ws-1"]).toBeUndefined();
    });

    it("should not change state if workspace not present", () => {
      const state = workspaceSettingsReducer(initialState, clearWorkspaceSettings("ws-1"));
      expect(state).toBe(initialState);
    });
  });
});

