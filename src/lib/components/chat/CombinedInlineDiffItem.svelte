<script lang="ts">
  /**
   * Combined Inline Diff Item
   *
   * Displays multiple change parts (staged, unstaged, committed) for the same file
   * in a unified view where all changes are merged into a single diff.
   *
   * Uses DiffViewer to render the merged patch with proper line numbers and
   * syntax highlighting.
   */

  import type { ChangePart } from './types';
  import UnifiedMultiStageDiff from './UnifiedMultiStageDiff.svelte';

  interface Props {
    /** The parts to display (staged, unstaged, committed) */
    parts: ChangePart[];
    foldUnchanged?: boolean;
    lineWrapping?: boolean;
    isAggregate?: boolean;
    onStageHunk?: (filePath: string, hunkPatch: string) => void;
    onUnstageHunk?: (filePath: string, hunkPatch: string) => void;
    onOpenCommit?: (commitHash: string) => void;
    /** Optional virtualizer forwarded to the underlying UnifiedMultiStageDiff */
    virtualizer?: import('@pierre/diffs').Virtualizer;
  }

  let {
    parts,
    foldUnchanged = true,
    lineWrapping = false,
    isAggregate: _isAggregate = false,
    onStageHunk,
    onUnstageHunk,
    onOpenCommit,
    virtualizer,
  }: Props = $props();

  // isAggregate is not used by UnifiedMultiStageDiff but kept for API compat
  void _isAggregate;
</script>

<UnifiedMultiStageDiff
  {parts}
  {foldUnchanged}
  {lineWrapping}
  {onStageHunk}
  {onUnstageHunk}
  {onOpenCommit}
  {virtualizer}
/>
