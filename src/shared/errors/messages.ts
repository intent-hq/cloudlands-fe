/**
 * Error Messages Module
 *
 * Centralized, user-friendly error messages with:
 * - Message templates with placeholders
 * - Localization support
 * - Help links and recovery suggestions
 * - Context-aware formatting
 */

/**
 * Help documentation links for different error categories
 */
export const HELP_LINKS = {
  AGENT_CREATION: 'https://docs.example.com/agent-creation',
  STREAMING: 'https://docs.example.com/streaming-issues',
  STORAGE: 'https://docs.example.com/storage-troubleshooting',
  MEMORY: 'https://docs.example.com/memory-management',
  PROVIDER: 'https://docs.example.com/provider-setup',
  GENERAL: 'https://docs.example.com/help',
} as const;

/**
 * Message templates with placeholders
 * Use {placeholder} syntax for dynamic values
 */
export const ERROR_MESSAGE_TEMPLATES: Record<string, string> = {
  AGENT_CREATION_FAILED: "Failed to create agent '{agentName}'. {details}",
  AGENT_ALREADY_EXISTS: "An agent named '{agentName}' already exists in this space.",
  INVALID_AGENT_CONFIG: 'Invalid agent configuration: {details}',
  INVALID_CONFIG: 'Invalid configuration: {details}',
  SESSION_NOT_FOUND: 'The chat session (ID: {sessionId}) could not be found. It may have expired.',
  SESSION_ALREADY_ACTIVE: 'This agent session is already active. Cannot start another session.',
  SESSION_INITIALIZATION_FAILED: 'Failed to initialize agent session: {details}',
  STREAM_CONNECTION_FAILED: 'Failed to establish streaming connection to agent. {details}',
  STREAM_TIMEOUT:
    'Response timeout after {timeout}ms. The agent may be processing a complex request.',
  STREAM_INTERRUPTED:
    'Connection interrupted. Attempting to reconnect... (Attempt {attempt}/{maxAttempts})',
  STREAM_RECOVERY_FAILED: 'Failed to recover streaming connection after {attempts} attempts.',
  MESSAGE_SEND_FAILED: 'Failed to send message: {details}',
  MESSAGE_VALIDATION_FAILED: 'Invalid message format: {details}',
  MESSAGE_TOO_LONG:
    'Message exceeds maximum length of {maxLength} characters. Current: {currentLength}',
  PROVIDER_NOT_FOUND: "Agent provider '{provider}' not found.",
  PROVIDER_CONNECTION_FAILED: "Failed to connect to provider '{provider}': {details}",
  PROVIDER_PROCESS_DIED: "Agent process for provider '{provider}' terminated unexpectedly.",
  STORAGE_READ_FAILED: 'Failed to load agent data from storage: {details}',
  STORAGE_WRITE_FAILED: 'Failed to save agent data to storage: {details}',
  STORAGE_CORRUPTED: 'Agent data appears to be corrupted. Last backup: {lastBackup}',
  MEMORY_LIMIT_EXCEEDED:
    'Memory limit exceeded ({currentUsage}MB / {limit}MB). Please close some agents.',
  RATE_LIMIT_EXCEEDED: 'Too many requests ({count} in {window}ms). Please slow down.',
  CONCURRENT_LIMIT_EXCEEDED:
    'Too many concurrent agents ({current}/{max}). Please close some agents.',
} as const;

/**
 * User-friendly fallback messages
 */
export const USER_FRIENDLY_MESSAGES: Record<string, string> = {
  AGENT_CREATION_FAILED: "We couldn't create your agent. Please check your settings and try again.",
  AGENT_ALREADY_EXISTS: 'An agent with this name already exists. Please choose a different name.',
  INVALID_AGENT_CONFIG: 'Your agent configuration is invalid. Please review and correct it.',
  INVALID_CONFIG: 'The configuration provided is invalid. Please check and try again.',
  SESSION_NOT_FOUND: 'The chat session has expired. Please start a new conversation.',
  SESSION_ALREADY_ACTIVE: 'This agent session is already running. Please wait or close it first.',
  SESSION_INITIALIZATION_FAILED: "We couldn't start the agent session. Please try again.",
  STREAM_CONNECTION_FAILED:
    "We couldn't connect to the agent. Please check your connection and try again.",
  STREAM_TIMEOUT:
    "The agent took too long to respond. Please try again or check if it's still running.",
  STREAM_INTERRUPTED: "Your connection was interrupted. We're trying to reconnect...",
  STREAM_RECOVERY_FAILED: "We couldn't reconnect to the agent. Please try again.",
  MESSAGE_SEND_FAILED: "We couldn't send your message. Please try again.",
  MESSAGE_VALIDATION_FAILED: 'Your message format is invalid. Please check and try again.',
  MESSAGE_TOO_LONG: 'Your message is too long. Please shorten it and try again.',
  PROVIDER_NOT_FOUND: 'The agent provider is not available. Please check your setup.',
  PROVIDER_CONNECTION_FAILED:
    "We couldn't connect to the agent provider. Please check your configuration.",
  PROVIDER_PROCESS_DIED: 'The agent process stopped unexpectedly. Please restart it.',
  STORAGE_READ_FAILED: "We couldn't load your agent data. Please try again.",
  STORAGE_WRITE_FAILED: "We couldn't save your agent data. Please try again.",
  STORAGE_CORRUPTED: 'Your agent data appears to be corrupted. Please restore from backup.',
  MEMORY_LIMIT_EXCEEDED: "You're using too much memory. Please close some agents.",
  RATE_LIMIT_EXCEEDED: "You're making too many requests. Please slow down.",
  CONCURRENT_LIMIT_EXCEEDED: 'You have too many agents running. Please close some.',
} as const;

/**
 * Extract placeholder keys from a template string
 */
function getTemplatePlaceholders(template: string): string[] {
  const matches = template.match(/{(\w+)}/g) || [];
  return matches.map((m) => m.slice(1, -1));
}

/**
 * Check if all required placeholders are provided in context
 */
function hasAllPlaceholders(template: string, context: Record<string, any>): boolean {
  const placeholders = getTemplatePlaceholders(template);
  return placeholders.every((key) => key in context);
}

/**
 * Format an error message with context values
 */
export function formatErrorMessage(template: string, context: Record<string, any> = {}): string {
  return template.replace(/{(\w+)}/g, (match, key) => String(context[key] ?? match));
}

/**
 * Clean a raw error message for user-facing display.
 * Strips technical noise like Electron IPC wrappers, retry prefixes,
 * stack traces, "Error:" prefixes, and excessive whitespace so the
 * message is suitable for a toast.
 */
export function cleanErrorMessage(message: string): string {
  const FALLBACK = 'Something went wrong. Please try again.';
  if (!message) return FALLBACK;

  let cleaned = message;

  // Strip retry / "failed after N attempts" wrappers (case-insensitive)
  // Matches: "send message failed after 3 attempts: ..."
  // Matches: "Failed to send message after 3 attempts: ..."
  cleaned = cleaned.replace(/^.*?failed(?:\s+to\s+.*?)?\s+after\s+\d+\s+attempts:\s*/i, '');

  // Strip Electron IPC wrapper: "Error invoking remote method '...': (Error: )?"
  cleaned = cleaned.replace(/^Error invoking remote method '[^']+':(\s*Error:)?\s*/i, '');

  // Strip chained "Error: " or "Error:" prefixes
  cleaned = cleaned.replace(/^(Error:\s*)+/i, '');

  // Remove stack trace lines (lines starting with "at ")
  cleaned = cleaned.replace(/\n\s*at .+/g, '');

  // Trim and collapse whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned || FALLBACK;
}

/**
 * Get user-friendly message for an error code
 *
 * Returns a simple, non-technical message suitable for end users.
 * If context is provided with all required placeholders, formats the template.
 * Otherwise, returns the pre-written user-friendly message.
 */
export function getUserFriendlyMessage(code: string, context?: Record<string, any>): string {
  // If context is provided, template exists, and all placeholders are provided, use formatted template
  if (
    context &&
    ERROR_MESSAGE_TEMPLATES[code] &&
    hasAllPlaceholders(ERROR_MESSAGE_TEMPLATES[code], context)
  ) {
    return formatErrorMessage(ERROR_MESSAGE_TEMPLATES[code], context);
  }
  // Otherwise use the pre-written user-friendly message
  return USER_FRIENDLY_MESSAGES[code] || 'An unexpected error occurred.';
}

/**
 * Get help link for an error code
 */
export function getHelpLink(code: string): string | undefined {
  const categoryMap: Record<string, keyof typeof HELP_LINKS> = {
    AGENT_CREATION_FAILED: 'AGENT_CREATION',
    AGENT_ALREADY_EXISTS: 'AGENT_CREATION',
    INVALID_AGENT_CONFIG: 'AGENT_CREATION',
    STREAM_CONNECTION_FAILED: 'STREAMING',
    STREAM_TIMEOUT: 'STREAMING',
    STREAM_INTERRUPTED: 'STREAMING',
    STREAM_RECOVERY_FAILED: 'STREAMING',
    STORAGE_READ_FAILED: 'STORAGE',
    STORAGE_WRITE_FAILED: 'STORAGE',
    STORAGE_CORRUPTED: 'STORAGE',
    MEMORY_LIMIT_EXCEEDED: 'MEMORY',
    RATE_LIMIT_EXCEEDED: 'MEMORY',
    CONCURRENT_LIMIT_EXCEEDED: 'MEMORY',
    PROVIDER_NOT_FOUND: 'PROVIDER',
    PROVIDER_CONNECTION_FAILED: 'PROVIDER',
    PROVIDER_PROCESS_DIED: 'PROVIDER',
  };

  const category = categoryMap[code];
  return category ? HELP_LINKS[category] : HELP_LINKS.GENERAL;
}

/**
 * Localization support - currently English only
 * Can be extended for multiple languages
 */
export type SupportedLocale = 'en' | 'es' | 'fr' | 'de' | 'ja' | 'zh';

export const LOCALE_MESSAGES: Record<SupportedLocale, Record<string, string>> = {
  en: USER_FRIENDLY_MESSAGES,
  es: {}, // Spanish translations would go here
  fr: {}, // French translations would go here
  de: {}, // German translations would go here
  ja: {}, // Japanese translations would go here
  zh: {}, // Chinese translations would go here
};

/**
 * Get localized message
 */
export function getLocalizedMessage(code: string, locale: SupportedLocale = 'en'): string {
  return LOCALE_MESSAGES[locale][code] || USER_FRIENDLY_MESSAGES[code] || 'An error occurred.';
}
