import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('SafeStorage');

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined';
}

export const safeLocalStorage = {
  getItem(key: string): string | null {
    if (!canUseLocalStorage()) {
      return null;
    }

    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      logger.warn('Failed to read localStorage item', { key, error });
      return null;
    }
  },

  getItemWithStatus(key: string): { value: string | null; hadError: boolean } {
    if (!canUseLocalStorage()) {
      return { value: null, hadError: false };
    }

    try {
      return {
        value: window.localStorage.getItem(key),
        hadError: false,
      };
    } catch (error) {
      logger.warn('Failed to read localStorage item', { key, error });
      return { value: null, hadError: true };
    }
  },

  setItem(key: string, value: string): void {
    if (!canUseLocalStorage()) {
      return;
    }

    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      logger.warn('Failed to write localStorage item', { key, error });
    }
  },

  removeItem(key: string): void {
    if (!canUseLocalStorage()) {
      return;
    }

    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      logger.warn('Failed to remove localStorage item', { key, error });
    }
  },

  getJSON<T>(key: string): T | undefined {
    const value = safeLocalStorage.getItem(key);

    if (value === null) {
      return undefined;
    }

    try {
      return JSON.parse(value) as T;
    } catch (error) {
      logger.warn('Failed to parse localStorage JSON', { key, error });
      return undefined;
    }
  },

  setJSON(key: string, value: unknown): void {
    try {
      safeLocalStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      logger.warn('Failed to serialize localStorage JSON', { key, error });
    }
  },
};