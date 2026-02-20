/**
 * Beta Updates Settings Store
 *
 * Manages the beta updates preference for the renderer process.
 * Persists settings via settings:get/settings:set IPC channels.
 * When enabled, the auto-updater will check the beta channel instead of stable.
 */

import { createLogger } from '$lib/utils/client-logger';
import { autoUpdateStore } from '$features/auto-update/auto-update.store.svelte';

const logger = createLogger('BetaUpdatesStore');

// Storage key for persisting settings
const STORAGE_KEY = 'betaUpdatesEnabled';

/**
 * Beta updates settings store class
 */
class BetaUpdatesSettingsStore {
  enabled = $state(false);
  private initialized = false;

  constructor() {
    // Load settings on construction
    this.load();
  }

  /**
   * Load settings from IPC
   */
  private async load() {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        const result = await window.electronAPI.invoke('settings:get', { key: STORAGE_KEY });
        if (result?.success && typeof result.data === 'boolean') {
          this.enabled = result.data;
          logger.debug('Loaded beta updates setting:', { enabled: this.enabled });

          // Apply the channel setting to the auto-updater
          if (this.initialized) {
            await this.applyChannel();
          }
        }
        this.initialized = true;

        // Apply channel on first load
        await this.applyChannel();
      }
    } catch (error) {
      logger.error('Failed to load beta updates setting:', error);
    }
  }

  /**
   * Save settings to IPC
   */
  private async save() {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        await window.electronAPI.invoke('settings:set', { key: STORAGE_KEY, value: this.enabled });
        logger.debug('Saved beta updates setting:', { enabled: this.enabled });
      }
    } catch (error) {
      logger.error('Failed to save beta updates setting:', error);
    }
  }

  /**
   * Apply the current channel setting to the auto-updater
   */
  private async applyChannel() {
    try {
      const channel = this.enabled ? 'beta' : 'stable';
      await autoUpdateStore.setChannel(channel);
      logger.debug('Applied update channel:', { channel });
    } catch (error) {
      logger.error('Failed to apply update channel:', error);
    }
  }

  /**
   * Update enabled state
   */
  async setEnabled(value: boolean) {
    logger.debug('Setting beta updates enabled:', value);
    this.enabled = value;
    await this.save();
    await this.applyChannel();
  }

  /**
   * Toggle beta updates
   */
  async toggle() {
    await this.setEnabled(!this.enabled);
  }
}

// Export singleton instance
export const betaUpdatesStore = new BetaUpdatesSettingsStore();
