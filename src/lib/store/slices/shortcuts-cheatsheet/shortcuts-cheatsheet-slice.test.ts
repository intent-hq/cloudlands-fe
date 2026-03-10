import { describe, it, expect } from "vitest";
import {
  closeCheatSheet,
  openCheatSheet,
  shortcutsCheatSheetReducer,
  toggleCheatSheet,
  type ShortcutsCheatSheetState,
} from "./shortcuts-cheatsheet-slice";

describe("shortcutsCheatSheetReducer", () => {
  const initialState: ShortcutsCheatSheetState = {
    isOpen: false,
    context: "global",
  };

  it("should return initial state", () => {
    const state = shortcutsCheatSheetReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  it("should open the cheat sheet with the provided context", () => {
    const state = shortcutsCheatSheetReducer(initialState, openCheatSheet("editor"));
    expect(state).toEqual({
      isOpen: true,
      context: "editor",
    });
  });

  it("should close the cheat sheet", () => {
    const state = shortcutsCheatSheetReducer(
      {
        isOpen: true,
        context: "panel",
      },
      closeCheatSheet()
    );

    expect(state).toEqual({
      isOpen: false,
      context: "panel",
    });
  });

  it("should toggle from closed to open with the provided context", () => {
    const state = shortcutsCheatSheetReducer(initialState, toggleCheatSheet("terminal"));
    expect(state).toEqual({
      isOpen: true,
      context: "terminal",
    });
  });

  it("should toggle from open to closed", () => {
    const state = shortcutsCheatSheetReducer(
      {
        isOpen: true,
        context: "chat",
      },
      toggleCheatSheet("global")
    );

    expect(state).toEqual({
      isOpen: false,
      context: "chat",
    });
  });
});