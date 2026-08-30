/**
 * Intent Link Constants
 *
 * Centralized URL scheme and regex patterns for intent:// protocol links.
 * This file is the SINGLE SOURCE OF TRUTH for all URL patterns used across
 * the Intent codebase.
 *
 * IMPORTANT: If you need to change the URL scheme, update these constants
 * and all usages will automatically be updated.
 */

// ============================================================================
// URL Scheme Constants
// ============================================================================

/**
 * The intent:// protocol scheme
 */
const INTENT_SCHEME = 'intent://';

/**
 * The organization ID (placeholder for future multi-org support)
 */
const INTENT_ORG_ID = 'local';

/**
 * Base URL for intent links: intent://local
 */
const INTENT_BASE_URL = `${INTENT_SCHEME}${INTENT_ORG_ID}`;

// ============================================================================
// URL Template Functions
// ============================================================================

/**
 * Generate an intent:// URL for a task note
 */
export function taskNoteUrl(noteId: string): string {
  return `${INTENT_BASE_URL}/task/${noteId}`;
}

/**
 * Generate an intent:// URL for a note
 */
export function noteUrl(noteId: string, workspaceId?: string): string {
  if (workspaceId) {
    return `${INTENT_BASE_URL}/${workspaceId}/note/${noteId}`;
  }
  return `${INTENT_BASE_URL}/note/${noteId}`;
}

/**
 * Generate a markdown link to a note
 */
export function noteLink(text: string, noteId: string, workspaceId?: string): string {
  return `[${text}](${noteUrl(noteId, workspaceId)})`;
}

/**
 * Generate an intent:// URL for one message in an agent conversation.
 */
export function conversationMessageUrl(
  workspaceId: string,
  agentId: string,
  messageId: string,
): string {
  return `${INTENT_BASE_URL}/${workspaceId}/agent/${agentId}/message/${messageId}`;
}

/**
 * Same as TASK_LINK_REGEX but with a more flexible ID pattern
 * Use this when you need to match any ID format (e.g., for validation)
 */
export const TASK_LINK_REGEX_FLEXIBLE = /\[([^\]]+)\]\(intent:\/\/local\/task\/([^)]+)\)/g;

/**
 * Same as TASK_HREF_REGEX but with flexible ID pattern
 */
export const TASK_HREF_REGEX_FLEXIBLE = /^intent:\/\/local\/task\/(.+)$/;

// ============================================================================
// UUID Validation
// ============================================================================

/**
 * UUID pattern for validating proper UUIDs
 */
export const UUID_REGEX = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/**
 * Reserved note IDs that are valid but not UUIDs (e.g., "spec")
 */
export const RESERVED_NOTE_IDS = new Set(['spec']);
