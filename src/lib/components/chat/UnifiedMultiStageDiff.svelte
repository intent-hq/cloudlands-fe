<script lang="ts">
  /**
   * Unified Multi-Stage Diff
   *
   * Renders a single unified diff view that combines changes from multiple stages
   * (staged, unstaged, committed) using Monaco diff editor.
   *
   * Note: Per-line stage indicators (colored bars) are not currently supported
   * in Monaco diff mode. The diff shows all changes merged together.
   */

  import {
  ChangeStage,
  type TrackedChange,
} from '$features/file-tracking/types';
  import { selectActiveWorkspaceId } from '$lib/store/slices/workspace/workspace-selectors';
  import type { ChangePart } from './types';
  import {
  mergeChangeParts,
  buildContentFromMergedHunks,
} from './unified-diff-merger';
  import { TrackedChangeDiffViewer } from '$lib/components/ui/diff';
  import { selectDiffSideBySide } from '$lib/store/slices/ui-layout/ui-layout-selectors';

  const activeWorkspaceId = selectActiveWorkspaceId();

  interface Props {
    /** The change parts to display (staged, unstaged, committed) */
    parts: ChangePart[];
    /** Whether to fold unchanged regions */
    foldUnchanged?: boolean;
    /** Whether to wrap long lines */
    lineWrapping?: boolean;
    /** Callback when user wants to stage a hunk */
    onStageHunk?: (filePath: string, hunkPatch: string) => void;
    /** Callback when user wants to unstage a hunk */
    onUnstageHunk?: (filePath: string, hunkPatch: string) => void;
    /** Callback when user wants to view a commit */
    onOpenCommit?: (commitHash: string) => void;
    /** Optional virtualizer forwarded to the underlying TrackedChangeDiffViewer */
    virtualizer?: import('@pierre/diffs').Virtualizer;
  }

  let {
    parts,
    foldUnchanged = true,
    lineWrapping = false,
    onStageHunk,
    onUnstageHunk,
    onOpenCommit: _onOpenCommit,
    virtualizer,
  }: Props = $props();

  // Silence unused variable warnings (onOpenCommit not yet implemented for merged view)
  void _onOpenCommit;

  const sideBySide = selectDiffSideBySide();

  // Merge the change parts into a unified diff
  const mergedHunks = $derived(mergeChangeParts(parts));

  // Build oldContent/newContent from merged hunks
  const mergedContent = $derived(buildContentFromMergedHunks(mergedHunks));

  // File path from the first part
  const filePath = $derived(parts[0]?.change.filePath || 'file');

  // Starting line number in the working tree for the merged snippet. Used so
  // the diff viewer gutter shows real file line numbers.
  const lineOffset = $derived(mergedHunks[0]?.wtStart ?? 1);

  // Build a TrackedChange that represents the merged diff
  const mergedTrackedChange = $derived.by<TrackedChange>(() => {
    // Calculate total stats
    let additions = 0;
    let deletions = 0;
    for (const hunk of mergedHunks) {
      for (const line of hunk.lines) {
        if (line.type === 'Addition') additions++;
        else if (line.type === 'Deletion') deletions++;
      }
    }

    return {
      id: `merged-${filePath}`,
      file: filePath,
      relativePath: filePath,
      stage: ChangeStage.Unstaged, // Default stage
      stats: { additions, deletions },
      attribution: { timestamp: 0 },
      content: {
        oldContent: mergedContent.oldContent,
        newContent: mergedContent.newContent,
      },
    };
  });

  const workspaceId = $derived($activeWorkspaceId);
</script>

{#if mergedHunks.length === 0}
  <div class="flex items-center justify-center py-8 text-subtle text-sm">
    No changes to display
  </div>
{:else if workspaceId}
  <div class="unified-multi-stage-diff">
    <TrackedChangeDiffViewer
      change={mergedTrackedChange}
      {workspaceId}
      viewMode={$sideBySide ? 'split' : 'unified'}
      {foldUnchanged}
      {lineWrapping}
      {onStageHunk}
      {onUnstageHunk}
      useProvidedContent={true}
      {lineOffset}
      {virtualizer}
    />
  </div>
{:else}
  <div class="flex items-center justify-center h-24 text-subtle">
    No workspace available
  </div>
{/if}

<style>
  .unified-multi-stage-diff {
    width: 100%;
    overflow: hidden;
  }
</style>
