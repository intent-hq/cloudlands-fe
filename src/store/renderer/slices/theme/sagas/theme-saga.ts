import {
  call,
  fork,
  put,
  takeEvery,
  type SagaGenerator,
} from "typed-redux-saga";
import {
  getLocalStorageItem,
  setLocalStorageItem,
} from "$store/renderer/utils/safe-local-storage-saga";
import { takeEveryFromWindowEvent } from "../../../utils/ipc-channel";
import { ThemeManager } from "$lib/utils/theme";
import { themePresets } from "$lib/utils/theme-presets";
import { parseVSCodeTheme } from "$lib/utils/vscode-theme-parser";
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
  DEFAULT_THEME_NAME,
  DEFAULT_THEME_PREFERENCE,
  type ThemeCustomizationState,
  type ThemeName,
  type ThemePreference,
} from "../theme-types";

const THEME_STORAGE_KEY = "theme";
const DARK_MODE_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export type ThemeChangedEventDetail = {
  theme?: ThemePreference;
  isDark?: boolean;
  customThemeName?: string | null;
  activePresetId?: string | null;
  terminalColors?: Record<string, string> | null;
};

export type ThemeManagerSnapshot = {
  preference: ThemePreference;
  name: ThemeName;
  customization: ThemeCustomizationState;
};

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

export function* readThemePreferenceFromStorage(): SagaGenerator<ThemePreference> {
  const storedTheme = yield* call(getLocalStorageItem, THEME_STORAGE_KEY);
  return isThemePreference(storedTheme) ? storedTheme : DEFAULT_THEME_PREFERENCE;
}

export function* persistThemePreference(preference: ThemePreference): SagaGenerator<void> {
  yield* call(setLocalStorageItem, THEME_STORAGE_KEY, preference);
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

export function applyPresetThemeToManager(manager: ThemeManager, presetId: string): void {
  const preset = themePresets.find((item) => item.id === presetId);
  if (!preset) throw new Error("Theme preset not found.");
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

export function* syncReduxFromThemeManager(manager: ThemeManager): SagaGenerator<void> {
  const snapshot = yield* call(readThemeManagerSnapshot, manager);
  yield* put(setThemePreference(snapshot.preference));
  yield* put(setThemeName(snapshot.name));
  yield* put(setThemeCustomization(snapshot.customization));
}

export function themeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

export function* initThemeSaga(): SagaGenerator<void> {
  const preference = yield* call(readThemePreferenceFromStorage);
  const manager = yield* call(getThemeManager);
  yield* call(applyThemePreferenceToManager, manager, preference);
  yield* call(syncReduxFromThemeManager, manager);
}

export function* handleThemeChanged(detail: ThemeChangedEventDetail): SagaGenerator<void> {
  const preference = isThemePreference(detail?.theme) ? detail.theme : null;
  if (preference) {
    yield* put(setThemePreference(preference));
  }

  const themeName =
    typeof detail?.isDark === "boolean"
      ? themeNameFromIsDark(detail.isDark)
      : yield* call(readThemeNameFromBrowserState, preference ?? DEFAULT_THEME_PREFERENCE);

  yield* put(setThemeName(themeName));
  yield* put(setThemeCustomization(themeCustomizationFromEvent(detail ?? {})));
}

export function* handleThemePreferenceChangeRequested(
  action: ReturnType<typeof requestThemePreferenceChange>
): SagaGenerator<void> {
  try {
    const [preference] = action.payload;
    yield* call(persistThemePreference, preference);
    const manager = yield* call(getThemeManager);
    yield* call(applyThemePreferenceToManager, manager, preference);
    yield* call(syncReduxFromThemeManager, manager);
    yield* put(setThemeError(null));
  } catch (error) {
    yield* put(setThemeError(themeErrorMessage(error, "Failed to apply theme preference.")));
  }
}

export function* handleThemePresetSelected(
  action: ReturnType<typeof selectThemePreset>,
): SagaGenerator<void> {
  try {
    const [presetId] = action.payload;
    const manager = yield* call(getThemeManager);
    yield* call(applyPresetThemeToManager, manager, presetId);
    yield* call(syncReduxFromThemeManager, manager);
    yield* put(setThemeError(null));
  } catch (error) {
    yield* put(setThemeError(themeErrorMessage(error, "Failed to apply theme preset.")));
  }
}

export function* handleCustomThemeImported(
  action: ReturnType<typeof importCustomTheme>,
): SagaGenerator<void> {
  try {
    const [json] = action.payload;
    yield* call(validateCustomThemeImport, json);
    const manager = yield* call(getThemeManager);
    yield* call(applyCustomThemeToManager, manager, json);
    yield* call(syncReduxFromThemeManager, manager);
    yield* put(setThemeError(null));
  } catch (error) {
    yield* put(setThemeError(themeErrorMessage(error, "Failed to import theme.")));
  }
}

export function* handleThemeCustomizationCleared(): SagaGenerator<void> {
  try {
    const manager = yield* call(getThemeManager);
    yield* call(clearCustomThemeFromManager, manager);
    yield* call(syncReduxFromThemeManager, manager);
    yield* put(setThemeError(null));
  } catch (error) {
    yield* put(setThemeError(themeErrorMessage(error, "Failed to clear custom theme.")));
  }
}

export function* watchThemeChangedSaga() {
  yield* takeEveryFromWindowEvent<ThemeChangedEventDetail>("theme-changed", handleThemeChanged);
}

export function* watchThemePreferencePersistenceSaga() {
  yield* takeEvery(requestThemePreferenceChange, handleThemePreferenceChangeRequested);
}

export function* watchThemeCustomizationRequestsSaga() {
  yield* takeEvery(selectThemePreset, handleThemePresetSelected);
  yield* takeEvery(importCustomTheme, handleCustomThemeImported);
  yield* takeEvery(clearThemeCustomization, handleThemeCustomizationCleared);
}

export function* themeSaga() {
  yield* fork(watchThemeChangedSaga);
  yield* fork(watchThemePreferencePersistenceSaga);
  yield* fork(watchThemeCustomizationRequestsSaga);
  yield* call(initThemeSaga);
}
