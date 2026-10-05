/**
 * Agent Overview Constants
 *
 * Shared constants for the agent overview graph visualization.
 * Centralizes magic numbers and configuration values for maintainability.
 */

// ============================================================================
// Tool Names for File/Note Detection
// ============================================================================

/** Tool names that indicate file editing operations */
export const FILE_EDIT_TOOLS = new Set([
  'str-replace-editor',
  'save-file',
  'remove-files',
  'str_replace_editor',
]);

/** Tool names that indicate note operations */
export const NOTE_TOOLS = new Set([
  'create_note',
  'update_note', // Legacy alias
  'set_note_content',
  'add_to_note',
  'append_to_note', // Legacy alias
  'edit_note',
  'edit_note_lines',
  'update_note_metadata',
  'read_note',
  'view_note',
  'delete_note',
]);

/** Read-only note tools (for determining action type) */
export const NOTE_READ_TOOLS = new Set(['read_note', 'view_note', 'list_note_tasks']);

/** Tool names that indicate task operations */
export const TASK_TOOLS = new Set([
  'add_tasks',
  'update_tasks',
  'view_tasklist',
  'reorganize_tasklist',
]);

/** Read-only task tools */
export const TASK_READ_TOOLS = new Set(['view_tasklist']);

/** Tool names that indicate agent delegation operations */
export const DELEGATION_TOOLS = new Set(['delegate_task', 'create_sub_agent', 'create_agent']);

// ============================================================================
// Timing Constants
// ============================================================================

/** Duration in milliseconds for an edge to be considered "active" */
export const ACTIVE_EDGE_WINDOW_MS = 5000;
