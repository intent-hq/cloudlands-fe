/**
 * ChangeSet Visualization Component
 *
 * A compact visual representation of file changes in a changeset.
 * Each file is represented as a vertical column with lines stacked vertically.
 * Added lines are green, deleted lines are red, unchanged lines are dark.
 *
 * Supports both TrackedChange (from file-tracking) and ChatFileChange types.
 */

export { default as ChangeSetVisualization } from './ChangeSetVisualization.svelte';
export { default as FileColumn } from './FileColumn.svelte';
export { default as LineHoverCard } from './LineHoverCard.svelte';

export * from './types';
export * from './utils';
