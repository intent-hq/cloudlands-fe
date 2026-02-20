/**
 * Types for the PureDiff component
 *
 * These types are designed to work with @pierre/diffs library while providing
 * a clean API for the PureDiff component.
 */

/**
 * Stage type for per-line stage indicators in TrackedChangeDiffViewer
 */
export type LineStage = 'staged' | 'unstaged' | 'committed';

/**
 * Per-line stage indicator - maps new line number to stage
 */
export interface LineStageIndicator {
  lineNumber: number;
  stage: LineStage;
}

/**
 * View mode for the diff display
 */
export type DiffViewMode = 'unified' | 'split';

/**
 * Style of diff indicators (bars on the left, classic +/-, or none)
 */
export type DiffIndicatorStyle = 'bars' | 'classic' | 'none';

/**
 * Overflow behavior for long lines
 */
export type DiffOverflow = 'scroll' | 'wrap';

/**
 * Hunk separator style
 */
export type DiffHunkSeparators = 'simple' | 'metadata' | 'line-info' | 'custom';

/**
 * Inline diff highlighting type
 */
export type DiffLineDiffType = 'word-alt' | 'word' | 'char' | 'none';

/**
 * Theme type for the diff viewer
 */
export type DiffThemeType = 'system' | 'light' | 'dark';

/**
 * Annotation side (which column the annotation appears in)
 */
export type AnnotationSide = 'deletions' | 'additions';

/**
 * Expansion directions for hunk expansion
 */
export type ExpansionDirections = 'up' | 'down' | 'both';

/**
 * Line types in a diff
 */
export type LineTypes = 'change-deletion' | 'change-addition' | 'context' | 'context-expanded';

/**
 * Selected line range for line selection feature
 */
export interface SelectedLineRange {
  start: number;
  side?: AnnotationSide;
  end: number;
  endSide?: AnnotationSide;
}

/**
 * Hunk data for custom hunk separator rendering
 */
export interface HunkData {
  slotName: string;
  hunkIndex: number;
  lines: number;
  type: 'additions' | 'deletions' | 'unified';
  expandable?: {
    chunked: boolean;
    up: boolean;
    down: boolean;
  };
}

/**
 * Props passed to line click callbacks
 */
export interface OnDiffLineClickProps {
  type: 'diff-line';
  lineNumber: number;
  lineElement: HTMLElement;
  numberElement: HTMLElement | undefined;
  numberColumn: boolean;
  annotationSide: AnnotationSide;
  lineType: LineTypes;
  event: PointerEvent;
}

/**
 * Props passed to line enter/leave callbacks
 */
export interface OnDiffLineEnterLeaveProps {
  type: 'diff-line';
  lineNumber: number;
  lineElement: HTMLElement;
  numberElement: HTMLElement | undefined;
  numberColumn: boolean;
  annotationSide: AnnotationSide;
  lineType: LineTypes;
  event: PointerEvent;
}

/**
 * Action button configuration for the diff header
 */
export interface DiffAction {
  label: string;
  icon?: string;
  variant?: 'default' | 'primary' | 'success' | 'danger';
  disabled?: boolean;
  onClick: () => void;
}

/**
 * Line annotation for adding comments, guides, or other content to specific lines
 */
export interface PureDiffLineAnnotation<T = undefined> {
  side: AnnotationSide;
  lineNumber: number;
  metadata?: T;
}

/**
 * Props for the PureDiff component
 */
export interface PureDiffProps<TAnnotation = undefined> {
  // === Input (one of these is required) ===
  /** Unified diff/patch string */
  patch?: string;
  /** Original file content (used with newContent) */
  oldContent?: string;
  /** Modified file content (used with oldContent) */
  newContent?: string;

  // === File info ===
  /** File name for display and language detection */
  fileName?: string;
  /** Previous file name (for renames) */
  oldFileName?: string;
  /** Override language detection */
  language?: string;

  // === View mode ===
  /** Display mode: unified (stacked) or split (side-by-side) */
  viewMode?: DiffViewMode;

  // === Display options ===
  /** Show file header with name and stats */
  showHeader?: boolean;
  /** Show +/- line count stats in header */
  showStats?: boolean;
  /** Show line numbers */
  showLineNumbers?: boolean;
  /** Style of diff indicators */
  diffIndicators?: DiffIndicatorStyle;
  /** How to handle long lines */
  overflow?: DiffOverflow;
  /** Maximum height before scrolling */
  maxHeight?: string;

  // === Hunk/context options ===
  /** Style of hunk separators */
  hunkSeparators?: DiffHunkSeparators;
  /** Allow expanding collapsed unchanged regions */
  expandUnchanged?: boolean;
  /** Number of lines to show when expanding */
  expansionLineCount?: number;

  // === Inline change highlighting ===
  /** Type of inline diff highlighting */
  lineDiffType?: DiffLineDiffType;
  /** Maximum line length for inline diff calculation */
  maxLineDiffLength?: number;

  // === Collapse/expand ===
  /** Allow collapsing the entire diff */
  collapsible?: boolean;
  /** Start in collapsed state */
  initialCollapsed?: boolean;
  /** Number of lines to show when collapsed (preview) */
  previewLines?: number;

  // === Line annotations ===
  /** Annotations to display on specific lines */
  annotations?: PureDiffLineAnnotation<TAnnotation>[];
  /** Custom render function for annotations */
  renderAnnotation?: (annotation: PureDiffLineAnnotation<TAnnotation>) => HTMLElement | undefined;

  // === Line selection ===
  /** Enable line selection */
  enableLineSelection?: boolean;
  /** Currently selected line range */
  selectedLines?: SelectedLineRange | null;
  /** Callback when line selection changes */
  onLineSelected?: (range: SelectedLineRange | null) => void;

  // === Callbacks ===
  /** Callback when a line is clicked */
  onLineClick?: (props: OnDiffLineClickProps) => void;
  /** Callback when a line number is clicked */
  onLineNumberClick?: (props: OnDiffLineClickProps) => void;
  /** Callback when mouse enters a line */
  onLineEnter?: (props: OnDiffLineEnterLeaveProps) => void;
  /** Callback when mouse leaves a line */
  onLineLeave?: (props: OnDiffLineEnterLeaveProps) => void;
  /** Callback when collapse state changes */
  onToggleCollapse?: (collapsed: boolean) => void;

  // === Actions ===
  /** Action buttons to show in the header */
  actions?: DiffAction[];

  // === Hover utility ===
  /** Enable hover utility (for adding comments, etc.) */
  enableHoverUtility?: boolean;
  /** Custom render function for hover utility */
  renderHoverUtility?: (
    getHoveredRow: () => { lineNumber: number; side: 'additions' | 'deletions' } | undefined,
  ) => HTMLElement | null;

  // === Custom hunk separators ===
  /** Custom render function for hunk separators */
  renderHunkSeparator?: (
    hunk: HunkData,
    expandHunk: (direction: 'up' | 'down' | 'both') => void,
  ) => HTMLElement | DocumentFragment;

  // === Styling ===
  /** Additional CSS classes */
  class?: string;
  /** Inline styles */
  style?: string;
  /** Custom CSS to inject into the shadow DOM (for @pierre/diffs web component) */
  unsafeCSS?: string;

  // === Performance options ===
  /**
   * Maximum number of total lines before disabling syntax highlighting.
   * For very large files, syntax highlighting can be slow and block the main thread.
   * When exceeded, the diff will render without syntax highlighting.
   * Default: 5000 lines
   */
  maxHighlightLines?: number;
  /**
   * Disable syntax highlighting entirely.
   * Useful for performance-critical scenarios or when highlighting is not needed.
   */
  disableHighlighting?: boolean;
}
