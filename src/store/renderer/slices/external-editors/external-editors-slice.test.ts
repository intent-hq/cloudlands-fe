import {
  describe,
  expect,
  it,
} from "vitest";
import {
  createCollection,
  getItems,
} from "$lib/store-shim/utils/collections/collection-utils";
import {
  clearError,
  externalEditorsReducer,
  fetchEditorsFailure,
  fetchEditorsSuccess,
  initialState,
  isSpecialAction,
  setHiddenEditorIds,
  setLoading,
  setOpenAction,
  toggleHiddenEditor,
  type ExternalEditorsState,
  type InstalledEditor,
} from "./external-editors-slice";

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

describe("externalEditorsReducer", () => {
  it("should return initial state", () => {
    const state = externalEditorsReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("setOpenAction", () => {
    it("should set the selected action", () => {
      const state = externalEditorsReducer(initialState, setOpenAction("cursor"));
      expect(state.selectedAction).toBe("cursor");
    });

    it("should handle special actions", () => {
      const state = externalEditorsReducer(initialState, setOpenAction("copy"));
      expect(state.selectedAction).toBe("copy");
    });

    it("should overwrite existing action", () => {
      const prev: ExternalEditorsState = {
        ...initialState,
        selectedAction: "cursor",
      };

      const state = externalEditorsReducer(prev, setOpenAction("vscode"));
      expect(state.selectedAction).toBe("vscode");
    });

    it("should coerce malformed selected actions to a string", () => {
      const state = externalEditorsReducer(
        initialState,
        setOpenAction(123 as unknown as string)
      );

      expect(state.selectedAction).toBe("123");
    });
  });

  describe("fetchEditorsSuccess", () => {
    it("should set editors and lastFetched", () => {
      const editors = [mockEditor, mockTerminal];
      const timestamp = 1234567890;
      const state = externalEditorsReducer(
        initialState,
        fetchEditorsSuccess(editors, timestamp)
      );

      expect(state.editors).toEqual(
        createCollection<InstalledEditor, "id">("id", editors)
      );
      expect(getItems(state.editors)).toEqual(editors);
      expect(state.lastFetched).toBe(timestamp);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
    });

    it("should clear error on success", () => {
      const prev: ExternalEditorsState = {
        ...initialState,
        error: "previous error",
        loading: true,
      };

      const state = externalEditorsReducer(
        prev,
        fetchEditorsSuccess([mockEditor], 999)
      );

      expect(state.error).toBeNull();
      expect(state.loading).toBe(false);
    });

    it("should not mutate previous state", () => {
      const state = externalEditorsReducer(
        initialState,
        fetchEditorsSuccess([mockEditor], 100)
      );

      expect(initialState.editors).toEqual(
        createCollection<InstalledEditor, "id">("id")
      );
      expect(getItems(state.editors)).toHaveLength(1);
    });

    it("should normalize malformed editor records before storing", () => {
      const state = externalEditorsReducer(
        initialState,
        fetchEditorsSuccess(
          [
            {
              id: "malformed",
              name: 42,
              shortLabel: { text: "Bad label" },
              appName: null,
              category: "unknown",
              handlerType: ["generic"],
              shortcut: 99,
              priority: "high",
              installed: "true",
              iconBase64: { data: "not base64" },
            },
            { id: { bad: true }, name: "Dropped" },
          ] as unknown as InstalledEditor[],
          Number.NaN
        )
      );

      expect(getItems(state.editors)).toEqual([
        {
          id: "malformed",
          name: "42",
          shortLabel: "malformed",
          appName: "malformed",
          category: "ide",
          handlerType: "generic",
          shortcut: "99",
          priority: 0,
          installed: true,
        },
      ]);
      expect(state.lastFetched).toBe(0);
    });
  });

  describe("fetchEditorsFailure", () => {
    it("should set error and clear loading", () => {
      const prev: ExternalEditorsState = {
        ...initialState,
        loading: true,
      };

      const state = externalEditorsReducer(
        prev,
        fetchEditorsFailure("Network error")
      );

      expect(state.error).toBe("Network error");
      expect(state.loading).toBe(false);
    });

    it("should preserve existing editors on failure", () => {
      const prev: ExternalEditorsState = {
        ...initialState,
        editors: createCollection<InstalledEditor, "id">("id", [mockEditor]),
        loading: true,
      };

      const state = externalEditorsReducer(prev, fetchEditorsFailure("Failed"));
      expect(getItems(state.editors)).toEqual([mockEditor]);
    });

    it("should coerce malformed errors before storing", () => {
      const state = externalEditorsReducer(
        initialState,
        fetchEditorsFailure({ message: 500 } as unknown as string)
      );

      expect(state.error).toBe("500");
    });
  });

  describe("setLoading", () => {
    it("should set loading to true", () => {
      const state = externalEditorsReducer(initialState, setLoading(true));
      expect(state.loading).toBe(true);
    });

    it("should set loading to false", () => {
      const prev: ExternalEditorsState = {
        ...initialState,
        loading: true,
      };

      const state = externalEditorsReducer(prev, setLoading(false));
      expect(state.loading).toBe(false);
    });
  });

  describe("hidden editor actions", () => {
    it("should replace hidden editor ids with normalized unique strings", () => {
      const state = externalEditorsReducer(
        initialState,
        setHiddenEditorIds(["vscode", "cursor", "vscode", 123 as unknown as string])
      );

      expect(state.hiddenEditorIds).toEqual(["vscode", "cursor"]);
    });

    it("should toggle editor ids in and out of the hidden list", () => {
      const hiddenState = externalEditorsReducer(initialState, toggleHiddenEditor("vscode"));
      expect(hiddenState.hiddenEditorIds).toEqual(["vscode"]);

      const visibleState = externalEditorsReducer(hiddenState, toggleHiddenEditor("vscode"));
      expect(visibleState.hiddenEditorIds).toEqual([]);
    });

    it("should ignore empty editor ids", () => {
      const state = externalEditorsReducer(initialState, toggleHiddenEditor(""));
      expect(state).toBe(initialState);
    });
  });

  describe("clearError", () => {
    it("should reset a stale error without changing editors", () => {
      const prev: ExternalEditorsState = {
        ...initialState,
        editors: createCollection<InstalledEditor, "id">("id", [mockEditor]),
        error: "Previous failure",
      };

      const state = externalEditorsReducer(prev, clearError());

      expect(state.error).toBeNull();
      expect(getItems(state.editors)).toEqual([mockEditor]);
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