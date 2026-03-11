/**
 * Centralized Constants
 *
 * All magic numbers, timeouts, limits, and configuration values consolidated here.
 * This is the single source of truth for application constants.
 *
 * NOTE: Model defaults are defined in constants/agent-services.ts (MODEL_DEFAULTS).
 * The DEFAULTS.AGENT_MODEL here re-exports from there for backwards compatibility.
 */

// ============================================================================
// TIMEOUTS (milliseconds)
// ============================================================================

export const TIMEOUTS = {
  /** Agent response timeout */
  AGENT_RESPONSE: 30000, // 30 seconds

  /** Streaming chunk interval */
  STREAMING_CHUNK: 100, // 100ms between chunks

  /** Session idle timeout */
  SESSION_IDLE: 600000, // 10 minutes

  /** Persistence retry timeout */
  PERSISTENCE_RETRY: 1000, // 1 second

  /** Backend stream timeout */
  BACKEND_STREAM: 240000, // 4 minutes

  /** Frontend stream cleanup grace period */
  STREAM_CLEANUP_GRACE: 15000, // 15 seconds

  /** Active stream max age */
  ACTIVE_STREAM_MAX_AGE: 24 * 60 * 60 * 1000, // 24 hours

  /** Session timeout for inactive agents */
  SESSION_TIMEOUT: 30 * 60 * 1000, // 30 minutes

  /** Heartbeat interval */
  HEARTBEAT_INTERVAL: 30 * 1000, // 30 seconds

  /** Stale streaming session timeout */
  STALE_STREAM: 30 * 1000, // 30 seconds

  /** Cleanup interval for stale sessions */
  CLEANUP_INTERVAL: 10 * 1000, // 10 seconds

  /** Batch save interval */
  BATCH_SAVE_INTERVAL: 5 * 1000, // 5 seconds

  /** Write debounce delay */
  WRITE_DEBOUNCE: 500, // 500ms

  /** Auto-save interval */
  AUTO_SAVE_INTERVAL: 60 * 1000, // 1 minute

  /** Base retry delay */
  BASE_RETRY_DELAY: 1000, // 1 second

  /** Max retry delay */
  MAX_RETRY_DELAY: 30 * 1000, // 30 seconds

  /** Error notification duration */
  NOTIFICATION_DURATION: 5 * 1000, // 5 seconds

  /** Recovery debounce */
  RECOVERY_DEBOUNCE: 1000, // 1 second

  /** Recovery check interval */
  RECOVERY_CHECK_INTERVAL: 5 * 1000, // 5 seconds

  /** Animation duration */
  ANIMATION_DURATION: 200, // 200ms

  /** Tooltip delay */
  TOOLTIP_DELAY: 500, // 500ms

  /** Message fade-in duration */
  MESSAGE_FADE_IN: 150, // 150ms

  /** Adaptive polling min interval */
  POLLING_MIN_INTERVAL: 2000, // 2 seconds

  /** Adaptive polling max interval */
  POLLING_MAX_INTERVAL: 30000, // 30 seconds

  /** Idle threshold for polling */
  POLLING_IDLE_THRESHOLD: 60000, // 1 minute

  /** Target response time for changes */
  POLLING_RESPONSE_TIME: 5000, // 5 seconds
} as const;

// ============================================================================
// LIMITS (sizes, counts, lengths)
// ============================================================================

export const LIMITS = {
  /** Maximum message length (characters) */
  MAX_MESSAGE_LENGTH: 500000, // 500k chars (~125k tokens)

  /** Maximum messages per session */
  MAX_MESSAGES_PER_SESSION: 1000,

  /** Maximum agents per workspace */
  MAX_AGENTS_PER_WORKSPACE: 50,

  /** Maximum memory usage (bytes) */
  MAX_MEMORY_USAGE: 500 * 1024 * 1024, // 500MB

  /** Maximum active agents */
  MAX_ACTIVE_AGENTS: 10,

  /** Maximum total agents */
  MAX_TOTAL_AGENTS: 100,

  /** Maximum agent name length */
  MAX_NAME_LENGTH: 100,

  /** Maximum system prompt length (characters)
   * System prompts can be large when built with all layers
   * (base prompt, specialization rules, user rules, workspace context, etc.)
   * 200k chars is roughly 50k tokens, which is reasonable for modern models
   */
  MAX_PROMPT_LENGTH: 200000,

  /** Maximum session file size (bytes) */
  MAX_SESSION_SIZE: 10 * 1024 * 1024, // 10MB

  /** Maximum cache size */
  MAX_CACHE_SIZE: 100,

  /** Maximum sessions in memory */
  MAX_SESSIONS: 10,

  /** Maximum visible messages before pagination */
  MAX_VISIBLE_MESSAGES: 50,

  /** Maximum workspaces */
  MAX_WORKSPACES: 100,

  /** Maximum notes per workspace */
  MAX_NOTES_PER_WORKSPACE: 1000,

  /** Maximum comments per note */
  MAX_COMMENTS_PER_NOTE: 10000,

  /** Maximum title length */
  MAX_TITLE_LENGTH: 100,

  /** Maximum content length (bytes) */
  MAX_CONTENT_LENGTH: 1000000, // 1MB

  /** Maximum backup files per agent */
  MAX_BACKUPS: 5,

  /** Maximum open tabs */
  MAX_OPEN_TABS: 20,

  /** Maximum recent workspaces */
  MAX_RECENT_WORKSPACES: 10,

  /** Maximum context cache size */
  MAX_CONTEXT_CACHE_SIZE: 50,

  /** Streaming chunk size (characters) */
  CHUNK_SIZE: 1024,

  /** Default concurrency for batch operations */
  DEFAULT_CONCURRENCY: 3,

  /** Default timeout per operation (ms) */
  DEFAULT_OPERATION_TIMEOUT: 60000, // 1 minute
} as const;

// ============================================================================
// DEFAULTS
// ============================================================================

export const DEFAULTS = {
  /**
   * @deprecated Use MODEL_DEFAULTS.AGENT_MODEL from constants/agent-services.ts instead.
   * Default agent model - uses short model ID format (e.g., 'sonnet4.5', 'opus4.5')
   */
  AGENT_MODEL: 'opus4.5',

  /** Default agent name */
  AGENT_NAME: 'Assistant',

  /** Default workspace name */
  WORKSPACE_NAME: 'Untitled',

  /**
   * @deprecated Use MODEL_DEFAULTS.DEFAULT_TEMPERATURE from constants/agent-services.ts instead.
   * Default temperature
   */
  TEMPERATURE: 0.7,

  /** Default max tokens */
  MAX_TOKENS: 4096,

  /** Default theme */
  THEME: 'dark',

  /** Default font size */
  FONT_SIZE: 14,

  /** Default tab size */
  TAB_SIZE: 2,

  /** Default branch */
  GIT_BRANCH: 'main',

  /** Default remote */
  GIT_REMOTE: 'origin',

  /** Default API URL */
  API_URL: 'https://api.augmentcode.com',

  /** Auto-update CDN URL (GCP Cloud CDN) */
  AUTO_UPDATE_URL: 'https://cdn.augmentcode.com',
} as const;

// ============================================================================
// THRESHOLDS
// ============================================================================

export const THRESHOLDS = {
  /** Slow operation threshold (ms) */
  SLOW_OPERATION: 1000,

  /** Very slow operation threshold (ms) */
  VERY_SLOW_OPERATION: 5000,

  /** Memory warning threshold (MB) */
  MEMORY_WARNING: 500,

  /** Memory critical threshold (MB) */
  MEMORY_CRITICAL: 1000,

  /** Warning threshold for agent count (percentage) */
  AGENT_WARNING_THRESHOLD: 0.8, // 80%

  /** Exponential backoff multiplier */
  BACKOFF_MULTIPLIER: 2,

  /** Activity boost multiplier for polling */
  ACTIVITY_BOOST: 0.5, // 50% faster during activity

  /** Decay rate for polling interval */
  POLLING_DECAY_RATE: 1.2, // 20% increase per adjustment
} as const;

// ============================================================================
// PATHS & FILES
// ============================================================================

export const PATHS = {
  /** Workspace base directory */
  WORKSPACE_BASE: '~/intent',

  /** Workspace metadata directory */
  WORKSPACE_META: '.workspace',

  /** Agents directory */
  AGENTS_DIR: 'agents',

  /** Recovery directory */
  RECOVERY_DIR: 'recovery',

  /** Backups directory */
  BACKUPS_DIR: 'backups',

  /** Cache directory */
  CACHE_DIR: 'cache',

  /** Notes directory */
  NOTES_DIR: 'notes',

  /** Diffs directory */
  DIFFS_DIR: 'diffs',
} as const;

export const FILE_EXTENSIONS = {
  /** Session file extension */
  SESSION: '.json',

  /** Recovery file extension */
  RECOVERY: '.recovery',

  /** Backup file extension */
  BACKUP: '.backup',

  /** Config file extension */
  CONFIG: '.config',

  /** Comments file suffix */
  COMMENTS: '.comments.json',
} as const;

// ============================================================================
// BROWSER PROTOCOLS
// ============================================================================
// Single source of truth for URL protocol validation across the app.
// If you need to change which protocols are allowed, update ONLY this section.

export const BROWSER_PROTOCOLS = {
  /**
   * Protocols allowed in the embedded browser (webview).
   * - http/https: standard web pages
   * - file: local HTML files for dev/testing (safe because nodeIntegration is disabled)
   */
  WEBVIEW_ALLOWED: ['http:', 'https:', 'about:', 'file:'] as readonly string[],

  /**
   * Protocols allowed for user-facing browser navigation (URL bar, openTab, navigate).
   * Subset of WEBVIEW_ALLOWED — excludes about: since users don't type that.
   */
  NAVIGATION_ALLOWED: ['http:', 'https:', 'file:'] as readonly string[],

  /**
   * Protocols that are always blocked — these enable code injection.
   */
  BLOCKED: ['javascript:', 'data:', 'vbscript:', 'blob:'] as readonly string[],

  /**
   * Protocols for external URL opening (system browser, shell:openExternal).
   */
  EXTERNAL: ['http:', 'https:'] as readonly string[],

  /**
   * Internal app protocols (not user-facing).
   */
  INTERNAL: ['app:', 'workspace-asset:'] as readonly string[],
} as const;


/**
 * Browser panel session partition name.
 * Uses 'persist:' prefix for persistent storage across app restarts.
 * This isolates the embedded browser's cookies/storage from the main app session.
 */
export const BROWSER_PANEL_PARTITION = 'persist:browser-panel';

// ============================================================================
// PATTERNS & VALIDATION
// ============================================================================

export const PATTERNS = {
  /** Valid name pattern */
  VALID_NAME: /^[a-zA-Z0-9\s\-_\.]+$/,

  /** Valid ID pattern */
  VALID_ID: /^[a-zA-Z0-9\-_]+$/,

  /** Valid agent name pattern - accepts any non-empty string */
  AGENT_NAME: /^.+$/,

  /** Optimistic ID pattern */
  OPTIMISTIC_ID: /^optimistic-\d+-[a-z0-9]+$/,

  /** UUID pattern */
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,

  /** GitHub URL pattern */
  GITHUB_URL: /^https?:\/\/(www\.)?github\.com\//,

  /** Script injection pattern */
  SCRIPT_TAG: /<script/i,

  /** Event handler pattern */
  EVENT_HANDLER: /on\w+\s*=/i,
} as const;

// ============================================================================
// CACHE TTL (milliseconds)
// ============================================================================

export const CACHE_TTL = {
  /** Rules cache TTL */
  RULES: 5 * 60 * 1000, // 5 minutes

  /** Models cache TTL */
  MODELS: 10 * 60 * 1000, // 10 minutes

  /** State cache TTL */
  STATE: 5 * 60 * 1000, // 5 minutes

  /** Recovery retention */
  RECOVERY_RETENTION: 24 * 60 * 60 * 1000, // 24 hours

  /** Backup retention */
  BACKUP_RETENTION: 7 * 24 * 60 * 60 * 1000, // 7 days

  /** Active stream max age */
  ACTIVE_STREAM_MAX_AGE: 24 * 60 * 60 * 1000, // 24 hours
} as const;

// ============================================================================
// RETRY CONFIGURATION
// ============================================================================

export const RETRY = {
  /** Default number of retry attempts */
  DEFAULT_ATTEMPTS: 2,

  /** Maximum recovery attempts */
  MAX_RECOVERY_ATTEMPTS: 3,

  /** Base retry delay (ms) */
  BASE_DELAY: 1000, // 1 second

  /** Maximum retry delay (ms) */
  MAX_DELAY: 30 * 1000, // 30 seconds

  /** Backoff multiplier */
  MULTIPLIER: 2,
} as const;

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type TimeoutKey = keyof typeof TIMEOUTS;
export type LimitKey = keyof typeof LIMITS;
export type DefaultKey = keyof typeof DEFAULTS;
export type ThresholdKey = keyof typeof THRESHOLDS;
export type PathKey = keyof typeof PATHS;
export type FileExtensionKey = keyof typeof FILE_EXTENSIONS;
export type PatternKey = keyof typeof PATTERNS;
export type CacheTTLKey = keyof typeof CACHE_TTL;
export type RetryKey = keyof typeof RETRY;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate retry delay with exponential backoff
 */
export function calculateRetryDelay(attempt: number): number {
  const delay = RETRY.BASE_DELAY * Math.pow(RETRY.MULTIPLIER, attempt - 1);
  return Math.min(delay, RETRY.MAX_DELAY);
}

/**
 * Check if a value is a valid model ID.
 * @see MODEL_IDS in agent-services.ts for the list of known model IDs
 */
export { isValidModelId } from './constants/agent-services';

/**
 * Check if agent count is at warning threshold
 */
export function isAtWarningThreshold(activeCount: number): boolean {
  return activeCount >= LIMITS.MAX_ACTIVE_AGENTS * THRESHOLDS.AGENT_WARNING_THRESHOLD;
}

/**
 * Check if session has exceeded size limits
 */
export function isSessionTooLarge(sizeInBytes: number): boolean {
  return sizeInBytes > LIMITS.MAX_SESSION_SIZE;
}

/**
 * Expand tilde in paths to home directory
 */
export function expandPath(path: string): string {
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
 *   Falls back to expanding PATHS.WORKSPACE_BASE when not provided (browser / test usage).
 */
export function getSessionPath(
  workspaceId: string,
  agentId: string,
  resolvedBasePath?: string,
): string {
  const basePath = resolvedBasePath ?? expandPath(PATHS.WORKSPACE_BASE);
  // Ensure agentId has the 'agent-' prefix for consistency with how files are saved
  const prefixedAgentId = agentId.startsWith('agent-') ? agentId : `agent-${agentId}`;
  return `${basePath}/${workspaceId}/${PATHS.WORKSPACE_META}/${PATHS.AGENTS_DIR}/${prefixedAgentId}${FILE_EXTENSIONS.SESSION}`;
}

/**
 * Get the full path for a recovery file.
 * @param resolvedBasePath - Optional pre-resolved workspace base path (e.g. from WorkspaceConfig.resolveWorkspaceRoot).
 *   When running in the main process, callers should pass the resolved path to support legacy ~/.workspaces workspaces.
 *   Falls back to expanding PATHS.WORKSPACE_BASE when not provided (browser / test usage).
 */
export function getRecoveryPath(
  workspaceId: string,
  agentId: string,
  resolvedBasePath?: string,
): string {
  const basePath = resolvedBasePath ?? expandPath(PATHS.WORKSPACE_BASE);
  // Ensure agentId has the 'agent-' prefix for consistency with how files are saved
  const prefixedAgentId = agentId.startsWith('agent-') ? agentId : `agent-${agentId}`;
  return `${basePath}/${workspaceId}/${PATHS.WORKSPACE_META}/${PATHS.RECOVERY_DIR}/${prefixedAgentId}${FILE_EXTENSIONS.RECOVERY}`;
}

// ============================================================================
// RECOVERY CONFIGURATION
// ============================================================================

export const RECOVERY = {
  /** Recovery state save debounce (milliseconds) */
  DEBOUNCE: 1000, // 1 second

  /** Recovery file retention (milliseconds) */
  RETENTION: 24 * 60 * 60 * 1000, // 24 hours

  /** Maximum recovery attempts */
  MAX_ATTEMPTS: 3,

  /** Recovery check interval (milliseconds) */
  CHECK_INTERVAL: 5 * 1000, // 5 seconds
} as const;

// ============================================================================
// DEFAULT MESSAGES
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

export default {
  TIMEOUTS,
  LIMITS,
  DEFAULTS,
  THRESHOLDS,
  PATHS,
  FILE_EXTENSIONS,
  PATTERNS,
  CACHE_TTL,
  RETRY,
  RECOVERY,
  DEFAULT_MESSAGES,
};
