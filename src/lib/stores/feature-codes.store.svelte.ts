/**
 * Feature Codes Store (Renderer Process)
 *
 * Reactive store for checking feature code status in the renderer.
 * Loads active features from the main process via IPC and exposes
 * a reactive isFeatureEnabled() check using Svelte 5 runes.
 */

import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('FeatureCodesStore');

/**
 * Feature codes store class using Svelte 5 runes
 */
class FeatureCodesStore {
  /** Set of currently active feature IDs */
  activeFeatures = $state<Set<string>>(new Set());
  private initialized = false;

  /**
   * Initialize the store by loading active features from the main process.
   * Safe to call multiple times — only fetches once.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    await this.fetchActiveFeatures();
  }

  /**
   * Re-fetch active features from the main process.
   * Useful after activating a new code so the UI updates immediately.
   */
  async refresh(): Promise<void> {
    await this.fetchActiveFeatures();
  }

  /**
   * Check whether a feature is currently enabled.
   */
  isFeatureEnabled(featureId: string): boolean {
    return this.activeFeatures.has(featureId);
  }

  /**
   * Deactivate a single feature by its ID.
   * Returns true if the feature was successfully deactivated.
   */
  async deactivateFeature(featureId: string): Promise<boolean> {
    try {
      const result = await invoke<{ success: boolean }>('feature-codes:deactivate', { featureId });
      if (result?.success) {
        await this.refresh();
      }
      return result?.success ?? false;
    } catch (error) {
      logger.error('Failed to deactivate feature', error);
      return false;
    }
  }

  /**
   * Fetch active features from the main process via IPC.
   */
  private async fetchActiveFeatures(): Promise<void> {
    try {
      const result = await invoke<{ features: string[] }>('feature-codes:get-active');
      if (result?.features && Array.isArray(result.features)) {
        this.activeFeatures = new Set(result.features);
        logger.debug('Loaded active features', { features: result.features });
      }
    } catch (error) {
      logger.error('Failed to fetch active features', error);
    }
  }
}

/** Singleton feature codes store instance */
export const featureCodesStore = new FeatureCodesStore();

