/**
 * Code Walkthrough Components
 *
 * A set of components for displaying narrated code walkthroughs.
 * These components render AI-generated annotations inline with diffs.
 */

// Main component
export { default as CodeWalkthrough } from './CodeWalkthrough.svelte';

// Sub-components
export { default as WalkthroughSection } from './WalkthroughSection.svelte';
export { default as WalkthroughDiffViewer } from './WalkthroughDiffViewer.svelte';
export { default as WalkthroughAnnotationCard } from './WalkthroughAnnotationCard.svelte';

// Types
export type {
  WalkthroughData,
  WalkthroughSection as WalkthroughSectionType,
  WalkthroughAnnotation,
  AnnotationCategory,
  AnnotationImportance,
  WalkthroughStatus,
  CodeWalkthrough as CodeWalkthroughType,
  ParsedWalkthrough,
} from './types';

// Utilities from types
export {
  parseWalkthroughResult,
  generateAnnotationId,
  groupAnnotationsByFile,
} from './types';

// Patch parsing utilities
export { parsePatch, splitDiffByFile, extractFilePath } from './patch-utils';
export type { Hunk, DiffLine, LineType } from './patch-utils';
