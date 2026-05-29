/**
 * ACP Provider Configuration
 *
 * Defines configurations for different ACP-compatible agents.
 * Each provider can have its own CLI command, arguments, and model handling.
 *
 * This file is in shared/config so it can be imported by both main and renderer processes.
 */

/**
 * Configuration for an ACP provider
 */
export interface ACPProviderConfig {
  /** Unique identifier for the provider (e.g., 'auggie', 'opencode') */
  id: string;
  /** Display name shown in UI (e.g., 'Auggie', 'OpenCode') */
  displayName: string;
  /** CLI command to spawn the agent */
  command: string;
  /** Default arguments for ACP mode */
  baseArgs: string[];
  /** Flag for model selection (e.g., '--model'). Providers that pass model config through
   *  other mechanisms (env vars, custom args) should leave this undefined. */
  modelFlag?: string;
  /** Default agent name for ACP session (e.g., 'build' for OpenCode) */
  defaultAgent?: string;
  /** Provider-specific support flags */
  supportsAuthenticate?: boolean;
  supportsSetMode?: boolean;
  /** Whether this provider supports MCP server configuration via CLI args */
  supportsMcpConfig?: boolean;
  /** Whether this provider supports rules files via CLI args */
  supportsRulesFile?: boolean;
  /** Flag for rules file (e.g., '--rules') */
  rulesFlag?: string;
  /** Flag for MCP config file (e.g., '--mcp-config') */
  mcpConfigFlag?: string;
  /** Flag for quiet mode (e.g., '--quiet') */
  quietFlag?: string;
  /** Optional provider-specific mode map overrides */
  modeMap?: Record<string, string>;
  /** Optional: filter available models for this provider */
  supportedModels?: string[];
  /** Optional: provider icon path */
  iconPath?: string;
  /** Whether this provider is the default/primary provider */
  isDefault?: boolean;
  /** Whether this provider can be disabled in settings */
  canBeDisabled?: boolean;
  /** IPC channel prefix for this provider (e.g., 'auggie', 'opencode') */
  ipcChannelPrefix?: string;
  /** Authentication error patterns to detect auth failures */
  authErrorPatterns?: string[];
  /** Login command hint for authentication errors */
  loginCommandHint?: string;
  /** If set, this provider is only visible when the named environment variable is defined */
  requiresEnvVar?: string;
  /** If set, this provider is only visible when this feature code is activated */
  requiresFeatureCode?: string;
  /** CLI args to check auth status (e.g., ['auth', 'status']). Exit 0 = authenticated. */
  authCheckArgs?: string[];
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
    command: 'auggie',
    baseArgs: ['--acp', '--allow-indexing'],
    modelFlag: '--model',
    supportsAuthenticate: true,
    supportsSetMode: true,
    supportsMcpConfig: true,
    supportsRulesFile: true,
    rulesFlag: '--rules',
    mcpConfigFlag: '--mcp-config',
    quietFlag: '--quiet',
    isDefault: true,
    canBeDisabled: false,
    ipcChannelPrefix: 'auggie',
    authErrorPatterns: ['authentication required', 'auggie login', 'please run `auggie login`'],
    loginCommandHint: 'auggie login',
  },

  'claude-code': {
    id: 'claude-code',
    displayName: 'Anthropic Claude Code',
    command: 'claude-agent-acp',
    // Claude Code ACP adapter runs without additional flags
    baseArgs: [],
    supportsAuthenticate: false,
    supportsSetMode: false,
    supportsMcpConfig: false,
    supportsRulesFile: false,
    isDefault: false,
    canBeDisabled: true,
    ipcChannelPrefix: 'claude-code',
    authCheckArgs: ['auth', 'status'],
    loginDocsUrl: 'https://code.claude.com/docs/en/quickstart#step-2-log-in-to-your-account',
  },
  codex: {
    id: 'codex',
    displayName: 'OpenAI Codex',
    command: 'codex-acp',
    // Codex ACP adapter runs without additional flags
    baseArgs: [],
    supportsAuthenticate: false,
    supportsSetMode: false,
    supportsMcpConfig: false,
    supportsRulesFile: false,
    isDefault: false,
    canBeDisabled: true,
    ipcChannelPrefix: 'codex',
    authCheckArgs: ['login', 'status'],
    loginDocsUrl: 'https://developers.openai.com/codex/cli#cli-setup',
  },

  cortex: {
    id: 'cortex',
    displayName: 'Snowflake Cortex',
    command: 'cortex-acp',
    // Cortex ACP adapter runs without additional flags
    baseArgs: [],
    supportsAuthenticate: false,
    supportsSetMode: false,
    supportsMcpConfig: false,
    supportsRulesFile: false,
    isDefault: false,
    canBeDisabled: true,
    ipcChannelPrefix: 'cortex',
    requiresFeatureCode: 'cortex',
  },

  opencode: {
    id: 'opencode',
    displayName: 'OpenCode',
    command: 'opencode',
    baseArgs: ['acp'],
    // OpenCode does not implement the ACP `authenticate` JSON-RPC method.
    // User credentials are supplied via `opencode auth login`, env vars
    // (ANTHROPIC_API_KEY, OPENAI_API_KEY, AWS_PROFILE, etc.), or a project .env file.
    supportsAuthenticate: false,
    supportsSetMode: false,
    supportsMcpConfig: false,
    supportsRulesFile: false,
    isDefault: false,
    canBeDisabled: true,
    ipcChannelPrefix: 'opencode',
    // Readiness is verified by listing models: `opencode models` returns a
    // non-empty list only when at least one provider is credentialed (from any
    // source: auth.json, env vars, or .env).
    authCheckArgs: ['models'],
    loginDocsUrl: 'https://opencode.ai/docs#configure',
  },

  pi: {
    id: 'pi',
    displayName: 'Pi',
    command: 'pi-acp',
    baseArgs: [],
    supportsAuthenticate: false,
    supportsSetMode: false,
    supportsMcpConfig: false,
    supportsRulesFile: false,
    isDefault: false,
    canBeDisabled: true,
    ipcChannelPrefix: 'pi',
    loginDocsUrl: 'https://pi.dev/docs/latest/quickstart',
  },

  mock: {
    id: 'mock',
    displayName: 'Mock (E2E)',
    command: 'node',
    baseArgs: [],
    supportsAuthenticate: true,
    supportsSetMode: false,
    supportsMcpConfig: false,
    supportsRulesFile: false,
    isDefault: false,
    canBeDisabled: true,
    ipcChannelPrefix: 'mock',
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
 * Create a compound model ID from provider and model
 */
export function createCompoundModelId(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

/**
 * Build environment variables for a provider.
 *
 * Most providers handle model/agent configuration via CLI args (set in
 * provider-registry.ts). Providers whose subcommands don't accept model
 * flags use this function to pass configuration through env vars instead.
 *
 * - cortex: sets ELECTRON_RUN_AS_NODE=1 so the Electron binary runs as Node.js
 * - opencode: sets OPENCODE_CONFIG_CONTENT with the selected model, because
 *   the `opencode acp` subcommand doesn't support --model
 *
 * Called from provider-registry.ts getACPWithProvider() and
 * agent-backend-handler.service.ts handleSetModel().
 */
export function buildProviderEnv(
  providerId: string,
  _model?: string,
   
  _agent?: string,
): Record<string, string> {
  // Cortex uses process.execPath (Electron binary) as the command for running
  // the cortex-acp adapter script. ELECTRON_RUN_AS_NODE=1 makes Electron
  // behave as Node.js so the script actually executes.
  if (providerId === 'cortex') {
    return { ELECTRON_RUN_AS_NODE: '1' };
  }
  // OpenCode's `acp` subcommand doesn't accept a --model flag.
  // Pass the selected model via OPENCODE_CONFIG_CONTENT, which is the
  // highest-precedence config source and only overrides the `model` key —
  // the user's other OpenCode settings are preserved.
  if (providerId === 'opencode' && _model) {
    return { OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: _model }) };
  }
  return {};
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
 * Get the authentication error message for a provider
 */
export function getProviderAuthErrorMessage(providerId: string, isRemote: boolean): string {
  const config = getProviderConfig(providerId);
  const loginCmd = config.loginCommandHint || `${config.command} login`;

  if (isRemote) {
    return `${config.displayName} needs to be authenticated on the remote server. Run "${loginCmd}" in a terminal connected to the remote environment.`;
  }
  return `${config.displayName} needs to be authenticated. Run "${loginCmd}" in a terminal.`;
}

/**
 * Get providers that can be disabled in settings
 */
export function getDisableableProviders(): ACPProviderConfig[] {
  return Object.values(ACP_PROVIDERS).filter((p) => p.canBeDisabled);
}

/**
 * Get providers that are always enabled
 */
export function getAlwaysEnabledProviders(): ACPProviderConfig[] {
  return Object.values(ACP_PROVIDERS).filter((p) => !p.canBeDisabled);
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
  // Note: opencode models are dynamic and fetched from the CLI at runtime.
  // Do NOT add a hardcoded opencode entry here — model names change frequently.
  // Tier resolution for opencode falls back to using the parent agent's model.
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
 * Normalize a model identifier for fuzzy comparison.
 * Lowercases, strips a leading 'claude-' brand prefix, and removes all
 * non-alphanumeric characters (dashes, dots, slashes).
 *
 * Examples:
 *   'sonnet'              -> 'sonnet'
 *   'sonnet-4.6'          -> 'sonnet46'
 *   'claude-sonnet-4-6'   -> 'sonnet46'
 *   'gpt-5.3-codex/high'  -> 'gpt53codexhigh'
 */
function normalizeForFuzzyMatch(id: string): string {
  return id
    .toLowerCase()
    .replace(/^claude-/, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Attempt to normalize a bare or fuzzy model name to the qualified provider:alias
 * form expected by the coordinator / LLM tool layer.
 *
 * Returns the qualified compound model ID when the candidate matches a known
 * tier model for `targetProviderId`, or undefined if no reasonable match is found.
 *
 * Matching rules (applied in order for the target provider's tier models):
 *   1. Exact match (case-insensitive)
 *   2. Normalized exact match (see normalizeForFuzzyMatch)
 *   3. Normalized prefix match where a short alias expands to a longer tier
 *      model (e.g., 'sonnet' -> 'sonnet4.5' for auggie). The direction is
 *      one-way: the candidate must be a prefix of a tier model. A longer
 *      candidate that merely starts with a tier model (e.g., 'gpt-5.3-codex/highest'
 *      starting with 'gpt-5.3-codex/high') is NOT silently rewritten.
 *
 * Candidates that already contain a ':' are treated as already-qualified and
 * returned unchanged.
 */
export function normalizeModelOverride(
  candidate: string,
  targetProviderId: string,
): string | undefined {
  if (!candidate) return undefined;
  if (candidate.includes(':')) return candidate;

  const tierModels = PROVIDER_MODEL_TIERS[targetProviderId];
  if (!tierModels) return undefined;

  const tierValues = Array.from(new Set(Object.values(tierModels)));
  const normalizedCandidate = normalizeForFuzzyMatch(candidate);
  if (!normalizedCandidate) return undefined;

  // 1. Exact (case-insensitive) match
  const exact = tierValues.find((m) => m.toLowerCase() === candidate.toLowerCase());
  if (exact) return createCompoundModelId(targetProviderId, exact);

  // 2. Normalized exact match
  const normExact = tierValues.find((m) => normalizeForFuzzyMatch(m) === normalizedCandidate);
  if (normExact) return createCompoundModelId(targetProviderId, normExact);

  // 3. Normalized prefix match — prefer the longest matching tier model so that
  //    'sonnet' resolves to 'sonnet4.5' (auggie) and not 'haiku4.5'. Only the
  //    short-alias → full tier direction is honored; see JSDoc above.
  const prefixMatches = tierValues
    .filter((m) => {
      const n = normalizeForFuzzyMatch(m);
      return n.startsWith(normalizedCandidate);
    })
    .sort((a, b) => normalizeForFuzzyMatch(b).length - normalizeForFuzzyMatch(a).length);
  if (prefixMatches.length > 0) {
    return createCompoundModelId(targetProviderId, prefixMatches[0]);
  }

  return undefined;
}

/**
 * Fuzzy-match a candidate model name against an explicit pool of known model IDs.
 *
 * Unlike {@link normalizeModelOverride} (which uses `PROVIDER_MODEL_TIERS` as its pool),
 * this helper takes the pool as a parameter so callers can supply the provider's live
 * model list fetched from the CLI. The tier table is a curated UX hint; the live list
 * is the source of truth.
 *
 * Matching rules (applied in order against `pool`):
 *   1. Exact match (case-insensitive)
 *   2. Normalized exact match (see {@link normalizeForFuzzyMatch})
 *   3. Normalized prefix match where the candidate is a prefix of a pool entry
 *      (one-way; a longer candidate that starts with a shorter pool entry is NOT
 *      rewritten — see the JSDoc on `normalizeModelOverride` for the rationale).
 *      Among multiple prefix matches, the longest pool entry wins so `sonnet`
 *      resolves to `sonnet4.6` rather than `sonnet4.5` when both are present.
 *
 * Returns the bare pool entry that matched, or `undefined` if no match.
 * Callers are responsible for qualifying it with a provider prefix if needed.
 */
export function fuzzyMatchModelInPool(
  candidate: string,
  pool: readonly string[],
): string | undefined {
  if (!candidate || pool.length === 0) return undefined;

  const normalizedCandidate = normalizeForFuzzyMatch(candidate);
  if (!normalizedCandidate) return undefined;

  // 1. Exact (case-insensitive) match
  const exact = pool.find((m) => m.toLowerCase() === candidate.toLowerCase());
  if (exact) return exact;

  // 2. Normalized exact match
  const normExact = pool.find((m) => normalizeForFuzzyMatch(m) === normalizedCandidate);
  if (normExact) return normExact;

  // 3. Normalized prefix match — prefer the longest matching pool entry so that
  //    'sonnet' resolves to 'sonnet4.6' rather than 'sonnet4.5' when both are
  //    present. Only the short-alias → full-name direction is honored.
  const prefixMatches = pool
    .filter((m) => normalizeForFuzzyMatch(m).startsWith(normalizedCandidate))
    .slice()
    .sort((a, b) => normalizeForFuzzyMatch(b).length - normalizeForFuzzyMatch(a).length);
  if (prefixMatches.length > 0) return prefixMatches[0];

  return undefined;
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
