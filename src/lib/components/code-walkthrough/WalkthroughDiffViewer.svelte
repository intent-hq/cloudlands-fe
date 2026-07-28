<script lang="ts">
  /**
   * WalkthroughDiffViewer
   *
   * A specialized diff viewer for code walkthroughs with inline annotations.
   * Displays diffs with syntax highlighting and inserts walkthrough
   * annotations inline after the relevant lines.
   *
   * Note: This is NOT a general-purpose diff viewer. For standard diff display,
   * use `DiffViewer` from `$lib/components/ui/diff`.
   */
  import { slide } from 'svelte/transition';
  import Fa from 'svelte-fa';
  import {
  faChevronDown,
  faChevronRight,
} from '@fortawesome/free-solid-svg-icons';
  import {
  parsePatch,
  type DiffLine,
} from './patch-utils';
  import type { WalkthroughAnnotation } from './types';
  import WalkthroughAnnotationCard from './WalkthroughAnnotationCard.svelte';
  import * as m from '$shared/paraglide/messages.js';

  interface Props {
    /** The unified diff/patch string */
    patch: string;
    /** File name for display and language detection */
    fileName: string;
    /** Annotations to display inline */
    annotations?: WalkthroughAnnotation[];
    /** Whether to start collapsed */
    initialCollapsed?: boolean;
    /** Maximum lines to show when collapsed (0 = show all) */
    previewLines?: number;
    class?: string;
  }

  let {
    patch,
    fileName,
    annotations = [],
    initialCollapsed = false,
    previewLines = 0,
    class: className = '',
  }: Props = $props();

  // Parse the patch into hunks
  const hunks = $derived(parsePatch(patch));

  // Count total lines
  const totalLineCount = $derived(hunks.reduce((acc, h) => acc + h.lines.length, 0));

  // Collapsed state
  let collapsed = $state(initialCollapsed && previewLines > 0);

  // Build annotation lookup by line number
  const annotationsByLine = $derived.by(() => {
    const map = new Map<number, WalkthroughAnnotation[]>();
    for (const ann of annotations) {
      const existing = map.get(ann.line) || [];
      existing.push(ann);
      map.set(ann.line, existing);
    }
    return map;
  });

  // Get annotations for a specific line (using newNum for additions, or the line number)
  function getAnnotationsForLine(line: DiffLine): WalkthroughAnnotation[] {
    const lineNum = line.newNum ?? line.oldNum;
    if (lineNum === null) return [];
    return annotationsByLine.get(lineNum) || [];
  }

  // Determine visible lines when collapsed
  function shouldShowLine(lineIndex: number): boolean {
    if (!collapsed || previewLines === 0) return true;
    return lineIndex < previewLines;
  }

  // Line type to CSS classes
  function getLineClasses(line: DiffLine): string {
    switch (line.type) {
      case 'addition':
        return 'bg-emerald-50 dark:bg-emerald-950/20';
      case 'deletion':
        return 'bg-red-50 dark:bg-red-950/20';
      default:
        return 'bg-background';
    }
  }

  // Line indicator bar color
  function getIndicatorClasses(line: DiffLine): string {
    switch (line.type) {
      case 'addition':
        return 'bg-emerald-400';
      case 'deletion':
        return 'bg-red-400';
      default:
        return 'bg-transparent';
    }
  }

  // Toggle collapsed state
  function toggleCollapsed() {
    collapsed = !collapsed;
  }
</script>

<div class="walkthrough-diff-viewer rounded-lg border border-border overflow-hidden {className}">
  <!-- File header -->
  <button
    type="button"
    class="w-full flex items-center gap-2 px-3 py-2 bg-muted/50 border-b border-border hover:bg-muted/70 transition-colors text-left"
    onclick={toggleCollapsed}
  >
    <Fa icon={collapsed ? faChevronRight : faChevronDown} class="h-3 w-3 text-ghost" />
    <span class="text-sm font-mono truncate flex-1">{fileName}</span>
    <span class="text-xs text-subtle">
      {annotations.length === 1
        ? m.codeWalkthrough_diffViewer_annotationCount_one({ count: annotations.length })
        : m.codeWalkthrough_diffViewer_annotationCount_many({ count: annotations.length })}
    </span>
  </button>

  <!-- Diff content -->
  {#if !collapsed || previewLines > 0}
    <div class="relative overflow-x-auto" transition:slide={{ duration: 150 }}>
      <div class="font-mono text-xs leading-relaxed">
        {#each hunks as hunk, hunkIndex (hunkIndex)}
          {#each hunk.lines as line, lineIndex (`${hunkIndex}-${lineIndex}`)}
            {#if shouldShowLine(lineIndex)}
              <!-- Diff line -->
              <div class="flex {getLineClasses(line)} group">
                <!-- Indicator bar -->
                <div class="w-1 shrink-0 {getIndicatorClasses(line)}"></div>

                <!-- Line numbers -->
                <div class="w-16 shrink-0 px-2 text-right text-subtle select-none border-r border-border/50">
                  <span class="inline-block w-6">{line.oldNum ?? ''}</span>
                  <span class="inline-block w-6">{line.newNum ?? ''}</span>
                </div>

                <!-- Line content -->
                <pre class="flex-1 px-2 whitespace-pre-wrap break-all">{line.content}</pre>
              </div>

              <!-- Inline annotations for this line -->
              {#each getAnnotationsForLine(line) as ann (ann.id)}
                <div class="pl-17 pr-2 py-1 bg-muted/30">
                  <WalkthroughAnnotationCard
                    message={ann.message}
                    category={ann.category}
                    importance={ann.importance}
                    lineNumber={ann.line}
                    endLine={ann.endLine}
                  />
                </div>
              {/each}
            {/if}
          {/each}
        {/each}
      </div>

      <!-- Show more indicator when collapsed -->
      {#if collapsed && previewLines > 0 && totalLineCount > previewLines}
        <button
          type="button"
          class="w-full py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          onclick={toggleCollapsed}
        >
          {m.codeWalkthrough_diffViewer_showMore_label({ count: totalLineCount - previewLines })}
        </button>
      {/if}
    </div>
  {/if}
</div>
