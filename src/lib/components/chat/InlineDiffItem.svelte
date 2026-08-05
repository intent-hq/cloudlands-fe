<script lang="ts">
  /**
   * Inline Diff Item
   *
   * Displays a file diff inline using TrackedChangeDiffViewer (@pierre/diffs).
   * Content comes from the chat tool call (oldContent/newContent) and is rendered
   * read-only via the provided-content path.
   *
   * Implements "click to focus and scroll" pattern to prevent accidental scrolling
   * when the user is trying to scroll the parent page.
   */

  import { fade } from 'svelte/transition';
  import type { ChatFileChange } from '$lib/utils/get-file-changes-from-messages';
  import {
  ChangeStage,
  type TrackedChange,
} from '$features/file-tracking/types';
  import { selectActiveWorkspaceId } from '$store/renderer/slices/workspace/workspace-selectors';
  import { selectDiffSideBySide } from '$store/renderer/slices/ui-layout/ui-layout-selectors';
  import Fa from 'svelte-fa';
  import { faArrowPointer } from '@fortawesome/free-solid-svg-icons';
  import { TrackedChangeDiffViewer } from '$lib/components/ui/diff';
  import type { LocalFileChange } from './types';
  import { m } from '$shared/paraglide/messages.js';

  const activeWorkspaceId = selectActiveWorkspaceId();

  interface Props {
    change: ChatFileChange | LocalFileChange;
    foldUnchanged?: boolean;
    lineWrapping?: boolean;
    /** @deprecated - scrollToLine is not supported by the new DiffViewer */
    scrollToLine?: number;
    /** When true, use git diff instead of snippet content (for aggregate views) */
    isAggregate?: boolean;
    /** When true, show "click to scroll" hint when scrolling on unfocused diff */
    showScrollHint?: boolean;
    /** Callback when user wants to stage a hunk */
    onStageHunk?: (filePath: string, hunkPatch: string) => void;
    /** Callback when user wants to unstage a hunk */
    onUnstageHunk?: (filePath: string, hunkPatch: string) => void;
    /** Callback when user wants to open a commit changeset */
    onOpenCommit?: (commitHash: string) => void;
    /**
     * Optional pierre `Virtualizer`. Forwarded to `TrackedChangeDiffViewer`
     * so the parent list can manage virtualization across all mounted
     * file diffs from a single virtualizer instance.
     */
    virtualizer?: import('@pierre/diffs').Virtualizer;
  }

  let {
    change,
    foldUnchanged = true,
    lineWrapping = false,

    scrollToLine: _scrollToLine,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    isAggregate = false,
    showScrollHint: enableScrollHint = false,
    onStageHunk,
    onUnstageHunk,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onOpenCommit,
    virtualizer,
  }: Props = $props();

  const sideBySide = selectDiffSideBySide();

  // Click-to-focus state
  let focused = $state(false);
  let hovered = $state(false);
  let showScrollHint = $state(false);
  let scrollDelta = $state(0);
  let containerRef: HTMLDivElement | undefined = $state(undefined);

  // Note: lazy-mounting via IntersectionObserver was previously done here AND
  // in the parent (ChatChangesPanel). As of Wave 3 the parent owns the single
  // visibility gate — this component mounts its TrackedChangeDiffViewer
  // unconditionally once the parent decides to render it.

  // Scroll hint threshold (pixels of scroll before showing hint)
  const SCROLL_THRESHOLD = 80;

  // Handle mouse enter
  function handleMouseEnter() {
    hovered = true;
  }

  // Handle mouse leave
  function handleMouseLeave() {
    hovered = false;
    showScrollHint = false;
    scrollDelta = 0;
  }

  // Handle wheel events when not focused - show hint (don't prevent, let parent scroll)
  function handleWheel(event: WheelEvent) {
    if (!hovered || focused) return;

    // Accumulate scroll delta
    scrollDelta += Math.abs(event.deltaY);

    // Show hint if threshold reached
    if (scrollDelta >= SCROLL_THRESHOLD && !showScrollHint) {
      showScrollHint = true;
    }
  }

  // Track focus via focusin/focusout events (captures Monaco focus)
  function handleFocusIn() {
    focused = true;
    showScrollHint = false;
    scrollDelta = 0;
  }

  function handleFocusOut(event: FocusEvent) {
    // Only unfocus if the new focus target is outside the container
    if (containerRef && !containerRef.contains(event.relatedTarget as Node)) {
      focused = false;
    }
  }

  // Reset scroll hint when focused or not hovered
  $effect(() => {
    if (focused || !hovered) {
      showScrollHint = false;
      scrollDelta = 0;
    }
  });

  // Convert ChatFileChange to TrackedChange format for DiffViewer
  // IMPORTANT: Do NOT use Date.now() or any non-deterministic values here!
  // Using Date.now() causes $derived to create a new object on every re-render,
  // which triggers an infinite loop in DiffViewer's $effect.
  //
  // We pass the oldContent/newContent from the tool call so the diff shows
  // exactly what this turn changed, not the current file state.
  //
  // Only derive based on properties that actually affect the diff display.
  // The 'staged' property is important for DiffViewer to call git:diff with the correct flag.
  let trackedChange = $derived.by<TrackedChange>(() => {
    // Extract only the properties that matter for the diff
    const { toolCallId, filePath, additions, deletions, oldContent, newContent } = change;
    // Check if this is a LocalFileChange with staged/category properties
    const isStaged = 'staged' in change && change.staged === true;
    const category = 'category' in change ? (change.category as string) : undefined;
    const commitHash = 'commitHash' in change ? (change.commitHash as string) : undefined;
    // Check if this is full file content from git:diff (vs snippet content from tool calls)
    // Snippet content should NOT be editable because saving would overwrite the full file
    const isFullFileContent =
      'isFullFileContent' in change ? (change.isFullFileContent as boolean) : false;

    // Determine the stage based on category or staged property
    let stage: ChangeStage;
    if (category === 'committed') {
      stage = ChangeStage.Committed;
    } else if (isStaged) {
      stage = ChangeStage.Staged;
    } else {
      stage = ChangeStage.Unstaged;
    }

    // For conversation changes, use the snippet content directly without padding.
    // The oldContent/newContent are snippets from tool calls (old_str/new_str),
    // not full file content. Padding with newlines just creates blank diffs.
    return {
      id: toolCallId,
      file: filePath,
      relativePath: filePath,
      stage,
      commitHash,
      stats: {
        additions,
        deletions,
      },
      attribution: {
        timestamp: 0, // Use static value to prevent infinite loop
      },
      // Pass the content from the tool call or git:diff for diffs
      content:
        oldContent !== undefined || newContent !== undefined
          ? {
              oldContent: oldContent ?? '',
              newContent: newContent ?? '',
              // Pass through isFullFileContent so the diff viewer knows if it can use git:diff to refresh
              isFullFileContent,
            }
          : undefined,
    };
  });

  let workspaceId = $derived($activeWorkspaceId);
  const lineOffset = $derived.by(() => {
    if (change.isFullFileContent) return 1;
    const firstChunkLine = 'chunks' in change ? change.chunks?.[0]?.newStart : undefined;
    return firstChunkLine ?? change.startLineNumber ?? 1;
  });

</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="inline-diff-container relative"
  class:focused
  bind:this={containerRef}
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
  onwheel={handleWheel}
  onfocusin={handleFocusIn}
  onfocusout={handleFocusOut}
  role="region"
  aria-label={m.chat_inlineDiffItem_viewer_ariaLabel()}
>
  {#if workspaceId}
    <TrackedChangeDiffViewer
      change={trackedChange}
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

    <!-- Scroll hint overlay -->
    {#if enableScrollHint && showScrollHint}
      <div
        class="absolute inset-0 flex items-center justify-center rounded-lg bg-background/60 backdrop-blur-[2px] transition-opacity duration-200 z-10 pointer-events-none"
        transition:fade={{ duration: 150 }}
      >
        <div
          class="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-subtle shadow-lg"
        >
          <Fa icon={faArrowPointer} class="w-3 h-3" />
          {m.chat_inlineDiffItem_clickToScroll_label()}
        </div>
      </div>
    {/if}
  {:else}
    <div class="flex items-center justify-center h-24 text-subtle">
      {m.chat_inlineDiffItem_noWorkspace_label()}
    </div>
  {/if}
</div>
