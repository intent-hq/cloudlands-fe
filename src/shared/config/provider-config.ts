/**
 * ACP Provider Configuration
 *
 * UI-facing metadata for ACP-compatible agents (display names, CLI command
 * hints, auth/login metadata). Provider spawning and model normalization are
 * owned by the intentd daemon.
 *
 * This file is in shared/config so it can be imported by both main and renderer processes.
 */

/**
 * Configuration for an ACP provider
 */
export interface ACPProviderConfig {
  /** Unique identifier for the provider (e.g., 'auggie', 'opencode') */
  id: string;
  /** Display name shown in UI (e.g., 'Augment Auggie', 'OpenCode') */
  displayName: string;
  /** Short display name for compact UI like the usage-stats cards (e.g., 'Auggie', 'Claude Code') */
  shortName: string;
  /** CLI command for the provider's agent binary (used in UI hints and PATH checks) */
  command: string;
  /** Whether this provider is the default/primary provider */
  isDefault?: boolean;
  /** Whether this provider can be disabled in settings */
  canBeDisabled?: boolean;
  /** Authentication error patterns to detect auth failures */
  authErrorPatterns?: string[];
  /** Login command hint for authentication errors */
  loginCommandHint?: string;
  /** If set, this provider is only visible when the named environment variable is defined */
  requiresEnvVar?: string;
  /** If set, this provider is only visible when this feature code is activated */
  requiresFeatureCode?: string;
  /** URL to login/auth docs for this provider */
  loginDocsUrl?: string;
}

/**
 * All available ACP providers
 * Note: Providers must be enabled in settings before they appear in the UI
 */
export const ACP_PROVIDERS: Record<string, ACPProviderConfig> = {
  auggie: {
    id: 'auggie',
    displayName: 'Augment Auggie',
    shortName: 'Auggie',
    command: 'auggie',
    isDefault: true,
    canBeDisabled: true,
    authErrorPatterns: ['authentication required', 'auggie login', 'please run `auggie login`'],
    loginCommandHint: 'auggie login',
  },

  'claude-code': {
    id: 'claude-code',
    displayName: 'Anthropic Claude Code',
    shortName: 'Claude Code',
    command: 'claude-agent-acp',
    isDefault: false,
    canBeDisabled: true,
    loginDocsUrl: 'https://code.claude.com/docs/en/quickstart#step-2-log-in-to-your-account',
  },
  codex: {
    id: 'codex',
    displayName: 'OpenAI Codex',
    shortName: 'Codex',
    command: 'codex-acp',
    isDefault: false,
    canBeDisabled: true,
    loginDocsUrl: 'https://developers.openai.com/codex/cli#cli-setup',
  },

  cortex: {
    id: 'cortex',
    displayName: 'Snowflake Cortex',
    shortName: 'Cortex',
    command: 'cortex-acp',
    isDefault: false,
    canBeDisabled: true,
    requiresFeatureCode: 'cortex',
  },

  opencode: {
    id: 'opencode',
    displayName: 'OpenCode',
    shortName: 'OpenCode',
    command: 'opencode',
    isDefault: false,
    canBeDisabled: true,
    loginDocsUrl: 'https://opencode.ai/docs#configure',
  },

  pi: {
    id: 'pi',
    displayName: 'Pi',
    shortName: 'Pi',
    command: 'pi-acp',
    isDefault: false,
    canBeDisabled: true,
    loginDocsUrl: 'https://pi.dev/docs/latest/quickstart',
  },

  droid: {
    id: 'droid',
    displayName: 'Factory Droid',
    shortName: 'Droid',
    command: 'droid',
    isDefault: false,
    canBeDisabled: true,
    loginDocsUrl: 'https://docs.factory.ai/cli/getting-started/overview',
  },

  grok: {
    id: 'grok',
    displayName: 'Grok Build',
    shortName: 'Grok',
    command: 'grok',
    isDefault: false,
    canBeDisabled: true,
    loginCommandHint: 'grok login',
    loginDocsUrl: 'https://docs.x.ai/build/enterprise#authentication',
  },

  unsloth: {
    id: 'unsloth',
    displayName: 'Unsloth',
    shortName: 'Unsloth',
    // Unsloth rides the opencode binary as its ACP runtime; the daemon owns
    // the managed local server lifecycle and spawn-time configuration.
    command: 'opencode',
    isDefault: false,
    canBeDisabled: true,
    loginDocsUrl: 'https://docs.unsloth.ai',
  },

  mock: {
    id: 'mock',
    displayName: 'Mock (E2E)',
    shortName: 'Mock',
    command: 'node',
    isDefault: false,
    canBeDisabled: true,
    requiresEnvVar: 'MOCK_AGENT_SCRIPT_PATH',
  },
};

/**
 * Get the default provider configuration
 */
export function getDefaultProviderConfig(): ACPProviderConfig {
  // Test-only override: allow tests to force a default provider (e.g. mock)
  if (process.env.TESTING === 'true') {
    const override = process.env.DEFAULT_PROVIDER_OVERRIDE;
    if (override && ACP_PROVIDERS[override]) {
      return ACP_PROVIDERS[override];
    }
  }
  const defaultProvider = Object.values(ACP_PROVIDERS).find((p) => p.isDefault);
  if (defaultProvider) {
    return defaultProvider;
  }
  // Fall back to the first available provider (provider-agnostic fallback)
  const providers = Object.values(ACP_PROVIDERS);
  if (providers.length > 0) {
    return providers[0];
  }
  // This should never happen in practice, but throw a descriptive error
  throw new Error('No ACP providers are configured. At least one provider must be defined.');
}

/**
 * Get the default provider ID
 */
export function getDefaultProviderId(): string {
  return getDefaultProviderConfig().id;
}

/**
 * Get a provider configuration by ID
 * Falls back to the default provider if not found
 */
export function getProviderConfig(providerId: string): ACPProviderConfig {
  const config = ACP_PROVIDERS[providerId];
  if (!config) {
    const defaultConfig = getDefaultProviderConfig();
    if (
      providerId &&
      providerId !== 'default' &&
      providerId !== 'acp' &&
      providerId !== 'augment'
    ) {
      console.warn(
        `[provider-config] Unknown provider "${providerId}", falling back to default (${defaultConfig.id})`,
      );
    }
    return defaultConfig;
  }
  return config;
}

/**
 * Get all provider IDs
 */
export function getAllProviderIds(): string[] {
  return Object.keys(ACP_PROVIDERS);
}

/**
 * Maps ProviderAvailabilityResult property keys (camelCase) to their
 * corresponding provider IDs used everywhere else in the app.
 *
 * Single source of truth — import this instead of hard-coding
 * the camelCase↔kebab-case translation in each call site.
 */
export const PROVIDER_AVAILABILITY_KEY_TO_ID: Record<string, string> = {
  auggie: 'auggie',
  claudeCode: 'claude-code',
  codex: 'codex',
  mock: 'mock',
  opencode: 'opencode',
  pi: 'pi',
  cortex: 'cortex',
  droid: 'droid',
  grok: 'grok',
  unsloth: 'unsloth',
};

/**
 * Given a ProviderAvailabilityResult-shaped providers map and an optional set
 * of hidden provider IDs, return the list of provider IDs that are both
 * available and not hidden.
 */
export function getAvailableIdsFromResult(
  providers: Record<string, { available: boolean }>,
  hiddenProviders: string[] = [],
): string[] {
  const hidden = new Set(hiddenProviders);
  const ids: string[] = [];
  for (const [key, providerId] of Object.entries(PROVIDER_AVAILABILITY_KEY_TO_ID)) {
    if (providers[key]?.available && !hidden.has(providerId)) {
      ids.push(providerId);
    }
  }
  return ids;
}

/**
 * Parse a compound model ID into provider and model parts
 * Format: {providerId}:{modelId} (e.g., 'opencode:claude-sonnet-4')
 * Falls back to the default provider if no provider prefix
 */
export function parseCompoundModelId(compoundModelId: string): {
  providerId: string;
  modelId: string;
} {
  if (compoundModelId.includes(':')) {
    const [providerId, ...modelParts] = compoundModelId.split(':');
    return { providerId, modelId: modelParts.join(':') };
  }
  // Default to the default provider for backwards compatibility
  return { providerId: getDefaultProviderId(), modelId: compoundModelId };
}

/**
 * Check if an error message indicates the provider needs authentication
 * Uses the provider's configured auth error patterns
 */
export function isProviderAuthenticationError(providerId: string, errorMessage: string): boolean {
  const config = getProviderConfig(providerId);
  if (!config.authErrorPatterns || config.authErrorPatterns.length === 0) {
    return false;
  }

  const errorLower = errorMessage.toLowerCase();
  return config.authErrorPatterns.some((pattern) => errorLower.includes(pattern.toLowerCase()));
}

/**
 * Resolve a provider's effective enabled state from the persisted enabled map.
 * Providers that cannot be disabled are always enabled. The default provider
 * is enabled when it has no persisted entry (fresh state); every other
 * provider defaults to disabled when unset. An explicit true/false entry
 * always wins once the user toggles the provider.
 */
export function resolveProviderEnabled(
  enabledProviders: Record<string, boolean>,
  providerId: string,
): boolean {
  const config = getProviderConfig(providerId);
  if (config.canBeDisabled === false) return true;
  return enabledProviders[providerId] ?? providerId === getDefaultProviderId();
}

/**
 * Model capability tiers for each provider.
 * - fast: Quick, cheap models for background tasks (commit messages, PR descriptions)
 * - balanced: General purpose models for most tasks
 * - smart: High-capability models for complex reasoning (coordinators, verifiers)
 */
export const PROVIDER_MODEL_TIERS: Record<
  string,
  { fast: string; balanced: string; smart: string }
> = {
  auggie: { fast: 'haiku4.5', balanced: 'sonnet4.5', smart: 'opus4.7' },
  'claude-code': {
    fast: 'haiku',
    balanced: 'sonnet',
    smart: 'default', // 'default' maps to Opus in Claude Code
  },
  codex: { fast: 'gpt-5.3-codex/medium', balanced: 'gpt-5.3-codex/high', smart: 'gpt-5.3-codex/xhigh' },
  cortex: { fast: 'claude-sonnet-4-5', balanced: 'claude-opus-4-5', smart: 'claude-opus-4-5' },
  // Note: opencode, droid, grok, and unsloth models are dynamic and fetched
  // via the daemon's models.list catalog at runtime. Do NOT add hardcoded
  // opencode/droid/grok/unsloth entries here — model names change frequently.
  // Tier resolution for these providers falls back to using the parent agent's model.
};

/**
 * Model tier type for type safety
 */
export type ModelTier = 'fast' | 'balanced' | 'smart';

/**
 * Get the default model for a provider at a specific capability tier.
 * Falls back to Auggie's models if the provider is not configured.
 *
 * IMPORTANT: Providers with dynamic model lists (e.g., opencode) are intentionally
 * NOT in PROVIDER_MODEL_TIERS. Callers should check `providerId in PROVIDER_MODEL_TIERS`
 * before calling this to avoid getting an Auggie model ID that's invalid for their provider.
 */
export function getDefaultModelForProvider(providerId: string, tier: ModelTier): string {
  if (!(providerId in PROVIDER_MODEL_TIERS)) {
    console.warn(
      `[provider-config] getDefaultModelForProvider called for provider "${providerId}" which has no ` +
        `tier mappings. Falling back to auggie's "${tier}" model. This may produce an invalid model ID. ` +
        `Callers should guard with "providerId in PROVIDER_MODEL_TIERS" before calling.`,
    );
  }
  return PROVIDER_MODEL_TIERS[providerId]?.[tier] ?? PROVIDER_MODEL_TIERS['auggie'][tier];
}

/**
 * Reverse-map a concrete model ID to its capability tier.
 * Searches all providers' tier mappings. Returns the tier if found, undefined otherwise.
 * If the model exists at different tiers across providers, returns the tier for the
 * specified provider (or the first match if no provider specified).
 */
export function getModelTierFromModel(
  modelId: string,
  preferredProviderId?: string,
): ModelTier | undefined {
  const tiers: ModelTier[] = ['fast', 'balanced', 'smart'];

  // Check preferred provider first
  if (preferredProviderId && PROVIDER_MODEL_TIERS[preferredProviderId]) {
    const providerTiers = PROVIDER_MODEL_TIERS[preferredProviderId];
    for (const tier of tiers) {
      if (providerTiers[tier] === modelId) {
        return tier;
      }
    }
  }

  // Search all providers
  for (const providerTiers of Object.values(PROVIDER_MODEL_TIERS)) {
    for (const tier of tiers) {
      if (providerTiers[tier] === modelId) {
        return tier;
      }
    }
  }

  return undefined;
}

/**
 * Check if a model ID (compound or bare) is compatible with a target provider.
 *
 * A bare model (e.g., 'opus4.5') is treated as belonging to the default provider.
 * A compound model (e.g., 'codex:gpt-5.3-codex/high') belongs to its explicit provider.
 *
 * Returns true if the model's provider matches the target provider.
 */
export function isModelValidForProvider(model: string, targetProviderId: string): boolean {
  const { providerId: modelProvider } = parseCompoundModelId(model);
  return modelProvider === targetProviderId;
}

/**
 * Resolve the best default model from a preference list against the available models.
 * Walks the preference list in order and returns the first match found in availableValues.
 * Returns undefined if none of the preferred models are available.
 */
export function resolvePreferredModel(
  preferenceList: readonly string[],
  availableValues: string[],
): string | undefined {
  for (const preferred of preferenceList) {
    if (availableValues.includes(preferred)) {
      return preferred;
    }
  }
  return undefined;
}
