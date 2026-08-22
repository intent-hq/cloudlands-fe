import { END, buffers, eventChannel, type EventChannel } from 'redux-saga';
import { call, put, take, takeEvery } from 'typed-redux-saga';

import { ThemeManager } from '$lib/utils/theme';
import { themePresets } from '$lib/utils/theme-presets';
import { safeLocalStorage } from '$lib/utils/safe-storage';
import { createLogger } from '$lib/utils/client-logger';
import { invoke, isElectron } from '$lib/electron-bridge';
import { WINDOW_CHANNELS } from '$shared/ipc/channels';
import { m } from '$shared/paraglide/messages.js';
import {
  clearThemeCustomization,
  importCustomTheme,
  requestThemePreferenceChange,
  selectThemePreset,
  setThemeCustomization,
  setThemeError,
  setThemeName,
  setThemePreference,
} from '../theme-slice';
import {
  DEFAULT_THEME_NAME,
  DEFAULT_THEME_PREFERENCE,
  type ThemeCustomizationState,
  type ThemeName,
  type ThemePreference,
} from '../theme-types';

const logger = createLogger('ThemeSaga');
const DARK_MODE_MEDIA_QUERY = '(prefers-color-scheme: dark)';

export interface ThemeChangedEventDetail {
  theme?: ThemePreference;
  isDark?: boolean;
  customThemeName?: string | null;
  activePresetId?: string | null;
  terminalColors?: Record<string, string> | null;
}

interface ThemeManagerSnapshot {
  preference: ThemePreference;
  name: ThemeName;
  customization: ThemeCustomizationState;
}

let suppressListenerDepth = 0;

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

function themeNameFromIsDark(isDark: boolean): ThemeName {
  return isDark ? 'dark' : 'light';
}

function readThemeNameFromBrowser(preference: ThemePreference): ThemeName {
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    if (root.classList.contains('dark')) return 'dark';
    if (root.classList.contains('light')) return 'light';
    const colorScheme = root.style.getPropertyValue('color-scheme').trim();
    if (colorScheme === 'dark' || colorScheme.startsWith('dark ')) return 'dark';
    if (colorScheme === 'light' || colorScheme.startsWith('light ')) return 'light';
  }
  if (preference !== 'system') return preference;
  try {
    return typeof window !== 'undefined' && window.matchMedia(DARK_MODE_MEDIA_QUERY).matches
      ? 'dark'
      : 'light';
  } catch {
    return DEFAULT_THEME_NAME;
  }
}

function snapshotThemeManager(manager: ThemeManager): ThemeManagerSnapshot {
  const preference = manager.getTheme();
  return {
    preference: isThemePreference(preference) ? preference : DEFAULT_THEME_PREFERENCE,
    name: themeNameFromIsDark(manager.isDark()),
    customization: {
      hasCustomTheme: manager.hasCustomTheme(),
      customThemeName: manager.getCustomThemeName(),
      activePresetId: manager.getActivePresetId(),
    },
  };
}

function* syncWindowTheme(preference: ThemePreference) {
  if (!isElectron()) return;
  try {
    yield* call(invoke, WINDOW_CHANNELS.SET_THEME, { theme: preference });
  } catch (error) {
    logger.warn('native window theme sync failed', error);
  }
}

function* syncThemeManager(manager: ThemeManager) {
  const snapshot: ThemeManagerSnapshot = yield* call(snapshotThemeManager, manager);
  yield* put(setThemePreference(snapshot.preference));
  yield* put(setThemeName(snapshot.name));
  yield* put(setThemeCustomization(snapshot.customization));
  const nativeTheme =
    snapshot.customization.hasCustomTheme && snapshot.customization.activePresetId === null
      ? snapshot.name
      : snapshot.preference;
  yield* call(syncWindowTheme, nativeTheme);
}

function withSuppressedListener(operation: () => void): void {
  suppressListenerDepth += 1;
  try {
    operation();
  } finally {
    suppressListenerDepth -= 1;
  }
}

function createThemeChangedChannel(): EventChannel<ThemeChangedEventDetail> {
  return eventChannel<ThemeChangedEventDetail>((emit) => {
    const listener = (event: Event) => {
      if (suppressListenerDepth > 0) return;
      emit((event as CustomEvent<ThemeChangedEventDetail>).detail ?? {});
    };
    window.addEventListener('theme-changed', listener);
    return () => window.removeEventListener('theme-changed', listener);
  }, buffers.expanding<ThemeChangedEventDetail>());
}

function themeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}

function* handlePreference(action: ReturnType<typeof requestThemePreferenceChange>) {
  try {
    const [preference] = action.payload;
    yield* call([safeLocalStorage, safeLocalStorage.setItem], 'theme', preference);
    const manager: ThemeManager = yield* call([ThemeManager, ThemeManager.getInstance]);
    yield* call(withSuppressedListener, () => manager.setTheme(preference, { persist: false }));
    yield* call(syncThemeManager, manager);
    yield* put(setThemeError(null));
  } catch (error) {
    yield* put(setThemeError(themeError(error, m.theme_service_applyPreferenceFailed_error())));
  }
}

function* handlePreset(action: ReturnType<typeof selectThemePreset>) {
  try {
    const [presetId] = action.payload;
    const preset = themePresets.find((candidate) => candidate.id === presetId);
    if (!preset) throw new Error(`Unknown theme preset: ${presetId}`);
    const manager: ThemeManager = yield* call([ThemeManager, ThemeManager.getInstance]);
    yield* call(withSuppressedListener, () =>
      manager.setPresetTheme(preset.id, preset.dark, preset.light),
    );
    yield* call(syncThemeManager, manager);
    yield* put(setThemeError(null));
  } catch (error) {
    yield* put(setThemeError(themeError(error, m.theme_service_applyPresetFailed_error())));
  }
}

function* handleImport(action: ReturnType<typeof importCustomTheme>) {
  try {
    const [json] = action.payload;
    const manager: ThemeManager = yield* call([ThemeManager, ThemeManager.getInstance]);
    yield* call(withSuppressedListener, () => manager.setCustomTheme(json));
    yield* call(syncThemeManager, manager);
    yield* put(setThemeError(null));
  } catch (error) {
    yield* put(setThemeError(themeError(error, m.theme_service_importFailed_error())));
  }
}

function* handleClear() {
  try {
    const manager: ThemeManager = yield* call([ThemeManager, ThemeManager.getInstance]);
    yield* call(withSuppressedListener, () => manager.clearCustomTheme());
    yield* call(syncThemeManager, manager);
    yield* put(setThemeError(null));
  } catch (error) {
    yield* put(setThemeError(themeError(error, m.theme_service_clearCustomFailed_error())));
  }
}

function* applyExternalThemeChange(detail: ThemeChangedEventDetail) {
  const preference = isThemePreference(detail.theme) ? detail.theme : null;
  if (preference) yield* put(setThemePreference(preference));
  const name =
    typeof detail.isDark === 'boolean'
      ? themeNameFromIsDark(detail.isDark)
      : readThemeNameFromBrowser(preference ?? DEFAULT_THEME_PREFERENCE);
  yield* put(setThemeName(name));
  yield* put(
    setThemeCustomization({
      hasCustomTheme: Boolean(detail.customThemeName || detail.activePresetId),
      customThemeName: detail.customThemeName ?? null,
      activePresetId: detail.activePresetId ?? null,
    }),
  );
}

export function* themeSaga() {
  const manager: ThemeManager = yield* call([ThemeManager, ThemeManager.getInstance]);
  try {
    yield* call(syncThemeManager, manager);
  } catch (error) {
    logger.warn('theme hydration failed', error);
  }

  const channel = createThemeChangedChannel();
  try {
    yield* takeEvery(requestThemePreferenceChange, handlePreference);
    yield* takeEvery(selectThemePreset, handlePreset);
    yield* takeEvery(importCustomTheme, handleImport);
    yield* takeEvery(clearThemeCustomization, handleClear);
    while (true) {
      const detail: ThemeChangedEventDetail = yield* take(channel);
      if (detail === (END as unknown as ThemeChangedEventDetail)) break;
      yield* call(applyExternalThemeChange, detail);
    }
  } finally {
    channel.close();
    yield* call(ThemeManager.resetInstance);
    suppressListenerDepth = 0;
  }
}
