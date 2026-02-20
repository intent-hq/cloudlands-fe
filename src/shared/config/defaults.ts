import type { AgentId } from '$shared/types/branded-ids';
/**
 * Default Configuration Values
 *
 * Provides sensible defaults for all configuration types.
 * These defaults ensure the system works out-of-the-box.
 */

import type { AgentConfig, StreamConfig, PersistenceConfig, AppConfig } from './types';
import { TIMEOUTS, LIMITS, DEFAULTS as CONST_DEFAULTS } from '../constants';
import { generateRandomAgentName } from '../../lib/utils/agent-name-generator';

// ============================================================================
// Default Agent Configuration
// ============================================================================

/**
 * Get default agent configuration with a unique random name.
 * Use this function instead of DEFAULT_AGENT_CONFIG for new agents.
 */
export function getDefaultAgentConfig(): AgentConfig {
  return {
    name: generateRandomAgentName(),
    model: CONST_DEFAULTS.AGENT_MODEL,
    temperature: CONST_DEFAULTS.TEMPERATURE,
    maxTokens: CONST_DEFAULTS.MAX_TOKENS,
    systemPrompt: undefined,
    metadata: {},
  };
}

/**
 * @deprecated Use getDefaultAgentConfig() for new agents to get unique names.
 * This constant is kept for backwards compatibility.
 */
export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  name: CONST_DEFAULTS.AGENT_NAME,
  model: CONST_DEFAULTS.AGENT_MODEL,
  temperature: CONST_DEFAULTS.TEMPERATURE,
  maxTokens: CONST_DEFAULTS.MAX_TOKENS,
  systemPrompt: undefined,
  metadata: {},
};

// ============================================================================
// Default Streaming Configuration
// ============================================================================

export const DEFAULT_STREAM_CONFIG: Omit<StreamConfig, 'sessionId' | 'agentId'> = {
  backpressureThreshold: 100,
  chunkTimeout: 5000, // 5 seconds
  maxQueueSize: 1000,
};

// ============================================================================
// Default Persistence Configuration
// ============================================================================

export const DEFAULT_PERSISTENCE_CONFIG: PersistenceConfig = {
  basePath: '.workspace/agents',
  backupEnabled: true,
  compressionEnabled: false,
  maxBackups: 5,
  autoSaveInterval: 60000, // 1 minute
};

// ============================================================================
// Default Application Configuration
// ============================================================================

export const DEFAULT_APP_CONFIG: AppConfig = {
  agent: DEFAULT_AGENT_CONFIG,
  streaming: {
    sessionId: 'default-session' as AgentId,
    agentId: 'default-agent' as AgentId,
    ...DEFAULT_STREAM_CONFIG,
  },
  persistence: DEFAULT_PERSISTENCE_CONFIG,
  app: {
    debugMode: false,
    enableExperimental: false,
    metadata: {},
  },
};

// ============================================================================
// Configuration Constants (Re-exported from centralized constants)
// ============================================================================

export const CONFIG_CONSTANTS = {
  // Timeouts
  AGENT_RESPONSE_TIMEOUT: TIMEOUTS.AGENT_RESPONSE,
  STREAMING_CHUNK_TIMEOUT: TIMEOUTS.STREAMING_CHUNK,
  SESSION_IDLE_TIMEOUT: TIMEOUTS.SESSION_IDLE,
  PERSISTENCE_RETRY_TIMEOUT: TIMEOUTS.PERSISTENCE_RETRY,

  // Limits
  MAX_MESSAGE_LENGTH: LIMITS.MAX_MESSAGE_LENGTH,
  MAX_MESSAGES_PER_SESSION: LIMITS.MAX_MESSAGES_PER_SESSION,
  MAX_AGENTS_PER_WORKSPACE: LIMITS.MAX_AGENTS_PER_WORKSPACE,
  MAX_MEMORY_USAGE: LIMITS.MAX_MEMORY_USAGE,

  // Streaming
  DEFAULT_BATCH_INTERVAL: 100, // ms
  DEFAULT_MAX_BATCH_SIZE: 50,
  DEFAULT_BACKPRESSURE_THRESHOLD: 100,

  // Persistence
  DEFAULT_BACKUP_RETENTION: 7 * 24 * 60 * 60 * 1000, // 7 days
  DEFAULT_BATCH_SAVE_INTERVAL: TIMEOUTS.BATCH_SAVE_INTERVAL,
  DEFAULT_WRITE_DEBOUNCE_DELAY: TIMEOUTS.WRITE_DEBOUNCE,
} as const;
