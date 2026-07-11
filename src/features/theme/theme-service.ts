/**
 * Theme mutation service — the post-saga consumer for the four orphaned
 * theme request-actions (`requestThemePreferenceChange`, `selectThemePreset`,
 * `importCustomTheme`, `clearThemeCustomization`) plus a boot-time hydrate
 * that reflects the ThemeManager singleton's initial state back into Redux.
 *
 * These triggers lost their handlers when the saga runtime was removed (they
 * lived in `slices/theme/sagas/theme-saga.ts` in the reference codebase), so
 * the Settings page toggle and the ColorThemeSettings preset / import / clear
 * buttons dispatched actions no code observed — the DOM class never changed
 * and Redux never learned about the persisted preference. This restores the
 * behaviour WITHOUT re-adding a saga and WITHOUT changing any dispatch site:
 * `createThemeMutationMiddleware()` observes dispatched actions and, after the
 * reducer runs, routes each trigger through the matching `ThemeManager`
 * mutation and re-syncs the Redux slice from the manager's snapshot.
 *
 * On the first dispatched action the middleware also (a) hydrates Redux from
 * the current `ThemeManager` snapshot so the slice reflects the persisted
 * preference the singleton already applied at import time, and (b) installs a
 * `window` `theme-changed` listener so external ThemeManager changes (e.g.
 * the `prefers-color-scheme` media query firing while `preference === 'system'`)
 * flow back into Redux.
 *
 * Dependency-light per src/store AGENTS.md: imports only the store type, the
 * configured store, the slice actions/types, the ThemeManager singleton and
 * its supporting utilities, the theme-presets registry, safe-storage, and the
 * logger. No selector modules (importing them would evaluate
 * `store.createSelector` during middleware-chain construction); state is read
 * directly off the ThemeManager snapshot, mirroring the sibling
 * `settings-hydration-service.ts` / `agent-mutation-service.ts`.
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { store as appStore } from "$store/renderer/store";
import { ThemeManager } from "$lib/utils/theme";
import { themePresets } from "$lib/utils/theme-presets";
import { parseVSCodeTheme } from "$lib/utils/vscode-theme-parser";
import { safeLocalStorage } from "$lib/utils/safe-storage";
import { createLogger } from "$lib/utils/client-logger";
import {
  clearThemeCustomization,
  importCustomTheme,
  requestThemePreferenceChange,
  selectThemePreset,
  setThemeCustomization,
  setThemeError,
  setThemeName,
  setThemePreference,
} from "$store/renderer/slices/theme/theme-slice";
import {
  DEFAULT_THEME_NAME,
  DEFAULT_THEME_PREFERENCE,
  type ThemeCustomizationState,
  type ThemeName,
  type ThemePreference,
} from "$store/renderer/slices/theme/theme-types";

const logger = createLogger("ThemeMutationService");

const THEME_STORAGE_KEY = "theme";
const DARK_MODE_MEDIA_QUERY = "(prefers-color-scheme: dark)";

/** Snapshot the ThemeManager exposes for one-shot Redux hydration. */
export type ThemeManagerSnapshot = {
  preference: ThemePreference;
  name: ThemeName;
  customization: ThemeCustomizationState;
};

/** Payload shape of the `theme-changed` window event ThemeManager emits. */
export type ThemeChangedEventDetail = {
  theme?: ThemePreference;
  isDark?: boolean;
  customThemeName?: string | null;
  activePresetId?: string | null;
  terminalColors?: Record<string, string> | null;
};

let installed = false;
let themeChangedListener: ((event: Event) => void) | null = null;
/**
 * Depth counter used to suppress the `theme-changed` listener during
 * middleware-initiated ThemeManager mutations. Each of ThemeManager's
 * mutation methods (`setTheme`, `setPresetTheme`, `setCustomTheme`,
 * `clearCustomTheme`) synchronously dispatches a `theme-changed` window
 * event, and every middleware handler already calls
 * `syncReduxFromThemeManager` explicitly afterwards. Without suppression the
 * listener would re-run `handleThemeChanged` for the echo and Redux would be
 * synced twice per middleware-routed action. A counter (rather than a
 * boolean) tolerates nested emissions such as `setPresetTheme(null)` which
 * internally invokes `clearCustomTheme`. External `theme-changed` events
 * (e.g. system `prefers-color-scheme` flipping while preference === 'system')
 * arrive with the counter at zero and still flow through unchanged.
 */
let suppressListenerDepth = 0;

function withListenerSuppressed<T>(fn: () => T): T {
  suppressListenerDepth += 1;
  try {
    return fn();
  } finally {
    suppressListenerDepth -= 1;
  }
}

export function themeNameFromIsDark(isDark: boolean): ThemeName {
  return isDark ? "dark" : "light";
}

function isThemePreference(value: string | null | undefined): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function readDocumentThemeName(): ThemeName | null {
  if (typeof document === "undefined") return null;

  const root = document.documentElement;
  if (root.classList.contains("dark")) return "dark";
  if (root.classList.contains("light")) return "light";

  const colorScheme = root.style.getPropertyValue("color-scheme").trim();
  if (colorScheme === "dark" || colorScheme.startsWith("dark ")) return "dark";
  if (colorScheme === "light" || colorScheme.startsWith("light ")) return "light";

  return null;
}

function readSystemThemeName(): ThemeName {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return DEFAULT_THEME_NAME;
  }

  try {
    return themeNameFromIsDark(window.matchMedia(DARK_MODE_MEDIA_QUERY).matches);
  } catch {
    return DEFAULT_THEME_NAME;
  }
}

function resolveThemePreference(preference: ThemePreference): ThemeName {
  if (preference === "system") return readSystemThemeName();
  return preference;
}

export function readThemeNameFromBrowserState(preference: ThemePreference): ThemeName {
  return readDocumentThemeName() ?? resolveThemePreference(preference);
}

export function readThemePreferenceFromStorage(): ThemePreference {
  const stored = safeLocalStorage.getItem(THEME_STORAGE_KEY);
  return isThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE;
}

export function persistThemePreference(preference: ThemePreference): void {
  safeLocalStorage.setItem(THEME_STORAGE_KEY, preference);
}

export function getThemeManager(): ThemeManager {
  return ThemeManager.getInstance();
}

export function applyThemePreferenceToManager(
  manager: ThemeManager,
  preference: ThemePreference,
): void {
  manager.setTheme(preference, { persist: false });
}

export function applyPresetThemeToManager(manager: ThemeManager, presetId: string | null): void {
  if (presetId == null || presetId === "") {
    manager.clearCustomTheme();
    return;
  }
  const preset = themePresets.find((item) => item.id === presetId);
  if (!preset) throw new Error(`Unknown theme preset: ${presetId}`);
  manager.setPresetTheme(preset.id, preset.dark, preset.light);
}

export function validateCustomThemeImport(json: unknown): void {
  parseVSCodeTheme(json);
}

export function applyCustomThemeToManager(manager: ThemeManager, json: unknown): void {
  manager.setCustomTheme(json);
}

export function clearCustomThemeFromManager(manager: ThemeManager): void {
  manager.clearCustomTheme();
}

export function readThemeManagerSnapshot(manager: ThemeManager): ThemeManagerSnapshot {
  const preference = manager.getTheme() as ThemePreference;
  const hasCustomTheme = manager.hasCustomTheme();
  return {
    preference: isThemePreference(preference) ? preference : DEFAULT_THEME_PREFERENCE,
    name: themeNameFromIsDark(manager.isDark()),
    customization: {
      hasCustomTheme,
      customThemeName: manager.getCustomThemeName(),
      activePresetId: manager.getActivePresetId(),
    },
  };
}

export function themeCustomizationFromEvent(
  detail: ThemeChangedEventDetail,
): ThemeCustomizationState {
  const customThemeName = detail?.customThemeName ?? null;
  const activePresetId = detail?.activePresetId ?? null;
  return {
    hasCustomTheme: Boolean(customThemeName || activePresetId),
    customThemeName,
    activePresetId,
  };
}

export function syncReduxFromThemeManager(manager: ThemeManager): void {
  const snapshot = readThemeManagerSnapshot(manager);
  appStore.dispatch(setThemePreference(snapshot.preference));
  appStore.dispatch(setThemeName(snapshot.name));
  appStore.dispatch(setThemeCustomization(snapshot.customization));
}

export function themeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

/** Initial hydration — mirrors `initThemeSaga` in the reference codebase. */
export function initThemeFromManager(): void {
  const preference = readThemePreferenceFromStorage();
  const manager = getThemeManager();
  applyThemePreferenceToManager(manager, preference);
  syncReduxFromThemeManager(manager);
}

export function handleThemeChanged(detail: ThemeChangedEventDetail): void {
  const preference = isThemePreference(detail?.theme) ? detail.theme : null;
  if (preference) {
    appStore.dispatch(setThemePreference(preference));
  }

  const themeName =
    typeof detail?.isDark === "boolean"
      ? themeNameFromIsDark(detail.isDark)
      : readThemeNameFromBrowserState(preference ?? DEFAULT_THEME_PREFERENCE);

  appStore.dispatch(setThemeName(themeName));
  appStore.dispatch(setThemeCustomization(themeCustomizationFromEvent(detail ?? {})));
}

export function handleThemePreferenceChangeRequested(
  action: ReturnType<typeof requestThemePreferenceChange>,
): void {
  try {
    const [preference] = action.payload;
    persistThemePreference(preference);
    const manager = getThemeManager();
    withListenerSuppressed(() => applyThemePreferenceToManager(manager, preference));
    syncReduxFromThemeManager(manager);
    appStore.dispatch(setThemeError(null));
  } catch (error) {
    appStore.dispatch(
      setThemeError(themeErrorMessage(error, "Failed to apply theme preference.")),
    );
  }
}

export function handleThemePresetSelected(
  action: ReturnType<typeof selectThemePreset>,
): void {
  try {
    const [presetId] = action.payload;
    const manager = getThemeManager();
    withListenerSuppressed(() => applyPresetThemeToManager(manager, presetId));
    syncReduxFromThemeManager(manager);
    appStore.dispatch(setThemeError(null));
  } catch (error) {
    appStore.dispatch(setThemeError(themeErrorMessage(error, "Failed to apply theme preset.")));
  }
}

export function handleCustomThemeImported(
  action: ReturnType<typeof importCustomTheme>,
): void {
  try {
    const [json] = action.payload;
    validateCustomThemeImport(json);
    const manager = getThemeManager();
    withListenerSuppressed(() => applyCustomThemeToManager(manager, json));
    syncReduxFromThemeManager(manager);
    appStore.dispatch(setThemeError(null));
  } catch (error) {
    appStore.dispatch(setThemeError(themeErrorMessage(error, "Failed to import theme.")));
  }
}

export function handleThemeCustomizationCleared(): void {
  try {
    const manager = getThemeManager();
    withListenerSuppressed(() => clearCustomThemeFromManager(manager));
    syncReduxFromThemeManager(manager);
    appStore.dispatch(setThemeError(null));
  } catch (error) {
    appStore.dispatch(
      setThemeError(themeErrorMessage(error, "Failed to clear custom theme.")),
    );
  }
}

function installThemeChangedListener(): void {
  if (typeof window === "undefined" || themeChangedListener !== null) return;
  themeChangedListener = (event: Event) => {
    if (suppressListenerDepth > 0) return;
    const detail = (event as CustomEvent<ThemeChangedEventDetail>).detail ?? {};
    try {
      handleThemeChanged(detail);
    } catch (error) {
      logger.warn("theme-changed handler failed", error);
    }
  };
  window.addEventListener("theme-changed", themeChangedListener);
}

/** Lazy boot: hydrate + install the window listener on the first dispatched action.
 *
 * `initThemeFromManager()` calls `ThemeManager.setTheme()`, which synchronously
 * dispatches a `theme-changed` window event. Run init BEFORE installing the
 * listener so the boot-time sync happens exactly once (through
 * `syncReduxFromThemeManager`) instead of twice (listener + sync).
 */
function bootOnce(): void {
  try {
    initThemeFromManager();
    installThemeChangedListener();
  } catch (error) {
    logger.warn("theme hydration failed", error);
  }
}

/**
 * Middleware that gives the theme request-actions real handlers: after each
 * action passes through the reducer, it routes the trigger to the matching
 * handler. Errors inside handlers are caught and surfaced through
 * `setThemeError` so the dispatch chain itself never throws.
 *
 * Ordering per action: (1) `next(action)` first so the reducer and any
 * downstream middleware see the original action before boot-time hydration
 * dispatches interleave, (2) then one-time boot on the very first action, and
 * (3) then trigger routing. This preserves the "after the reducer runs"
 * contract for both boot and per-action mutations.
 */
export function createThemeMutationMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (!installed) {
      installed = true;
      bootOnce();
    }
    if (!action || typeof action !== "object") return result;
    const type = (action as { type?: unknown }).type;
    switch (type) {
      case requestThemePreferenceChange.type:
        handleThemePreferenceChangeRequested(
          action as ReturnType<typeof requestThemePreferenceChange>,
        );
        break;
      case selectThemePreset.type:
        handleThemePresetSelected(action as ReturnType<typeof selectThemePreset>);
        break;
      case importCustomTheme.type:
        handleCustomThemeImported(action as ReturnType<typeof importCustomTheme>);
        break;
      case clearThemeCustomization.type:
        handleThemeCustomizationCleared();
        break;
    }
    return result;
  };
}

/** Test-only — reset the installed-once guard so each test fixture can boot fresh. */
export function __resetThemeMutationForTests(): void {
  if (typeof window !== "undefined" && themeChangedListener) {
    window.removeEventListener("theme-changed", themeChangedListener);
  }
  themeChangedListener = null;
  installed = false;
  suppressListenerDepth = 0;
}
