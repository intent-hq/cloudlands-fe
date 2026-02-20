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
export const INTENT_SCHEME = 'intent://';

/**
 * The organization ID (placeholder for future multi-org support)
 */
export const INTENT_ORG_ID = 'local';

/**
 * Base URL for intent links: intent://local
 */
export const INTENT_BASE_URL = `${INTENT_SCHEME}${INTENT_ORG_ID}`;

/**
 * Task URL base path for constructing dynamic regexes
 * Use this when you need to build a regex with variable content
 */
export const TASK_URL_BASE = `${INTENT_BASE_URL}/task/`;

/**
 * Note URL base path for constructing dynamic regexes
 * Use this when you need to build a regex with variable content
 */
export const NOTE_URL_BASE = `${INTENT_BASE_URL}/note/`;

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
 * Generate a markdown link to a task note
 */
export function taskNoteLink(text: string, noteId: string): string {
  return `[${text}](${taskNoteUrl(noteId)})`;
}

/**
 * Generate a markdown link to a note
 */
export function noteLink(text: string, noteId: string, workspaceId?: string): string {
  return `[${text}](${noteUrl(noteId, workspaceId)})`;
}

// ============================================================================
// Regex Patterns
// ============================================================================

/**
 * Pattern to match UUID-style note IDs (e.g., "550e8400-e29b-41d4-a716-446655440000")
 * Also allows simpler IDs with lowercase hex and hyphens (e.g., "note-abc123")
 */
export const NOTE_ID_PATTERN = '[a-f0-9-]+';

/**
 * Pattern to match any note ID (non-greedy, for use within URLs)
 * Uses [^)]+ to match anything that's not a closing paren (for markdown links)
 */
export const NOTE_ID_PATTERN_FLEXIBLE = '[^)]+';

/**
 * Regex to match task link in markdown: [text](intent://local/task/{noteId})
 * - Use with 'g' flag for global matching
 * - Capture group 1: link text
 * - Capture group 2: note ID
 */
export const TASK_LINK_REGEX = /\[([^\]]+)\]\(intent:\/\/local\/task\/([a-f0-9-]+)\)/g;

/**
 * Same as TASK_LINK_REGEX but with a more flexible ID pattern
 * Use this when you need to match any ID format (e.g., for validation)
 */
export const TASK_LINK_REGEX_FLEXIBLE = /\[([^\]]+)\]\(intent:\/\/local\/task\/([^)]+)\)/g;

/**
 * Same as TASK_LINK_REGEX_FLEXIBLE but anchored for exact string matching
 * Use when you want to verify the entire string is ONLY a task link
 */
export const TASK_LINK_REGEX_EXACT = /^\[([^\]]+)\]\(intent:\/\/local\/task\/([^)]+)\)$/;

/**
 * Regex to match note link in markdown: [text](intent://local/note/{noteId})
 * - Use with 'g' flag for global matching
 * - Capture group 1: link text
 * - Capture group 2: note ID
 */
export const NOTE_LINK_REGEX = /\[([^\]]+)\]\(intent:\/\/local\/note\/([a-f0-9-]+)\)/g;

/**
 * Regex to match task link href (not markdown, just the URL)
 * Use for matching href attributes in HTML/Tiptap nodes
 */
export const TASK_HREF_REGEX = /^intent:\/\/local\/task\/([a-f0-9-]+)$/;

/**
 * Same as TASK_HREF_REGEX but with flexible ID pattern
 */
export const TASK_HREF_REGEX_FLEXIBLE = /^intent:\/\/local\/task\/(.+)$/;

/**
 * Regex to match note link href (not markdown, just the URL)
 */
export const NOTE_HREF_REGEX = /^intent:\/\/local\/note\/([a-f0-9-]+)$/;

/**
 * Check if a string starts with the delegated task link prefix
 */
export function isDelegatedTaskLink(text: string): boolean {
  return text.startsWith('[delegated](intent://');
}

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

/**
 * Check if a note ID is valid (UUID or reserved ID)
 */
export function isValidNoteId(id: string): boolean {
  if (!id || id.trim().length === 0) return false;
  return UUID_REGEX.test(id) || RESERVED_NOTE_IDS.has(id);
}
