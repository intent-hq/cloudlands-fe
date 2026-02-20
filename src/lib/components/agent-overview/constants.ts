/**
 * Agent Overview Constants
 *
 * Shared constants for the agent overview graph visualization.
 * Centralizes magic numbers and configuration values for maintainability.
 */

// ============================================================================
// Layout Mode
// ============================================================================

export type LayoutMode = 'force' | 'hierarchical';

/** Default layout mode */
export const DEFAULT_LAYOUT_MODE: LayoutMode = 'hierarchical';

/** Hierarchical layout configuration */
export const HIERARCHICAL_LAYOUT = {
  /** Vertical spacing between agents */
  agentVerticalSpacing: 100,
  /** Horizontal indent per delegation level */
  agentIndentPerLevel: 60,
  /** Fixed X position for notes column (left side) - fixed pixel value from left edge */
  notesColumnX: 80, // Fixed 80px from left edge
  /** Fixed X position for files column (right side) - fixed pixel value from right edge */
  filesColumnXFromRight: 80, // Fixed 80px from right edge
  /** Horizontal wiggle room for notes/files within their swim lane */
  swimLaneWidth: 100,
  /** Top margin for the layout */
  topMargin: 80,
  /** Minimum Y distance between items */
  minYSpacing: 60,
} as const;

/** Collision padding by node type (pixels between nodes) */
export const COLLISION_PADDING = {
  agent: 10,
  file: 0,
  note: 0,
  task: 0,
} as const;

// ============================================================================
// Node Dimensions
// ============================================================================

/**
 * Approximate dimensions for nodes, used for collision detection.
 * Slightly larger than visual dimensions to provide spacing.
 */
export const NODE_DIMENSIONS = {
  agent: { width: 256, height: 100, radius: 60 },
  file: { width: 160, height: 50, radius: 40 },
  note: { width: 160, height: 50, radius: 40 },
  task: { width: 160, height: 50, radius: 40 },
} as const;

/**
 * Visual card dimensions for edge endpoint calculations.
 * These should match the actual rendered card sizes.
 */
export const CARD_DIMENSIONS = {
  agent: { width: 232, height: 72 },
  file: { width: 120, height: 47 },
  note: { width: 120, height: 47 },
  task: { width: 120, height: 47 },
} as const;

export type NodeDimensionType = keyof typeof NODE_DIMENSIONS;

// ============================================================================
// Force Simulation Configuration
// ============================================================================

/** Force simulation physics parameters */
export const SIMULATION_CONFIG = {
  /** Maximum distance for charge force - larger means nodes affect each other from farther away */
  chargeDistanceMax: 200,
  /** Strength of centering force for unpinned nodes (keeps unlinked nodes from drifting) */
  centeringStrength: 0.15,
  /** Collision detection strength */
  collisionStrength: 1.0,
  /** Number of collision detection iterations per tick */
  collisionIterations: 4,
  /** Padding between nodes for collision */
  collisionPadding: 15,
  /** How quickly simulation velocity decays */
  velocityDecay: 0.5,
  /** How quickly simulation cools down */
  alphaDecay: 0.03,
  /** Minimum alpha before simulation stops */
  alphaMin: 0.001,
  /** Alpha value for reheating simulation on updates */
  reheatAlpha: 0.2,
} as const;

/** Repulsion strength by node type (negative = repulsion, more negative = stronger) */
export const CHARGE_STRENGTH = {
  agent: -100,
  file: -30,
  note: -30,
  task: -30,
} as const;

/** Link distance by edge type (pixels) */
export const LINK_DISTANCES = {
  /** Parent-child agent delegation */
  delegation: 120,
  /** Agent reading a file */
  'file-read': 90,
  /** Agent writing to a file */
  'file-write': 80,
  /** Agent reading a note - closer since notes are key context */
  'note-read': 50,
  /** Agent writing to a note - very close since actively working with it */
  'note-write': 40,
  /** Agent creating a task */
  'task-create': 50,
  /** Agent updating a task */
  'task-update': 50,
  default: 80,
} as const;

/** Link strength by edge type (0-1+, higher = stronger pull) */
export const LINK_STRENGTHS = {
  /** Parent-child agent delegation - moderate */
  delegation: 1.0,
  /** Agent reading a file */
  'file-read': 0.8,
  /** Agent writing to a file - stronger since it's an active relationship */
  'file-write': 1.2,
  /** Agent reading a note - strong since notes are important context */
  'note-read': 1.5,
  /** Agent writing to a note - very strong to keep them close */
  'note-write': 2.0,
  /** Agent creating a task */
  'task-create': 1.5,
  /** Agent updating a task */
  'task-update': 1.5,
  default: 1.0,
} as const;

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
export const NOTE_READ_TOOLS = new Set(['read_note', 'view_note']);

/** Tool names that indicate task operations */
export const TASK_TOOLS = new Set([
  'add_tasks',
  'update_tasks',
  'view_tasklist',
  'reorganize_tasklist',
]);

/** Read-only task tools */
export const TASK_READ_TOOLS = new Set(['view_tasklist']);

// ============================================================================
// Timing Constants
// ============================================================================

/** Duration in milliseconds for an edge to be considered "active" */
export const ACTIVE_EDGE_WINDOW_MS = 5000;

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
    stroke: 'var(--color-muted)',
    strokeWidth: 1.5,
    strokeDasharray: 'none',
    opacity: 0.85,
  },
  'file-read': {
    stroke: 'var(--color-muted)',
    strokeWidth: 1.5,
    strokeDasharray: '6,4',
    opacity: 0.6,
  },
  'note-read': {
    stroke: 'var(--color-muted)',
    strokeWidth: 1.5,
    strokeDasharray: '6,4',
    opacity: 0.6,
  },
  'file-write': {
    stroke: 'rgb(59, 130, 246)',
    strokeWidth: 1.5,
    strokeDasharray: 'none',
    opacity: 0.9,
  },
  'note-write': {
    stroke: 'rgb(59, 130, 246)',
    strokeWidth: 1.5,
    strokeDasharray: 'none',
    opacity: 0.9,
  },
  'task-create': {
    stroke: 'rgb(139, 92, 246)',
    strokeWidth: 1.5,
    strokeDasharray: 'none',
    opacity: 0.9,
  },
  'task-update': {
    stroke: 'rgb(139, 92, 246)',
    strokeWidth: 1.5,
    strokeDasharray: 'none',
    opacity: 0.9,
  },
  default: {
    stroke: 'var(--color-border)',
    strokeWidth: 1.5,
    strokeDasharray: 'none',
    opacity: 0.5,
  },
} as const;

export type EdgeStyleType = keyof typeof EDGE_STYLES;
