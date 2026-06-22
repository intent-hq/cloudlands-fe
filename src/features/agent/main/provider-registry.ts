import {
  ACP_PROVIDERS,
  buildProviderEnv,
  getDefaultProviderConfig,
  getProviderConfig,
  parseCompoundModelId,
  type ACPProviderConfig,
} from '$shared/config/provider-config';
import { parseCodexReasoningEffort } from '$shared/config/open-ai-codex-models';
import { Logger } from '../../../shared/logger';
import { featureCodesService } from '../../feature-codes/main/feature-codes.service';
import type { AgentConfig, BaseAgentProvider } from './agent-providers/base-provider';
import {
  isProgrammaticTestProviderEnabled,
  PROGRAMMATIC_TEST_PROVIDER_ID,
} from '../testing/programmatic-test-agent-provider';

const logger = new Logger('ProviderRegistry');

type ResolvedCommand = {
  command: string;
  argsPrefix: string[];
  env?: Record<string, string>;
};

async function resolveProviderCommand(providerConfig: ACPProviderConfig): Promise<ResolvedCommand> {
  // Use provider-specific resolvers for command resolution with fallback to npx
  if (providerConfig.id === 'claude-code') {
    const { resolveClaudeCodeCommand } = await import(
      '../../claude-code/main/claude-code-resolver'
    );
    const resolved = await resolveClaudeCodeCommand();
    if (resolved) {
      return { command: resolved.command, argsPrefix: resolved.argsPrefix };
    }
    logger.warn('Failed to resolve claude-code command, falling back to config');
  }

  if (providerConfig.id === 'codex') {
    const { resolveCodexCommand } = await import('../../codex/main/codex-resolver');
    const resolved = await resolveCodexCommand();
    if (resolved) {
      return { command: resolved.command, argsPrefix: resolved.argsPrefix, env: resolved.env };
    }
    logger.warn('Failed to resolve codex command, falling back to config');
  }

  if (providerConfig.id === 'opencode') {
    const { resolveOpenCodeCommand } = await import('../../opencode/main/opencode-resolver');
    const resolved = await resolveOpenCodeCommand();
    if (resolved) {
      return { command: resolved.command, argsPrefix: resolved.argsPrefix };
    }
    logger.warn('Failed to resolve opencode command, falling back to config');
  }

  if (providerConfig.id === 'pi') {
    const { resolvePiCommand } = await import('../../pi/main/pi-resolver');
    const resolved = await resolvePiCommand();
    if (resolved) {
      return { command: resolved.command, argsPrefix: resolved.argsPrefix };
    }
    logger.warn('Failed to resolve pi command, falling back to config');
  }

  if (providerConfig.id === 'droid') {
    const { resolveDroidCommand } = await import('../../droid/main/droid-resolver');
    const resolved = await resolveDroidCommand();
    if (resolved) {
      return { command: resolved.command, argsPrefix: resolved.argsPrefix };
    }
    logger.warn('Failed to resolve droid command, falling back to config');
  }

  if (providerConfig.id === 'cortex') {
    const { resolveCortexCommand } = await import('../../cortex/main/cortex-resolver');
    const resolved = await resolveCortexCommand();
    if (resolved) {
      return { command: resolved.command, argsPrefix: resolved.argsPrefix };
    }
    logger.warn('Failed to resolve cortex command, falling back to config');
  }

  if (providerConfig.id === 'mock') {
    if (process.env.TESTING !== 'true') {
      logger.warn('Mock provider requires TESTING=true, skipping');
      throw new Error('Mock provider is only available when TESTING=true');
    }
    const scriptPath = process.env.MOCK_AGENT_SCRIPT_PATH;
    if (!scriptPath) {
      throw new Error('MOCK_AGENT_SCRIPT_PATH must be set when using the mock provider');
    }
    return { command: 'node', argsPrefix: [scriptPath] };
  }

  // Default: return command as-is (for other providers)
  return { command: providerConfig.command, argsPrefix: [] };
}

function hasArgsPrefix(args: string[], prefix: string[]): boolean {
  if (prefix.length === 0 || args.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (args[i] !== prefix[i]) return false;
  }
  return true;
}

export function upsertCodexConfigArgs(args: string[], key: string, value: string): string[] {
  // Codex parses config overrides as TOML. Quote strings so values like gpt-5.2-codex parse reliably.
  const escaped = value.replaceAll('"', '\\"');
  const configValue = `${key}="${escaped}"`;

  const next: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if ((a === '-c' || a === '--config') && i + 1 < args.length) {
      const v = args[i + 1];
      if (typeof v === 'string' && v.trim().startsWith(`${key}=`)) {
        // Skip old value
        i += 1;
        continue;
      }
    }
    next.push(a);
  }

  next.push('-c', configValue);
  return next;
}

/**
 * Get ACP provider instance for a specific provider
 * Dynamically imports to avoid bundling Node.js modules in browser
 * @param config - Agent configuration
 * @param providerConfig - Provider-specific configuration (command, args, etc.)
 * @param autoInitialize - Whether to automatically initialize the provider (default: true)
 */
async function getACPWithProvider(
  config: AgentConfig,
  providerConfig: ACPProviderConfig,
  autoInitialize: boolean = true,
): Promise<BaseAgentProvider> {
  const { ACPProvider } = await import('./agent-providers/acp-provider.js');

  logger.info('[ProviderRegistry] getACPWithProvider called with config', {
    providerId: providerConfig.id,
    providerDisplayName: providerConfig.displayName,
    hasSystemPrompt: !!config.systemPrompt,
    systemPromptLength: config.systemPrompt?.length || 0,
    command: config.command,
    args: config.args,
  });

  // Resolve provider command (binary or npx fallback)
  const resolvedCommand = await resolveProviderCommand(providerConfig);
  logger.info('[ProviderRegistry] Resolved provider command', {
    providerId: providerConfig.id,
    originalCommand: providerConfig.command,
    resolvedCommand: resolvedCommand.command,
    argsPrefix: resolvedCommand.argsPrefix,
  });
  config.command = resolvedCommand.command;

  // Parse compound model ID if present (e.g., "opencode:claude-sonnet-4" -> "claude-sonnet-4")
  let rawModelId = config.model;
  if (config.model && config.model.includes(':')) {
    const parsed = parseCompoundModelId(config.model);
    rawModelId = parsed.modelId;
    logger.info('Parsed compound model ID', {
      original: config.model,
      providerId: parsed.providerId,
      rawModelId,
    });
  }

  // Check if args are already provided (from agent-backend-handler)
  // If so, don't modify them to avoid duplicates
  if (!config.args || config.args.length === 0) {
    // Build args array with provider-specific base args
    let args = [...resolvedCommand.argsPrefix, ...providerConfig.baseArgs];

    // Add model flag if specified ('default' is a sentinel — don't pass it as a real model ID)
    if (rawModelId && rawModelId.length > 0 && rawModelId !== 'default' && providerConfig.modelFlag) {
      args.push(providerConfig.modelFlag, rawModelId);
      logger.info(`Setting ${providerConfig.displayName} model`, { model: rawModelId });
    }

    // Codex uses `-c model="<slug>"` (not `--model`) for codex-acp.
    if (providerConfig.id === 'codex' && rawModelId && rawModelId !== 'default') {
      const { baseModel, effort } = parseCodexReasoningEffort(rawModelId);
      args = upsertCodexConfigArgs(args, 'model', baseModel);
      if (effort) {
        args = upsertCodexConfigArgs(args, 'model_reasoning_effort', effort);
      } else {
        const envEffort =
          process.env.CODEX_REASONING_EFFORT || process.env.CODEX_MODEL_REASONING_EFFORT;
        if (envEffort) {
          args = upsertCodexConfigArgs(args, 'model_reasoning_effort', envEffort);
        }
      }
    }

    config.args = args;
  } else {
    // Ensure any command prefix (npx) is present before existing args
    if (
      resolvedCommand.argsPrefix.length > 0 &&
      !hasArgsPrefix(config.args, resolvedCommand.argsPrefix)
    ) {
      config.args = [...resolvedCommand.argsPrefix, ...config.args];
    }

    // Args already provided, just ensure model is included if needed
    // ('default' is a sentinel — don't pass it as a real model ID)
    if (
      rawModelId &&
      rawModelId.length > 0 &&
      rawModelId !== 'default' &&
      providerConfig.modelFlag &&
      !config.args.includes(providerConfig.modelFlag)
    ) {
      config.args.push(providerConfig.modelFlag, rawModelId);
      logger.info('Adding model to existing args', { model: rawModelId });
    }

    if (providerConfig.id === 'codex' && rawModelId && rawModelId !== 'default') {
      const { baseModel, effort } = parseCodexReasoningEffort(rawModelId);
      config.args = upsertCodexConfigArgs(config.args, 'model', baseModel);
      if (effort) {
        config.args = upsertCodexConfigArgs(config.args, 'model_reasoning_effort', effort);
      } else {
        const envEffort =
          process.env.CODEX_REASONING_EFFORT || process.env.CODEX_MODEL_REASONING_EFFORT;
        if (envEffort) {
          config.args = upsertCodexConfigArgs(config.args, 'model_reasoning_effort', envEffort);
        }
      }
    }
  }

  // Build provider-specific environment variables (e.g., OPENCODE_CONFIG_CONTENT)
  // Pass undefined instead of 'default' so buildProviderEnv doesn't set an invalid model
  const envModelId = rawModelId === 'default' ? undefined : rawModelId;
  const providerEnv = buildProviderEnv(providerConfig.id, envModelId, providerConfig.defaultAgent);
  config.env = { ...(config.env || {}), ...(resolvedCommand.env || {}), ...providerEnv };

  // Safety check: warn if a model was specified but no mechanism exists to pass it
  // at spawn time. This catches the class of bug where a new provider is added without
  // configuring either modelFlag, buildProviderEnv, or provider-specific arg handling.
  // Providers that apply models post-session (e.g., claude-code via ACP session/set_model)
  // are excluded — they intentionally skip spawn-time model passing.
  if (rawModelId && rawModelId.length > 0) {
    const hasModelFlag = !!providerConfig.modelFlag;
    // Check if buildProviderEnv returned model-carrying env vars (not just unrelated ones like ELECTRON_RUN_AS_NODE)
    const hasModelEnv = !!providerEnv.OPENCODE_CONFIG_CONTENT;
    const hasCustomArgs = providerConfig.id === 'codex'; // Codex uses -c model="..."
    const appliesModelPostSession = providerConfig.id === 'claude-code' || providerConfig.id === 'cortex' || providerConfig.id === 'opencode' || providerConfig.id === 'pi' || providerConfig.id === 'droid';
    if (!hasModelFlag && !hasModelEnv && !hasCustomArgs && !appliesModelPostSession) {
      logger.warn(
        `[ProviderRegistry] Model "${rawModelId}" specified for provider "${providerConfig.id}" ` +
          'but no modelFlag, env var, or custom arg handler is configured to pass it. ' +
          'The model may be silently ignored by the provider.',
        { providerId: providerConfig.id, rawModelId },
      );
    }
  }

  logger.info('[ProviderRegistry] Provider environment configured', {
    providerId: providerConfig.id,
    hasOpenCodeConfig: !!(providerEnv as any).OPENCODE_CONFIG_CONTENT,
    envKeys: Object.keys(providerEnv),
  });

  // Store provider config on the agent config for use in ACPProvider
  // This allows the provider to use the correct agent name in permission dialogs
  (config as any)._providerConfig = providerConfig;

  // MODEL RESOLUTION AUDIT LOG
  // Single structured log that captures the entire model resolution chain.
  // This makes it trivial to debug "wrong model" bugs by checking a single log line.
  logger.info('[ProviderRegistry] Model resolution audit', {
    providerId: providerConfig.id,
    inputModel: config.model,                                // compound ID from caller
    rawModelId,                                               // after stripping provider prefix
    mechanism: providerConfig.id === 'droid'
      ? 'ACP session/set_model (post-session; --model is ignored in ACP mode)'
      : providerConfig.modelFlag
        ? `CLI flag (${providerConfig.modelFlag})`
        : providerConfig.id === 'opencode'
          ? 'OPENCODE_CONFIG_CONTENT env var + ACP session/set_model (post-session)'
          : providerConfig.id === 'codex'
            ? 'codex -c model="..."'
            : providerConfig.id === 'claude-code' || providerConfig.id === 'cortex' || providerConfig.id === 'pi'
              ? 'ACP session/set_model (post-session)'
              : 'NONE — model may be ignored',
    envModel: providerEnv.OPENCODE_CONFIG_CONTENT
      ? (() => { try { return JSON.parse(providerEnv.OPENCODE_CONFIG_CONTENT).model; } catch { return 'parse-error'; } })()
      : undefined,
    cliArgs: config.args,
  });

  logger.info('[ProviderRegistry] Creating ACPProvider with final config', {
    providerId: providerConfig.id,
    hasSystemPrompt: !!config.systemPrompt,
    systemPromptLength: config.systemPrompt?.length || 0,
    command: config.command,
    args: config.args,
    workspaceId: config.workspaceId,
    hasMetadata: !!(config as any).metadata,
    metadataKeys: (config as any).metadata ? Object.keys((config as any).metadata) : [],
    hasDirectAgentType: !!(config as any).agentType,
    directAgentType: (config as any).agentType,
  });

  const provider = new ACPProvider(config);

  // Initialize the provider if requested (default behavior)
  if (autoInitialize) {
    await provider.initialize();
  }

  return provider;
}

/**
 * Get ACP provider instance (legacy function for backwards compatibility)
 * Defaults to the default provider (configured via isDefault in provider-config)
 */
async function getACP(
  config: AgentConfig,
  autoInitialize: boolean = true,
): Promise<BaseAgentProvider> {
  // Check if model has a provider prefix
  let providerConfig = getDefaultProviderConfig();

  if (config.model && config.model.includes(':')) {
    const parsed = parseCompoundModelId(config.model);
    const foundConfig = getProviderConfig(parsed.providerId);
    if (foundConfig) {
      providerConfig = foundConfig;
    }
  }

  return getACPWithProvider(config, providerConfig, autoInitialize);
}

// Removed temporary stdio workaround - using ACP exclusively as per architecture

export type ProviderFactory = (
  config: AgentConfig,
  autoInitialize?: boolean,
) => BaseAgentProvider | Promise<BaseAgentProvider>;

export { PROGRAMMATIC_TEST_PROVIDER_ID, isProgrammaticTestProviderEnabled };

export function isKnownProviderId(providerId: string | undefined): boolean {
  if (!providerId) return false;
  return (
    providerId in ACP_PROVIDERS ||
    (providerId === PROGRAMMATIC_TEST_PROVIDER_ID && isProgrammaticTestProviderEnabled())
  );
}

/**
 * Provider Registry - Multi-ACP Provider Architecture
 *
 * Supports multiple ACP-compatible agents (Auggie, OpenCode, etc.)
 * Each agent uses the Agent Client Protocol (ACP) with provider-specific configuration.
 */
export class ProviderRegistry {
  private registry = new Map<string, ProviderFactory>();

  static createDefault(): ProviderRegistry {
    const reg = new ProviderRegistry();

    if (isProgrammaticTestProviderEnabled()) {
      const factory = async (cfg: AgentConfig, autoInit?: boolean) => {
        const { ProgrammaticTestAgentProvider } = await import(
          '../testing/programmatic-test-agent-provider'
        );
        const provider = new ProgrammaticTestAgentProvider({
          ...cfg,
          provider: PROGRAMMATIC_TEST_PROVIDER_ID,
        });
        if (autoInit !== false) {
          await provider.initialize();
        }
        return provider;
      };
      reg.register(PROGRAMMATIC_TEST_PROVIDER_ID, factory);
    }

    // Register all known ACP providers from provider-config
    for (const [providerId, providerConfig] of Object.entries(ACP_PROVIDERS)) {
      // Check legacy env var gating
      if (providerConfig.requiresEnvVar && !process.env[providerConfig.requiresEnvVar]) {
        logger.info(`Skipping provider "${providerId}" (requires env var ${providerConfig.requiresEnvVar})`);
        continue;
      }
      // Check feature code gating
      if (providerConfig.requiresFeatureCode && !featureCodesService.isFeatureEnabled(providerConfig.requiresFeatureCode)) {
        logger.info(`Skipping provider "${providerId}" (requires feature code "${providerConfig.requiresFeatureCode}")`);
        continue;
      }
      const factory = (cfg: AgentConfig, autoInit?: boolean) =>
        getACPWithProvider(cfg, providerConfig, autoInit);
      reg.register(providerId, factory);
    }

    // Get the default provider config
    const defaultConfig = getDefaultProviderConfig();
    const defaultFactory = (cfg: AgentConfig, autoInit?: boolean) =>
      getACPWithProvider(cfg, defaultConfig, autoInit);

    // Register generic 'acp' and 'augment' as aliases for the default provider (backwards compat)
    reg.register('acp', defaultFactory);
    reg.register('augment', defaultFactory);

    // Default provider
    reg.register('default', defaultFactory);

    return reg;
  }

  register(id: string, factory: ProviderFactory): void {
    this.registry.set(id.toLowerCase(), factory);
  }

  has(id: string): boolean {
    return this.registry.has(id.toLowerCase());
  }

  async create(
    id: string,
    config: AgentConfig,
    autoInitialize: boolean = true,
  ): Promise<BaseAgentProvider> {
    const defaultConfig = getDefaultProviderConfig();

    // Handle undefined or null provider ID
    if (!id) {
      logger.warn(
        `No provider ID specified, using default ACP provider (${defaultConfig.displayName})`,
      );
      return getACP(config, autoInitialize);
    }

    const factory = this.registry.get(id.toLowerCase());
    if (!factory) {
      logger.warn(
        `Unknown provider "${id}", using default ACP provider (${defaultConfig.displayName})`,
      );
      // Always fall back to ACP since it's our only provider
      return getACP(config, autoInitialize);
    }
    const provider = await factory(config, autoInitialize);
    return provider;
  }

  list(): string[] {
    // Return all registered provider IDs
    return Array.from(this.registry.keys());
  }
}
