/**
 * App Settings Service (Main Process)
 *
 * Provides access to app-level settings stored in electron-store.
 * This is a thin wrapper around electron-store for use by main process services.
 */

import { Logger } from '../../../shared/logger';
import ElectronStore from 'electron-store';

const logger = new Logger({ category: 'AppSettingsService' });

let settingsStore: any = null;
let initPromise: Promise<void> | null = null;

const WEBSOCKET_API_TOKEN_KEY = 'websocketApiToken';
const WEBSOCKET_API_ENABLED_KEY = 'websocketApiEnabled';
const WEBSOCKET_API_DISCOVERY_ENABLED_KEY = 'websocketApiDiscoveryEnabled';

function getStore(): any {
  if (!settingsStore) {
    try {
      settingsStore = new ElectronStore({ name: 'settings' });
      logger.info('App settings service initialized');
    } catch (error) {
      logger.error('Failed to initialize app settings service', error as Error);
    }
  }
  return settingsStore;
}

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
    getStore();
  })();
  return initPromise;
}

/**
 * Get a setting value by key
 */
export function getSetting<T>(key: string, defaultValue?: T): T | undefined {
  const store = getStore();
  if (!store) {
    logger.warn('Settings store not initialized, returning default', { key });
    return defaultValue;
  }
  const value = store.get(key);
  return value !== undefined ? value : defaultValue;
}

/**
 * Set a setting value
 */
export function setSetting<T>(key: string, value: T): void {
  const store = getStore();
  if (!store) {
    logger.warn('Settings store not initialized, cannot set', { key });
    return;
  }
  store.set(key, value);
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

/**
 * Whether the WebSocket API is enabled.
 * Defaults to false (opt-in).
 */
export function isWebSocketApiEnabled(): boolean {
  return getSetting<boolean>(WEBSOCKET_API_ENABLED_KEY, false) === true;
}

export function setWebSocketApiEnabled(enabled: boolean): void {
  setSetting(WEBSOCKET_API_ENABLED_KEY, enabled);
  logger.info('WebSocket API enabled state changed', { enabled });
}

/**
 * Get the WebSocket API token.
 * Returns undefined if not set. Call ensureWebSocketApiToken() for the explicit
 * create-on-missing path.
 */
export function getWebSocketApiToken(): string | undefined {
  return getSetting<string>(WEBSOCKET_API_TOKEN_KEY);
}

export function setWebSocketApiToken(token: string): void {
  setSetting(WEBSOCKET_API_TOKEN_KEY, token);
}

/**
 * Return the persisted WebSocket API token, creating one only when explicitly requested.
 */
export function ensureWebSocketApiToken(createToken: () => string): string {
  const existing = getWebSocketApiToken();
  if (existing && typeof existing === 'string' && existing.length > 0) {
    return existing;
  }
  const token = createToken();
  setWebSocketApiToken(token);
  return token;
}

export function isWebSocketApiDiscoveryEnabled(): boolean {
  return getSetting<boolean>(WEBSOCKET_API_DISCOVERY_ENABLED_KEY, false) === true;
}

export function setWebSocketApiDiscoveryEnabled(enabled: boolean): void {
  setSetting(WEBSOCKET_API_DISCOVERY_ENABLED_KEY, enabled);
  logger.info('Network discovery enabled state changed', { enabled });
}
