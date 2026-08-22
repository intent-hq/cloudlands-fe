/**
 * DiffViewer - The canonical diff viewer component
 *
 * A pure, reusable diff viewer built on @pierre/diffs with Shiki syntax highlighting.
 * Works in browser without Electron dependencies.
 *
 * @example
 * ```svelte
 * <script>
 *   import { DiffViewer } from '$features/file-tracking/components/diff';
 * </script>
 *
 * <!-- From patch string -->
 * <DiffViewer patch={patchString} fileName="example.ts" />
 *
 * <!-- From content comparison -->
 * <DiffViewer
 *   oldContent={originalCode}
 *   newContent={modifiedCode}
 *   fileName="example.ts"
 *   viewMode="split"
 * />
 * ```
 */

export { default as DiffViewer } from './DiffViewer.svelte';
export { default as PatchBlockContent } from './PatchBlockContent.svelte';
export { default as TrackedChangeDiffViewer } from './TrackedChangeDiffViewer.svelte';

// Legacy alias for backwards compatibility

export * from './types.js';
