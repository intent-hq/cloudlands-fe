import { describe, it, expect } from "vitest";
import {
  clearError,
  installedEditorsReducer,
  fetchEditorsSuccess,
  fetchEditorsFailure,
  setLoading,
  initialState,
  type InstalledEditorsState,
  type InstalledEditor,
} from "./installed-editors-slice";

const mockEditor: InstalledEditor = {
  id: "vscode",
  name: "Visual Studio Code",
  shortLabel: "VS Code",
  appName: "Visual Studio Code",
  category: "ide",
  handlerType: "vscode",
  bundleId: "com.microsoft.VSCode",
  priority: 100,
  installed: true,
};

const mockTerminal: InstalledEditor = {
  id: "iterm2",
  name: "iTerm2",
  shortLabel: "iTerm",
  appName: "iTerm",
  category: "terminal",
  handlerType: "generic",
  priority: 50,
  installed: true,
};

describe("installedEditorsReducer", () => {
  it("should return initial state", () => {
    const state = installedEditorsReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("fetchEditorsSuccess", () => {
    it("should set editors and lastFetched", () => {
      const editors = [mockEditor, mockTerminal];
      const timestamp = 1234567890;
      const state = installedEditorsReducer(
        initialState,
        fetchEditorsSuccess(editors, timestamp)
      );
      expect(state.editors).toEqual(editors);
      expect(state.lastFetched).toBe(timestamp);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
    });

    it("should clear error on success", () => {
      const prev: InstalledEditorsState = {
        ...initialState,
        error: "previous error",
        loading: true,
      };
      const state = installedEditorsReducer(
        prev,
        fetchEditorsSuccess([mockEditor], 999)
      );
      expect(state.error).toBeNull();
      expect(state.loading).toBe(false);
    });

    it("should not mutate previous state", () => {
      const state = installedEditorsReducer(
        initialState,
        fetchEditorsSuccess([mockEditor], 100)
      );
      expect(initialState.editors).toEqual([]);
      expect(state.editors).toHaveLength(1);
    });
  });

  describe("fetchEditorsFailure", () => {
    it("should set error and clear loading", () => {
      const prev: InstalledEditorsState = {
        ...initialState,
        loading: true,
      };
      const state = installedEditorsReducer(
        prev,
        fetchEditorsFailure("Network error")
      );
      expect(state.error).toBe("Network error");
      expect(state.loading).toBe(false);
    });

    it("should preserve existing editors on failure", () => {
      const prev: InstalledEditorsState = {
        ...initialState,
        editors: [mockEditor],
        loading: true,
      };
      const state = installedEditorsReducer(
        prev,
        fetchEditorsFailure("Failed")
      );
      expect(state.editors).toEqual([mockEditor]);
    });
  });

  describe("setLoading", () => {
    it("should set loading to true", () => {
      const state = installedEditorsReducer(initialState, setLoading(true));
      expect(state.loading).toBe(true);
    });

    it("should set loading to false", () => {
      const prev: InstalledEditorsState = {
        ...initialState,
        loading: true,
      };
      const state = installedEditorsReducer(prev, setLoading(false));
      expect(state.loading).toBe(false);
    });
  });

  describe("clearError", () => {
    it("should reset a stale error without changing editors", () => {
      const prev: InstalledEditorsState = {
        ...initialState,
        editors: [mockEditor],
        error: "Previous failure",
      };

      const state = installedEditorsReducer(prev, clearError());

      expect(state.error).toBeNull();
      expect(state.editors).toEqual([mockEditor]);
    });
  });
});

