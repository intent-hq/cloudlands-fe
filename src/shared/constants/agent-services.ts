/**
 * Agent Services Constants
 *
 * Centralized configuration for all agent service constants.
 * This file consolidates all magic numbers, timeouts, and configuration values.
 */

// ============================================================================
// Cache Configuration
// ============================================================================

export const CACHE_CONFIG = {
  /** TTL for cached agent rules (milliseconds) */
  RULES_TTL: 5 * 60 * 1000, // 5 minutes

  /** TTL for cached model configurations (milliseconds) */
  MODELS_TTL: 10 * 60 * 1000, // 10 minutes

  /** TTL for agent state cache (milliseconds) */
  STATE_TTL: 5 * 60 * 1000, // 5 minutes

  /** Maximum number of cached items before cleanup */
  MAX_CACHE_SIZE: 100,
} as const;

// ============================================================================
// Session Management
// ============================================================================

export const SESSION_CONFIG = {
  /** Maximum number of sessions in memory (LRU cache) */
  MAX_SESSIONS: 10,

  /** Session timeout for inactive agents (milliseconds) */
  SESSION_TIMEOUT: 30 * 60 * 1000, // 30 minutes

  /** Heartbeat interval for active sessions (milliseconds) */
  HEARTBEAT_INTERVAL: 30 * 1000, // 30 seconds

  /** Maximum message history per session */
  MAX_MESSAGES: 1000,

  /** Maximum session file size (bytes) */
  MAX_SESSION_SIZE: 10 * 1024 * 1024, // 10MB
} as const;

// ============================================================================
// Streaming Configuration
// ============================================================================

export const STREAMING_CONFIG = {
  /** Batch interval for streaming updates (milliseconds) - DEPRECATED: Now using immediate mode */
  BATCH_INTERVAL: 0, // 0ms - immediate mode for snappy UI

  /** Timeout for stale streaming sessions (milliseconds) */
  STALE_TIMEOUT: 30 * 1000, // 30 seconds

  /** Cleanup interval for stale sessions (milliseconds) */
  CLEANUP_INTERVAL: 10 * 1000, // 10 seconds

  /** Maximum buffer size before forced flush - DEPRECATED: No longer buffering */
  MAX_BUFFER_SIZE: 100,

  /** Streaming chunk size (characters) */
  CHUNK_SIZE: 1024,
} as const;

// ============================================================================
// Persistence Configuration
// ============================================================================

export const PERSISTENCE_CONFIG = {
  /** Batch save interval (milliseconds) */
  BATCH_SAVE_INTERVAL: 5 * 1000, // 5 seconds

  /** Debounce delay for writes (milliseconds) */
  WRITE_DEBOUNCE_DELAY: 500, // 500ms

  /** Maximum backup files per agent */
  MAX_BACKUPS: 5,

  /** Backup retention period (milliseconds) */
  BACKUP_RETENTION: 7 * 24 * 60 * 60 * 1000, // 7 days

  /** Auto-save interval (milliseconds) */
  AUTO_SAVE_INTERVAL: 60 * 1000, // 1 minute
} as const;

// ============================================================================
// Error Handling & Retry Configuration
// ============================================================================

export const ERROR_CONFIG = {
  /** Default number of retry attempts */
  DEFAULT_RETRIES: 2,

  /** Base retry delay (milliseconds) */
  BASE_RETRY_DELAY: 1000, // 1 second

  /** Maximum retry delay (milliseconds) */
  MAX_RETRY_DELAY: 30 * 1000, // 30 seconds

  /** Exponential backoff multiplier */
  BACKOFF_MULTIPLIER: 2,

  /** Error notification duration (milliseconds) */
  NOTIFICATION_DURATION: 5 * 1000, // 5 seconds
} as const;

// ============================================================================
// Recovery Configuration
// ============================================================================

export const RECOVERY_CONFIG = {
  /** Recovery state save debounce (milliseconds) */
  RECOVERY_DEBOUNCE: 1000, // 1 second

  /** Recovery file retention (milliseconds) */
  RECOVERY_RETENTION: 24 * 60 * 60 * 1000, // 24 hours

  /** Maximum recovery attempts */
  MAX_RECOVERY_ATTEMPTS: 3,

  /** Recovery check interval (milliseconds) */
  RECOVERY_CHECK_INTERVAL: 5 * 1000, // 5 seconds
} as const;

// ============================================================================
// Agent Limits
// ============================================================================

export const AGENT_LIMITS = {
  /** Maximum active (non-paused) agents */
  MAX_ACTIVE_AGENTS: 10,

  /** Maximum total agents (including paused) */
  MAX_TOTAL_AGENTS: 100,

  /** Warning threshold (percentage of max) */
  WARNING_THRESHOLD: 0.8, // 80%

  /** Maximum agent name length */
  MAX_NAME_LENGTH: 100,

  /** Maximum system prompt length */
  MAX_PROMPT_LENGTH: 200000,
} as const;

// ============================================================================
// File Paths
// ============================================================================

export const FILE_PATHS = {
  /** Base workspace directory */
  WORKSPACE_BASE: '~/intent',

  /** Workspace metadata directory */
  WORKSPACE_META: '.workspace',

  /** Agents directory name */
  AGENTS_DIR: 'agents',

  /** Recovery directory name */
  RECOVERY_DIR: 'recovery',

  /** Backups directory name */
  BACKUPS_DIR: 'backups',

  /** File extensions */
  EXTENSIONS: {
    SESSION: '.json',
    RECOVERY: '.recovery',
    BACKUP: '.backup',
    CONFIG: '.config',
  },
} as const;

// ============================================================================
// Model Defaults
// ============================================================================

export const MODEL_IDS = {
  // Claude models
  CLAUDE_OPUS_4_7: 'opus4.7' as const,
  CLAUDE_OPUS_4_6: 'opus4.6' as const,
  CLAUDE_OPUS_4_5: 'opus4.5' as const,
  CLAUDE_SONNET_4_5: 'sonnet4.5' as const,
  CLAUDE_SONNET_4: 'sonnet4' as const,
  CLAUDE_OPUS_4_1: 'opus4.1' as const,
  CLAUDE_HAIKU_4_5: 'haiku4.5' as const,
  CLAUDE_OPUS_4_1_200K: 'claude-opus-4-1-200k-v8-c4-p2-agent' as const,
  CLAUDE_3_OPUS: 'claude-3-opus' as const,
  CLAUDE_3_SONNET: 'claude-3-sonnet' as const,
  CLAUDE_3_HAIKU: 'claude-3-haiku' as const,

  // GPT models
  GPT_4: 'gpt-4' as const,
  GPT_4_TURBO: 'gpt-4-turbo' as const,
  GPT_4O: 'gpt-4o' as const,
  GPT_4O_MINI: 'gpt-4o-mini' as const,
  GPT_3_5_TURBO: 'gpt-3.5-turbo' as const,
  GPT_5_4: 'gpt5.4' as const,
  GPT_5_CODEX: 'gpt5-codex' as const,

  // Gemini models
  GEMINI_25_PRO: 'gemini25-pro' as const,
  GEMINI_3_EAP: 'gemini3-eap' as const,

  // Other models
  GLM_4_6: 'glm4.6' as const,
  O1_PREVIEW: 'o1-preview' as const,
  O1_MINI: 'o1-mini' as const,
} as const;

/**
 * ============================================================================
 * MODEL DEFAULTS
 * ============================================================================
 *
 * Non-model-id defaults only. There is intentionally NO hardcoded interactive
 * default model id: the default model is always derived from the provider
 * CLI's catalog (the row it marks `isDefault`, else the first available row)
 * via `resolveDefaultModel` in
 * `$store/renderer/slices/model/model-selection-utils`.
 */
export const MODEL_DEFAULTS = {
  /**
   * Default model for background agents (commit, PR, review).
   * Uses Haiku for fast, cheap, reliable automated background operations.
   */
  BACKGROUND_AGENT_MODEL: MODEL_IDS.CLAUDE_HAIKU_4_5,

  /**
   * Default model for lightweight background requests (status checks, validations).
   * Uses Haiku for fast, cheap, reliable one-off requests.
   */
  BACKGROUND_REQUEST_MODEL: MODEL_IDS.CLAUDE_HAIKU_4_5,

  /** Default temperature */
  DEFAULT_TEMPERATURE: 0.7,

  /** Default max output tokens we request */
  DEFAULT_MAX_TOKENS: 16000,

  /**
   * Default max input tokens for context management.
   * The actual limit is enforced by the backend/ACP - this is just for
   * client-side estimation and message truncation.
   */
  DEFAULT_MAX_INPUT_TOKENS: 100000,
} as const;

/** Type for the built-in model IDs defined in this file */
export type KnownModelId = (typeof MODEL_IDS)[keyof typeof MODEL_IDS];

/**
 * Type for model IDs throughout the app.
 *
 * This is intentionally `string` because models can be user-provided/custom.
 */
export type ModelId = string;

// ============================================================================
// UI Configuration
// ============================================================================

export const UI_CONFIG = {
  /** Animation duration (milliseconds) */
  ANIMATION_DURATION: 200,

  /** Tooltip delay (milliseconds) */
  TOOLTIP_DELAY: 500,

  /** Scroll behavior */
  SCROLL_BEHAVIOR: 'smooth' as const,

  /** Maximum visible messages before pagination */
  MAX_VISIBLE_MESSAGES: 50,

  /** Message fade-in duration (milliseconds) */
  MESSAGE_FADE_IN: 150,
} as const;

// ============================================================================
// Performance Thresholds
// ============================================================================

export const PERFORMANCE_THRESHOLDS = {
  /** Slow operation threshold (milliseconds) */
  SLOW_OPERATION: 1000,

  /** Very slow operation threshold (milliseconds) */
  VERY_SLOW_OPERATION: 5000,

  /** Memory warning threshold (MB) */
  MEMORY_WARNING: 500,

  /** Memory critical threshold (MB) */
  MEMORY_CRITICAL: 1000,
} as const;

// ============================================================================
// Default Messages
// ============================================================================

export const DEFAULT_MESSAGES = {
  /** Recovery message */
  RECOVERY_MESSAGE:
    'Session was restored after an interruption. The previous response may be incomplete.',

  /** Connection error message */
  CONNECTION_ERROR: 'Unable to connect to the agent service. Please try again.',

  /** Timeout error message */
  TIMEOUT_ERROR: 'The operation timed out. Please try again.',

  /** Generic error message */
  GENERIC_ERROR: 'An unexpected error occurred. Please try again.',
} as const;

// ============================================================================
// Type Guards
// ============================================================================

/** Check if a value is a known model ID (from MODEL_IDS) */
export function isValidModelId(value: string): boolean {
  return Object.values(MODEL_IDS).includes(value as KnownModelId);
}

/** Check if a session has exceeded size limits */
export function isSessionTooLarge(sizeInBytes: number): boolean {
  return sizeInBytes > SESSION_CONFIG.MAX_SESSION_SIZE;
}

/** Check if agent count is at warning threshold */
export function isAtWarningThreshold(activeCount: number): boolean {
  return activeCount >= AGENT_LIMITS.MAX_ACTIVE_AGENTS * AGENT_LIMITS.WARNING_THRESHOLD;
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Expand tilde in paths to home directory */
export function expandPath(path: string): string {
  // In browser environment, we can't expand ~ directly
  // The backend should handle this via IPC
  if (typeof window !== 'undefined') {
    // Frontend - return as-is, backend will handle expansion
    return path;
  }

  // Backend Node.js environment
  if (path.startsWith('~/')) {
    // Use process.env.HOME, USERPROFILE, or os.homedir() for Windows compatibility
    const homeDir = process.env.HOME || process.env.USERPROFILE || require('os').homedir() || '';
    return path.replace('~', homeDir);
  }
  return path;
}

/**
 * Get the full path for an agent session file.
 * @param resolvedBasePath - Optional pre-resolved workspace base path (e.g. from WorkspaceConfig.resolveWorkspaceRoot).
 *   When running in the main process, callers should pass the resolved path to support legacy ~/.workspaces workspaces.
 *   Falls back to expanding FILE_PATHS.WORKSPACE_BASE when not provided (browser / test usage).
 */
export function getSessionPath(
  workspaceId: string,
  agentId: string,
  resolvedBasePath?: string,
): string {
  const basePath = resolvedBasePath ?? expandPath(FILE_PATHS.WORKSPACE_BASE);
  return `${basePath}/${workspaceId}/${FILE_PATHS.WORKSPACE_META}/${FILE_PATHS.AGENTS_DIR}/${agentId}${FILE_PATHS.EXTENSIONS.SESSION}`;
}

/**
 * Get the full path for a recovery file.
 * @param resolvedBasePath - Optional pre-resolved workspace base path (e.g. from WorkspaceConfig.resolveWorkspaceRoot).
 *   When running in the main process, callers should pass the resolved path to support legacy ~/.workspaces workspaces.
 *   Falls back to expanding FILE_PATHS.WORKSPACE_BASE when not provided (browser / test usage).
 */
export function getRecoveryPath(
  workspaceId: string,
  agentId: string,
  resolvedBasePath?: string,
): string {
  const basePath = resolvedBasePath ?? expandPath(FILE_PATHS.WORKSPACE_BASE);
  return `${basePath}/${workspaceId}/${FILE_PATHS.WORKSPACE_META}/${FILE_PATHS.RECOVERY_DIR}/${agentId}${FILE_PATHS.EXTENSIONS.RECOVERY}`;
}

/** Calculate retry delay with exponential backoff */
export function calculateRetryDelay(attempt: number): number {
  const delay =
    ERROR_CONFIG.BASE_RETRY_DELAY * Math.pow(ERROR_CONFIG.BACKOFF_MULTIPLIER, attempt - 1);
  return Math.min(delay, ERROR_CONFIG.MAX_RETRY_DELAY);
}

// Export as default for convenience
export default {
  CACHE_CONFIG,
  SESSION_CONFIG,
  STREAMING_CONFIG,
  PERSISTENCE_CONFIG,
  ERROR_CONFIG,
  RECOVERY_CONFIG,
  AGENT_LIMITS,
  FILE_PATHS,
  MODEL_DEFAULTS,
  UI_CONFIG,
  PERFORMANCE_THRESHOLDS,
  DEFAULT_MESSAGES,
};
