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

  it("still rejects unknown non-empty preset IDs and includes the ID in the error", () => {
    const manager = createThemeManagerMock();
    expect(() => applyPresetThemeToManager(manager, "unknown-id")).toThrow(
      "Unknown theme preset: unknown-id",
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

  it("hydrates Redux from the ThemeManager snapshot on the first dispatched action without re-applying to the manager", async () => {
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
    // Boot must not call setTheme() — the ThemeManager constructor already
    // ran loadTheme() and applied the stored preference; init only reflects
    // that snapshot back into Redux.
    expect(managerState.current!.setTheme).not.toHaveBeenCalled();
  });

  it("syncs Redux exactly once on boot and does not re-apply the theme to the ThemeManager", async () => {
    // Init must not invoke ThemeManager.setTheme() (which would repeat DOM
    // work and emit an extra theme-changed event). The boot-time sync happens
    // exactly once through syncReduxFromThemeManager.
    primeLocalStorage({ theme: "dark" });
    managerState.current = createThemeManagerMock({
      getTheme: vi.fn(() => "dark"),
      isDark: vi.fn(() => true),
    });
    const dispatchSpy = vi.spyOn(appStore, "dispatch");

    const middleware = createThemeMutationMiddleware();
    const invoke = middleware({} as never)((action) => action);

    invoke({ type: "unrelated/action" });
    await flush();

    expect(managerState.current!.setTheme).not.toHaveBeenCalled();
    const bootDispatchTypes = dispatchSpy.mock.calls
      .map(([action]) => (action as { type?: string })?.type)
      .filter((type) => type === "theme/setThemePreference");
    expect(bootDispatchTypes).toHaveLength(1);
    dispatchSpy.mockRestore();
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

  it("surfaces preset lookup failures through setThemeError with the preset ID", async () => {
    const middleware = createThemeMutationMiddleware();
    const invoke = middleware({} as never)((action) => action);
    appStore.dispatch(setThemeError(null));

    invoke(selectThemePreset("unknown"));
    await flush();

    const state = appStore.state as { theme: { error: string | null } };
    expect(state.theme.error).toBe("Unknown theme preset: unknown");
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
    // ThemeManager.setCustomTheme() parses the JSON itself and throws on
    // invalid input before mutating state, so handleCustomThemeImported
    // relies on that internal validation rather than pre-parsing.
    managerState.current = createThemeManagerMock({
      setCustomTheme: vi.fn(() => {
        throw new Error("VSCode theme JSON missing colors object");
      }),
    });
    const middleware = createThemeMutationMiddleware();
    const invoke = middleware({} as never)((action) => action);
    appStore.dispatch(setThemeError(null));

    invoke(importCustomTheme({ name: "Empty" }));
    await flush();

    const state = appStore.state as { theme: { error: string | null } };
    expect(state.theme.error).toContain("colors");
    expect(managerState.current!.setCustomTheme).toHaveBeenCalledWith({ name: "Empty" });
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

  it("syncs Redux exactly once per middleware-routed mutation even when ThemeManager echoes theme-changed synchronously", async () => {
    // Every ThemeManager mutation (setTheme / setPresetTheme / setCustomTheme /
    // clearCustomTheme) synchronously dispatches a `theme-changed` window
    // event, and each handler also calls syncReduxFromThemeManager. Without
    // suppression the listener would fire during the mutation and Redux would
    // sync twice per action. Simulate that echo for all four mutation methods
    // and assert each middleware-routed action produces exactly one
    // `theme/setThemePreference` dispatch (from the explicit sync, not from
    // the listener echo).
    const emitLightEcho = () =>
      window.dispatchEvent(
        new CustomEvent("theme-changed", {
          detail: { theme: "light", isDark: false, customThemeName: null, activePresetId: null },
        }),
      );
    managerState.current = createThemeManagerMock({
      getTheme: vi.fn(() => "light"),
      isDark: vi.fn(() => false),
      setTheme: vi.fn(emitLightEcho),
      setPresetTheme: vi.fn(emitLightEcho),
      setCustomTheme: vi.fn(emitLightEcho),
      clearCustomTheme: vi.fn(emitLightEcho),
    });
    const middleware = createThemeMutationMiddleware();
    const invoke = middleware({} as never)((action) => action);

    invoke({ type: "unrelated/action" });
    await flush();

    // Wrap `appStore.dispatch` via a shadowing own-property so we count real
    // dispatches without breaking the getter's `this` binding (vi.spyOn on the
    // prototype getter loses the captured `this` and the store's requireCore()
    // guard trips).
    const protoDescriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(appStore),
      "dispatch",
    ) as PropertyDescriptor | undefined;
    const originalDispatch = protoDescriptor?.get?.call(appStore) as (
      action: unknown,
    ) => unknown;
    const dispatchCalls: unknown[] = [];
    Object.defineProperty(appStore, "dispatch", {
      configurable: true,
      enumerable: true,
      get: () => (action: unknown) => {
        dispatchCalls.push(action);
        return originalDispatch(action);
      },
    });

    try {
      const countPreferenceDispatches = () =>
        dispatchCalls.filter(
          (action) => (action as { type?: string } | undefined)?.type === "theme/setThemePreference",
        ).length;

      for (const action of [
        requestThemePreferenceChange("light"),
        selectThemePreset("catppuccin"),
        importCustomTheme({ name: "Custom", type: "dark", colors: { "editor.background": "#000000" } }),
        clearThemeCustomization(),
      ]) {
        dispatchCalls.length = 0;
        invoke(action);
        await flush();
        expect(countPreferenceDispatches()).toBe(1);
      }
    } finally {
      delete (appStore as { dispatch?: unknown }).dispatch;
    }
  });

  it("still routes external theme-changed events into Redux (system prefers-color-scheme flip)", async () => {
    // The suppression flag must only mask ThemeManager echoes emitted inside
    // middleware handlers — events from outside that scope (e.g. the media
    // query firing while preference === 'system') must still propagate.
    managerState.current = createThemeManagerMock({
      getTheme: vi.fn(() => "system"),
      isDark: vi.fn(() => false),
    });
    const middleware = createThemeMutationMiddleware();
    const invoke = middleware({} as never)((action) => action);

    invoke({ type: "unrelated/action" });
    await flush();

    window.dispatchEvent(
      new CustomEvent("theme-changed", {
        detail: { theme: "system", isDark: true, customThemeName: null, activePresetId: null },
      }),
    );

    const state = appStore.state as { theme: { preference: string; name: string } };
    expect(state.theme.preference).toBe("system");
    expect(state.theme.name).toBe("dark");
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
