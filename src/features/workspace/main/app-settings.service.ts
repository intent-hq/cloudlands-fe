/**
 * App Settings Service (Main Process)
 *
 * Provides access to app-level settings stored in electron-store.
 * This is a thin wrapper around electron-store for use by main process services.
 */

import { Logger } from '../../../shared/logger';

const logger = new Logger({ category: 'AppSettingsService' });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let settingsStore: any = null;
let initPromise: Promise<void> | null = null;

/**
 * Initialize the settings store (call once during app startup)
 */
export async function initAppSettingsService(): Promise<void> {
  if (settingsStore) {
    return; // Already initialized
  }
  if (initPromise) {
    return initPromise;
  }
  initPromise = (async () => {
    try {
      const ElectronStore = (await import('electron-store')).default;
      settingsStore = new ElectronStore({ name: 'settings' });
      logger.info('App settings service initialized');
    } catch (error) {
      logger.error('Failed to initialize app settings service', error as Error);
    }
  })();
  return initPromise;
}

/**
 * Get a setting value by key
 */
export function getSetting<T>(key: string, defaultValue?: T): T | undefined {
  if (!settingsStore) {
    logger.warn('Settings store not initialized, returning default', { key });
    return defaultValue;
  }
  const value = settingsStore.get(key);
  return value !== undefined ? value : defaultValue;
}

/**
 * Set a setting value
 */
export function setSetting<T>(key: string, value: T): void {
  if (!settingsStore) {
    logger.warn('Settings store not initialized, cannot set', { key });
    return;
  }
  settingsStore.set(key, value);
}

/**
 * Get the branch prefix setting
 * Returns empty string if not set (no prefix)
 */
export function getBranchPrefix(): string {
  return getSetting<string>('branchPrefix', '') || '';
}

/**
 * Get the custom worktrees location setting.
 * Returns empty string if not set (use default ~/intent/workspaces).
 */
export function getWorktreesLocation(): string {
  return getSetting<string>('worktreesLocation', '') || '';
}

/**
 * Get the SSH key path setting.
 * Returns empty string if not set (use default SSH behavior).
 */
export function getSshKeyPath(): string {
  return getSetting<string>('sshKeyPath', '') || '';
}
