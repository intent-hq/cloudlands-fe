/**
 * Additional Agents Settings Store
 *
 * Manages which additional ACP providers are enabled.
 * Providers must be manually enabled in settings before they appear in the model picker.
 * Uses provider configuration to determine which providers can be disabled.
 */

import { createLogger } from '$lib/utils/client-logger';
import { getAlwaysEnabledProviders, getProviderConfig } from '$shared/config/provider-config';

const logger = createLogger('AdditionalAgentsStore');

// Storage key for persisting settings
const STORAGE_KEY = 'additional-agents-settings';

/**
 * Settings structure for additional agents
 */
interface AdditionalAgentsSettings {
  /** Map of provider ID to enabled state; absence means "not decided yet" */
  enabledProviders: Record<string, boolean>;
}

/**
 * Default settings - providers with canBeDisabled=false are always enabled implicitly
 */
const DEFAULT_SETTINGS: AdditionalAgentsSettings = {
  enabledProviders: {
    // Always-enabled providers are handled implicitly; leave others unset so we can auto-enable when available
  },
};

function loadSettings(): AdditionalAgentsSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch (error) {
    logger.error('Failed to load additional agents settings:', error);
  }
  return DEFAULT_SETTINGS;
}

function saveSettings(settings: AdditionalAgentsSettings) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    logger.error('Failed to save additional agents settings:', error);
  }
}

class AdditionalAgentsStore {
  // State - which providers are enabled
  enabledProviders = $state<Record<string, boolean>>(DEFAULT_SETTINGS.enabledProviders);

  constructor() {
    const settings = loadSettings();
    this.enabledProviders = settings.enabledProviders;
  }

  /**
   * Check if a provider can be disabled based on its configuration
   */
  private canProviderBeDisabled(providerId: string): boolean {
    const config = getProviderConfig(providerId);
    return config.canBeDisabled !== false;
  }

  /**
   * Check if a provider is enabled
   * Providers with canBeDisabled=false are always considered enabled
   */
  isProviderEnabled(providerId: string): boolean {
    if (!this.canProviderBeDisabled(providerId)) return true;
    return this.enabledProviders[providerId] ?? false;
  }

  /**
   * Enable or disable a provider
   */
  setProviderEnabled(providerId: string, enabled: boolean) {
    if (!this.canProviderBeDisabled(providerId)) {
      const config = getProviderConfig(providerId);
      logger.warn(`Cannot disable the ${config.displayName} provider`);
      return;
    }

    logger.info('Setting provider enabled:', { providerId, enabled });
    this.enabledProviders = {
      ...this.enabledProviders,
      [providerId]: enabled,
    };
    saveSettings({ enabledProviders: this.enabledProviders });
  }

  /**
   * Toggle a provider's enabled state
   */
  toggleProvider(providerId: string) {
    const currentState = this.isProviderEnabled(providerId);
    this.setProviderEnabled(providerId, !currentState);
  }

  /**
   * Get list of all enabled provider IDs (always includes providers with canBeDisabled=false)
   */
  getEnabledProviderIds(): string[] {
    // Start with always-enabled providers
    const enabled = getAlwaysEnabledProviders().map((p) => p.id);

    // Add explicitly enabled providers
    for (const [providerId, isEnabled] of Object.entries(this.enabledProviders)) {
      if (isEnabled && !enabled.includes(providerId)) {
        enabled.push(providerId);
      }
    }
    return enabled;
  }

  /**
   * Auto-enable a provider when models are detected, but only if the user has not explicitly set it.
   */
  ensureEnabledIfUnset(providerId: string) {
    if (!this.canProviderBeDisabled(providerId)) return;
    const current = this.enabledProviders[providerId];
    if (current === undefined) {
      this.enabledProviders = {
        ...this.enabledProviders,
        [providerId]: true,
      };
      saveSettings({ enabledProviders: this.enabledProviders });
      logger.info('Auto-enabled provider after detecting available models', { providerId });
    }
  }
}

// Create singleton instance
export const additionalAgentsStore = new AdditionalAgentsStore();
