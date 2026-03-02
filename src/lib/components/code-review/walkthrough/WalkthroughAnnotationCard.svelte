<script lang="ts">
  import Fa from 'svelte-fa';
  import { faArrowUpRightFromSquare } from '@fortawesome/free-solid-svg-icons';
  import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
  import type { WalkthroughAnnotation } from './types';

  interface Props {
    annotation: WalkthroughAnnotation;
    index: number;
    isLast?: boolean;
    /** Code lines to display (already extracted for the annotation's line range) */
    codeLines?: string[];
    onClick?: () => void;
  }

  let { annotation, index, isLast = false, codeLines = [], onClick }: Props = $props();

  // Format line range for display
  const lineDisplay = $derived(
    annotation.endLine && annotation.endLine !== annotation.line
      ? `L${annotation.line}-${annotation.endLine}`
      : `L${annotation.line}`,
  );

  // Get short filename for display
  const shortFilename = $derived(() => {
    const parts = annotation.file.split('/');
    return parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : annotation.file;
  });
</script>

<!-- Timeline-based annotation card -->
<div class="relative flex gap-4">
  <!-- Timeline line and dot -->
  <div class="relative flex flex-col items-center">
    <!-- Dot/number -->
    <div
      class="relative z-10 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium shadow-sm"
    >
      {index}
    </div>
    <!-- Vertical line (hidden for last item) -->
    {#if !isLast}
      <div class="absolute top-6 bottom-0 left-1/2 w-px -translate-x-1/2 bg-border"></div>
    {/if}
  </div>

  <!-- Content card -->
  <div class="flex-1 pb-6 min-w-0">
    <!-- File header - clickable -->
    <button
      class="group mb-2 flex items-center gap-2 text-left transition-colors hover:text-primary"
      onclick={() => onClick?.()}
      title="View in diff"
    >
      <span class="text-xs font-mono text-muted-foreground group-hover:text-primary truncate">
        {shortFilename()}
      </span>
      <span class="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-subtle">
        {lineDisplay}
      </span>
      {#if onClick}
        <Fa
          icon={faArrowUpRightFromSquare}
          class="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
        />
      {/if}
    </button>

    <!-- Code snippet (if available) -->
    {#if codeLines.length > 0}
      <div
        class="mb-2 overflow-hidden rounded-lg border border-border bg-muted/30"
      >
        <div class="overflow-x-auto">
          <div class="font-mono text-xs leading-relaxed">
            {#each codeLines as line, i}
              <div class="flex hover:bg-muted/50">
                <!-- Line number -->
                <div
                  class="w-10 shrink-0 select-none border-r border-border/50 px-2 text-right text-subtle"
                >
                  {annotation.line + i}
                </div>
                <!-- Code content -->
                <pre class="flex-1 whitespace-pre-wrap break-all px-3 py-0.5">{line}</pre>
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/if}

    <!-- Message content -->
    <div class="rounded-lg border border-border bg-card p-3 text-sm shadow-sm">
      <MarkdownViewer content={annotation.message} className="prose-sm" />
    </div>
  </div>
</div>
