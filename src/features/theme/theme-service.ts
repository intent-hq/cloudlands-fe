import type { StoreMiddleware } from '@augmentcode/themis/types';

import { m } from '$shared/paraglide/messages.js';
import { store as appStore } from '$store/renderer/store';
import {
  requestThemePreferenceChange,
  setThemeError,
  setThemeName,
  setThemePreference,
} from '$store/renderer/slices/theme/theme-slice';
import {
  DEFAULT_THEME_NAME,
  DEFAULT_THEME_PREFERENCE,
  type ThemeName,
  type ThemePreference,
} from '$store/renderer/slices/theme/theme-types';
import { ThemeManager } from '$lib/utils/theme';
import { safeLocalStorage } from '$lib/utils/safe-storage';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('ThemeMutationService');
const THEME_STORAGE_KEY = 'theme';
const DARK_MODE_MEDIA_QUERY = '(prefers-color-scheme: dark)';

type ThemeChangedEventDetail = { theme?: ThemePreference; isDark?: boolean };

let installed = false;
let themeChangedListener: ((event: Event) => void) | null = null;
let suppressListenerDepth = 0;

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

function themeNameFromIsDark(isDark: boolean): ThemeName {
  return isDark ? 'dark' : 'light';
}

function readSystemThemeName(): ThemeName {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return DEFAULT_THEME_NAME;
  try {
    return themeNameFromIsDark(window.matchMedia(DARK_MODE_MEDIA_QUERY).matches);
  } catch {
    return DEFAULT_THEME_NAME;
  }
}

function resolveThemeName(preference: ThemePreference): ThemeName {
  return preference === 'system' ? readSystemThemeName() : preference;
}

function syncReduxFromThemeManager(manager: ThemeManager): void {
  const preference = manager.getTheme();
  appStore.dispatch(setThemePreference(isThemePreference(preference) ? preference : DEFAULT_THEME_PREFERENCE));
  appStore.dispatch(setThemeName(themeNameFromIsDark(manager.isDark())));
}

function installThemeChangedListener(): void {
  if (typeof window === 'undefined' || themeChangedListener !== null) return;
  themeChangedListener = (event: Event) => {
    if (suppressListenerDepth > 0) return;
    const detail = (event as CustomEvent<ThemeChangedEventDetail>).detail ?? {};
    const preference = isThemePreference(detail.theme) ? detail.theme : DEFAULT_THEME_PREFERENCE;
    appStore.dispatch(setThemePreference(preference));
    appStore.dispatch(setThemeName(typeof detail.isDark === 'boolean' ? themeNameFromIsDark(detail.isDark) : resolveThemeName(preference)));
  };
  window.addEventListener('theme-changed', themeChangedListener);
}

function bootOnce(): void {
  try {
    syncReduxFromThemeManager(ThemeManager.getInstance());
    installThemeChangedListener();
  } catch (error) {
    logger.warn('theme hydration failed', error);
  }
}

function handlePreference(action: ReturnType<typeof requestThemePreferenceChange>): void {
  try {
    const [preference] = action.payload;
    safeLocalStorage.setItem(THEME_STORAGE_KEY, preference);
    const manager = ThemeManager.getInstance();
    suppressListenerDepth += 1;
    try {
      manager.setTheme(preference, { persist: false });
    } finally {
      suppressListenerDepth -= 1;
    }
    syncReduxFromThemeManager(manager);
    appStore.dispatch(setThemeError(null));
  } catch (error) {
    const fallback = m.theme_service_applyPreferenceFailed_error();
    appStore.dispatch(setThemeError(error instanceof Error && error.message ? error.message : fallback));
  }
}

export function createThemeMutationMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (!installed) {
      installed = true;
      bootOnce();
    }
    if (
      action &&
      typeof action === 'object' &&
      (action as { type?: unknown }).type === requestThemePreferenceChange.type
    ) {
      handlePreference(action as ReturnType<typeof requestThemePreferenceChange>);
    }
    return result;
  };
}

export function __resetThemeMutationForTests(): void {
  if (typeof window !== 'undefined' && themeChangedListener) window.removeEventListener('theme-changed', themeChangedListener);
  themeChangedListener = null;
  installed = false;
  suppressListenerDepth = 0;
}