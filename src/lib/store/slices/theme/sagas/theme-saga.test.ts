import { beforeEach, describe, expect, it, vi } from "vitest";
import * as sagaEffects from "redux-saga/effects";

vi.mock(
  "typed-redux-saga",
  async () => await import("$lib/store/utils/test-helpers/typed-redux-saga-mock"),
);

const { takeEveryFromWindowEventMock } = vi.hoisted(() => ({
  takeEveryFromWindowEventMock: vi.fn(function* () {}),
}));

vi.mock("../../../utils/ipc-channel", () => ({
  takeEveryFromWindowEvent: takeEveryFromWindowEventMock,
}));

import type { ThemeManager } from "$lib/utils/theme";
import {
  clearThemeCustomization,
  importCustomTheme,
  requestThemePreferenceChange,
  selectThemePreset,
  setThemeError,
  setThemeCustomization,
  setThemeName,
  setThemePreference,
} from "../theme-slice";
import {
  getLocalStorageItem,
  setLocalStorageItem,
} from "$lib/store/utils/safe-local-storage-saga";
import {
  applyCustomThemeToManager,
  applyPresetThemeToManager,
  applyThemePreferenceToManager,
  clearCustomThemeFromManager,
  getThemeManager,
  handleCustomThemeImported,
  handleThemeChanged,
  handleThemeCustomizationCleared,
  handleThemePreferenceChangeRequested,
  handleThemePresetSelected,
  initThemeSaga,
  persistThemePreference,
  readThemeManagerSnapshot,
  readThemePreferenceFromStorage,
  readThemeNameFromBrowserState,
  syncReduxFromThemeManager,
  themeCustomizationFromEvent,
  validateCustomThemeImport,
  themeNameFromIsDark,
  themeSaga,
  watchThemeCustomizationRequestsSaga,
  watchThemeChangedSaga,
  watchThemePreferencePersistenceSaga,
} from "./theme-saga";

function createThemeManagerMock(overrides: Partial<ThemeManager> = {}): ThemeManager {
  return {
    setTheme: vi.fn(),
    getTheme: vi.fn(() => "system"),
    setCustomTheme: vi.fn(),
    setPresetTheme: vi.fn(),
    clearCustomTheme: vi.fn(),
    hasCustomTheme: vi.fn(() => false),
    getCustomThemeName: vi.fn(() => null),
    getActivePresetId: vi.fn(() => null),
    toggleTheme: vi.fn(),
    isDark: vi.fn(() => true),
    ...overrides,
  } as unknown as ThemeManager;
}

function stubMatchMedia(matches: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockReturnValue({
      matches,
      media: "(prefers-color-scheme: dark)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
}

function resetMatchMedia(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: undefined,
  });
}

describe("themeSaga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMatchMedia();
    localStorage.clear();
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.style.removeProperty("color-scheme");
  });

  it("maps the ThemeManager resolved isDark flag to a theme slice name", () => {
    expect(themeNameFromIsDark(true)).toBe("dark");
    expect(themeNameFromIsDark(false)).toBe("light");
  });

  it("prefers the document theme class when hydrating browser state", () => {
    document.documentElement.classList.add("light");
    stubMatchMedia(true);

    expect(readThemeNameFromBrowserState("dark")).toBe("light");
  });

  it("resolves a system preference through matchMedia", () => {
    stubMatchMedia(false);

    expect(readThemeNameFromBrowserState("system")).toBe("light");
  });

  it("reads a valid stored theme preference through the safe localStorage helper", () => {
    const iterator = readThemePreferenceFromStorage();

    expect(iterator.next().value).toEqual(sagaEffects.call(getLocalStorageItem, "theme"));
    expect(iterator.next("dark")).toEqual({ done: true, value: "dark" });
  });

  it("falls back to system for an invalid stored theme preference", () => {
    const iterator = readThemePreferenceFromStorage();

    expect(iterator.next().value).toEqual(sagaEffects.call(getLocalStorageItem, "theme"));
    expect(iterator.next("solarized")).toEqual({ done: true, value: "system" });
  });

  it("persists theme preference through the safe localStorage helper", () => {
    const iterator = persistThemePreference("light");

    expect(iterator.next().value).toEqual(
      sagaEffects.call(setLocalStorageItem, "theme", "light"),
    );
    expect(iterator.next().done).toBe(true);
  });

  it("initializes ThemeManager from the stored preference and syncs Redux", () => {
    const manager = createThemeManagerMock();
    const iterator = initThemeSaga();

    expect(iterator.next().value).toEqual(sagaEffects.call(readThemePreferenceFromStorage));
    expect(iterator.next("system").value).toEqual(sagaEffects.call(getThemeManager));
    expect(iterator.next(manager).value).toEqual(
      sagaEffects.call(applyThemePreferenceToManager, manager, "system"),
    );
    expect(iterator.next().value).toEqual(sagaEffects.call(syncReduxFromThemeManager, manager));
    expect(iterator.next().done).toBe(true);
  });

  it("reads a complete ThemeManager snapshot for Redux hydration", () => {
    const manager = createThemeManagerMock({
      getTheme: vi.fn(() => "dark"),
      isDark: vi.fn(() => true),
      hasCustomTheme: vi.fn(() => true),
      getCustomThemeName: vi.fn(() => "Catppuccin Mocha"),
      getActivePresetId: vi.fn(() => "catppuccin"),
    });

    expect(readThemeManagerSnapshot(manager)).toEqual({
      preference: "dark",
      name: "dark",
      customization: {
        hasCustomTheme: true,
        customThemeName: "Catppuccin Mocha",
        activePresetId: "catppuccin",
      },
    });
  });

  it("syncs Redux from a ThemeManager snapshot", () => {
    const manager = createThemeManagerMock();
    const snapshot = {
      preference: "system" as const,
      name: "dark" as const,
      customization: {
        hasCustomTheme: false,
        customThemeName: null,
        activePresetId: null,
      },
    };
    const iterator = syncReduxFromThemeManager(manager);

    expect(iterator.next().value).toEqual(sagaEffects.call(readThemeManagerSnapshot, manager));
    expect(iterator.next(snapshot).value).toEqual(sagaEffects.put(setThemePreference("system")));
    expect(iterator.next().value).toEqual(sagaEffects.put(setThemeName("dark")));
    expect(iterator.next().value).toEqual(sagaEffects.put(setThemeCustomization(snapshot.customization)));
    expect(iterator.next().done).toBe(true);
  });

  it("updates the slice from ThemeManager theme-changed events", () => {
    const detail = { theme: "system" as const, isDark: false };
    const iterator = handleThemeChanged(detail);

    expect(iterator.next().value).toEqual(sagaEffects.put(setThemePreference("system")));
    expect(iterator.next().value).toEqual(sagaEffects.put(setThemeName("light")));
    expect(iterator.next().value).toEqual(
      sagaEffects.put(setThemeCustomization(themeCustomizationFromEvent(detail))),
    );
    expect(iterator.next().done).toBe(true);
  });

  it("falls back to browser state if an event lacks a resolved isDark value", () => {
    const detail = { theme: "system" as const };
    const iterator = handleThemeChanged(detail);

    expect(iterator.next().value).toEqual(sagaEffects.put(setThemePreference("system")));
    expect(iterator.next().value).toEqual(
      sagaEffects.call(readThemeNameFromBrowserState, "system"),
    );
    expect(iterator.next("dark").value).toEqual(sagaEffects.put(setThemeName("dark")));
    expect(iterator.next().value).toEqual(
      sagaEffects.put(setThemeCustomization(themeCustomizationFromEvent(detail))),
    );
    expect(iterator.next().done).toBe(true);
  });

  it("maps ThemeManager events to custom theme metadata", () => {
    expect(
      themeCustomizationFromEvent({
        customThemeName: "Catppuccin Mocha",
        activePresetId: "catppuccin",
      }),
    ).toEqual({
      hasCustomTheme: true,
      customThemeName: "Catppuccin Mocha",
      activePresetId: "catppuccin",
    });
  });

  it("persists requested Redux theme preference changes and applies ThemeManager", () => {
    const manager = createThemeManagerMock();
    const iterator = handleThemePreferenceChangeRequested(requestThemePreferenceChange("dark"));

    expect(iterator.next().value).toEqual(sagaEffects.call(persistThemePreference, "dark"));
    expect(iterator.next().value).toEqual(sagaEffects.call(getThemeManager));
    expect(iterator.next(manager).value).toEqual(
      sagaEffects.call(applyThemePreferenceToManager, manager, "dark"),
    );
    expect(iterator.next().value).toEqual(sagaEffects.call(syncReduxFromThemeManager, manager));
    expect(iterator.next().value).toEqual(sagaEffects.put(setThemeError(null)));
    expect(iterator.next().done).toBe(true);
  });

  it("applies selected preset themes through ThemeManager", () => {
    const manager = createThemeManagerMock();
    const iterator = handleThemePresetSelected(selectThemePreset("catppuccin"));

    expect(iterator.next().value).toEqual(sagaEffects.call(getThemeManager));
    expect(iterator.next(manager).value).toEqual(
      sagaEffects.call(applyPresetThemeToManager, manager, "catppuccin"),
    );
    expect(iterator.next().value).toEqual(sagaEffects.call(syncReduxFromThemeManager, manager));
    expect(iterator.next().value).toEqual(sagaEffects.put(setThemeError(null)));
    expect(iterator.next().done).toBe(true);
  });

  it("applies imported custom themes through ThemeManager", () => {
    const manager = createThemeManagerMock();
    const json = { name: "Custom", type: "dark", colors: {} };
    const iterator = handleCustomThemeImported(importCustomTheme(json));

    expect(iterator.next().value).toEqual(sagaEffects.call(validateCustomThemeImport, json));
    expect(iterator.next().value).toEqual(sagaEffects.call(getThemeManager));
    expect(iterator.next(manager).value).toEqual(
      sagaEffects.call(applyCustomThemeToManager, manager, json),
    );
    expect(iterator.next().value).toEqual(sagaEffects.call(syncReduxFromThemeManager, manager));
    expect(iterator.next().value).toEqual(sagaEffects.put(setThemeError(null)));
    expect(iterator.next().done).toBe(true);
  });

  it("validates imported custom themes in the saga before touching ThemeManager", () => {
    const json = { name: "Empty" };
    const iterator = handleCustomThemeImported(importCustomTheme(json));

    expect(iterator.next().value).toEqual(sagaEffects.call(validateCustomThemeImport, json));
    expect(iterator.throw(new Error('Invalid theme: must contain "colors" or "tokenColors"')).value).toEqual(
      sagaEffects.put(setThemeError('Invalid theme: must contain "colors" or "tokenColors"')),
    );
    expect(iterator.next().done).toBe(true);
  });

  it("surfaces ThemeManager apply failures to Redux error state", () => {
    const manager = createThemeManagerMock();
    const iterator = handleThemePresetSelected(selectThemePreset("catppuccin"));

    expect(iterator.next().value).toEqual(sagaEffects.call(getThemeManager));
    expect(iterator.next(manager).value).toEqual(
      sagaEffects.call(applyPresetThemeToManager, manager, "catppuccin"),
    );
    expect(iterator.throw(new Error("Monaco failed")).value).toEqual(
      sagaEffects.put(setThemeError("Monaco failed")),
    );
    expect(iterator.next().done).toBe(true);
  });

  it("clears custom themes through ThemeManager", () => {
    const manager = createThemeManagerMock();
    const iterator = handleThemeCustomizationCleared();

    expect(iterator.next().value).toEqual(sagaEffects.call(getThemeManager));
    expect(iterator.next(manager).value).toEqual(
      sagaEffects.call(clearCustomThemeFromManager, manager),
    );
    expect(iterator.next().value).toEqual(sagaEffects.call(syncReduxFromThemeManager, manager));
    expect(iterator.next().value).toEqual(sagaEffects.put(setThemeError(null)));
    expect(iterator.next().done).toBe(true);
  });

  it("subscribes to the ThemeManager window event through the channel helper", () => {
    const iterator = watchThemeChangedSaga();

    expect(iterator.next().done).toBe(true);
    expect(takeEveryFromWindowEventMock).toHaveBeenCalledWith("theme-changed", handleThemeChanged);
  });

  it("subscribes to theme preference request changes for persistence", () => {
    const iterator = watchThemePreferencePersistenceSaga();

    expect(iterator.next().value).toEqual(
      sagaEffects.takeEvery(requestThemePreferenceChange, handleThemePreferenceChangeRequested),
    );
    expect(iterator.next().done).toBe(true);
  });

  it("subscribes to custom theme request actions", () => {
    const iterator = watchThemeCustomizationRequestsSaga();

    expect(iterator.next().value).toEqual(
      sagaEffects.takeEvery(selectThemePreset, handleThemePresetSelected),
    );
    expect(iterator.next().value).toEqual(
      sagaEffects.takeEvery(importCustomTheme, handleCustomThemeImported),
    );
    expect(iterator.next().value).toEqual(
      sagaEffects.takeEvery(clearThemeCustomization, handleThemeCustomizationCleared),
    );
    expect(iterator.next().done).toBe(true);
  });

  it("starts the event watcher and then hydrates the initial theme", () => {
    const iterator = themeSaga();

    expect(iterator.next().value).toEqual(sagaEffects.fork(watchThemeChangedSaga));
    expect(iterator.next().value).toEqual(sagaEffects.fork(watchThemePreferencePersistenceSaga));
    expect(iterator.next().value).toEqual(sagaEffects.fork(watchThemeCustomizationRequestsSaga));
    expect(iterator.next().value).toEqual(sagaEffects.call(initThemeSaga));
    expect(iterator.next().done).toBe(true);
  });
});