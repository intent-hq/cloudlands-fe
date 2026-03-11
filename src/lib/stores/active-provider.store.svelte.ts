/**
 * Active Provider Store
 *
 * Manages which SINGLE ACP provider is currently active.
 * This replaces the multi-provider enabled map from additional-agents.store.svelte.ts.
 *
 * IMPORTANT: This store only controls WHICH provider is active.
 * Users can still select different models within the active provider
 * (e.g., opus for coordinator, sonnet for implementor).
 */

import { createLogger } from '$lib/utils/client-logger';
import {
  type ACPProviderConfig,
  ACP_PROVIDERS,
  getDefaultProviderId,
  getProviderConfig,
} from '$shared/config/provider-config';
import { backgroundAgentSettingsStore } from './background-agent-settings.store.svelte';
import { specialistsStore } from './specialists.store.svelte';

const logger = createLogger('ActiveProviderStore');

// Storage keys
const STORAGE_KEY = 'workspaces-active-provider';
const OLD_STORAGE_KEY = 'additional-agents-settings';

/**
 * Load active provider ID from localStorage
 */
function loadActiveProviderId(): string {
  if (typeof window === 'undefined') return getDefaultProviderId();

  try {
    // Try to load from new storage key first
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      // Validate the stored provider ID exists
      if (ACP_PROVIDERS[stored]) {
        return stored;
      }
      logger.warn('Stored provider ID not found in config, falling back to default:', stored);
    }

    // Migration: check old additional-agents-settings
    const oldStored = localStorage.getItem(OLD_STORAGE_KEY);
    if (oldStored) {
      const oldSettings = JSON.parse(oldStored);
      const enabledProviders = oldSettings.enabledProviders || {};

      // Prefer auggie if it was enabled, else take first enabled provider
      const defaultId = getDefaultProviderId();
      if (enabledProviders[defaultId] !== false) {
        logger.info('Migrated from old settings, using default provider:', defaultId);
        return defaultId;
      }

      // Find first enabled provider
      const firstEnabled = Object.entries(enabledProviders).find(
        ([, enabled]) => enabled === true,
      );
      if (firstEnabled) {
        const [providerId] = firstEnabled;
        if (ACP_PROVIDERS[providerId]) {
          logger.info('Migrated from old settings, using first enabled provider:', providerId);
          return providerId;
        }
      }
    }
  } catch (error) {
    logger.error('Failed to load active provider:', error);
  }

  return getDefaultProviderId();
}

/**
 * Save active provider ID to localStorage
 */
function saveActiveProviderId(providerId: string): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(STORAGE_KEY, providerId);
    logger.debug('Saved active provider:', providerId);
  } catch (error) {
    logger.error('Failed to save active provider:', error);
  }
}

class ActiveProviderStore {
  /** The currently active provider ID */
  activeProviderId = $state<string>(getDefaultProviderId());

  constructor() {
    this.activeProviderId = loadActiveProviderId();
  }

  /**
   * Get the configuration for the currently active provider
   */
  getActiveProvider(): ACPProviderConfig {
    return getProviderConfig(this.activeProviderId);
  }

  /**
   * Set the active provider by ID
   * Persists the selection to localStorage and resets model settings for the new provider
   */
  setActiveProvider(providerId: string): void {
    // Validate the provider exists
    if (!ACP_PROVIDERS[providerId]) {
      logger.warn('Attempted to set unknown provider as active:', providerId);
      return;
    }

    const previousProviderId = this.activeProviderId;
    logger.info('Setting active provider:', { from: previousProviderId, to: providerId });
    this.activeProviderId = providerId;
    saveActiveProviderId(providerId);
    void import('./additional-agents.store.svelte')
      .then(({ additionalAgentsStore }) => {
        additionalAgentsStore.ensureProviderEnabled(providerId);
      })
      .catch((error) => {
        logger.warn('Failed to sync enabled providers after default change', { providerId, error });
      });

    // Save current settings for the outgoing provider, then restore (or reset)
    // settings for the incoming provider. This lets users switch back and forth
    // without losing their per-provider model configurations.
    if (previousProviderId !== providerId) {
      backgroundAgentSettingsStore.switchProvider(providerId, previousProviderId);
      specialistsStore.switchModelOverridesForProvider(providerId, previousProviderId);
    }
  }

  /**
   * Get list of available (installed) providers
   * Returns all configured providers - availability checking can be done elsewhere
   * based on whether models were successfully loaded for each provider
   */
  getAvailableProviders(): ACPProviderConfig[] {
    return Object.values(ACP_PROVIDERS);
  }

  /**
   * Check if a specific provider is currently active
   */
  isProviderActive(providerId: string): boolean {
    return this.activeProviderId === providerId;
  }

  /**
   * Ensure the active provider is valid
   * If the current selection is unavailable, falls back to default
   */
  validateActiveProvider(availableProviderIds: string[]): void {
    if (availableProviderIds.length === 0) {
      logger.warn('No available providers, keeping current selection');
      return;
    }

    if (!availableProviderIds.includes(this.activeProviderId)) {
      const defaultId = getDefaultProviderId();
      const fallbackId = availableProviderIds.includes(defaultId)
        ? defaultId
        : availableProviderIds[0];

      logger.info('Active provider unavailable, falling back:', {
        from: this.activeProviderId,
        to: fallbackId,
      });
      this.setActiveProvider(fallbackId);
    }
  }
}

// Create singleton instance
export const activeProviderStore = new ActiveProviderStore();
