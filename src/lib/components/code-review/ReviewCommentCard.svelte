<script lang="ts">
  import Fa from 'svelte-fa';
  import {
    faCircleExclamation,
    faTriangleExclamation,
    faCircleInfo,
    faChevronDown,
    faArrowUpRightFromSquare,
    faWrench,
  } from '@fortawesome/free-solid-svg-icons';
  import { cn } from '$lib/utils';
  import { type ReviewComment, type ReviewSeverity } from './types';
  import CodeBlock from '$lib/components/editor/CodeBlock.svelte';
  import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
  import { invoke } from '$lib/electron-bridge';
  import { getLanguageFromPath } from '$lib/utils/file-utils';
  import { slide } from 'svelte/transition';

  interface Props {
    comment: ReviewComment;
    workspacePath?: string;
    onViewInDiff?: (comment: ReviewComment) => void;
    onFix?: (comment: ReviewComment) => void;
    class?: string;
  }

  let { comment, workspacePath, onViewInDiff, onFix, class: className }: Props = $props();

  let isFixing = $state(false);
  let isCodeExpanded = $state(false);
  let codeSnippet = $state<string | null>(null);
  let isLoadingSnippet = $state(false);
  let snippetError = $state<string | null>(null);

  async function loadCodeSnippet() {
    if (!comment.location || codeSnippet !== null) return;
    isLoadingSnippet = true;
    snippetError = null;
    try {
      let filePath = comment.location.file;
      if (!filePath.startsWith('/') && workspacePath) {
        filePath = `${workspacePath}/${filePath}`;
      }
      const response = await invoke<{
        success: boolean;
        data?: { content: string } | string;
        error?: string;
      }>('file:read', { path: filePath });
      if (response.success && response.data) {
        const content = typeof response.data === 'string' ? response.data : response.data.content;
        const lines = content.split('\n');
        const startLine = Math.max(0, comment.location.startLine - 1);
        const endLine = comment.location.endLine || comment.location.startLine;
        const snippetStart = Math.max(0, startLine - 2);
        const snippetEnd = Math.min(lines.length, endLine + 2);
        codeSnippet = lines.slice(snippetStart, snippetEnd).join('\n');
      } else {
        snippetError = response.error || 'Failed to load file';
      }
    } catch (error) {
      snippetError = (error as Error).message;
    } finally {
      isLoadingSnippet = false;
    }
  }

  function toggleCodeExpand() {
    isCodeExpanded = !isCodeExpanded;
    if (isCodeExpanded && codeSnippet === null && !isLoadingSnippet) {
      loadCodeSnippet();
    }
  }

  const severityConfig: Record<ReviewSeverity, { icon: typeof faCircleExclamation; color: string }> =
    {
      critical: { icon: faCircleExclamation, color: 'text-red-500' },
      important: { icon: faTriangleExclamation, color: 'text-amber-500' },
      minor: { icon: faCircleInfo, color: 'text-blue-400' },
    };

  const config = $derived(severityConfig[comment.severity]);
  const language = $derived(comment.location ? getLanguageFromPath(comment.location.file) : 'text');
  const startLineNumber = $derived(
    comment.location ? Math.max(1, comment.location.startLine - 2) : 1,
  );
</script>

<div
  class={cn(
    'rounded-lg border border-border/50 bg-card shadow-sm',
    comment.dismissed && 'opacity-50',
    className,
  )}
>
  <!-- Title row with severity badge -->
  <div class="flex items-start justify-between gap-3 px-4 pt-3 pb-2">
    <h4 class="text-sm font-semibold text-foreground leading-snug">{comment.title}</h4>
    <span class={cn('text-xs font-medium shrink-0', config.color)}>
      {comment.severity === 'critical'
        ? 'Critical'
        : comment.severity === 'important'
          ? 'Important'
          : 'Suggestion'}
    </span>
  </div>

  <!-- Description -->
  {#if comment.description}
    <div class="px-4 pb-3 text-sm text-muted-foreground leading-relaxed">
      <MarkdownViewer content={comment.description} className="prose-sm" />
    </div>
  {/if}

  <!-- File location row -->
  {#if comment.location}
    <div class="flex items-center gap-2 px-4 py-2 border-t border-border/30">
      <button
        class="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors flex-1 min-w-0"
        onclick={toggleCodeExpand}
      >
        <Fa
          icon={faChevronDown}
          class="h-2.5 w-2.5 transition-transform shrink-0 {isCodeExpanded ? '' : '-rotate-90'}"
        />
        <span class="font-mono truncate">
          {comment.location.file}:{comment.location.startLine}{comment.location.endLine
            ? `-${comment.location.endLine}`
            : ''}
        </span>
      </button>
      <button
        class="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
        onclick={() => onViewInDiff?.(comment)}
        title="View in diff"
      >
        <Fa icon={faArrowUpRightFromSquare} class="h-3 w-3" />
      </button>
    </div>

    <!-- Expandable code snippet -->
    {#if isCodeExpanded}
      <div class="px-4 pb-3" transition:slide={{ duration: 100 }}>
        {#if isLoadingSnippet}
          <div class="text-xs text-muted-foreground italic py-2">Loading...</div>
        {:else if snippetError}
          <div class="text-xs text-red-500 py-2">{snippetError}</div>
        {:else if codeSnippet}
          <CodeBlock
            code={codeSnippet}
            {language}
            showLineNumbers={true}
            {startLineNumber}
            highlightLines={comment.location.endLine
              ? Array.from(
                  { length: comment.location.endLine - comment.location.startLine + 1 },
                  (_, i) => comment.location!.startLine + i,
                )
              : [comment.location.startLine]}
            maxHeight={150}
          />
        {/if}
      </div>
    {/if}
  {/if}

  <!-- Footer actions -->
  <div class="flex items-center gap-3 px-4 py-2 border-t border-border/30">
    {#if onFix}
      <button
        class="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onclick={() => onFix?.(comment)}
        disabled={isFixing}
      >
        <Fa icon={faWrench} class="h-3 w-3" />
        <span>{isFixing ? 'Creating...' : 'Fix'}</span>
      </button>
    {/if}
  </div>
</div>
