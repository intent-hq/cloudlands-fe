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
    supportsAuthenticate: false, // OpenCode manages its own auth
    supportsSetMode: false,
    supportsMcpConfig: false,
    supportsRulesFile: false,
    isDefault: false,
    canBeDisabled: true,
    ipcChannelPrefix: 'opencode',
    authCheckArgs: ['auth', 'list'],
    loginDocsUrl: 'https://opencode.ai/docs#configure',
  },
};

/**
 * Get the default provider configuration
 */
export function getDefaultProviderConfig(): ACPProviderConfig {
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
  auggie: { fast: 'haiku4.5', balanced: 'sonnet4.5', smart: 'opus4.6' },
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
