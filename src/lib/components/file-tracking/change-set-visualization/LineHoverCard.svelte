<script lang="ts">
  import hljs from 'highlight.js';
  import type { FileColumn, VisualizationLine, HoverPosition } from './types';
  import { getLanguageFromPath } from './utils';

  interface Props {
    fileColumn: FileColumn;
    lineIndex: number;
    line?: VisualizationLine; // Kept for backwards compatibility but not used
    position: HoverPosition;
  }

  let { fileColumn, lineIndex, line: _line, position }: Props = $props();

  const language = $derived(getLanguageFromPath(fileColumn.filePath));

  // Approximate line height in pixels (py-0.5 + text content)
  const LINE_HEIGHT = 20;
  // Container visible height (max-h-64 = 256px)
  const CONTAINER_HEIGHT = 256;
  // Number of lines to show around the hovered line
  const VISIBLE_LINES = Math.ceil(CONTAINER_HEIGHT / LINE_HEIGHT) + 2;

  // Calculate which lines are visible (only render these for performance)
  const visibleRange = $derived.by(() => {
    const halfVisible = Math.floor(VISIBLE_LINES / 2);
    const start = Math.max(0, lineIndex - halfVisible);
    const end = Math.min(fileColumn.lines.length, lineIndex + halfVisible + 1);
    return { start, end };
  });

  // Only get the visible lines for rendering
  const visibleLines = $derived(fileColumn.lines.slice(visibleRange.start, visibleRange.end));

  // Calculate transform to position the visible lines correctly
  const translateY = $derived.by(() => {
    // We're rendering from visibleRange.start, so offset is relative to that
    const startLineTop = visibleRange.start * LINE_HEIGHT;
    const lineTop = lineIndex * LINE_HEIGHT;
    const centerOffset = CONTAINER_HEIGHT / 2 - LINE_HEIGHT / 2;
    // How much to scroll within our visible window
    return Math.max(0, lineTop - centerOffset) - startLineTop;
  });

  function highlight(code: string, lang: string): string {
    try {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      // Skip auto-detection for performance
      return escapeHtml(code);
    } catch {
      return escapeHtml(code);
    }
  }

  function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function getLineClass(lineType: VisualizationLine['type'], isHovered: boolean): string {
    const base = 'flex items-stretch font-mono text-xs leading-tight';

    switch (lineType) {
      case 'add':
        return `${base} ${isHovered ? 'bg-green-500/20' : 'bg-green-500/10'}`;
      case 'remove':
        return `${base} ${isHovered ? 'bg-red-500/20' : 'bg-red-500/10'}`;
      default:
        return `${base} ${isHovered ? 'bg-muted/30' : 'bg-background'}`;
    }
  }

  function getGutterClass(lineType: VisualizationLine['type']): string {
    switch (lineType) {
      case 'add':
        return 'text-green-600 bg-green-500/20';
      case 'remove':
        return 'text-red-600 bg-red-500/20';
      default:
        return 'text-muted-foreground bg-muted/50';
    }
  }

  function getLineSymbol(lineType: VisualizationLine['type']): string {
    switch (lineType) {
      case 'add':
        return '+';
      case 'remove':
        return '-';
      default:
        return ' ';
    }
  }
</script>

<div
  class="fixed z-50 max-w-lg rounded-md border border-border bg-popover shadow-lg overflow-hidden pointer-events-none"
  style="left: {position.x}px; top: {position.y}px;"
>
  <!-- Header -->
  <div class="px-3 py-1.5 border-b border-border bg-background flex items-center gap-2">
    <span class="text-xs font-medium truncate">{fileColumn.fileName}</span>
    <span class="text-[10px] text-muted-foreground truncate flex-1">{fileColumn.filePath}</span>
    <span class="text-[10px] text-muted-foreground">
      <span class="text-green-600">+{fileColumn.additions}</span>
      <span class="mx-1">/</span>
      <span class="text-red-600">-{fileColumn.deletions}</span>
    </span>
  </div>

  <!-- Code lines - only render visible lines for performance -->
  <div class="max-h-64 overflow-hidden">
    <div style="transform: translateY(-{translateY}px)">
      {#each visibleLines as displayLine, i (`line-${visibleRange.start + i}-${displayLine.type}`)}
        {@const actualIndex = visibleRange.start + i}
        {@const isHovered = actualIndex === lineIndex}
        <div class={getLineClass(displayLine.type, isHovered)}>
          <!-- Gutter with line number -->
          <div
            class={`w-10 shrink-0 text-right pr-2 py-0.5 select-none ${getGutterClass(displayLine.type)}`}
          >
            <span class="text-[10px]">
              {displayLine.newLineNumber || displayLine.oldLineNumber || ''}
            </span>
          </div>

          <!-- Symbol column -->
          <div
            class={`w-4 shrink-0 text-center py-0.5 select-none ${getGutterClass(displayLine.type)}`}
          >
            <span class="text-[10px]">{getLineSymbol(displayLine.type)}</span>
          </div>

          <!-- Code content -->
          <pre
            class="flex-1 py-0.5 px-2 overflow-hidden whitespace-pre text-ellipsis code-content">{@html highlight(
              displayLine.content,
              language,
            )}</pre>
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .code-content {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 11px;
    line-height: 1.4;
    color: hsl(var(--foreground)) !important;
  }

  /* Use theme-aware colors via CSS variables */
  .code-content :global(span) {
    color: hsl(var(--foreground));
  }
  .code-content :global(.hljs-keyword) {
    color: hsl(var(--destructive)) !important;
  }
  .code-content :global(.hljs-string) {
    color: hsl(var(--primary)) !important;
  }
  .code-content :global(.hljs-number) {
    color: hsl(var(--primary)) !important;
  }
  .code-content :global(.hljs-comment) {
    color: hsl(var(--muted-foreground)) !important;
  }
  .code-content :global(.hljs-function) {
    color: hsl(270, 50%, 60%) !important;
  }
  .code-content :global(.hljs-class) {
    color: hsl(30, 80%, 45%) !important;
  }
  .code-content :global(.hljs-variable) {
    color: hsl(var(--foreground)) !important;
  }
  .code-content :global(.hljs-built_in) {
    color: hsl(var(--primary)) !important;
  }
  .code-content :global(.hljs-type) {
    color: hsl(30, 80%, 45%) !important;
  }
  .code-content :global(.hljs-attr) {
    color: hsl(var(--primary)) !important;
  }
  .code-content :global(.hljs-property) {
    color: hsl(var(--primary)) !important;
  }
  .code-content :global(.hljs-tag) {
    color: hsl(140, 50%, 40%) !important;
  }
  .code-content :global(.hljs-name) {
    color: hsl(140, 50%, 40%) !important;
  }
  .code-content :global(.hljs-title) {
    color: hsl(270, 50%, 60%) !important;
  }
  .code-content :global(.hljs-params) {
    color: hsl(var(--foreground)) !important;
  }
  .code-content :global(.hljs-literal) {
    color: hsl(var(--primary)) !important;
  }
  .code-content :global(.hljs-punctuation) {
    color: hsl(var(--foreground)) !important;
  }
  .code-content :global(.hljs-operator) {
    color: hsl(var(--foreground)) !important;
  }
</style>
