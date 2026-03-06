/**
 * Specialists Service (BACKEND ONLY)
 *
 * Provides access to specialist configurations for the InstructionService.
 * Reads specialists from (in priority order):
 * 1. User file-based specialists (~/.augment/specialists/*.md) - highest priority
 * 2. Bundled specialists (resources/specialists/*.md)
 * 3. Custom specialists from electron-store (deprecated, migrated to files)
 * 4. Hardcoded SPECIALISTS array (last-resort fallback if file loading fails)
 *
 * IMPORTANT: initSpecialistsService() MUST be awaited during app startup before
 * any workspace creation occurs. This ensures the settings store is ready when
 * getEffectiveSpecialist() is called.
 */

import { Logger } from '$shared/logger';
import type { Specialist } from '$lib/constants/specialists';
import { SPECIALISTS, getSpecialistById } from '$lib/constants/specialists';
import {
  getDefaultModelForProvider,
  getDefaultProviderId,
  getModelTierFromModel,
  PROVIDER_MODEL_TIERS,
  type ModelTier,
} from '$shared/config/provider-config';
import {
  loadSpecialistFiles,
  loadBundledSpecialistFiles,
  migrateCustomSpecialistsFromStore,
  migrateOverridesFromStore,
} from '../../specialists/main/specialist-file-loader';
import type { SpecialistFile } from '../../../shared/specialist-file-types';
import { featureCodesService } from '../../feature-codes/main/feature-codes.service';

const logger = new Logger('SpecialistsService');

// Storage keys - must match frontend store
const CUSTOM_SPECIALISTS_KEY = 'custom-specialists';
const SPECIALISTS_OVERRIDES_KEY = 'specialists-overrides';

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

export interface EffectiveSpecialist {
  id: string;
  name: string;
  description: string;
  model: string;
  /**
   * The capability tier for this specialist's model.
   * When present, consumers should resolve the model from this tier for their
   * active provider, rather than using the pre-resolved `model` field directly.
   * This ensures the model is always valid for the active provider.
   */
  modelTier?: ModelTier;
  behaviorPrompt: string;
  isCustomized: boolean;
  /**
   * Short reminder of critical constraints for this specialist.
   * May be explicit (from config) or auto-generated from behaviorPrompt.
   */
  roleReminder?: string;
}

// ElectronStore instance for reading custom specialists (deprecated, migrated to files)
// Using interface to avoid coupling to electron-store module at type level
interface SettingsStoreInterface {
  get(key: string): unknown;
}
let settingsStore: SettingsStoreInterface | null = null;
let initPromise: Promise<void> | null = null;

// Cache for file-based specialists (refreshed on demand)
// This includes both bundled specialists and user file-based specialists
let fileSpecialistsCache: SpecialistFile[] = [];
let fileSpecialistsCacheTime = 0;
const FILE_CACHE_TTL_MS = 5000; // 5 second cache for file-based specialists

// In-flight promise to prevent concurrent cache refreshes (race condition fix)
let refreshInFlight: Promise<void> | null = null;

/**
 * Initialize the settings store (call once during app startup)
 * This MUST be awaited before getEffectiveSpecialist is called.
 */
export async function initSpecialistsService(): Promise<void> {
  if (settingsStore) {
    return; // Already initialized
  }
  if (initPromise) {
    return initPromise;
  }
  initPromise = (async () => {
    try {
      const ElectronStore = (await import('electron-store')).default;
      settingsStore = new ElectronStore({ name: 'settings' });
      logger.info('Specialists service initialized with electron-store');

      // Migrate any custom specialists from electron-store to file-based system
      const migrationResult = await migrateCustomSpecialistsFromStore();
      if (migrationResult.migrated > 0) {
        logger.info(`Migrated ${migrationResult.migrated} custom specialists to file-based system`);
      }

      // Migrate any user overrides from electron-store to file-based system
      const overridesResult = await migrateOverridesFromStore();
      if (overridesResult.migrated > 0) {
        logger.info(
          `Migrated overrides for ${overridesResult.migrated} specialists to file-based system`,
        );
      }

      // Pre-load file-based specialists (includes bundled + user files)
      await refreshFileSpecialistsCache();
    } catch (error) {
      logger.error('Failed to initialize specialists service', error as Error);
    }
  })();
  return initPromise;
}

/**
 * Refresh the cache of file-based specialists
 * Loads both bundled specialists and user file-based specialists.
 * User file-based specialists override bundled specialists with the same ID.
 */
async function refreshFileSpecialistsCache(): Promise<void> {
  try {
    // Load bundled specialists first (from resources/specialists/)
    const bundledResult = await loadBundledSpecialistFiles();

    // Load user file-based specialists (from ~/.augment/specialists/)
    const userResult = await loadSpecialistFiles();

    // Merge with user files taking priority over bundled
    const specialistsById = new Map<string, SpecialistFile>();

    // Add bundled specialists first
    for (const specialist of bundledResult.specialists) {
      specialistsById.set(specialist.id, specialist);
    }

    // User specialists override bundled ones with the same ID
    for (const specialist of userResult.specialists) {
      specialistsById.set(specialist.id, specialist);
    }

    fileSpecialistsCache = Array.from(specialistsById.values());
    fileSpecialistsCacheTime = Date.now();

    const allErrors = [...bundledResult.errors, ...userResult.errors];
    if (allErrors.length > 0) {
      logger.warn(`Errors loading specialist files: ${allErrors.map((e) => e.error).join(', ')}`);
    }

    logger.info(
      `Loaded specialists: ${bundledResult.specialists.length} bundled, ${userResult.specialists.length} user files, ${fileSpecialistsCache.length} total`,
    );
  } catch (error) {
    logger.error('Failed to refresh file specialists cache', error as Error);
  }
}

/**
 * Get file-based specialists (with caching)
 * Uses in-flight promise tracking to prevent concurrent cache refreshes.
 */
async function getFileSpecialists(): Promise<SpecialistFile[]> {
  const now = Date.now();
  if (now - fileSpecialistsCacheTime > FILE_CACHE_TTL_MS) {
    // Prevent concurrent cache refreshes by reusing in-flight promise
    if (!refreshInFlight) {
      refreshInFlight = refreshFileSpecialistsCache().finally(() => {
        refreshInFlight = null;
      });
    }
    await refreshInFlight;
  }
  return fileSpecialistsCache;
}

/**
 * Find a file-based specialist by ID (synchronous, uses cache)
 */
function findFileSpecialistSync(specialistId: string): SpecialistFile | undefined {
  return fileSpecialistsCache.find((s) => s.id === specialistId);
}

/**
 * Force refresh the file specialists cache.
 * Useful when files have been modified externally.
 */
export async function refreshSpecialistsFromFiles(): Promise<void> {
  await refreshFileSpecialistsCache();
}

/**
 * Check if the store is initialized.
 * Logs a warning if not - this indicates initSpecialistsService() wasn't awaited during startup.
 */
function checkStoreInitialized(): boolean {
  if (!settingsStore) {
    logger.warn(
      'Settings store not initialized when reading specialist config. ' +
        'Ensure initSpecialistsService() is awaited during app startup before workspace creation.',
    );
    return false;
  }
  return true;
}

/**
 * Get custom specialists from electron-store
 */
function getCustomSpecialists(): CustomSpecialist[] {
  // Check store is initialized - if not, we can't read custom specialists
  if (!checkStoreInitialized() || !settingsStore) {
    return [];
  }

  try {
    const custom = settingsStore.get(CUSTOM_SPECIALISTS_KEY);
    if (Array.isArray(custom)) {
      return custom as CustomSpecialist[];
    }
  } catch (error) {
    logger.error('Failed to read custom specialists', error as Error);
  }

  return [];
}

/**
 * Get user overrides for a specialist from electron-store settings.
 * These overrides are set by the frontend UI and stored in electron-store
 * under the 'specialists-overrides' key.
 */
function getUserOverrides(specialistId: string): {
  model?: string;
  behaviorPrompt?: string;
} {
  if (!settingsStore) return {};
  try {
    const overrides = settingsStore.get(SPECIALISTS_OVERRIDES_KEY) as
      | {
          modelOverrides?: Record<string, string>;
          behaviorPromptOverrides?: Record<string, string>;
        }
      | undefined;
    return {
      model: overrides?.modelOverrides?.[specialistId] || undefined,
      behaviorPrompt: overrides?.behaviorPromptOverrides?.[specialistId] || undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Apply user overrides from electron-store settings if they exist.
 * User overrides take highest priority — they represent explicit user choices
 * from the specialist settings UI.
 * When a model override is applied, modelTier is cleared to prevent downstream
 * re-resolution via tier-based logic (e.g., in resolveModelForProvider).
 */
function applyUserOverrides(specialist: EffectiveSpecialist): EffectiveSpecialist {
  const overrides = getUserOverrides(specialist.id);
  let result = specialist;

  if (overrides.model) {
    logger.info('Applying user model override from settings', {
      specialistId: specialist.id,
      originalModel: specialist.model,
      overrideModel: overrides.model,
    });
    result = {
      ...result,
      model: overrides.model,
      modelTier: undefined, // Don't re-resolve via tier when user explicitly set a model
    };
  }

  if (overrides.behaviorPrompt) {
    logger.info('Applying user behavior prompt override from settings', {
      specialistId: specialist.id,
      originalPromptLength: specialist.behaviorPrompt?.length || 0,
      overridePromptLength: overrides.behaviorPrompt.length,
    });
    result = {
      ...result,
      behaviorPrompt: overrides.behaviorPrompt,
      isCustomized: true,
    };
  }

  return result;
}

/**
 * Get the effective configuration for a specialist (with user overrides applied)
 * Priority order:
 * 1. User overrides from settings UI (specialists-overrides: model + behaviorPrompt) - highest priority
 * 2. User file-based specialists (~/.augment/specialists/*.md)
 * 3. Bundled specialists (resources/specialists/*.md)
 * 4. Custom specialists from electron-store (deprecated, migrated to files)
 *
 * Note: Bundled specialists are included in the file cache alongside user files.
 *
 * @param specialistId - The specialist ID to look up
 * @param providerId - Optional provider ID for resolving model tiers. Defaults to default provider.
 */
export function getEffectiveSpecialist(
  specialistId: string,
  providerId?: string,
): EffectiveSpecialist | null {
  // File-based specialists include both user and bundled specialists
  // User files take priority over bundled (handled by the cache refresh logic)
  const fileSpecialist = findFileSpecialistSync(specialistId);
  if (fileSpecialist) {
    const hasExplicitModel = !!fileSpecialist.frontmatter.model;
    const hasExplicitTier = !!fileSpecialist.frontmatter.modelTier;
    let resolvedModel = fileSpecialist.frontmatter.model || '';

    // Determine the effective tier for downstream re-resolution.
    // Priority: explicit modelTier > reverse-mapped from explicit model > 'balanced' default
    const tier: ModelTier | undefined =
      fileSpecialist.frontmatter.modelTier ||
      (resolvedModel ? getModelTierFromModel(resolvedModel) : undefined) ||
      'balanced';

    // Only override the model via tier-based resolution when:
    // 1. The specialist has an explicit modelTier (user wants provider-aware resolution), OR
    // 2. The specialist has NO explicit model (need a default — without this, empty string
    //    cascades to DEFAULT_AGENT_MODEL gpt5.4)
    // When the user explicitly set `model` without `modelTier`, respect their choice.
    if (hasExplicitTier || !hasExplicitModel) {
      if (tier) {
        const effectiveProviderId = providerId || getDefaultProviderId();
        // Only resolve tiers for providers with known tier mappings.
        // Providers with dynamic model lists (e.g. opencode) would produce
        // invalid model IDs — leave resolvedModel empty so downstream
        // consumers can resolve via the specialist's modelTier field.
        if (effectiveProviderId in PROVIDER_MODEL_TIERS) {
          resolvedModel = getDefaultModelForProvider(effectiveProviderId, tier);
        }
      }
    }

    return applyUserOverrides({
      id: fileSpecialist.id,
      name: fileSpecialist.frontmatter.name,
      description: fileSpecialist.frontmatter.description,
      model: resolvedModel,
      // Only propagate modelTier when it should drive downstream resolution:
      // - explicit modelTier from frontmatter, OR
      // - no explicit model (tier was used to provide a default).
      // When the user set an explicit model without modelTier, leave modelTier undefined
      // so downstream consumers (workspace.service.ts, agent-interaction-tools.ts) use
      // the explicit model directly instead of overriding it via tier-based resolution.
      modelTier: hasExplicitTier || !hasExplicitModel ? tier : undefined,
      behaviorPrompt: fileSpecialist.behaviorPrompt,
      isCustomized: fileSpecialist.source === 'file', // Only user files are considered customized
      roleReminder: fileSpecialist.frontmatter.roleReminder,
    });
  }

  // Legacy: check custom specialists from electron-store
  // These should have been migrated to files, but keeping for backward compatibility
  const customSpecialists = getCustomSpecialists();
  const custom = customSpecialists.find((s) => s.id === specialistId);
  if (custom) {
    // Try to determine tier from the legacy custom specialist's model
    const customTier = custom.model ? getModelTierFromModel(custom.model) : 'balanced';
    return applyUserOverrides({
      id: custom.id,
      name: custom.name,
      description: custom.description,
      model: custom.model,
      modelTier: customTier,
      behaviorPrompt: custom.behaviorPrompt,
      isCustomized: true,
      roleReminder: custom.roleReminder,
    });
  }

  // Last resort fallback: hardcoded SPECIALISTS array from constants
  // This ensures built-in specialists are ALWAYS available even if file loading
  // completely fails (e.g., stale build, missing directory, permission error).
  const hardcoded = getSpecialistById(specialistId);
  if (hardcoded) {
    logger.warn(
      `Using hardcoded fallback for specialist "${specialistId}" — file-based loading may have failed`,
    );
    const hardcodedTier: ModelTier | undefined =
      hardcoded.defaultModelTier ||
      (hardcoded.defaultModel ? getModelTierFromModel(hardcoded.defaultModel) : undefined) ||
      'balanced';
    let resolvedModel = hardcoded.defaultModel || '';
    if (hardcodedTier) {
      const effectiveProviderId = providerId || getDefaultProviderId();
      if (effectiveProviderId in PROVIDER_MODEL_TIERS) {
        resolvedModel = getDefaultModelForProvider(effectiveProviderId, hardcodedTier);
      }
    }
    return applyUserOverrides({
      id: hardcoded.id,
      name: hardcoded.name,
      description: hardcoded.description,
      model: resolvedModel,
      modelTier: hardcodedTier,
      behaviorPrompt: hardcoded.defaultBehaviorPrompt,
      isCustomized: false,
      roleReminder: hardcoded.roleReminder,
    });
  }

  return null;
}

/**
 * Get all specialists with effective configurations
 * Includes file-based specialists (user + bundled) and electron-store custom specialists.
 * User file-based specialists override bundled specialists with the same ID.
 *
 * @param providerId - Optional provider ID for resolving model tiers. Defaults to default provider.
 */
export function getAllEffectiveSpecialists(providerId?: string): EffectiveSpecialist[] {
  // Track IDs we've already seen (user file-based takes priority)
  const seenIds = new Set<string>();

  // File-based specialists include both user and bundled
  // The cache already has the correct priority (user overrides bundled)
  const fileEffective: EffectiveSpecialist[] = fileSpecialistsCache.map((file) => {
    seenIds.add(file.id);

    const hasExplicitModel = !!file.frontmatter.model;
    const hasExplicitTier = !!file.frontmatter.modelTier;
    let resolvedModel = file.frontmatter.model || '';

    // Determine the effective tier for downstream re-resolution.
    const tier: ModelTier | undefined =
      file.frontmatter.modelTier ||
      (resolvedModel ? getModelTierFromModel(resolvedModel) : undefined) ||
      'balanced';

    // Only override model via tier when user specified modelTier or has no explicit model.
    // Respect explicit model values from user specialist files.
    if (hasExplicitTier || !hasExplicitModel) {
      if (tier) {
        const effectiveProviderId = providerId || getDefaultProviderId();
        if (effectiveProviderId in PROVIDER_MODEL_TIERS) {
          resolvedModel = getDefaultModelForProvider(effectiveProviderId, tier);
        }
      }
    }

    return applyUserOverrides({
      id: file.id,
      name: file.frontmatter.name,
      description: file.frontmatter.description,
      model: resolvedModel,
      // Only propagate modelTier when it should drive downstream resolution
      modelTier: hasExplicitTier || !hasExplicitModel ? tier : undefined,
      behaviorPrompt: file.behaviorPrompt,
      isCustomized: file.source === 'file', // Only user files are considered customized
      roleReminder: file.frontmatter.roleReminder,
    });
  });

  // Legacy: get custom specialists from electron-store (skipping those overridden)
  // These should have been migrated to files, but keeping for backward compatibility
  const customSpecialists = getCustomSpecialists();
  const customEffective: EffectiveSpecialist[] = customSpecialists
    .filter((custom) => !seenIds.has(custom.id))
    .map((custom) => {
      seenIds.add(custom.id);
      const customTier = custom.model ? getModelTierFromModel(custom.model) : 'balanced';
      return applyUserOverrides({
        id: custom.id,
        name: custom.name,
        description: custom.description,
        model: custom.model,
        modelTier: customTier,
        behaviorPrompt: custom.behaviorPrompt,
        isCustomized: true,
        roleReminder: custom.roleReminder,
      });
    });

  // Last resort fallback: include any hardcoded SPECIALISTS not already covered
  // This ensures built-in specialists are ALWAYS available even if file loading fails
  const hardcodedFallback: EffectiveSpecialist[] = SPECIALISTS.filter(
    (s) => !seenIds.has(s.id),
  ).map((s) => {
    const hardcodedTier: ModelTier | undefined =
      s.defaultModelTier ||
      (s.defaultModel ? getModelTierFromModel(s.defaultModel) : undefined) ||
      'balanced';
    let resolvedModel = s.defaultModel || '';
    if (hardcodedTier) {
      const effectiveProviderId = providerId || getDefaultProviderId();
      if (effectiveProviderId in PROVIDER_MODEL_TIERS) {
        resolvedModel = getDefaultModelForProvider(effectiveProviderId, hardcodedTier);
      }
    }
    return applyUserOverrides({
      id: s.id,
      name: s.name,
      description: s.description,
      model: resolvedModel,
      modelTier: hardcodedTier,
      behaviorPrompt: s.defaultBehaviorPrompt,
      isCustomized: false,
      roleReminder: s.roleReminder,
    });
  });

  if (hardcodedFallback.length > 0) {
    logger.warn(
      `Using hardcoded fallback for ${hardcodedFallback.length} specialists — file-based loading may have failed`,
      { ids: hardcodedFallback.map((s) => s.id) },
    );
  }

  const allSpecialists = [...fileEffective, ...customEffective, ...hardcodedFallback];

  // Gate ralph specialist behind feature flag
  if (!featureCodesService.isFeatureEnabled('ralph-agent')) {
    return allSpecialists.filter((s) => s.id !== 'ralph');
  }

  return allSpecialists;
}

/**
 * Auto-generate a role reminder from a behavior prompt.
 * Extracts the first meaningful line and optionally the first "Hard Rule" if present.
 */
function autoGenerateRoleReminder(behaviorPrompt: string): string {
  if (!behaviorPrompt) return '';

  // Try to extract the first non-header, non-empty line as the core role description
  const lines = behaviorPrompt.split('\n');
  let firstMeaningfulLine = '';

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and markdown headers
    if (!trimmed || trimmed.startsWith('#')) continue;
    // Skip lines that are just bold markers
    if (trimmed.startsWith('**') && trimmed.endsWith('**')) continue;
    // Found a meaningful line
    firstMeaningfulLine = trimmed.replace(/^\*\*|\*\*$/g, '').trim();
    break;
  }

  // Try to extract the first "Hard Rule" if present
  const hardRulesMatch = behaviorPrompt.match(/##\s*Hard Rules[\s\S]*?(?=\n##|$)/i);
  if (hardRulesMatch) {
    // Extract first numbered rule: "1. **Rule text** — description"
    const firstRuleMatch = hardRulesMatch[0].match(/\d+\.\s*\*\*([^*]+)\*\*/);
    if (firstRuleMatch) {
      const firstRule = firstRuleMatch[1].trim();
      if (firstMeaningfulLine) {
        return `${firstMeaningfulLine} ${firstRule}.`;
      }
      return firstRule;
    }
  }

  return firstMeaningfulLine;
}

/**
 * Get the role reminder for a specialist.
 * Returns the explicit roleReminder if defined, otherwise auto-generates from behaviorPrompt.
 *
 * @param specialist - The effective specialist configuration
 * @returns The role reminder string (may be empty if no meaningful content found)
 */
export function getRoleReminder(specialist: EffectiveSpecialist): string {
  // Use explicit reminder if provided
  if (specialist.roleReminder) {
    return specialist.roleReminder;
  }

  // Auto-generate from behavior prompt
  return autoGenerateRoleReminder(specialist.behaviorPrompt);
}

/**
 * Fully resolved specialist configuration for agent creation.
 * This is the single source of truth — all code paths that need specialist
 * config should use resolveSpecialistForAgent() to get this object.
 *
 * Adding a new specialist field? Add it here and in resolveSpecialistForAgent().
 * All callers automatically get the new field.
 */
export interface ResolvedSpecialistConfig {
  /** The specialist ID (e.g., 'spec-writer', 'implementor') */
  specialistId: string;
  /** Display name (e.g., 'Coordinator', 'Implementor') */
  specialistName: string;
  /** Resolved model ID (modelTier resolved to concrete model for the provider) */
  model: string;
  /**
   * The capability tier for this specialist's model.
   * When present, consumers should resolve the model from this tier for their
   * active provider, rather than using the pre-resolved `model` field directly.
   * This ensures the model is always valid for the active provider.
   */
  modelTier?: ModelTier;
  /** The specialist's behavior prompt (full markdown instructions) */
  behaviorPrompt: string;
  /** Critical constraints reminder (explicit or auto-generated from behaviorPrompt) */
  roleReminder: string;
  /**
   * Default agent type for agents created with this specialist.
   * Controls which instruction set (agent loop) the agent uses.
   * If not set, callers should default to 'task-loop'.
   */
  defaultAgentType?: string;
}

/**
 * Central specialist resolver — the ONLY function that should be used to get
 * a complete specialist configuration for agent creation.
 *
 * This replaces the pattern of calling getEffectiveSpecialist() + getRoleReminder()
 * separately and manually assembling the results. By centralizing here, adding a
 * new specialist field is a one-place change instead of updating 5+ code paths.
 *
 * @param specialistId - The specialist ID to resolve
 * @param providerId - Optional provider ID for resolving model tiers (e.g., 'auggie', 'codex')
 * @returns Complete specialist config, or null if specialist not found
 */
export function resolveSpecialistForAgent(
  specialistId: string,
  providerId?: string,
): ResolvedSpecialistConfig | null {
  // Gate ralph specialist behind feature flag
  if (specialistId === 'ralph' && !featureCodesService.isFeatureEnabled('ralph-agent')) {
    logger.info('resolveSpecialistForAgent: ralph specialist gated by feature flag');
    return null;
  }

  const specialist = getEffectiveSpecialist(specialistId, providerId);
  if (!specialist) {
    logger.warn('resolveSpecialistForAgent: specialist not found', {
      specialistId,
      fileCacheSize: fileSpecialistsCache.length,
      fileCacheIds: fileSpecialistsCache.map((s) => s.id),
    });
    return null;
  }

  const roleReminder = getRoleReminder(specialist);

  logger.info('resolveSpecialistForAgent: resolved', {
    specialistId,
    specialistName: specialist.name,
    hasBehaviorPrompt: !!specialist.behaviorPrompt,
    behaviorPromptLength: specialist.behaviorPrompt?.length || 0,
    hasRoleReminder: !!roleReminder,
    isCustomized: specialist.isCustomized,
    source: fileSpecialistsCache.find((s) => s.id === specialistId)
      ? 'file-cache'
      : getSpecialistById(specialistId)
        ? 'hardcoded-fallback'
        : 'electron-store',
  });

  // Resolve defaultAgentType from file frontmatter or hardcoded specialist
  const fileSpec = fileSpecialistsCache.find((s) => s.id === specialistId);
  const defaultAgentType =
    fileSpec?.frontmatter.agentType || getSpecialistById(specialistId)?.defaultAgentType;

  return {
    specialistId: specialist.id,
    specialistName: specialist.name,
    model: specialist.model,
    modelTier: specialist.modelTier,
    behaviorPrompt: specialist.behaviorPrompt,
    roleReminder,
    defaultAgentType,
  };
}

/**
 * Format specialists for inclusion in agent prompts.
 * Shows capability tier (fast/balanced/smart) instead of concrete model IDs
 * so the prompt is provider-agnostic.
 */
export function formatSpecialistsForPrompt(): string {
  const specialists = getAllEffectiveSpecialists();

  const rows = specialists
    .map(
      (s) =>
        `| **${s.name}** | \`${s.id}\` | ${s.modelTier || 'balanced'} | ${s.description} |`,
    )
    .join('\n');

  return `## Agent Specialists

You have access to the following agent specialists. When delegating work, you can either create a blank agent or use \`specialist\` to create an agent with specific, pre-configured behavior:

| Specialist | ID | Speed | Purpose |
|------------|-------|-------|---------|
${rows}

**Examples:**

\`\`\`
// To implement work
delegate_task(taskNoteId="abc-123", specialist="implementor")

// To review work
create_agent(name="Review changes", specialist="verifier", initialMessage="Check the implementation...")
\`\`\`

The specialist parameter sets the model and adds role-specific instructions. Override with \`model\` or \`behaviorPrompt\` if needed.`;
}
