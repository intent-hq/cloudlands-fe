/**
 * Types for the ChangeSet Visualization component
 */

import type { TrackedChange } from '$features/file-tracking/types';
import type { ChatFileChange } from '$lib/utils/get-file-changes-from-messages';

/**
 * Configuration for the visualization
 */
export interface VisualizationConfig {
  columnWidth: number;
  lineHeight: number;
  gap: number;
  hoverContextLines: number;
  /** Minimum height for columns in pixels */
  minColumnHeight: number;
  /** Maximum height for columns in pixels (0 = no limit) */
  maxColumnHeight: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: VisualizationConfig = {
  columnWidth: 60,
  lineHeight: 0.3,
  gap: 4,
  hoverContextLines: 10,
  minColumnHeight: 10,
  maxColumnHeight: 200,
};

/**
 * Line type for diff visualization
 */
export type LineType = 'add' | 'remove' | 'context';

/**
 * Represents a single line in the visualization
 */
export interface VisualizationLine {
  lineNumber: number;
  type: LineType;
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

/**
 * Represents a file column in the visualization
 */
export interface FileColumn {
  id: string;
  filePath: string;
  fileName: string;
  lines: VisualizationLine[];
  totalLines: number;
  additions: number;
  deletions: number;
  /** Original TrackedChange (for commit/working changes view) */
  change?: TrackedChange;
  /** Original ChatFileChange (for chat changes view) */
  chatChange?: ChatFileChange;
}

/**
 * Position for hover card
 */
export interface HoverPosition {
  x: number;
  y: number;
}

/**
 * Hover state for line preview
 */
export interface HoverState {
  fileColumn: FileColumn;
  lineIndex: number;
  line: VisualizationLine;
  position: HoverPosition;
}
