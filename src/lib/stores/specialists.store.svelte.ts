import { createLogger } from '$lib/utils/client-logger';
import { SPECIALISTS, type Specialist } from '$lib/constants/specialists';
import {
  getDefaultModelForProvider,
  getDefaultProviderId,
  PROVIDER_MODEL_TIERS,
} from '$shared/config/provider-config';
import { activeProviderStore } from './active-provider.store.svelte';
import { SPECIALISTS_CHANNELS } from '$shared/ipc/channels';

const logger = createLogger('SpecialistsStore');

// Storage key for electron-store
const SPECIALISTS_OVERRIDES_KEY = 'specialists-overrides';
const CUSTOM_SPECIALISTS_KEY = 'custom-specialists';
// localStorage key for per-provider model override cache
const PROVIDER_MODEL_OVERRIDES_KEY = 'specialists-model-overrides-per-provider';

export interface SpecialistOverrides {
  modelOverrides: Record<string, string>;
  behaviorPromptOverrides: Record<string, string>;
}

export interface CustomSpecialist {
  id: string;
  name: string;
  description: string;
  model: string;
  behaviorPrompt: string;
  /**
   * Optional short reminder of critical constraints.
   * If not provided, will be auto-generated from behaviorPrompt.
   */
  roleReminder?: string;
}

/**
 * File-based specialist stored in ~/.augment/specialists/
 */
export interface FileSpecialist {
  id: string;
  name: string;
  description: string;
  model: string;
  modelTier?: 'fast' | 'balanced' | 'smart';
  behaviorPrompt: string;
  roleReminder?: string;
  filePath: string;
  source: 'file';
}

class SpecialistsStore {
  // State - bundled specialists loaded from resources/specialists/
  private bundledSpecialists = $state<Specialist[]>([]);
  customSpecialists = $state<CustomSpecialist[]>([]);
  fileSpecialists = $state<FileSpecialist[]>([]);
  userOverrides = $state<SpecialistOverrides>({
    modelOverrides: {},
    behaviorPromptOverrides: {},
  });
  // Per-provider cache of model overrides (provider ID → model overrides map)
  private providerModelOverrides: Map<string, Record<string, string>> = new Map();
  // Track whether overrides have been loaded from electron-store
  overridesLoaded = $state(false);
  // Track whether custom specialists have been loaded from electron-store
  customSpecialistsLoaded = $state(false);
  // Track whether file-based specialists have been loaded
  fileSpecialistsLoaded = $state(false);
  // Track whether bundled specialists have been loaded
  bundledSpecialistsLoaded = $state(false);
  // Path to the specialists folder
  specialistsFolderPath = $state<string | null>(null);

  // Derived: all specialists with correct priority
  // Priority: file-based > bundled > electron-store custom > hardcoded SPECIALISTS (last resort)
  // Deduplicate by ID to prevent Svelte each_key_duplicate errors
  specialists = $derived.by<Specialist[]>(() => {
    const seen = new Set<string>();
    const result: Specialist[] = [];

    // File-based specialists first (highest priority)
    for (const file of this.fileSpecialists) {
      if (!seen.has(file.id)) {
        seen.add(file.id);
        // Default to 'balanced' tier when neither model nor modelTier is set,
        // so file specialists don't fall through to DEFAULT_AGENT_MODEL (gpt5.4).
        const effectiveTier = file.modelTier || (!file.model ? 'balanced' : undefined);
        result.push({
          id: file.id,
          name: file.name,
          description: file.description,
          defaultModel: file.model || undefined,
          defaultModelTier: effectiveTier,
          defaultBehaviorPrompt: file.behaviorPrompt,
          roleReminder: file.roleReminder,
        });
      }
    }

    // Bundled specialists (skip if overridden by file)
    for (const specialist of this.bundledSpecialists) {
      if (!seen.has(specialist.id)) {
        seen.add(specialist.id);
        result.push(specialist);
      }
    }

    // Electron-store custom specialists (skip if ID conflicts)
    for (const custom of this.customSpecialists) {
      if (!seen.has(custom.id)) {
        seen.add(custom.id);
        result.push({
          id: custom.id,
          name: custom.name,
          description: custom.description,
          defaultModel: custom.model,
          defaultModelTier: undefined,
          defaultBehaviorPrompt: custom.behaviorPrompt,
          roleReminder: custom.roleReminder,
        });
      } else {
        logger.warn('Skipping duplicate specialist ID:', { id: custom.id });
      }
    }

    // Last resort fallback: hardcoded SPECIALISTS if file/bundled loading failed
    // This ensures the UI always has specialists even if IPC or file loading breaks
    for (const specialist of SPECIALISTS) {
      if (!seen.has(specialist.id)) {
        seen.add(specialist.id);
        result.push(specialist);
      }
    }

    if (
      result.length > 0 &&
      this.fileSpecialists.length === 0 &&
      this.bundledSpecialists.length === 0
    ) {
      logger.warn('Using hardcoded SPECIALISTS fallback - file/bundled loading may have failed');
    }

    return result;
  });

  constructor() {
    // Load from all sources on initialization
    this.loadBundledSpecialists();
    this.loadOverrides();
    this.loadCustomSpecialists();
    this.loadFileSpecialists();
    this.loadFolderPath();

    // Load per-provider model overrides cache (inline to avoid Svelte rune compilation issues)
    try {
      const stored = localStorage.getItem(PROVIDER_MODEL_OVERRIDES_KEY);
      if (stored) {
        const parsed: Record<string, Record<string, string>> = JSON.parse(stored);
        this.providerModelOverrides = new Map(Object.entries(parsed));
        logger.debug('Loaded per-provider model overrides cache', {
          providers: [...this.providerModelOverrides.keys()],
        });
      }
    } catch (error) {
      logger.error('Failed to load per-provider model overrides cache:', error);
    }
  }

  /**
   * Load bundled specialists from the backend (resources/specialists/)
   */
  private async loadBundledSpecialists() {
    logger.info('[SpecialistsStore] loadBundledSpecialists starting');
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        const result = await window.electronAPI.invoke(SPECIALISTS_CHANNELS.LIST_BUNDLED, {});
        if (result?.success && result.data?.specialists) {
          // Convert from SpecialistFile to Specialist format
          // Note: SpecialistFile has nested frontmatter structure
          this.bundledSpecialists = result.data.specialists.map(
            (spec: {
              id: string;
              frontmatter: {
                name: string;
                description: string;
                model?: string;
                modelTier?: 'fast' | 'balanced' | 'smart';
                roleReminder?: string;
              };
              behaviorPrompt: string;
              filePath: string;
            }) => ({
              id: spec.id,
              name: spec.frontmatter.name,
              description: spec.frontmatter.description,
              defaultModel: spec.frontmatter.model || '',
              defaultModelTier: spec.frontmatter.modelTier,
              defaultBehaviorPrompt: spec.behaviorPrompt,
              roleReminder: spec.frontmatter.roleReminder,
              source: 'bundled' as const,
              filePath: spec.filePath,
            }),
          );
          logger.info('[SpecialistsStore] Loaded bundled specialists', {
            count: this.bundledSpecialists.length,
            ids: this.bundledSpecialists.map((s) => s.id),
          });
        }
      }
    } catch (error) {
      logger.error('[SpecialistsStore] Failed to load bundled specialists', { error });
    } finally {
      this.bundledSpecialistsLoaded = true;
    }
  }

  private async loadOverrides() {
    logger.info('[SpecialistsStore] loadOverrides starting', {
      hasWindow: typeof window !== 'undefined',
      hasElectronAPI: typeof window !== 'undefined' && !!window.electronAPI,
    });
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        const result = await window.electronAPI.invoke('settings:get', {
          key: SPECIALISTS_OVERRIDES_KEY,
        });
        logger.info('[SpecialistsStore] loadOverrides result', {
          hasResult: !!result,
          success: result?.success,
          hasData: !!result?.data,
          dataKeys: result?.data ? Object.keys(result.data) : [],
        });
        if (result?.success && result.data) {
          this.userOverrides = result.data;
          logger.info('[SpecialistsStore] Loaded specialist overrides from electron-store', {
            modelOverrides: Object.keys(result.data.modelOverrides || {}),
            hasSpecWriterOverride: !!result.data.modelOverrides?.['spec-writer'],
            specWriterModel: result.data.modelOverrides?.['spec-writer'],
          });
        } else {
          logger.info('[SpecialistsStore] No overrides data found in electron-store');
        }
      } else {
        logger.warn('[SpecialistsStore] window.electronAPI not available');
      }
    } catch (error) {
      logger.error('[SpecialistsStore] Failed to load specialist overrides:', error);
    } finally {
      logger.info('[SpecialistsStore] loadOverrides finished, setting overridesLoaded=true');
      this.overridesLoaded = true;
    }
  }

  private async loadCustomSpecialists() {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        const result = await window.electronAPI.invoke('settings:get', {
          key: CUSTOM_SPECIALISTS_KEY,
        });
        if (result?.success && result.data) {
          this.customSpecialists = result.data;
          logger.debug('Loaded custom specialists from electron-store');
        }
      }
    } catch (error) {
      logger.error('Failed to load custom specialists:', error);
    } finally {
      this.customSpecialistsLoaded = true;
    }
  }

  /**
   * Load file-based specialists from ~/.augment/specialists/
   */
  async loadFileSpecialists() {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        const result = await window.electronAPI.invoke(SPECIALISTS_CHANNELS.LIST_FILES, {});
        if (result?.success && result.data) {
          const { specialists, errors } = result.data;
          // Note: SpecialistFile has nested frontmatter structure and behaviorPrompt (not content)
          this.fileSpecialists = specialists.map(
            (s: {
              id: string;
              frontmatter: {
                name: string;
                description: string;
                model?: string;
                modelTier?: 'fast' | 'balanced' | 'smart';
                roleReminder?: string;
              };
              behaviorPrompt: string;
              filePath: string;
            }) => ({
              id: s.id,
              name: s.frontmatter.name,
              description: s.frontmatter.description,
              model: s.frontmatter.model || '',
              modelTier: s.frontmatter.modelTier,
              behaviorPrompt: s.behaviorPrompt,
              roleReminder: s.frontmatter.roleReminder,
              filePath: s.filePath,
              source: 'file' as const,
            }),
          );
          if (errors.length > 0) {
            logger.warn('Errors loading specialist files:', { errors });
          }
          logger.debug('Loaded file-based specialists', { count: specialists.length });
        }
      }
    } catch (error) {
      logger.error('Failed to load file-based specialists:', error);
    } finally {
      this.fileSpecialistsLoaded = true;
    }
  }

  /**
   * Load the specialists folder path
   */
  private async loadFolderPath() {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        const result = await window.electronAPI.invoke(SPECIALISTS_CHANNELS.GET_FOLDER_PATH, {});
        if (result?.success && result.data) {
          this.specialistsFolderPath = result.data;
        }
      }
    } catch (error) {
      logger.error('Failed to get specialists folder path:', error);
    }
  }

  /**
   * Open the specialists folder in the file explorer
   */
  async openSpecialistsFolder(): Promise<boolean> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        const result = await window.electronAPI.invoke(SPECIALISTS_CHANNELS.OPEN_FOLDER, {});
        return result?.success ?? false;
      }
    } catch (error) {
      logger.error('Failed to open specialists folder:', error);
    }
    return false;
  }

  /**
   * Export a built-in specialist to a file for customization
   */
  async exportBuiltinToFile(specialistId: string): Promise<boolean> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        const result = await window.electronAPI.invoke(SPECIALISTS_CHANNELS.EXPORT_BUILTIN, {
          id: specialistId,
        });
        if (result?.success) {
          // Reload file specialists to pick up the new file
          await this.loadFileSpecialists();
          return true;
        }
        if (result?.error) {
          logger.warn('Failed to export specialist:', { error: result.error });
        }
      }
    } catch (error) {
      logger.error('Failed to export specialist to file:', error);
    }
    return false;
  }

  /**
   * Save a file-based specialist
   */
  async saveFileSpecialist(specialist: {
    id: string;
    name: string;
    description: string;
    model?: string;
    modelTier?: 'fast' | 'balanced' | 'smart';
    roleReminder?: string;
    behaviorPrompt: string;
  }): Promise<boolean> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        const result = await window.electronAPI.invoke(SPECIALISTS_CHANNELS.WRITE_FILE, specialist);
        if (result?.success) {
          // Reload file specialists
          await this.loadFileSpecialists();
          return true;
        }
        if (result?.error) {
          logger.warn('Failed to save specialist file:', { error: result.error });
        }
      }
    } catch (error) {
      logger.error('Failed to save specialist file:', error);
    }
    return false;
  }

  /**
   * Delete a file-based specialist
   */
  async deleteFileSpecialist(specialistId: string): Promise<boolean> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        const result = await window.electronAPI.invoke(SPECIALISTS_CHANNELS.DELETE_FILE, {
          id: specialistId,
        });
        if (result?.success) {
          // Reload file specialists
          await this.loadFileSpecialists();
          return true;
        }
        if (result?.error) {
          logger.warn('Failed to delete specialist file:', { error: result.error });
        }
      }
    } catch (error) {
      logger.error('Failed to delete specialist file:', error);
    }
    return false;
  }

  /**
   * Check if a specialist is file-based
   */
  isFileBased(specialistId: string): boolean {
    return this.fileSpecialists.some((s) => s.id === specialistId);
  }

  /**
   * Get a file-based specialist by ID
   */
  getFileSpecialist(specialistId: string): FileSpecialist | undefined {
    return this.fileSpecialists.find((s) => s.id === specialistId);
  }

  /**
   * Get the on-disk file path for a specialist (file-based or bundled).
   * Returns undefined for custom (electron-store) specialists which have no file.
   */
  getSpecialistFilePath(specialistId: string): string | undefined {
    // Check file-based specialists first
    const file = this.fileSpecialists.find((s) => s.id === specialistId);
    if (file) return file.filePath;

    // Check bundled specialists (filePath is set during loading but not in the Specialist type)
    const bundled = this.bundledSpecialists.find((s) => s.id === specialistId);
    if (bundled && 'filePath' in bundled) return (bundled as Specialist & { filePath: string }).filePath;

    return undefined;
  }

  private async saveOverrides() {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        const plainOverrides: SpecialistOverrides = {
          modelOverrides: { ...this.userOverrides.modelOverrides },
          behaviorPromptOverrides: { ...this.userOverrides.behaviorPromptOverrides },
        };
        await window.electronAPI.invoke('settings:set', {
          key: SPECIALISTS_OVERRIDES_KEY,
          value: plainOverrides,
        });
        logger.debug('Saved specialist overrides to electron-store');
      }
    } catch (error) {
      logger.error('Failed to save specialist overrides:', error);
    }
  }

  private async saveCustomSpecialists() {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        const plainCustom = this.customSpecialists.map((s) => ({ ...s }));
        await window.electronAPI.invoke('settings:set', {
          key: CUSTOM_SPECIALISTS_KEY,
          value: plainCustom,
        });
        logger.debug('Saved custom specialists to electron-store');
      }
    } catch (error) {
      logger.error('Failed to save custom specialists:', error);
    }
  }

  /**
   * Check if a bundled specialist exists with this ID.
   * Note: This checks if a bundled version exists, not whether the bundled version
   * is currently in use. A file-based specialist may override the bundled one.
   * To check if a specialist is currently customized via files, use isFileBased().
   */
  isBuiltIn(specialistId: string): boolean {
    return this.bundledSpecialists.some((s) => s.id === specialistId);
  }

  /**
   * Get a custom specialist by ID
   */
  getCustomSpecialist(specialistId: string): CustomSpecialist | undefined {
    return this.customSpecialists.find((s) => s.id === specialistId);
  }

  /**
   * Create a new custom specialist
   */
  createCustomSpecialist(specialist: Omit<CustomSpecialist, 'id'>): CustomSpecialist {
    const id = `custom-${Date.now()}`;
    const newSpecialist: CustomSpecialist = { id, ...specialist };
    this.customSpecialists = [...this.customSpecialists, newSpecialist];
    this.saveCustomSpecialists();
    logger.debug('Created custom specialist:', { id });
    return newSpecialist;
  }

  /**
   * Update a custom specialist
   */
  updateCustomSpecialist(specialistId: string, updates: Partial<Omit<CustomSpecialist, 'id'>>) {
    const index = this.customSpecialists.findIndex((s) => s.id === specialistId);
    if (index === -1) {
      logger.warn('Cannot update non-existent custom specialist:', { specialistId });
      return;
    }
    this.customSpecialists[index] = { ...this.customSpecialists[index], ...updates };
    this.customSpecialists = [...this.customSpecialists];
    this.saveCustomSpecialists();
    logger.debug('Updated custom specialist:', { specialistId });
  }

  /**
   * Delete a custom specialist
   */
  deleteCustomSpecialist(specialistId: string) {
    this.customSpecialists = this.customSpecialists.filter((s) => s.id !== specialistId);
    this.saveCustomSpecialists();
    logger.debug('Deleted custom specialist:', { specialistId });
  }

  /**
   * Get the effective model for a specialist (override or default).
   * Resolves the model tier to an actual model ID based on the active provider.
   */
  getEffectiveModel(specialistId: string): string {
    const specialist = this.specialists.find((s) => s.id === specialistId);
    if (!specialist) {
      logger.info('[SpecialistsStore] getEffectiveModel - specialist not found', { specialistId });
      return '';
    }

    // Check for user override first
    const override = this.userOverrides.modelOverrides[specialistId];
    if (override) {
      logger.info('[SpecialistsStore] getEffectiveModel - using override', {
        specialistId,
        override,
      });
      return override;
    }

    // Resolve the model tier to an actual model ID for the active provider.
    // Only resolve when the provider has a known tier mapping — providers with
    // dynamic model lists (e.g. opencode) don't have mappings, so we skip tier
    // resolution and return empty to let callers use their own fallback.
    if (specialist.defaultModelTier) {
      const providerId = activeProviderStore.activeProviderId;
      if (providerId in PROVIDER_MODEL_TIERS) {
        const baseModel = getDefaultModelForProvider(providerId, specialist.defaultModelTier);
        // Prefix with provider ID for non-default providers (matches model store behavior)
        const defaultProviderId = getDefaultProviderId();
        const resolvedModel =
          providerId !== defaultProviderId ? `${providerId}:${baseModel}` : baseModel;
        logger.info('[SpecialistsStore] getEffectiveModel - resolved tier', {
          specialistId,
          tier: specialist.defaultModelTier,
          providerId,
          resolvedModel,
        });
        return resolvedModel;
      }
      // Provider has no tier mapping (dynamic models) — fall through to defaultModel / empty
      logger.info('[SpecialistsStore] getEffectiveModel - provider has no tier mapping, skipping', {
        specialistId,
        providerId,
      });
    }

    // Fallback to hardcoded defaultModel (for backwards compat with custom specialists)
    const effectiveModel = specialist.defaultModel ?? '';

    logger.info('[SpecialistsStore] getEffectiveModel', {
      specialistId,
      overridesLoaded: this.overridesLoaded,
      defaultModel: specialist.defaultModel,
      effectiveModel,
      allModelOverrides: Object.keys(this.userOverrides.modelOverrides),
    });

    return effectiveModel;
  }

  /**
   * Get the resolved default model for a specialist (ignoring user overrides).
   * This resolves the model tier to an actual model ID for the active provider.
   * Used to determine if a user's selection differs from the default.
   */
  getResolvedDefaultModel(specialistId: string): string {
    const specialist = this.specialists.find((s) => s.id === specialistId);
    if (!specialist) return '';

    // Resolve the model tier to an actual model ID for the active provider.
    // Skip for providers without tier mappings (dynamic model lists).
    if (specialist.defaultModelTier) {
      const providerId = activeProviderStore.activeProviderId;
      if (providerId in PROVIDER_MODEL_TIERS) {
        const baseModel = getDefaultModelForProvider(providerId, specialist.defaultModelTier);
        // Prefix with provider ID for non-default providers (matches model store behavior)
        const defaultProviderId = getDefaultProviderId();
        return providerId !== defaultProviderId ? `${providerId}:${baseModel}` : baseModel;
      }
    }

    // Fallback to hardcoded defaultModel (for custom specialists)
    return specialist.defaultModel ?? '';
  }

  /**
   * Get the effective behavior prompt for a specialist (override or default)
   */
  getEffectiveBehaviorPrompt(specialistId: string): string {
    const specialist = this.specialists.find((s) => s.id === specialistId);
    if (!specialist) return '';

    const override = this.userOverrides.behaviorPromptOverrides[specialistId];
    return override || specialist.defaultBehaviorPrompt;
  }

  /**
   * Set a model override for a specialist
   */
  setModelOverride(specialistId: string, model: string) {
    logger.debug('Setting model override:', { specialistId, model });
    this.userOverrides.modelOverrides[specialistId] = model;
    this.saveOverrides();
  }

  /**
   * Clear a model override for a specialist
   */
  clearModelOverride(specialistId: string) {
    logger.debug('Clearing model override:', { specialistId });
    delete this.userOverrides.modelOverrides[specialistId];
    this.saveOverrides();
  }

  /**
   * Set a behavior prompt override for a specialist
   */
  setBehaviorPromptOverride(specialistId: string, prompt: string) {
    logger.debug('Setting behavior prompt override:', { specialistId });
    this.userOverrides.behaviorPromptOverrides[specialistId] = prompt;
    this.saveOverrides();
  }

  /**
   * Clear a behavior prompt override for a specialist
   */
  clearBehaviorPromptOverride(specialistId: string) {
    logger.debug('Clearing behavior prompt override:', { specialistId });
    delete this.userOverrides.behaviorPromptOverrides[specialistId];
    this.saveOverrides();
  }

  /**
   * Check if a specialist has any overrides
   */
  hasOverrides(specialistId: string): boolean {
    return (
      !!this.userOverrides.modelOverrides[specialistId] ||
      !!this.userOverrides.behaviorPromptOverrides[specialistId]
    );
  }

  /**
   * Get specialist info by ID from any source (file-based, built-in, or custom)
   * This is the unified lookup that should be used by UI components
   */
  getSpecialistById(specialistId: string): {
    id: string;
    name: string;
    description: string;
    source: 'file' | 'builtin' | 'custom';
  } | null {
    // First check file-based specialists (highest priority)
    const file = this.fileSpecialists.find((s) => s.id === specialistId);
    if (file) {
      return { id: file.id, name: file.name, description: file.description, source: 'file' };
    }

    // Then check bundled specialists
    const bundled = this.bundledSpecialists.find((s) => s.id === specialistId);
    if (bundled) {
      return {
        id: bundled.id,
        name: bundled.name,
        description: bundled.description,
        source: 'builtin',
      };
    }

    // Finally check electron-store custom specialists
    const custom = this.customSpecialists.find((s) => s.id === specialistId);
    if (custom) {
      return {
        id: custom.id,
        name: custom.name,
        description: custom.description,
        source: 'custom',
      };
    }

    return null;
  }

  /**
   * Get specialist display name by ID (convenience method for UI)
   * Returns the name if found, or null if not found
   */
  getSpecialistName(specialistId: string): string | null {
    const specialist = this.getSpecialistById(specialistId);
    return specialist?.name ?? null;
  }

  /**
   * Clear all overrides for a specialist
   */
  clearAllOverrides(specialistId: string) {
    logger.debug('Clearing all overrides:', { specialistId });
    delete this.userOverrides.modelOverrides[specialistId];
    delete this.userOverrides.behaviorPromptOverrides[specialistId];
    this.saveOverrides();
  }

  /**
   * Reset all overrides for all specialists (used by settings reset)
   */
  resetAllOverrides() {
    logger.debug('Resetting all specialist overrides');
    this.userOverrides = {
      modelOverrides: {},
      behaviorPromptOverrides: {},
    };
    this.saveOverrides();
  }

  /**
   * Reset model overrides when switching providers (legacy — kept for backward compat).
   * Prefer switchModelOverridesForProvider() which saves before wiping.
   */
  resetModelOverridesForProvider(providerId: string) {
    logger.info('Resetting specialist model overrides for provider:', { providerId });
    this.userOverrides.modelOverrides = {};
    this.saveOverrides();
  }

  /**
   * Switch model overrides when changing providers.
   * Saves the current model overrides under the previous provider, then restores
   * saved overrides for the new provider (or clears to {} if none were saved).
   */
  switchModelOverridesForProvider(newProviderId: string, previousProviderId: string) {
    logger.info('Switching specialist model overrides for provider:', {
      from: previousProviderId,
      to: newProviderId,
    });

    // Save current model overrides for the outgoing provider
    const currentOverrides = { ...this.userOverrides.modelOverrides };
    if (Object.keys(currentOverrides).length > 0) {
      this.providerModelOverrides.set(previousProviderId, currentOverrides);
    } else {
      // Explicitly store empty so we distinguish "user cleared all" from "never set"
      this.providerModelOverrides.set(previousProviderId, {});
    }
    this.saveProviderModelOverrides();

    // Restore saved overrides for the incoming provider, or clear
    const saved = this.providerModelOverrides.get(newProviderId);
    if (saved && Object.keys(saved).length > 0) {
      logger.info('Restoring specialist model overrides for provider:', {
        providerId: newProviderId,
        overrideKeys: Object.keys(saved),
      });
      this.userOverrides.modelOverrides = { ...saved };
    } else {
      this.userOverrides.modelOverrides = {};
    }
    this.saveOverrides();
  }

  /**
   * Save per-provider model overrides cache to localStorage.
   */
  private saveProviderModelOverrides() {
    try {
      const obj = Object.fromEntries(this.providerModelOverrides);
      localStorage.setItem(PROVIDER_MODEL_OVERRIDES_KEY, JSON.stringify(obj));
    } catch (error) {
      logger.error('Failed to save per-provider model overrides cache:', error);
    }
  }
}

// Create singleton instance
export const specialistsStore = new SpecialistsStore();
