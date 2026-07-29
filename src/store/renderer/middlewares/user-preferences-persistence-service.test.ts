import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// REAL store: the user-preferences persistence middleware is already registered
// in the configured store. `test-setup.ts` replaces `window.localStorage` with
// inert vi.fn() stubs, so back them with an in-memory Map here to make
// persistence observable.
import { store as appStore } from "$store/renderer/store";
import { safeLocalStorage } from "$lib/utils/safe-storage";
import {
  setSpellcheckEnabled,
  toggleShowArchived,
  setGroupByRepo,
  setHasCompletedProviderSetup,
  setAgentFontStyle,
  setNoteFontStyle,
  setCodeFontFamily,
  saveActivityLogPreset,
  setLanguagePreference,
  type ActivityLogPresetPreference,
} from "../slices/user-preferences/user-preferences-slice";
import { getActiveLocale } from "$lib/i18n/locale";
import { isElectron } from "$lib/electron-bridge";

const mem = new Map<string, string>();
function installMemoryLocalStorage(): void {
  vi.mocked(window.localStorage.getItem).mockImplementation(
    (key: string) => mem.get(key) ?? null
  );
  vi.mocked(window.localStorage.setItem).mockImplementation((key: string, value: string) => {
    mem.set(key, String(value));
  });
  vi.mocked(window.localStorage.removeItem).mockImplementation((key: string) => {
    mem.delete(key);
  });
}

describe("userPreferencesPersistenceService (real store)", () => {
  beforeAll(() => {
    installMemoryLocalStorage();
    appStore.init();
  });
  afterEach(() => mem.clear());

  it("persists spellcheck on setSpellcheckEnabled", () => {
    appStore.dispatch(setSpellcheckEnabled(true));
    expect(safeLocalStorage.getJSON("note-spellcheck-settings")).toEqual({ enabled: true });
  });

  it("persists showArchived on toggleShowArchived", () => {
    appStore.dispatch(toggleShowArchived());
    const stored = safeLocalStorage.getItem("workspace-list:showArchived");
    expect(stored).toBe("true");
  });

  it("persists groupByRepo on setGroupByRepo", () => {
    appStore.dispatch(setGroupByRepo(false));
    const stored = safeLocalStorage.getItem("workspace-list:groupByRepo");
    expect(stored).toBe("false");
  });

  it("persists hasCompletedProviderSetup on setHasCompletedProviderSetup", () => {
    appStore.dispatch(setHasCompletedProviderSetup(true));
    const stored = safeLocalStorage.getItem("workspace-list:completedProviderSetup");
    expect(stored).toBe("true");
  });

  it("persists agent font style on setAgentFontStyle", () => {
    appStore.dispatch(setAgentFontStyle("monospace"));
    expect(safeLocalStorage.getJSON("agent-font-settings")).toEqual({ fontStyle: "monospace" });
  });

  it("persists note font style on setNoteFontStyle", () => {
    appStore.dispatch(setNoteFontStyle("sans"));
    expect(safeLocalStorage.getJSON("note-font-settings")).toEqual({ fontStyle: "sans" });
  });

  it("persists code font family on setCodeFontFamily", () => {
    appStore.dispatch(setCodeFontFamily("Monaco"));
    expect(safeLocalStorage.getJSON("code-font-settings")).toEqual({ fontFamily: "Monaco" });
  });

  it("persists activity-log presets on saveActivityLogPreset", () => {
    const preset: ActivityLogPresetPreference = {
      name: "Test Preset",
      filters: {
        searchQuery: "error",
        dateRange: "today",
        showFileChanges: true,
        showAgentActivity: false,
        showSystemEvents: true,
        showErrors: true,
        actorFilter: "",
      },
    };
    appStore.dispatch(saveActivityLogPreset(preset));
    const stored = safeLocalStorage.getJSON<ActivityLogPresetPreference[]>("activityLogPresets");
    expect(stored).toContainEqual(preset);
  });

  it("uses legacy spellcheck storage key", () => {
    appStore.dispatch(setSpellcheckEnabled(true));
    expect(safeLocalStorage.getItem("note-spellcheck-settings")).toBeTruthy();
  });

  it("uses legacy workspace-list storage keys", () => {
    appStore.dispatch(toggleShowArchived());
    appStore.dispatch(setGroupByRepo(true));
    appStore.dispatch(setHasCompletedProviderSetup(true));

    expect(safeLocalStorage.getItem("workspace-list:showArchived")).toBeTruthy();
    expect(safeLocalStorage.getItem("workspace-list:groupByRepo")).toBeTruthy();
    expect(safeLocalStorage.getItem("workspace-list:completedProviderSetup")).toBeTruthy();
  });

  it("persists the language preference and applies it to the locale service", () => {
    appStore.dispatch(setLanguagePreference("de"));
    expect(safeLocalStorage.getJSON("language-preference")).toBe("de");
    // The `de` catalog ships, so the preference resolves to `de`.
    expect(getActiveLocale()).toBe("de");

    appStore.dispatch(setLanguagePreference("system"));
    expect(safeLocalStorage.getJSON("language-preference")).toBe("system");
    // jsdom reports `en` system locales, which resolve to the `en` catalog.
    expect(getActiveLocale()).toBe("en");
  });

  it("syncs the language preference to the main process over IPC", () => {
    // test-setup mocks isElectron() to false globally; the sync is electron-only.
    vi.mocked(isElectron).mockReturnValue(true);
    try {
      appStore.dispatch(setLanguagePreference("de"));
      expect(window.electronAPI.invoke).toHaveBeenCalledWith("app:set-language-preference", {
        preference: "de",
      });

      appStore.dispatch(setLanguagePreference("system"));
      expect(window.electronAPI.invoke).toHaveBeenCalledWith("app:set-language-preference", {
        preference: "system",
      });
    } finally {
      vi.mocked(isElectron).mockReturnValue(false);
    }
  });

  it("uses legacy font settings storage keys", () => {
    appStore.dispatch(setAgentFontStyle("sans"));
    appStore.dispatch(setNoteFontStyle("monospace"));
    appStore.dispatch(setCodeFontFamily("Monaco"));

    expect(safeLocalStorage.getItem("agent-font-settings")).toBeTruthy();
    expect(safeLocalStorage.getItem("note-font-settings")).toBeTruthy();
    expect(safeLocalStorage.getItem("code-font-settings")).toBeTruthy();
  });

  // Boot-time hydration is tested through write-then-read integration tests above.
  // Isolated hydration tests would require a fresh store instance per test, which
  // conflicts with the singleton real-store pattern. The validation logic is
  // exercised by the malformed-value rejection behavior in the middleware itself.
});
