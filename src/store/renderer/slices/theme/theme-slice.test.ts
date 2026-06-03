import {
  describe,
  expect,
  it,
} from "vitest";
import {
  initialState,
  setThemeCustomization,
  setThemeError,
  setThemeName,
  setThemePreference,
  themeReducer,
} from "./theme-slice";
import type { ThemeState } from "./theme-types";

describe("themeReducer", () => {
  it("returns initial state", () => {
    const state = themeReducer(undefined, { type: "@@INIT" });

    expect(state).toEqual(initialState);
    expect(state.name).toBe("dark");
    expect(state.preference).toBe("system");
    expect(state.hasCustomTheme).toBe(false);
    expect(state.customThemeName).toBeNull();
    expect(state.activePresetId).toBeNull();
    expect(state.error).toBeNull();
  });

  it("sets the theme name", () => {
    const previous: ThemeState = { ...initialState, name: "dark", preference: "system" };
    const state = themeReducer(previous, setThemeName("light"));

    expect(state.name).toBe("light");
    expect(state.preference).toBe("system");
  });

  it("sets the theme preference", () => {
    const previous: ThemeState = { ...initialState, name: "dark", preference: "system" };
    const state = themeReducer(previous, setThemePreference("light"));

    expect(state.name).toBe("dark");
    expect(state.preference).toBe("light");
  });

  it("does not mutate previous state", () => {
    const previous: ThemeState = { ...initialState, name: "dark", preference: "system" };
    const state = themeReducer(previous, setThemeName("light"));

    expect(previous.name).toBe("dark");
    expect(previous.preference).toBe("system");
    expect(state.name).toBe("light");
    expect(state.preference).toBe("system");
  });

  it("does not mutate previous state when setting the theme preference", () => {
    const previous: ThemeState = { ...initialState, name: "dark", preference: "system" };
    const state = themeReducer(previous, setThemePreference("dark"));

    expect(previous.name).toBe("dark");
    expect(previous.preference).toBe("system");
    expect(state.name).toBe("dark");
    expect(state.preference).toBe("dark");
  });

  it("returns the same state reference when the name is unchanged", () => {
    const previous: ThemeState = { ...initialState, name: "light", preference: "system" };
    const state = themeReducer(previous, setThemeName("light"));

    expect(state).toBe(previous);
  });

  it("returns the same state reference when the preference is unchanged", () => {
    const previous: ThemeState = { ...initialState, name: "light", preference: "system" };
    const state = themeReducer(previous, setThemePreference("system"));

    expect(state).toBe(previous);
  });

  it("sets custom theme metadata", () => {
    const state = themeReducer(
      initialState,
      setThemeCustomization({
        hasCustomTheme: true,
        customThemeName: "Catppuccin Mocha",
        activePresetId: "catppuccin",
      }),
    );

    expect(state.hasCustomTheme).toBe(true);
    expect(state.customThemeName).toBe("Catppuccin Mocha");
    expect(state.activePresetId).toBe("catppuccin");
  });

  it("returns the same state reference when custom theme metadata is unchanged", () => {
    const previous: ThemeState = {
      ...initialState,
      hasCustomTheme: true,
      customThemeName: "Catppuccin Mocha",
      activePresetId: "catppuccin",
    };
    const state = themeReducer(
      previous,
      setThemeCustomization({
        hasCustomTheme: true,
        customThemeName: "Catppuccin Mocha",
        activePresetId: "catppuccin",
      }),
    );

    expect(state).toBe(previous);
  });

  it("sets and clears theme errors", () => {
    const errored = themeReducer(initialState, setThemeError("Invalid theme"));

    expect(errored.error).toBe("Invalid theme");

    const cleared = themeReducer(errored, setThemeError(null));
    expect(cleared.error).toBeNull();
  });

  it("returns the same state reference when the error is unchanged", () => {
    const previous: ThemeState = { ...initialState, error: "Invalid theme" };
    const state = themeReducer(previous, setThemeError("Invalid theme"));

    expect(state).toBe(previous);
  });
});
