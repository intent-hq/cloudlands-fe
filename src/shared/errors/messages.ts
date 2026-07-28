/**
 * Error Messages Module
 *
 * Centralized, user-friendly error messages with:
 * - Message templates with placeholders
 * - Localization support
 * - Help links and recovery suggestions
 * - Context-aware formatting
 */

import { m } from '../paraglide/messages.js';

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
 *
 * Property getters re-render the Paraglide message on every access so
 * templates follow the active locale. Each getter feeds the message's own
 * `{placeholder}` markers back in as parameter values, reconstructing the
 * placeholder-bearing template that `formatErrorMessage()` /
 * `hasAllPlaceholders()` substitute later with real context values.
 */
export const ERROR_MESSAGE_TEMPLATES: Record<string, string> = {
  get AGENT_CREATION_FAILED() {
    return m.errors_catalog_agentCreationFailed_template({
      agentName: '{agentName}',
      details: '{details}',
    });
  },
  get AGENT_ALREADY_EXISTS() {
    return m.errors_catalog_agentAlreadyExists_template({ agentName: '{agentName}' });
  },
  get INVALID_AGENT_CONFIG() {
    return m.errors_catalog_invalidAgentConfig_template({ details: '{details}' });
  },
  get INVALID_CONFIG() {
    return m.errors_catalog_invalidConfig_template({ details: '{details}' });
  },
  get SESSION_NOT_FOUND() {
    return m.errors_catalog_sessionNotFound_template({ sessionId: '{sessionId}' });
  },
  get SESSION_ALREADY_ACTIVE() {
    return m.errors_catalog_sessionAlreadyActive_template();
  },
  get SESSION_INITIALIZATION_FAILED() {
    return m.errors_catalog_sessionInitializationFailed_template({ details: '{details}' });
  },
  get STREAM_CONNECTION_FAILED() {
    return m.errors_catalog_streamConnectionFailed_template({ details: '{details}' });
  },
  get STREAM_TIMEOUT() {
    return m.errors_catalog_streamTimeout_template({ timeout: '{timeout}' });
  },
  get STREAM_INTERRUPTED() {
    return m.errors_catalog_streamInterrupted_template({
      attempt: '{attempt}',
      maxAttempts: '{maxAttempts}',
    });
  },
  get STREAM_RECOVERY_FAILED() {
    return m.errors_catalog_streamRecoveryFailed_template({ attempts: '{attempts}' });
  },
  get MESSAGE_SEND_FAILED() {
    return m.errors_catalog_messageSendFailed_template({ details: '{details}' });
  },
  get MESSAGE_VALIDATION_FAILED() {
    return m.errors_catalog_messageValidationFailed_template({ details: '{details}' });
  },
  get MESSAGE_TOO_LONG() {
    return m.errors_catalog_messageTooLong_template({
      maxLength: '{maxLength}',
      currentLength: '{currentLength}',
    });
  },
  get PROVIDER_NOT_FOUND() {
    return m.errors_catalog_providerNotFound_template({ provider: '{provider}' });
  },
  get PROVIDER_CONNECTION_FAILED() {
    return m.errors_catalog_providerConnectionFailed_template({
      provider: '{provider}',
      details: '{details}',
    });
  },
  get PROVIDER_PROCESS_DIED() {
    return m.errors_catalog_providerProcessDied_template({ provider: '{provider}' });
  },
  get STORAGE_READ_FAILED() {
    return m.errors_catalog_storageReadFailed_template({ details: '{details}' });
  },
  get STORAGE_WRITE_FAILED() {
    return m.errors_catalog_storageWriteFailed_template({ details: '{details}' });
  },
  get STORAGE_CORRUPTED() {
    return m.errors_catalog_storageCorrupted_template({ lastBackup: '{lastBackup}' });
  },
  get MEMORY_LIMIT_EXCEEDED() {
    return m.errors_catalog_memoryLimitExceeded_template({
      currentUsage: '{currentUsage}',
      limit: '{limit}',
    });
  },
  get RATE_LIMIT_EXCEEDED() {
    return m.errors_catalog_rateLimitExceeded_template({ count: '{count}', window: '{window}' });
  },
  get CONCURRENT_LIMIT_EXCEEDED() {
    return m.errors_catalog_concurrentLimitExceeded_template({
      current: '{current}',
      max: '{max}',
    });
  },
};

/**
 * User-friendly fallback messages
 *
 * Property getters resolve the Paraglide message at lookup time so the
 * catalog follows the active locale.
 */
export const USER_FRIENDLY_MESSAGES: Record<string, string> = {
  get AGENT_CREATION_FAILED() {
    return m.errors_catalog_agentCreationFailed_friendly();
  },
  get AGENT_ALREADY_EXISTS() {
    return m.errors_catalog_agentAlreadyExists_friendly();
  },
  get INVALID_AGENT_CONFIG() {
    return m.errors_catalog_invalidAgentConfig_friendly();
  },
  get INVALID_CONFIG() {
    return m.errors_catalog_invalidConfig_friendly();
  },
  get SESSION_NOT_FOUND() {
    return m.errors_catalog_sessionNotFound_friendly();
  },
  get SESSION_ALREADY_ACTIVE() {
    return m.errors_catalog_sessionAlreadyActive_friendly();
  },
  get SESSION_INITIALIZATION_FAILED() {
    return m.errors_catalog_sessionInitializationFailed_friendly();
  },
  get STREAM_CONNECTION_FAILED() {
    return m.errors_catalog_streamConnectionFailed_friendly();
  },
  get STREAM_TIMEOUT() {
    return m.errors_catalog_streamTimeout_friendly();
  },
  get STREAM_INTERRUPTED() {
    return m.errors_catalog_streamInterrupted_friendly();
  },
  get STREAM_RECOVERY_FAILED() {
    return m.errors_catalog_streamRecoveryFailed_friendly();
  },
  get MESSAGE_SEND_FAILED() {
    return m.errors_catalog_messageSendFailed_friendly();
  },
  get MESSAGE_VALIDATION_FAILED() {
    return m.errors_catalog_messageValidationFailed_friendly();
  },
  get MESSAGE_TOO_LONG() {
    return m.errors_catalog_messageTooLong_friendly();
  },
  get PROVIDER_NOT_FOUND() {
    return m.errors_catalog_providerNotFound_friendly();
  },
  get PROVIDER_CONNECTION_FAILED() {
    return m.errors_catalog_providerConnectionFailed_friendly();
  },
  get PROVIDER_PROCESS_DIED() {
    return m.errors_catalog_providerProcessDied_friendly();
  },
  get STORAGE_READ_FAILED() {
    return m.errors_catalog_storageReadFailed_friendly();
  },
  get STORAGE_WRITE_FAILED() {
    return m.errors_catalog_storageWriteFailed_friendly();
  },
  get STORAGE_CORRUPTED() {
    return m.errors_catalog_storageCorrupted_friendly();
  },
  get MEMORY_LIMIT_EXCEEDED() {
    return m.errors_catalog_memoryLimitExceeded_friendly();
  },
  get RATE_LIMIT_EXCEEDED() {
    return m.errors_catalog_rateLimitExceeded_friendly();
  },
  get CONCURRENT_LIMIT_EXCEEDED() {
    return m.errors_catalog_concurrentLimitExceeded_friendly();
  },
};

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
  const FALLBACK = m.errors_cleanMessage_fallback_error();
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
  return USER_FRIENDLY_MESSAGES[code] || m.errors_userFriendly_fallback_error();
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
  return LOCALE_MESSAGES[locale][code] || USER_FRIENDLY_MESSAGES[code] || m.errors_localized_fallback_error();
}
