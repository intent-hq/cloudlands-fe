/**
 * Background Agent Settings Store
 *
 * Manages default model settings for background agents (commit message, PR description, code review).
 * Provides a general default model and per-type overrides.
 */

import type { AuggieModel } from '$features/auggie/auggie-models.client';
import { createLogger } from '$lib/utils/client-logger';
import type { ModelFallbackResult } from '$lib/utils/model-fallback';
import { findBestAvailableModel } from '$lib/utils/model-fallback';
import { MODEL_DEFAULTS } from '$shared/constants/agent-services';
import {
  getDefaultModelForProvider,
  getDefaultProviderId,
  PROVIDER_MODEL_TIERS,
} from '$shared/config/provider-config';

const logger = createLogger('BackgroundAgentSettingsStore');

// Storage key for persisting settings
const STORAGE_KEY = 'workspaces-background-agent-settings';
// localStorage key for per-provider settings cache
const PROVIDER_SETTINGS_KEY = 'workspaces-bg-agent-settings-per-provider';

/**
 * Default model for background tasks (commit, PR, review).
 * Uses MODEL_DEFAULTS.BACKGROUND_AGENT_MODEL as the single source of truth.
 * Will gracefully fallback to other available models if not accessible.
 */
export const DEFAULT_BACKGROUND_MODEL = MODEL_DEFAULTS.BACKGROUND_AGENT_MODEL;

/**
 * Background agent types that can have model overrides
 */
export type BackgroundAgentType = 'commit' | 'pr' | 'review' | 'fast';

/**
 * Display information for each background agent type
 */
export const BACKGROUND_AGENT_TYPE_INFO: Record<
  BackgroundAgentType,
  { label: string; description: string }
> = {
  commit: {
    label: 'Commit message',
    description: 'Generates git commit messages from staged changes',
  },
  pr: {
    label: 'PR description',
    description: 'Generates pull request titles and descriptions',
  },
  review: {
    label: 'Code review',
    description: 'Performs automated code reviews on changes',
  },
  fast: {
    label: 'Quick tasks',
    description: 'Prompt enhancement, layout suggestions, and setup scripts',
  },
};

/**
 * Settings structure for background agents
 */
interface BackgroundAgentSettings {
  /** Default model for all background agents */
  defaultModel: string;
  /** Per-type model overrides (empty string means use default) */
  typeOverrides: Record<BackgroundAgentType, string>;
}

/**
 * Default settings
 */
const DEFAULT_SETTINGS: BackgroundAgentSettings = {
  defaultModel: DEFAULT_BACKGROUND_MODEL,
  typeOverrides: {
    commit: '',
    pr: '',
    review: '',
    fast: '',
  },
};

/** Shape of per-provider cached settings */
interface ProviderBgSettings {
  defaultModel: string;
  typeOverrides: Record<BackgroundAgentType, string>;
}

class BackgroundAgentSettingsStore {
  // State
  defaultModel = $state<string>(DEFAULT_BACKGROUND_MODEL);
  typeOverrides = $state<Record<BackgroundAgentType, string>>({
    commit: '',
    pr: '',
    review: '',
    fast: '',
  });
  // Per-provider settings cache (provider ID → settings snapshot)
  private providerSettings: Map<string, ProviderBgSettings> = new Map();

  constructor() {
    this.load();

    // Load per-provider settings cache (inline to avoid Svelte rune compilation issues)
    try {
      const stored = localStorage.getItem(PROVIDER_SETTINGS_KEY);
      if (stored) {
        const parsed: Record<string, ProviderBgSettings> = JSON.parse(stored);
        this.providerSettings = new Map(Object.entries(parsed));
        logger.debug('Loaded per-provider background agent settings cache', {
          providers: [...this.providerSettings.keys()],
        });
      }
    } catch (error) {
      logger.error('Failed to load per-provider background agent settings cache:', error);
    }
  }

  /**
   * Load settings from localStorage
   */
  private load() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: BackgroundAgentSettings = JSON.parse(stored);
        this.defaultModel = parsed.defaultModel || DEFAULT_BACKGROUND_MODEL;
        this.typeOverrides = {
          commit: parsed.typeOverrides?.commit || '',
          pr: parsed.typeOverrides?.pr || '',
          review: parsed.typeOverrides?.review || '',
          fast: parsed.typeOverrides?.fast || '',
        };
        logger.debug('Loaded background agent settings:', {
          defaultModel: this.defaultModel,
          typeOverrides: this.typeOverrides,
        });
      }
    } catch (error) {
      logger.error('Failed to load background agent settings:', error);
    }
  }

  /**
   * Save settings to localStorage
   */
  private save() {
    try {
      const settings: BackgroundAgentSettings = {
        defaultModel: this.defaultModel,
        typeOverrides: this.typeOverrides,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      logger.debug('Saved background agent settings');
    } catch (error) {
      logger.error('Failed to save background agent settings:', error);
    }
  }

  /**
   * Set the default model for all background agents
   */
  setDefaultModel(model: string) {
    logger.debug('Setting default background model:', model);
    this.defaultModel = model;
    this.save();
  }

  /**
   * Set a model override for a specific agent type
   * Pass empty string to clear the override
   */
  setTypeOverride(type: BackgroundAgentType, model: string) {
    logger.debug('Setting type override:', { type, model });
    this.typeOverrides = { ...this.typeOverrides, [type]: model };
    this.save();
  }

  /**
   * Clear a type override (will use default model)
   */
  clearTypeOverride(type: BackgroundAgentType) {
    this.setTypeOverride(type, '');
  }

  /**
   * Get the effective model for a background agent type
   * Returns the type-specific override if set, otherwise the default
   */
  getModelForType(type: BackgroundAgentType): string {
    const override = this.typeOverrides[type];
    if (override && override.length > 0) {
      return override;
    }
    return this.defaultModel;
  }

  /**
   * Get the effective model for a background agent type with fallback validation.
   * Checks if the model is available and falls back to alternatives if not.
   *
   * @param type - The background agent type
   * @param availableModels - List of available models from enabled providers
   * @returns ModelFallbackResult with the model to use and fallback info
   */
  getValidatedModelForType(
    type: BackgroundAgentType,
    availableModels: AuggieModel[],
  ): ModelFallbackResult {
    const requestedModel = this.getModelForType(type);
    return findBestAvailableModel(requestedModel, availableModels);
  }

  /**
   * Check if a type has a custom override
   */
  hasOverride(type: BackgroundAgentType): boolean {
    return !!this.typeOverrides[type] && this.typeOverrides[type].length > 0;
  }

  /**
   * Reset all settings to defaults
   */
  reset() {
    logger.debug('Resetting background agent settings to defaults');
    this.defaultModel = DEFAULT_SETTINGS.defaultModel;
    this.typeOverrides = { ...DEFAULT_SETTINGS.typeOverrides };
    this.save();
  }

  /**
   * Reset settings for a new provider.
   * Sets the default model to the provider's fast-tier model and clears all overrides.
   * For providers without tier mappings (dynamic model lists like opencode), clears
   * the model so callers fall back to validated model selection.
   */
  resetForProvider(providerId: string) {
    logger.info('Resetting background agent settings for provider:', { providerId });
    let fastModel = '';
    // Only resolve tier-based models for providers with known tier mappings.
    // Providers with dynamic model lists (e.g. opencode) would produce invalid
    // compound IDs like "opencode:haiku4.5" since getDefaultModelForProvider
    // falls back to Auggie model names that don't exist in the provider.
    if (providerId in PROVIDER_MODEL_TIERS) {
      const baseModel = getDefaultModelForProvider(providerId, 'fast');
      // Prefix with provider ID for non-default providers (matches model store behavior)
      const defaultProviderId = getDefaultProviderId();
      fastModel = providerId !== defaultProviderId ? `${providerId}:${baseModel}` : baseModel;
    }
    this.defaultModel = fastModel;
    this.typeOverrides = { commit: '', pr: '', review: '', fast: '' };
    this.save();
  }

  /**
   * Switch provider with save/restore semantics.
   * Saves the current settings under the previous provider, then restores
   * saved settings for the new provider (or falls back to resetForProvider).
   */
  switchProvider(newProviderId: string, previousProviderId: string) {
    logger.info('Switching background agent settings for provider:', {
      from: previousProviderId,
      to: newProviderId,
    });

    // Save current settings for the outgoing provider
    this.providerSettings.set(previousProviderId, {
      defaultModel: this.defaultModel,
      typeOverrides: { ...this.typeOverrides },
    });
    this.saveProviderSettings();

    // Restore saved settings for the incoming provider, or reset
    const saved = this.providerSettings.get(newProviderId);
    if (saved) {
      logger.info('Restoring background agent settings for provider:', {
        providerId: newProviderId,
        defaultModel: saved.defaultModel,
        overrideKeys: Object.keys(saved.typeOverrides).filter(
          (k) => saved.typeOverrides[k as BackgroundAgentType]?.length > 0,
        ),
      });
      this.defaultModel = saved.defaultModel;
      this.typeOverrides = {
        commit: saved.typeOverrides.commit || '',
        pr: saved.typeOverrides.pr || '',
        review: saved.typeOverrides.review || '',
        fast: saved.typeOverrides.fast || '',
      };
      this.save();
    } else {
      // No saved settings — fall back to the existing reset logic
      this.resetForProvider(newProviderId);
    }
  }

  /**
   * Save per-provider settings cache to localStorage.
   */
  private saveProviderSettings() {
    try {
      const obj = Object.fromEntries(this.providerSettings);
      localStorage.setItem(PROVIDER_SETTINGS_KEY, JSON.stringify(obj));
    } catch (error) {
      logger.error('Failed to save per-provider background agent settings cache:', error);
    }
  }
}

// Create singleton instance
export const backgroundAgentSettingsStore = new BackgroundAgentSettingsStore();
