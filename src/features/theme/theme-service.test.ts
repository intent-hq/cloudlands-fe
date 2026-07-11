import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { store as appStore } from "$store/renderer/store";
import {
  clearThemeCustomization,
  importCustomTheme,
  requestThemePreferenceChange,
  selectThemePreset,
  setThemeError,
} from "$store/renderer/slices/theme/theme-slice";
import type { ThemeManager } from "$lib/utils/theme";
import {
  __resetThemeMutationForTests,
  applyPresetThemeToManager,
  createThemeMutationMiddleware,
  handleThemeChanged,
  readThemeManagerSnapshot,
  readThemeNameFromBrowserState,
  readThemePreferenceFromStorage,
  themeCustomizationFromEvent,
  themeErrorMessage,
  themeNameFromIsDark,
} from "./theme-service";

// Fixed ThemeManager mock returned by getInstance() — every handler resolves
// its manager via the singleton, so pointing the singleton at a spy-backed
// object lets us assert the mutations the middleware performs on the wire.
const managerState = { current: null as ThemeManager | null };
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

vi.mock("$lib/utils/theme", () => ({
  ThemeManager: {
    getInstance: () => {
      if (!managerState.current) managerState.current = createThemeManagerMock();
      return managerState.current;
    },
    resetInstance: () => {
      managerState.current = null;
    },
  },
}));

vi.mock("$lib/utils/theme-presets", () => ({
  themePresets: [
    {
      id: "catppuccin",
      label: "Catppuccin",
      previewColors: {
        dark: ["#000", "#fff", "#aaa", "#bbb"],
        light: ["#fff", "#000", "#ccc", "#ddd"],
      },
      dark: { name: "Catppuccin Dark", type: "dark", colors: {} },
      light: { name: "Catppuccin Light", type: "light", colors: {} },
    },
  ],
}));

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

/**
 * The global test-setup mocks `localStorage` as bare `vi.fn()`s (no backing
 * store), so we wire an in-memory map through the same handles for tests that
 * exercise the read/write path.
 */
function primeLocalStorage(entries: Record<string, string> = {}): Map<string, string> {
  const store = new Map(Object.entries(entries));
  const ls = window.localStorage as unknown as {
    getItem: ReturnType<typeof vi.fn>;
    setItem: ReturnType<typeof vi.fn>;
    removeItem: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  };
  ls.getItem.mockImplementation((key: string) => store.get(key) ?? null);
  ls.setItem.mockImplementation((key: string, value: string) => {
    store.set(key, value);
  });
  ls.removeItem.mockImplementation((key: string) => {
    store.delete(key);
  });
  ls.clear.mockImplementation(() => {
    store.clear();
  });
  return store;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("theme-service (pure helpers)", () => {
  beforeEach(() => {
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

  it("reads a valid stored theme preference from safeLocalStorage", () => {
    primeLocalStorage({ theme: "dark" });
    expect(readThemePreferenceFromStorage()).toBe("dark");
  });

  it("falls back to system for an invalid stored theme preference", () => {
    primeLocalStorage({ theme: "solarized" });
    expect(readThemePreferenceFromStorage()).toBe("system");
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

  it("clears custom themes when applying a null preset", () => {
    const manager = createThemeManagerMock();
    expect(() => applyPresetThemeToManager(manager, null)).not.toThrow();
    expect(manager.clearCustomTheme).toHaveBeenCalledTimes(1);
    expect(manager.setPresetTheme).not.toHaveBeenCalled();
  });

  it("still rejects unknown non-empty preset IDs", () => {
    const manager = createThemeManagerMock();
    expect(() => applyPresetThemeToManager(manager, "unknown-id")).toThrow(
      "Theme preset not found.",
    );
  });

  it("surfaces error messages verbatim and falls back to the provided default", () => {
    expect(themeErrorMessage(new Error("boom"), "fallback")).toBe("boom");
    expect(themeErrorMessage("nope", "fallback")).toBe("nope");
    expect(themeErrorMessage(undefined, "fallback")).toBe("fallback");
  });
});

describe("createThemeMutationMiddleware (dispatch handlers + hydration)", () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(() => {
    __resetThemeMutationForTests();
    managerState.current = createThemeManagerMock();
    resetMatchMedia();
    primeLocalStorage();
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.style.removeProperty("color-scheme");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("hydrates Redux from the ThemeManager snapshot on the first dispatched action", async () => {
    primeLocalStorage({ theme: "dark" });
    managerState.current = createThemeManagerMock({
      getTheme: vi.fn(() => "dark"),
      isDark: vi.fn(() => true),
    });
    const middleware = createThemeMutationMiddleware();
    const invoke = middleware({} as never)((action) => action);

    invoke({ type: "unrelated/action" });
    await flush();

    const state = appStore.state as { theme: { preference: string; name: string } };
    expect(state.theme.preference).toBe("dark");
    expect(state.theme.name).toBe("dark");
    expect(managerState.current!.setTheme).toHaveBeenCalledWith("dark", { persist: false });
  });

  it("persists and applies the requested theme preference", async () => {
    managerState.current = createThemeManagerMock({ getTheme: vi.fn(() => "light"), isDark: vi.fn(() => false) });
    const middleware = createThemeMutationMiddleware();
    const invoke = middleware({} as never)((action) => action);

    invoke(requestThemePreferenceChange("light"));
    await flush();

    expect(window.localStorage.setItem).toHaveBeenCalledWith("theme", "light");
    expect(managerState.current!.setTheme).toHaveBeenCalledWith("light", { persist: false });
    const state = appStore.state as { theme: { preference: string; name: string; error: string | null } };
    expect(state.theme.preference).toBe("light");
    expect(state.theme.error).toBeNull();
  });

  it("routes selectThemePreset through ThemeManager.setPresetTheme", async () => {
    const middleware = createThemeMutationMiddleware();
    const invoke = middleware({} as never)((action) => action);

    invoke(selectThemePreset("catppuccin"));
    await flush();

    expect(managerState.current!.setPresetTheme).toHaveBeenCalledWith(
      "catppuccin",
      expect.objectContaining({ name: "Catppuccin Dark", type: "dark" }),
      expect.objectContaining({ name: "Catppuccin Light", type: "light" }),
    );
  });

  it("surfaces preset lookup failures through setThemeError", async () => {
    const middleware = createThemeMutationMiddleware();
    const invoke = middleware({} as never)((action) => action);
    appStore.dispatch(setThemeError(null));

    invoke(selectThemePreset("unknown"));
    await flush();

    const state = appStore.state as { theme: { error: string | null } };
    expect(state.theme.error).toBe("Theme preset not found.");
  });

  it("validates then applies imported custom themes", async () => {
    const middleware = createThemeMutationMiddleware();
    const invoke = middleware({} as never)((action) => action);
    const json = { name: "Custom", type: "dark", colors: { "editor.background": "#000000" } };

    invoke(importCustomTheme(json));
    await flush();

    expect(managerState.current!.setCustomTheme).toHaveBeenCalledWith(json);
  });

  it("surfaces custom-theme validation errors through setThemeError", async () => {
    const middleware = createThemeMutationMiddleware();
    const invoke = middleware({} as never)((action) => action);
    appStore.dispatch(setThemeError(null));

    invoke(importCustomTheme({ name: "Empty" }));
    await flush();

    const state = appStore.state as { theme: { error: string | null } };
    expect(state.theme.error).toContain("colors");
    expect(managerState.current!.setCustomTheme).not.toHaveBeenCalled();
  });

  it("clears custom themes through ThemeManager on clearThemeCustomization", async () => {
    const middleware = createThemeMutationMiddleware();
    const invoke = middleware({} as never)((action) => action);

    invoke(clearThemeCustomization());
    await flush();

    expect(managerState.current!.clearCustomTheme).toHaveBeenCalled();
  });

  it("routes window theme-changed events into Redux via handleThemeChanged", () => {
    handleThemeChanged({ theme: "system", isDark: false });
    const state = appStore.state as { theme: { preference: string; name: string } };
    expect(state.theme.preference).toBe("system");
    expect(state.theme.name).toBe("light");
  });

  it("re-syncs Redux when the ThemeManager fires a theme-changed window event", async () => {
    managerState.current = createThemeManagerMock({ isDark: vi.fn(() => true) });
    const middleware = createThemeMutationMiddleware();
    const invoke = middleware({} as never)((action) => action);

    invoke({ type: "unrelated/action" });
    await flush();

    window.dispatchEvent(
      new CustomEvent("theme-changed", {
        detail: { theme: "dark", isDark: true, customThemeName: null, activePresetId: null },
      }),
    );

    const state = appStore.state as { theme: { preference: string; name: string } };
    expect(state.theme.preference).toBe("dark");
    expect(state.theme.name).toBe("dark");
  });
});
