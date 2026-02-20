import { unifiedStateStore } from '$features/agent/services/unified-state-store';
import type { AuggieModel } from '$features/auggie/auggie-models.client';
import { getAuggieModels } from '$features/auggie/auggie-models.client';
import type { ClaudeCodeModel } from '$features/claude-code/claude-code-models.client';
import { getClaudeCodeModels } from '$features/claude-code/claude-code-models.client';
import type { CodexModel } from '$features/codex/codex-models.client';
import { getCodexModels } from '$features/codex/codex-models.client';
import type { CortexModel } from '$features/cortex/cortex-models.client';
import { getCortexModels } from '$features/cortex/cortex-models.client';
import type { OpenCodeModel } from '$features/opencode/opencode-models.client';
import { getOpencodeModels } from '$features/opencode/opencode-models.client';
import { createLogger } from '$lib/utils/client-logger';
import { MODEL_DEFAULTS } from '$shared/constants/agent-services';
import {
  ACP_PROVIDERS,
  parseCompoundModelId,
  getDefaultProviderId,
  getDefaultModelForProvider,
  getProviderConfig,
  resolvePreferredModel,
} from '$shared/config/provider-config';
import { activeProviderStore } from './active-provider.store.svelte';

/** Union type for all provider model types */
type ProviderModel = AuggieModel | ClaudeCodeModel | CodexModel | CortexModel | OpenCodeModel;

const logger = createLogger('ModelStore');

// Storage keys
const GLOBAL_MODEL_KEY = 'workspaces-selected-model';
const WORKSPACE_MODELS_KEY = 'workspaces-workspace-models';
const PROVIDER_MODELS_KEY = 'workspaces-provider-models';

class ModelStore {
  // State - uses MODEL_DEFAULTS.UI_INITIAL_MODEL as the default when no model is stored
  selectedModel = $state<string>(MODEL_DEFAULTS.UI_INITIAL_MODEL);
  availableModels = $state<AuggieModel[]>([]);
  isLoadingModels = $state(false);
  modelsLoaded = $state(false);
  /** Error message if model loading failed */
  loadError = $state<string | null>(null);

  /** The provider ID that models were loaded for (used to detect provider changes) */
  private loadedForProviderId = $state<string | null>(null);

  /** Auto-retry state */
  private retryAttempt = 0;
  private retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private static readonly MAX_AUTO_RETRIES = 3;
  private static readonly RETRY_DELAYS_MS = [5_000, 15_000, 30_000];

  // Per-workspace model preferences (workspaceId -> model)
  private workspaceModels: Map<string, string> = new Map();

  // Per-provider model preferences (providerId -> model)
  // Remembers the last-selected model for each provider so switching back restores it
  private providerModels: Map<string, string> = new Map();

  constructor() {
    // Load global selected model from localStorage on initialization
    const stored = localStorage.getItem(GLOBAL_MODEL_KEY);
    if (stored) {
      this.selectedModel = stored;
      logger.debug('Loaded global model from localStorage:', stored);
    }

    // Load per-workspace model preferences
    this.loadWorkspaceModels();

    // Load per-provider model preferences
    this.loadProviderModels();

    // Load models immediately
    this.loadModels();
  }

  private loadWorkspaceModels() {
    try {
      const stored = localStorage.getItem(WORKSPACE_MODELS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.workspaceModels = new Map(Object.entries(parsed));
        logger.debug('Loaded workspace models:', this.workspaceModels.size);
      }
    } catch (error) {
      logger.error('Failed to load workspace models:', error);
    }
  }

  private saveWorkspaceModels() {
    try {
      const obj = Object.fromEntries(this.workspaceModels);
      localStorage.setItem(WORKSPACE_MODELS_KEY, JSON.stringify(obj));
    } catch (error) {
      logger.error('Failed to save workspace models:', error);
    }
  }

  private loadProviderModels() {
    try {
      const stored = localStorage.getItem(PROVIDER_MODELS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.providerModels = new Map(Object.entries(parsed));
        logger.debug('Loaded provider models:', this.providerModels.size);
      }
    } catch (error) {
      logger.error('Failed to load provider models:', error);
    }
  }

  private saveProviderModels() {
    try {
      const obj = Object.fromEntries(this.providerModels);
      localStorage.setItem(PROVIDER_MODELS_KEY, JSON.stringify(obj));
    } catch (error) {
      logger.error('Failed to save provider models:', error);
    }
  }

  /**
   * Load models from the active provider only.
   * This is called on initialization and when the provider changes.
   */
  async loadModels() {
    const activeProviderId = activeProviderStore.activeProviderId;

    // Skip if already loaded for this provider or currently loading
    if (
      (this.modelsLoaded && this.loadedForProviderId === activeProviderId) ||
      this.isLoadingModels
    ) {
      logger.debug('Models already loaded for active provider or loading, skipping', {
        activeProviderId,
        loadedForProviderId: this.loadedForProviderId,
      });
      return;
    }

    this.isLoadingModels = true;
    this.loadError = null;
    logger.debug('Loading models for active provider:', { activeProviderId });

    // Sync loading state with unified store
    unifiedStateStore.setModelsLoading(true);

    try {
      // Load models only from the active provider
      const models = await this.fetchModelsForProvider(activeProviderId);

      if (models.length > 0) {
        // Prefix model values with provider ID for non-default providers
        // This ensures parseCompoundModelId routes to the correct provider
        const defaultProviderId = getDefaultProviderId();
        const prefixedModels = models.map((model) => {
          if (activeProviderId !== defaultProviderId) {
            return {
              ...model,
              value: `${activeProviderId}:${model.value}`,
            };
          }
          return model;
        });

        this.availableModels = prefixedModels as AuggieModel[];
        this.modelsLoaded = true;
        this.loadedForProviderId = activeProviderId;
        this.loadError = null;
        this.retryAttempt = 0; // Reset retry counter on success

        logger.debug('Loaded models for provider:', {
          providerId: activeProviderId,
          count: models.length,
        });

        // Log all available model IDs for debugging provider config
        logger.info('Available models for provider:', {
          providerId: activeProviderId,
          models: models.map((m) => ({ value: m.value, label: m.label })),
          prefixedModelIds: prefixedModels.map((m) => m.value),
        });

        // Sync models with unified state store
        unifiedStateStore.setAvailableModels(this.availableModels);

        // Validate selected model is in the available list (using prefixed values)
        const availableModelValues = prefixedModels.map((m) => m.value);
        // Also check compound format for backwards compatibility
        const { providerId: selectedProviderId, modelId } = parseCompoundModelId(
          this.selectedModel,
        );
        const isModelAvailable =
          availableModelValues.includes(this.selectedModel) ||
          (selectedProviderId === activeProviderId &&
            availableModelValues.some((v) => v.endsWith(modelId)));

        if (!isModelAvailable && this.availableModels.length > 0) {
          // Try the preference list first, then fall back to first available as last resort
          const toModel =
            resolvePreferredModel(MODEL_DEFAULTS.UI_MODEL_PREFERENCE, availableModelValues) ??
            this.availableModels[0].value;
          logger.warn('Selected model not available for active provider, using preferred default', {
            selectedModel: this.selectedModel,
            activeProviderId,
            fallbackModel: toModel,
          });
          this.selectModel(toModel);
        }
      } else {
        // Models list was empty
        this.loadError = `No models available for ${activeProviderId}. Please try again.`;
        logger.warn('Model list was empty for provider:', { providerId: activeProviderId });
        this.scheduleAutoRetry(activeProviderId);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load models';
      this.loadError = errorMessage;
      logger.error('Failed to load models:', error);
      this.scheduleAutoRetry(activeProviderId);
    } finally {
      this.isLoadingModels = false;
      // Sync loading state with unified store
      unifiedStateStore.setModelsLoading(false);
    }
  }

  /**
   * Schedule an automatic retry with exponential backoff.
   * Only retries up to MAX_AUTO_RETRIES times.
   */
  private scheduleAutoRetry(forProviderId: string) {
    if (this.retryAttempt >= ModelStore.MAX_AUTO_RETRIES) {
      logger.warn('Max auto-retries reached for model loading', {
        attempts: this.retryAttempt,
        providerId: forProviderId,
      });
      return;
    }

    const delay = ModelStore.RETRY_DELAYS_MS[this.retryAttempt] ?? 30_000;
    this.retryAttempt++;

    logger.info(`Scheduling model load retry ${this.retryAttempt}/${ModelStore.MAX_AUTO_RETRIES} in ${delay / 1000}s`);

    // Clear any existing retry timeout
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
    }

    this.retryTimeoutId = setTimeout(() => {
      this.retryTimeoutId = null;
      // Only retry if still for the same provider and not yet loaded
      if (!this.modelsLoaded && activeProviderStore.activeProviderId === forProviderId) {
        logger.info(`Auto-retrying model load (attempt ${this.retryAttempt}/${ModelStore.MAX_AUTO_RETRIES})`);
        this.loadModels();
      }
    }, delay);
  }

  /**
   * Fetch models for a specific provider.
   * Maps provider ID to the appropriate model fetching function.
   * Normalizes aliases (e.g. 'acp' → 'auggie') via getProviderConfig().
   */
  private async fetchModelsForProvider(providerId: string): Promise<ProviderModel[]> {
    // Normalize provider aliases (e.g. 'acp', 'augment', 'default' → 'auggie')
    const normalizedId = getProviderConfig(providerId).id;
    switch (normalizedId) {
      case 'auggie':
        return getAuggieModels().catch((err) => {
          logger.warn('Failed to load Auggie models:', err);
          return [];
        });
      case 'claude-code':
        return getClaudeCodeModels().catch((err) => {
          logger.warn('Failed to load Claude Code models:', err);
          return [];
        });
      case 'codex':
        return getCodexModels().catch((err) => {
          logger.warn('Failed to load Codex models:', err);
          return [];
        });
      case 'cortex':
        return getCortexModels().catch((err) => {
          logger.warn('Failed to load Cortex models:', err);
          return [];
        });
      case 'opencode':
        return getOpencodeModels().catch((err) => {
          logger.warn('Failed to load OpenCode models:', err);
          return [];
        });
      default:
        logger.warn('Unknown provider ID, cannot fetch models:', { providerId, normalizedId });
        return [];
    }
  }

  /**
   * Reload models when the active provider changes.
   * Clears current models and loads from the new active provider.
   * Restores the user's last-selected model for the new provider if one was saved,
   * otherwise preserves the global selectedModel for loadModels() validation.
   */
  async reloadModelsForProvider() {
    const newProviderId = activeProviderStore.activeProviderId;
    logger.info('Reloading models for provider change', {
      previousProvider: this.loadedForProviderId,
      newProvider: newProviderId,
    });

    // Clear per-workspace overrides since old selections may be invalid for the new provider.
    this.workspaceModels = new Map();
    try {
      localStorage.removeItem(WORKSPACE_MODELS_KEY);
    } catch (error) {
      logger.warn('Failed to clear workspace model storage', error);
    }

    // Restore the user's last-selected model for this provider (if any).
    // This is set speculatively before loadModels() so that the validation
    // in loadModels() will keep it if it's still available, or fall back
    // to the preference list / first available model if not.
    const savedModel = this.providerModels.get(newProviderId);
    if (savedModel) {
      logger.info('Restoring saved model for provider', {
        providerId: newProviderId,
        savedModel,
      });
      this.selectedModel = savedModel;
      localStorage.setItem(GLOBAL_MODEL_KEY, savedModel);
      unifiedStateStore.selectModel(savedModel);
    }

    // Reset state to force reload
    this.modelsLoaded = false;
    this.loadedForProviderId = null;
    this.availableModels = [];
    this.loadError = null;

    await this.loadModels();
  }

  /**
   * Retry loading models (clears previous state and tries again)
   */
  async retryLoadModels() {
    logger.debug('Retrying model load...');
    // Reset state to allow retry
    this.modelsLoaded = false;
    this.loadError = null;
    this.retryAttempt = 0; // Reset auto-retry counter for manual retry
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
      this.retryTimeoutId = null;
    }
    await this.loadModels();
  }

  /**
   * Fetch and return models for a specific provider ID.
   * Unlike loadModels(), this does NOT update the store's availableModels state.
   * Used by ModelPicker when an agent's provider differs from the global active provider.
   */
  async getModelsForProvider(providerId: string): Promise<AuggieModel[]> {
    // Normalize provider aliases (e.g. 'acp' → 'auggie') so cache hits, fetching,
    // and model-ID prefixing all use the canonical provider ID.
    const normalizedId = getProviderConfig(providerId).id;

    // If the requested provider matches what's already loaded, return cached models
    if (this.modelsLoaded && this.loadedForProviderId === normalizedId) {
      return this.availableModels;
    }

    const models = await this.fetchModelsForProvider(normalizedId);
    if (models.length === 0) {
      return [];
    }

    // Apply the same prefixing logic as loadModels()
    const defaultProviderId = getDefaultProviderId();
    return models.map((model) => {
      if (normalizedId !== defaultProviderId) {
        return { ...model, value: `${normalizedId}:${model.value}` } as AuggieModel;
      }
      return model as AuggieModel;
    });
  }

  /**
   * Select a model globally (updates the current selection and persists it)
   */
  selectModel(model: string) {
    logger.debug('Selecting model:', { model, previousModel: this.selectedModel });
    this.selectedModel = model;

    // Sync with unified state store
    unifiedStateStore.selectModel(model);

    // Persist to localStorage
    localStorage.setItem(GLOBAL_MODEL_KEY, model);

    // Also remember this model for the current active provider
    // so switching away and back restores the user's choice
    const activeProviderId = activeProviderStore.activeProviderId;
    this.providerModels.set(activeProviderId, model);
    this.saveProviderModels();
    logger.debug('Saved model for provider:', { activeProviderId, model });
  }

  /**
   * Reset global and per-workspace model selections back to defaults.
   * Used when the active provider changes or is reset.
   */
  resetToDefaults() {
    logger.info('Resetting model selections to defaults');
    this.selectModel(MODEL_DEFAULTS.UI_INITIAL_MODEL);

    // Clear per-workspace overrides so new agents use the global default again.
    this.workspaceModels = new Map();
    try {
      localStorage.removeItem(WORKSPACE_MODELS_KEY);
    } catch (error) {
      logger.warn('Failed to clear workspace model storage', error);
    }
  }

  /**
   * @deprecated Use resetToDefaults() instead
   */
  resetToAuggieDefaults() {
    this.resetToDefaults();
  }

  /**
   * Set the default model for a specific workspace
   * This will be used when creating new agents in that workspace
   */
  setWorkspaceDefaultModel(workspaceId: string, model: string) {
    logger.debug('Setting workspace default model:', { workspaceId, model });
    this.workspaceModels.set(workspaceId, model);
    this.saveWorkspaceModels();
  }

  /**
   * Get the default model for a specific workspace
   * Falls back to the global selected model if no workspace-specific model is set
   */
  getWorkspaceDefaultModel(workspaceId: string): string {
    const workspaceModel = this.workspaceModels.get(workspaceId);
    if (workspaceModel) {
      logger.debug('Using workspace default model:', { workspaceId, model: workspaceModel });
      return workspaceModel;
    }
    logger.debug('No workspace default model, using global:', {
      workspaceId,
      model: this.selectedModel,
    });
    return this.selectedModel;
  }

  /**
   * Check if a workspace has a specific default model set
   */
  hasWorkspaceDefaultModel(workspaceId: string): boolean {
    return this.workspaceModels.has(workspaceId);
  }

  /**
   * Clear the default model for a workspace (will fall back to global)
   */
  clearWorkspaceDefaultModel(workspaceId: string) {
    logger.debug('Clearing workspace default model:', { workspaceId });
    this.workspaceModels.delete(workspaceId);
    this.saveWorkspaceModels();
  }

  /**
   * Get models grouped by provider.
   * In single-provider mode, returns a single group with the active provider's models.
   * Kept for backwards compatibility with components that expect grouped models.
   */
  getGroupedModels(): Array<{
    providerId: string;
    providerDisplayName: string;
    models: AuggieModel[];
  }> {
    const activeProviderId = activeProviderStore.activeProviderId;
    const providerConfig = ACP_PROVIDERS[activeProviderId];

    if (!providerConfig || this.availableModels.length === 0) {
      return [];
    }

    // Return single group with all models from active provider
    // No prefixing needed - models use simple IDs
    return [
      {
        providerId: providerConfig.id,
        providerDisplayName: providerConfig.displayName,
        models: this.availableModels,
      },
    ];
  }

  /**
   * Get the display label for a model value.
   * Handles both simple model IDs and compound IDs (for backwards compatibility).
   */
  getModelLabel(modelValue: string): string {
    if (!modelValue) return modelValue;

    // Parse compound ID for backwards compatibility with stored selections
    const { modelId } = parseCompoundModelId(modelValue);

    // Look up in available models using both the original value and parsed modelId
    const model = this.availableModels.find((m) => m.value === modelValue || m.value === modelId);

    return model?.label || modelValue;
  }

  getCurrentModelLabel(): string {
    return this.getModelLabel(this.selectedModel);
  }
}

// Create singleton instance
export const modelStore = new ModelStore();
