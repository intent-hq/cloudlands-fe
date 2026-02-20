/**
 * Notification Settings Store
 *
 * Manages notification preferences for the renderer process.
 * Persists settings via settings:get/settings:set IPC channels.
 */

import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('NotificationSettingsStore');

// Storage key for persisting settings
const STORAGE_KEY = 'notificationSettings';

/**
 * Notification settings interface
 */
export interface NotificationSettings {
  enabled: boolean;
  soundEnabled: boolean;
  soundOnlyWhenUnfocused: boolean;
  volume: number;
}

/**
 * Default settings
 */
const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: true,
  soundEnabled: true,
  soundOnlyWhenUnfocused: true,
  volume: 0.5,
};

class NotificationSettingsStore {
  // State
  enabled = $state<boolean>(DEFAULT_SETTINGS.enabled);
  soundEnabled = $state<boolean>(DEFAULT_SETTINGS.soundEnabled);
  soundOnlyWhenUnfocused = $state<boolean>(DEFAULT_SETTINGS.soundOnlyWhenUnfocused);
  volume = $state<number>(DEFAULT_SETTINGS.volume);

  constructor() {
    this.load();
  }

  /**
   * Load settings from IPC
   */
  private async load() {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        const result = await window.electronAPI.invoke('settings:get', { key: STORAGE_KEY });
        if (result?.success && result.data) {
          const parsed: NotificationSettings = result.data;
          this.enabled = parsed.enabled ?? DEFAULT_SETTINGS.enabled;
          this.soundEnabled = parsed.soundEnabled ?? DEFAULT_SETTINGS.soundEnabled;
          this.soundOnlyWhenUnfocused = parsed.soundOnlyWhenUnfocused ?? DEFAULT_SETTINGS.soundOnlyWhenUnfocused;
          this.volume = parsed.volume ?? DEFAULT_SETTINGS.volume;
          logger.debug('Loaded notification settings:', {
            enabled: this.enabled,
            soundEnabled: this.soundEnabled,
            soundOnlyWhenUnfocused: this.soundOnlyWhenUnfocused,
            volume: this.volume,
          });
        }
      }
    } catch (error) {
      logger.error('Failed to load notification settings:', error);
    }
  }

  /**
   * Save settings to IPC
   */
  private async save() {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        const settings: NotificationSettings = {
          enabled: this.enabled,
          soundEnabled: this.soundEnabled,
          soundOnlyWhenUnfocused: this.soundOnlyWhenUnfocused,
          volume: this.volume,
        };
        await window.electronAPI.invoke('settings:set', { key: STORAGE_KEY, value: settings });
        logger.debug('Saved notification settings');
      }
    } catch (error) {
      logger.error('Failed to save notification settings:', error);
    }
  }

  /**
   * Update enabled state
   */
  setEnabled(value: boolean) {
    logger.debug('Setting notifications enabled:', value);
    this.enabled = value;
    this.save();
  }

  /**
   * Update sound enabled state
   */
  setSoundEnabled(value: boolean) {
    logger.debug('Setting sound enabled:', value);
    this.soundEnabled = value;
    this.save();
  }

  /**
   * Update sound only when unfocused state
   */
  setSoundOnlyWhenUnfocused(value: boolean) {
    logger.debug('Setting sound only when unfocused:', value);
    this.soundOnlyWhenUnfocused = value;
    this.save();
  }

  /**
   * Update volume (0.0 to 1.0)
   */
  setVolume(value: number) {
    const clampedValue = Math.max(0, Math.min(1, value));
    logger.debug('Setting volume:', clampedValue);
    this.volume = clampedValue;
    this.save();
  }

  /**
   * Reset all settings to defaults
   */
  reset() {
    logger.debug('Resetting notification settings to defaults');
    this.enabled = DEFAULT_SETTINGS.enabled;
    this.soundEnabled = DEFAULT_SETTINGS.soundEnabled;
    this.soundOnlyWhenUnfocused = DEFAULT_SETTINGS.soundOnlyWhenUnfocused;
    this.volume = DEFAULT_SETTINGS.volume;
    this.save();
  }
}

// Create singleton instance
export const notificationSettingsStore = new NotificationSettingsStore();
