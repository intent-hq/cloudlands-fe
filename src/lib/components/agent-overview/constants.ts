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
  'apply_patch',
  'edit',
  'write',
]);

/** Tool names that indicate file read operations */
export const FILE_READ_TOOLS = new Set(['view', 'read', 'read-file', 'read_file']);

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

/** Maximum resource satellites shown for an agent before they collapse. */
export const MAX_VISIBLE_RESOURCES_PER_AGENT = 6;

/** Maximum rendered node dimensions used by layout collision and fit-to-view. */
export const GRAPH_NODE_DIMENSIONS = {
  agent: { width: 112, height: 88 },
  task: { width: 176, height: 48 },
  file: { width: 72, height: 88 },
  note: { width: 72, height: 88 },
} as const;

/** Clear space beyond node bounds for related-node orbits. */
export const GRAPH_NODE_GAPS = {
  collision: 16,
  taskAgent: 30,
  agentResource: 20,
} as const;

/** Shared zoom limits and per-side fit padding. */
export const GRAPH_ZOOM_EXTENT: [number, number] = [0.25, 2.5];
export const GRAPH_FIT_PADDING = 48;

// ============================================================================
// Edge Animation Configuration
// ============================================================================

/** Configuration for edge pulse animation */
export const EDGE_ANIMATION = {
  /** Base duration in seconds (scaled by path length) */
  baseDuration: 1,
  /** Pixels per second for animation speed calculation */
  speedFactor: 150,
  /** Minimum animation duration in seconds */
  minDuration: 1,
} as const;

// ============================================================================
// Edge Styling
// ============================================================================

/** Edge visual styles by type */
export const EDGE_STYLES = {
  delegation: {
    stroke: 'var(--color-muted-foreground)',
    strokeWidth: 1,
    strokeDasharray: 'none',
    opacity: 0.66,
  },
  'task-assignment': {
    stroke: 'var(--color-muted-foreground)',
    strokeWidth: 1,
    strokeDasharray: 'none',
    opacity: 0.45,
  },
  message: {
    stroke: 'var(--color-muted-foreground)',
    strokeWidth: 0.75,
    strokeDasharray: 'none',
    opacity: 0.58,
  },
  'waiting-on': {
    stroke: 'var(--color-muted-foreground)',
    strokeWidth: 0.75,
    strokeDasharray: '2 3',
    opacity: 0.64,
  },
  'file-read': {
    stroke: 'var(--color-muted-foreground)',
    strokeWidth: 0.75,
    strokeDasharray: '2 3',
    opacity: 0.3,
  },
  'note-read': {
    stroke: 'var(--color-muted-foreground)',
    strokeWidth: 0.75,
    strokeDasharray: '2 3',
    opacity: 0.3,
  },
  'file-write': {
    stroke: 'var(--color-muted-foreground)',
    strokeWidth: 0.75,
    strokeDasharray: 'none',
    opacity: 0.54,
  },
  'note-write': {
    stroke: 'var(--color-muted-foreground)',
    strokeWidth: 0.75,
    strokeDasharray: 'none',
    opacity: 0.54,
  },
  'task-create': {
    stroke: 'var(--color-border)',
    strokeWidth: 0.75,
    strokeDasharray: '2 3',
    opacity: 0.5,
  },
  'task-update': {
    stroke: 'var(--color-border)',
    strokeWidth: 0.75,
    strokeDasharray: '2 3',
    opacity: 0.5,
  },
  default: {
    stroke: 'var(--color-border)',
    strokeWidth: 0.75,
    strokeDasharray: 'none',
    opacity: 0.4,
  },
} as const;
