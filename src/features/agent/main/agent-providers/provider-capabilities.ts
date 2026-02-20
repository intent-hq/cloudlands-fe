import {
  type ACPProviderConfig,
  getDefaultProviderId,
} from '$shared/config/provider-config';
import type { AgentConfig } from './base-provider';

export interface ProviderCapabilities {
  id: string;
  command?: string;
  supportsAuthenticate: boolean;
  supportsSetMode: boolean;
  supportsMcpConfig: boolean;
  supportsRulesFile: boolean;
  rulesFlag?: string;
  mcpConfigFlag?: string;
  quietFlag?: string;
  /** CLI flag used to pass the model (e.g., '--model'). Undefined when the provider
   *  passes model config through other means (env vars, custom args, etc.). */
  modelFlag?: string;
  defaultAgent: string;
  modeMap: Record<string, string>;
  displayName: string;
}

function getProviderId(config: AgentConfig): string {
  const providerConfig = (config as any)._providerConfig as ACPProviderConfig | undefined;
  return providerConfig?.id || config.provider || config.command || getDefaultProviderId();
}

function resolveDefaultAgent(config: AgentConfig, providerConfig?: ACPProviderConfig): string {
  // Prefer provider-config default (set by ProviderRegistry)
  if (providerConfig?.defaultAgent) {
    return providerConfig.defaultAgent;
  }

  // Fallback: parse OPENCODE_CONFIG_CONTENT if present
  const opencodeConfig = config.env?.OPENCODE_CONFIG_CONTENT;
  if (opencodeConfig) {
    try {
      const parsed = JSON.parse(opencodeConfig);
      const defaultAgent = (parsed as any).default_agent || (parsed as any).defaultAgent;
      if (typeof defaultAgent === 'string') {
        return defaultAgent;
      }
    } catch {
      // Ignore parse errors; fall through to generic default
    }
  }

  return 'default';
}

function resolveModeMap(
  providerId: string,
  defaultAgent: string,
  providerConfig?: ACPProviderConfig,
): Record<string, string> {
  if (providerConfig?.modeMap) {
    return providerConfig.modeMap;
  }

  // Provider-specific defaults
  if (providerId === 'opencode') {
    return {
      plan: 'plan',
      agent: defaultAgent,
      ask: 'ask',
    };
  }

  // Generic defaults (auggie / others)
  return {
    plan: 'default',
    agent: defaultAgent,
    ask: 'ask',
  };
}

export function resolveProviderCapabilities(config: AgentConfig): ProviderCapabilities {
  const providerConfig = (config as any)._providerConfig as ACPProviderConfig | undefined;
  const providerId = getProviderId(config);
  const defaultAgent = resolveDefaultAgent(config, providerConfig);

  // Use provider config values with sensible defaults
  const supportsAuthenticate = providerConfig?.supportsAuthenticate ?? true;
  const supportsSetMode = providerConfig?.supportsSetMode ?? true;
  const supportsMcpConfig = providerConfig?.supportsMcpConfig ?? false;
  const supportsRulesFile = providerConfig?.supportsRulesFile ?? false;

  return {
    id: providerId,
    command: providerConfig?.command || config.command,
    displayName: providerConfig?.displayName || providerId,
    supportsAuthenticate: !!supportsAuthenticate,
    supportsSetMode: !!supportsSetMode,
    supportsMcpConfig: !!supportsMcpConfig,
    supportsRulesFile: !!supportsRulesFile,
    rulesFlag: providerConfig?.rulesFlag,
    mcpConfigFlag: providerConfig?.mcpConfigFlag,
    quietFlag: providerConfig?.quietFlag,
    modelFlag: providerConfig?.modelFlag,
    defaultAgent,
    modeMap: resolveModeMap(providerId, defaultAgent, providerConfig),
  };
}
