<script lang="ts">
  /**
   * WalkthroughFileDiff
   *
   * A clean, GitHub-style diff viewer with:
   * - Collapsible hunks with "expand above/below" functionality
   * - Inline annotations that appear elegantly within the diff
   * - Subtle styling without harsh stripes
   * - Proper syntax highlighting (highlights entire hunks for context)
   */
  import { slide } from 'svelte/transition';
  import Fa from 'svelte-fa';
  import {
  faChevronDown,
  faChevronRight,
  faEllipsisH,
} from '@fortawesome/free-solid-svg-icons';
  import hljs from 'highlight.js';
  import {
  parsePatch,
  type DiffLine,
  type Hunk,
} from '$lib/components/code-walkthrough/patch-utils';
  import { getLanguageFromPath } from '$lib/utils/file-utils';
  import type { WalkthroughAnnotation } from './types';
  import WalkthroughInlineComment from './WalkthroughInlineComment.svelte';
  import WalkthroughCommentThread from './WalkthroughCommentThread.svelte';
  import '$lib/styles/syntax-highlighting.css';

  /** Message in a comment thread */
  interface ThreadMessage {
    id: string;
    type: 'annotation' | 'user' | 'agent';
    content: string;
    timestamp?: Date;
  }

  interface Props {
    /** File name/path */
    fileName: string;
    /** The unified diff/patch string */
    patch: string;
    /** Annotations for this file */
    annotations?: WalkthroughAnnotation[];
    /** Whether the file starts collapsed */
    initialCollapsed?: boolean;
    /** Context lines to show around changes when collapsed */
    contextLines?: number;
    /** Callback when sending a message about a line */
    onSendMessage?: (message: string, lineNumber: number, fileName: string) => void;
    /** Whether a message is being sent */
    isSending?: boolean;
    /** Number of additions in this file */
    additions?: number;
    /** Number of deletions in this file */
    deletions?: number;
    /** Description of changes in this file */
    fileDescription?: string;
    class?: string;
  }

  let {
    fileName,
    patch,
    annotations = [],
    initialCollapsed = false,
    contextLines = 3,
    onSendMessage,
    isSending = false,
    additions = 0,
    deletions = 0,
    fileDescription = '',
    class: className = '',
  }: Props = $props();

  // Parse the patch
  const hunks = $derived(parsePatch(patch));

  // Detect language for syntax highlighting
  const language = $derived(getLanguageFromPath(fileName));

  // Build highlighted content map - highlight entire hunks at once for proper context
  const highlightedLines = $derived.by(() => {
    const lineMap = new Map<string, string>();

    // Only apply highlighting if we have a detected language
    if (!language || language === 'text' || language === 'plaintext' || !hljs.getLanguage(language)) {
      return lineMap;
    }

    // Process each hunk separately to maintain context
    hunks.forEach((hunk: Hunk) => {
      // Collect lines for this hunk
      const hunkLines: Array<{ content: string; key: string }> = [];

      hunk.lines.forEach((line: DiffLine) => {
        const content = line.content || '';
        const key = `${line.oldNum}-${line.newNum}`;
        hunkLines.push({ content, key });
      });

      if (hunkLines.length === 0) return;

      // Join lines and highlight as a single block
      try {
        const hunkCode = hunkLines.map((l) => l.content).join('\n');
        const highlighted = hljs.highlight(hunkCode, { language });

        // Split the highlighted result back into lines
        const highlightedParts = highlighted.value.split('\n');

        // Map back to original lines
        hunkLines.forEach((line, index) => {
          if (index < highlightedParts.length) {
            lineMap.set(line.key, highlightedParts[index]);
          }
        });
      } catch (error) {
        console.warn('Failed to highlight hunk:', error);
      }
    });

    return lineMap;
  });

  // File-level collapsed state (header toggle)
  let isFileCollapsed = $state(initialCollapsed);

  // Track expanded ranges: Set of "hunkIndex-startLine-endLine"
  let expandedRanges = $state<Set<string>>(new Set());

  // Track which line has an open comment input
  let activeCommentLine = $state<string | null>(null);

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

  // Lines that have annotations (should always be visible)
  const annotatedLines = $derived(new Set(annotations.map(a => a.line)));

  // Get annotations for a specific line
  // Only show annotations on new lines (additions or unchanged), not on deletions
  function getAnnotationsForLine(line: DiffLine): WalkthroughAnnotation[] {
    // For deletions, don't show annotations - they should appear on the new content
    if (line.type === 'deletion') return [];

    // Use newNum for additions and context lines
    const lineNum = line.newNum;
    if (lineNum === null || lineNum === undefined) return [];
    return annotationsByLine.get(lineNum) || [];
  }

  // Determine if a line should be visible
  function shouldShowLine(hunkIndex: number, lineIndex: number, line: DiffLine): boolean {
    // Changed lines (additions/deletions) are always visible
    if (line.type === 'addition' || line.type === 'deletion') return true;

    // Lines with annotations are always visible
    const lineNum = line.newNum ?? line.oldNum;
    if (lineNum !== null && annotatedLines.has(lineNum)) return true;

    // Check if within context of a change
    const hunk = hunks[hunkIndex];
    if (!hunk) return false;

    // Show if within contextLines of a changed line
    for (let i = Math.max(0, lineIndex - contextLines); i <= Math.min(hunk.lines.length - 1, lineIndex + contextLines); i++) {
      const nearbyLine = hunk.lines[i];
      if (nearbyLine.type === 'addition' || nearbyLine.type === 'deletion') return true;

      // Also show near annotated lines
      const nearbyNum = nearbyLine.newNum ?? nearbyLine.oldNum;
      if (nearbyNum !== null && annotatedLines.has(nearbyNum)) return true;
    }

    // Check if in an expanded range
    for (const range of expandedRanges) {
      const [rHunk, rStart, rEnd] = range.split('-').map(Number);
      if (rHunk === hunkIndex && lineIndex >= rStart && lineIndex <= rEnd) return true;
    }

    return false;
  }

  // Find gaps (hidden line ranges) in a hunk
  function findGapsInHunk(hunkIndex: number): Array<{ startIndex: number; endIndex: number; count: number }> {
    const hunk = hunks[hunkIndex];
    if (!hunk) return [];

    const gaps: Array<{ startIndex: number; endIndex: number; count: number }> = [];
    let gapStart: number | null = null;

    for (let i = 0; i < hunk.lines.length; i++) {
      const isVisible = shouldShowLine(hunkIndex, i, hunk.lines[i]);

      if (!isVisible && gapStart === null) {
        gapStart = i;
      } else if (isVisible && gapStart !== null) {
        gaps.push({ startIndex: gapStart, endIndex: i - 1, count: i - gapStart });
        gapStart = null;
      }
    }

    // Handle gap at end
    if (gapStart !== null) {
      gaps.push({ startIndex: gapStart, endIndex: hunk.lines.length - 1, count: hunk.lines.length - gapStart });
    }

    return gaps;
  }

  // Expand a range of lines
  function expandRange(hunkIndex: number, startIndex: number, endIndex: number) {
    const key = `${hunkIndex}-${startIndex}-${endIndex}`;
    expandedRanges.add(key);
    expandedRanges = new Set(expandedRanges);
  }

  // Expand all lines in file
  function expandAll() {
    for (let h = 0; h < hunks.length; h++) {
      const hunk = hunks[h];
      expandRange(h, 0, hunk.lines.length - 1);
    }
  }

  // Collapse to default view
  function collapseToDefault() {
    expandedRanges = new Set();
  }

  // Get highlighted content for a line (uses pre-computed map for proper context)
  function getHighlightedContent(line: DiffLine): string {
    const key = `${line.oldNum}-${line.newNum}`;
    const highlighted = highlightedLines.get(key);
    if (highlighted !== undefined) {
      return highlighted;
    }
    // Fallback to escaped content
    return escapeHtml(line.content || '');
  }

  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Get line background class (very subtle)
  function getLineBgClass(line: DiffLine): string {
    switch (line.type) {
      case 'addition':
        return 'bg-emerald-500/5 dark:bg-emerald-500/10';
      case 'deletion':
        return 'bg-red-500/5 dark:bg-red-500/10';
      default:
        return '';
    }
  }

  // Get the +/- prefix styling
  function getPrefixClass(line: DiffLine): string {
    switch (line.type) {
      case 'addition':
        return 'text-emerald-600 dark:text-emerald-400 font-medium';
      case 'deletion':
        return 'text-red-600 dark:text-red-400 font-medium';
      default:
        return 'text-transparent';
    }
  }

  // Get the prefix character
  function getPrefix(line: DiffLine): string {
    switch (line.type) {
      case 'addition': return '+';
      case 'deletion': return '-';
      default: return ' ';
    }
  }

  // Get line number gutter class
  function getGutterClass(line: DiffLine): string {
    switch (line.type) {
      case 'addition':
        return 'bg-emerald-500/10 dark:bg-emerald-500/15';
      case 'deletion':
        return 'bg-red-500/10 dark:bg-red-500/15';
      default:
        return 'bg-muted/30';
    }
  }

  function toggleFileCollapsed() {
    isFileCollapsed = !isFileCollapsed;
  }

  function handleOpenComment(lineKey: string) {
    activeCommentLine = lineKey;
  }

  function handleCloseComment() {
    activeCommentLine = null;
  }

  function handleSendMessage(message: string, lineNumber: number, file: string) {
    onSendMessage?.(message, lineNumber, file);
    activeCommentLine = null;
  }

  // Just the filename without path
  const shortFileName = $derived(() => {
    const parts = fileName.split('/');
    return parts[parts.length - 1];
  });

  // Get directory path without filename
  const getFilePath = $derived(() => {
    const parts = fileName.split('/');
    if (parts.length <= 1) return '';
    return parts.slice(0, -1).join('/');
  });

  // Check if there are any hidden lines
  const hasHiddenLines = $derived.by(() => {
    for (let h = 0; h < hunks.length; h++) {
      const gaps = findGapsInHunk(h);
      if (gaps.length > 0) return true;
    }
    return false;
  });

  // Get preview lines when collapsed (first few changed lines)
  const previewLines = $derived.by(() => {
    const maxPreviewLines = 3;
    const preview: Array<{ line: DiffLine; hunkIndex: number; lineIndex: number }> = [];

    for (let h = 0; h < hunks.length && preview.length < maxPreviewLines; h++) {
      const hunk = hunks[h];
      for (let i = 0; i < hunk.lines.length && preview.length < maxPreviewLines; i++) {
        const line = hunk.lines[i];
        // Only show changed lines in preview
        if (line.type === 'addition' || line.type === 'deletion') {
          preview.push({ line, hunkIndex: h, lineIndex: i });
        }
      }
    }
    return preview;
  });

  // Total number of changed lines (for "show more" indicator)
  const totalChangedLines = $derived.by(() => {
    let count = 0;
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.type === 'addition' || line.type === 'deletion') {
          count++;
        }
      }
    }
    return count;
  });

  // Track conversation threads per annotation
  let threadMessages = $state<Map<string, ThreadMessage[]>>(new Map());

  // Get thread key for an annotation
  function getThreadKey(ann: WalkthroughAnnotation): string {
    return `${ann.file}:${ann.line}:${ann.type}`;
  }

  // Get messages for a thread
  function getThreadMessages(ann: WalkthroughAnnotation): ThreadMessage[] {
    return threadMessages.get(getThreadKey(ann)) || [];
  }
</script>

<div class="walkthrough-file-diff overflow-hidden bg-card {className}">
  <!-- File header -->
  <div class="flex flex-col border-b border-border/50">
    <button
      type="button"
      class="w-full flex items-center gap-2 px-4 py-3 hover:bg-muted/30 transition-colors text-left group"
      onclick={toggleFileCollapsed}
    >
      <Fa icon={isFileCollapsed ? faChevronRight : faChevronDown} class="h-3 w-3 text-ghost shrink-0" />

      <!-- File icon -->
      <svg class="h-4 w-4 text-ghost shrink-0" viewBox="0 0 16 16" fill="currentColor">
        <path d="M3.5 1.5A1.5 1.5 0 0 1 5 0h6a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 11 15H5a1.5 1.5 0 0 1-1.5-1.5v-12zm2 0v12h6v-12H5.5z"/>
      </svg>

      <!-- File name and path -->
      <div class="flex items-baseline gap-2 flex-1 min-w-0">
        <span class="text-sm font-medium text-foreground truncate">{shortFileName()}</span>
        <span class="text-xs text-subtle truncate hidden sm:inline">{getFilePath()}</span>
      </div>

      <!-- Stats (additions only for cleaner look) -->
      <div class="flex items-center gap-1 text-xs shrink-0">
        {#if additions > 0 || deletions > 0}
          <span class="text-emerald-600 dark:text-emerald-400 font-medium">+{additions + deletions}</span>
        {/if}
      </div>
    </button>

    <!-- File description (if provided) -->
    {#if fileDescription}
      <div class="px-4 pb-3 -mt-1">
        <p class="text-sm text-subtle">{fileDescription}</p>
      </div>
    {/if}
  </div>

  <!-- Preview when collapsed -->
  {#if isFileCollapsed && previewLines.length > 0}
    <div class="border-t border-border/50" transition:slide={{ duration: 150 }}>
      <div class="font-mono text-xs leading-relaxed opacity-60">
        {#each previewLines as { line, hunkIndex, lineIndex } (`preview-${hunkIndex}-${lineIndex}`)}
          <div class="flex {getLineBgClass(line)}">
            <div class="w-12 shrink-0 flex select-none {getGutterClass(line)} border-r border-border/30">
              <span class="w-12 px-2 text-right text-ui text-subtle tabular-nums">{line.newNum ?? line.oldNum ?? ''}</span>
            </div>
            <span class="w-5 shrink-0 text-center select-none {getPrefixClass(line)}">{getPrefix(line)}</span>
            <pre class="flex-1 px-1 whitespace-pre overflow-hidden text-ellipsis"><code class="hljs">{@html getHighlightedContent(line)}</code></pre>
          </div>
        {/each}
        {#if totalChangedLines > previewLines.length}
          <button
            type="button"
            class="w-full py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors text-center"
            onclick={toggleFileCollapsed}
          >
            +{totalChangedLines - previewLines.length} more lines
          </button>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Diff content -->
  {#if !isFileCollapsed}
    <div class="relative" transition:slide={{ duration: 150 }}>
      <!-- Toolbar when there are hidden lines -->
      {#if hasHiddenLines}
        <div class="flex items-center justify-end gap-2 px-3 py-1.5 bg-muted/20 border-b border-border text-xs">
          <button
            type="button"
            class="text-muted-foreground hover:text-foreground transition-colors"
            onclick={expandAll}
          >
            Expand all
          </button>
          {#if expandedRanges.size > 0}
            <span class="text-subtle">·</span>
            <button
              type="button"
              class="text-muted-foreground hover:text-foreground transition-colors"
              onclick={collapseToDefault}
            >
              Collapse
            </button>
          {/if}
        </div>
      {/if}

      <div class="overflow-x-auto">
        <div class="font-mono text-xs leading-relaxed min-w-full">
          {#each hunks as hunk, hunkIndex (hunkIndex)}
            {@const gaps = findGapsInHunk(hunkIndex)}
            {@const gapAtStart = gaps.find(g => g.startIndex === 0)}

            <!-- Gap indicator at start of hunk -->
            {#if gapAtStart}
              <button
                type="button"
                class="w-full flex items-center justify-center gap-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors border-b border-border/50"
                onclick={() => expandRange(hunkIndex, gapAtStart.startIndex, gapAtStart.endIndex)}
              >
                <Fa icon={faChevronDown} class="h-2.5 w-2.5" />
                <span>Show {gapAtStart.count} hidden lines</span>
                <Fa icon={faChevronDown} class="h-2.5 w-2.5" />
              </button>
            {/if}

            {#each hunk.lines as line, lineIndex (`${hunkIndex}-${lineIndex}`)}
              {@const lineKey = `${line.oldNum}-${line.newNum}`}
              {@const lineAnnotations = getAnnotationsForLine(line)}
              {@const isCommentOpen = activeCommentLine === lineKey}
              {@const isVisible = shouldShowLine(hunkIndex, lineIndex, line)}
              {@const gapAfter = gaps.find(g => g.startIndex === lineIndex + 1)}

              {#if isVisible}
                <!-- Diff line -->
                <div class="group flex {getLineBgClass(line)} hover:bg-accent/30 transition-colors">
                  <!-- Line numbers gutter -->
                  <div class="w-20 shrink-0 flex select-none {getGutterClass(line)} border-r border-border/30">
                    <span class="w-10 px-2 text-right text-ui text-subtle tabular-nums">{line.oldNum ?? ''}</span>
                    <span class="w-10 px-2 text-right text-ui text-subtle tabular-nums">{line.newNum ?? ''}</span>
                  </div>

                  <!-- +/- prefix -->
                  <span class="w-5 shrink-0 text-center select-none {getPrefixClass(line)}">{getPrefix(line)}</span>

                  <!-- Line content -->
                  <div class="flex-1 flex items-center min-w-0 pr-2">
                    <pre class="flex-1 px-1 whitespace-pre overflow-x-auto"><code class="hljs">{@html getHighlightedContent(line)}</code></pre>

                    <!-- Comment button (show on hover) -->
                    {#if onSendMessage}
                      <button
                        type="button"
                        class="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-primary transition-all shrink-0"
                        onclick={() => handleOpenComment(lineKey)}
                        title="Ask about this line"
                      >
                        <Fa icon={faEllipsisH} class="h-3 w-3" />
                      </button>
                    {/if}
                  </div>
                </div>

                <!-- Inline annotations for this line (using comment thread component) -->
                {#each lineAnnotations as ann, annIdx (`${ann.line}-${annIdx}`)}
                  <div class="ml-20" transition:slide={{ duration: 150 }}>
                    <WalkthroughCommentThread
                      annotation={ann}
                      lineNumber={line.newNum ?? line.oldNum ?? 0}
                      {fileName}
                      messages={getThreadMessages(ann)}
                      onSendMessage={(msg, ln, fn) => handleSendMessage(msg, ln, fn)}
                      {isSending}
                    />
                  </div>
                {/each}

                <!-- Inline comment input (for lines without annotations) -->
                {#if isCommentOpen && lineAnnotations.length === 0}
                  <div class="ml-20 border-l-2 border-primary/50 bg-muted/20">
                    <div class="p-3">
                      <WalkthroughInlineComment
                        lineNumber={line.newNum ?? line.oldNum ?? 0}
                        fileName={fileName}
                        onSend={handleSendMessage}
                        onClose={handleCloseComment}
                        {isSending}
                      />
                    </div>
                  </div>
                {/if}

                <!-- Gap indicator after this line -->
                {#if gapAfter}
                  <button
                    type="button"
                    class="w-full flex items-center justify-center gap-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors border-y border-border/50 bg-muted/10"
                    onclick={() => expandRange(hunkIndex, gapAfter.startIndex, gapAfter.endIndex)}
                  >
                    <Fa icon={faEllipsisH} class="h-2.5 w-2.5" />
                    <span>Show {gapAfter.count} hidden lines</span>
                    <Fa icon={faEllipsisH} class="h-2.5 w-2.5" />
                  </button>
                {/if}
              {/if}
            {/each}
          {/each}
        </div>
      </div>
    </div>
  {/if}
</div>
