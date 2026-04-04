<script lang="ts">
  /**
   * ContextEngineToolCall - Special tool call display for Augment's Context Engine
   *
   * Renders codebase-retrieval and git-commit-retrieval tool calls with
   * Augment branding to highlight they use Augment's proprietary context engine.
   */
  import type { ToolUseBlock } from '$shared/types';
  import {
    faFile,
    faExclamationTriangle,
    faCodeCommit,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { fly, slide } from 'svelte/transition';
  import { parseToolResult } from './tool-result-parser';
  import CodeBlock from '$lib/components/editor/CodeBlock.svelte';
  import { TooltipRich } from '$lib/components/ui/tooltip';
  import { cn } from '$lib/utils';

  interface Props {
    toolUse: ToolUseBlock;
    toolState?: 'running' | 'completed' | 'error';
    result?: any;
  }

  let { toolUse, toolState = 'completed', result = null }: Props = $props();

  const parsedResult = $derived(
    result ? parseToolResult(toolUse.name, toolUse.input, result) : null,
  );

  let expanded = $state(false);
  // Only allow expanding if there are actual results to show
  const hasResults = $derived(
    (parsedResult?.snippets?.length ?? 0) > 0 || !!parsedResult?.content,
  );
  let hoveredIndex = $state<number | null>(null);
  let hoverTimeout: ReturnType<typeof setTimeout> | null = null;

  function handleMouseEnter(index: number) {
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
      hoverTimeout = null;
    }
    hoveredIndex = index;
  }

  function handleMouseLeave() {
    hoverTimeout = setTimeout(() => {
      hoveredIndex = null;
    }, 50);
  }

  function expand(node: Element) {
    return slide(node, { duration: 150 });
  }

  // Determine the source type (codebase vs commit history)
  const isCommitRetrieval = $derived(
    toolUse.name.toLowerCase().includes('git') || toolUse.name.toLowerCase().includes('commit'),
  );
  const isConversationRetrieval = $derived(
    toolUse.name.toLowerCase().includes('conversation'),
  );

  const sourceLabel = $derived(
    isCommitRetrieval ? 'commit history' : isConversationRetrieval ? 'conversations' : 'codebase',
  );

  // Get the query/information request (cast to String to handle non-string values safely)
  const query = $derived(String(toolUse.input?.information_request || toolUse.input?.query || ''));

  // Get snippets from parsed result
  const snippets = $derived(parsedResult?.snippets || []);
  const snippetCount = $derived(snippets.length);

  // Normalize content with line numbers to have consistent formatting
  // Input format: "    42\tcode here" (varying leading spaces + digits + tab + content)
  // Output format: "42 | code here" (consistent width line numbers)
  function normalizeIndentation(content: string): string {
    const lines = content.split('\n');

    // Check if content has line numbers (format: spaces + digits + tab + content)
    const lineNumberPattern = /^\s*(\d+)\t(.*)$/;
    const parsedLines = lines.map((line) => {
      const match = line.match(lineNumberPattern);
      if (match) {
        return { lineNum: match[1], code: match[2] };
      }
      return { lineNum: null, code: line };
    });

    const hasLineNumbers = parsedLines.some((l) => l.lineNum !== null);

    if (hasLineNumbers) {
      // Find max line number width for padding
      const maxLineNumWidth = Math.max(
        ...parsedLines.filter((l) => l.lineNum).map((l) => l.lineNum!.length),
      );

      // Normalize code indentation
      const codeLines = parsedLines.map((l) => l.code);
      const nonEmptyCodeLines = codeLines.filter((line) => line.trim().length > 0);

      let minIndent = 0;
      if (nonEmptyCodeLines.length > 0) {
        minIndent = Math.min(
          ...nonEmptyCodeLines.map((line) => {
            const match = line.match(/^(\s*)/);
            return match ? match[1].length : 0;
          }),
        );
      }

      // Rebuild with consistent line number width and normalized indentation
      return parsedLines
        .map((l) => {
          const code =
            minIndent > 0 && l.code.length >= minIndent ? l.code.slice(minIndent) : l.code;
          if (l.lineNum !== null) {
            return `${l.lineNum.padStart(maxLineNumWidth)} | ${code}`;
          }
          return code;
        })
        .join('\n');
    }

    // No line numbers - just normalize indentation
    const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
    if (nonEmptyLines.length === 0) return content;

    const minIndent = Math.min(
      ...nonEmptyLines.map((line) => {
        const match = line.match(/^(\s*)/);
        return match ? match[1].length : 0;
      }),
    );

    if (minIndent === 0) return content;

    return lines
      .map((line) => (line.length >= minIndent ? line.slice(minIndent) : line))
      .join('\n');
  }

  // Get preview content (first N lines) with normalized indentation
  function getPreviewContent(content: string | undefined, maxLines: number): string {
    if (!content) return '';
    const normalized = normalizeIndentation(content);
    const lines = normalized.split('\n');
    if (lines.length <= maxLines) return normalized;
    return lines.slice(0, maxLines).join('\n');
  }

  // Detect language from file extension
  function getLanguageFromPath(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase() || '';
    const langMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      rs: 'rust',
      go: 'go',
      svelte: 'xml',
      vue: 'xml',
      html: 'xml',
      css: 'css',
      scss: 'scss',
      less: 'less',
      json: 'json',
      yaml: 'yaml',
      yml: 'yaml',
      md: 'markdown',
      sh: 'bash',
      bash: 'bash',
      zsh: 'bash',
      sql: 'sql',
      rb: 'ruby',
      java: 'java',
      kt: 'kotlin',
      swift: 'swift',
      c: 'c',
      cpp: 'cpp',
      h: 'c',
      hpp: 'cpp',
      cs: 'csharp',
      php: 'php',
      toml: 'ini',
      xml: 'xml',
    };
    return langMap[ext] || 'plaintext';
  }
</script>

<div
  class="group relative w-full text-base transition-all duration-150 overflow-hidden block my-1 bg-primary/5 text-primary px-3.5 pb-2"
>
  <div class="flex flex-col w-full min-w-0 pt-2 relative min-h-8">
    <button
      class={cn('flex flex-col text-left items-start gap-1.5', hasResults ? 'cursor-pointer' : 'cursor-default')}
      onclick={() => {
        if (hasResults) expanded = !expanded;
      }}
    >
      <!-- Context Engine label -->
      <div class="w-full flex mb-1">
        <!-- Augment Logo -->
        <!-- <div class="shrink-0 pt-1.25 pr-1.5 text-subtle">
          <Fa icon={faMagnifyingGlass} size={12} />
        </div> -->
        <span class="shrink-0 text-primary/80 {toolState === 'running' ? 'animate-pulse' : ''}">
          Search {sourceLabel}
        </span>

        <div class="ml-auto flex items-center gap-1.5">
          <div
            class="flex items-center justify-center leading-none font-medium whitespace-nowrap text-primary/70 px-3d py-1.25 rounded-full text-[0.66rem] uppercase tracking-widest"
          >
            Augment Context Engine
          </div>

          <!-- Status indicator -->
          {#if toolState === 'error'}
            <div class="flex items-center gap-2 shrink-0">
              <Fa icon={faExclamationTriangle} size="xs" class="text-red-500" />
            </div>
          {/if}
        </div>
      </div>
    </button>

    <!-- Query preview (truncated) -->
    {#if query}
      <button
        class={cn('flex-1 flex items-center gap-2 min-w-0 text-left bg-transparent border-0 p-0 my-0.5', hasResults ? 'cursor-pointer' : 'cursor-default')}
        onclick={() => {
          if (hasResults) expanded = !expanded;
        }}
      >
        <span class="text-subtle text-sm line-clamp-2 block leading-tight">
          {query.slice(0, 600)}
        </span>
      </button>

      {#if !expanded}
        <div class="w-full flex -ml-1 shrink" role="list" onmouseleave={handleMouseLeave}>
          {#each snippets.slice(0, 20) as snippet, i (`snippet-${i}-${snippet.path}`)}
            {@const fileName = snippet.path.split('/').pop() || snippet.path}
            {@const lineInfo = snippet.lineStart ? `:${snippet.lineStart}` : ''}
            {@const dirPath = snippet.path.split('/').slice(0, -1).join('/')}
            {@const previewLines = getPreviewContent(snippet.content, 6)}
            <div class="shrink-0" transition:fly={{ x: 6, duration: 200 }}>
              <TooltipRich
                side="top"
                sideOffset={4}
                delayDuration={0}
                maxWidth="28rem"
                variant="custom"
                contentClass="bg-popover border border-border"
                showArrow={false}
                disableHoverableContent
                disableAnimation
                open={hoveredIndex === i}
              >
                {#snippet trigger()}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <span class="p-1 pb-0" onmouseenter={() => handleMouseEnter(i)}>
                    <Fa
                      icon={isCommitRetrieval ? faCodeCommit : faFile}
                      size="xs"
                      class="text-ghost"
                    />
                  </span>
                {/snippet}
                {#snippet content()}
                  <div class="flex items-baseline gap-1.5 mb-1 whitespace-nowrap">
                    <span class="text-sm text-foreground">{fileName}{lineInfo}</span>
                    {#if dirPath}
                      <span class="text-xs text-subtle truncate">{dirPath}</span>
                    {/if}
                  </div>
                  {#if previewLines}
                    <div class="snippet-hover-code">
                      <CodeBlock
                        className="overflow-hidden"
                        doScroll={false}
                        code={previewLines}
                        language={getLanguageFromPath(snippet.path)}
                        maxHeight={120}
                      />
                    </div>
                  {/if}
                {/snippet}
              </TooltipRich>
            </div>
          {/each}
        </div>
      {/if}
    {:else}
      <div class="flex-1"></div>
    {/if}
  </div>

  {#if expanded}
    <div class="-mt-2" transition:expand>
      <!-- Error display -->
      {#if toolState === 'error'}
        <div class="px-4 py-3 bg-red-500/10 border-b border-red-500/20">
          <div class="flex items-start gap-2">
            <Fa icon={faExclamationTriangle} size="sm" class="text-red-500 mt-0.5 shrink-0" />
            <div class="text-sm text-red-600 dark:text-red-400">
              {#if result}
                {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
              {:else}
                Tool call failed
              {/if}
            </div>
          </div>
        </div>
      {/if}

      <!-- Results section -->
      {#if toolState !== 'error' && snippetCount > 0}
        <div class="py-2">
          <!-- <div class="flex items-center gap-2 mb-2">
          <span class="text-xs text-muted-foreground uppercase tracking-wide">Retrieved</span>
          <span class="text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
            {snippetCount} {snippetCount === 1 ? 'file' : 'files'}
          </span>
        </div> -->

          <div class="flex flex-col gap-1.5">
            {#each snippets.slice(0, 6) as snippet, i (`snippet-${i}-${snippet.path}`)}
              {@const fileName = snippet.path.split('/').pop() || snippet.path}
              {@const dirPath = snippet.path.split('/').slice(0, -1).join('/')}
              <div class="transition-colors">
                <!-- File header -->
                <div class="flex items-center gap-1.5 py-1">
                  <!-- <Fa icon={faFile} size="xs" class="text-primary/60" /> -->
                  <span class="text-sm text-subtle">{fileName}</span>
                  {#if snippet.lineStart}
                    <span class="text-sm text-subtle">:{snippet.lineStart}</span>
                  {/if}
                  {#if dirPath}
                    <span class="text-sm text-subtle truncate" title={snippet.path}
                      >{dirPath}</span
                    >
                  {/if}
                </div>
                <!-- Code preview with syntax highlighting -->
                <div class="code-snippet-wrapper">
                  <CodeBlock
                    code={getPreviewContent(snippet.content, 6)}
                    language={getLanguageFromPath(snippet.path)}
                    maxHeight={120}
                  />
                </div>
              </div>
            {/each}

            {#if snippetCount > 6}
              <div
                class="text-center text-xs text-subtle py-1.5 border-t border-border/20 mt-1"
              >
                +{snippetCount - 6} more {snippetCount - 6 === 1 ? 'file' : 'files'}
              </div>
            {/if}
          </div>
        </div>
      {:else if toolState !== 'error' && parsedResult?.content}
        <!-- Fallback: plain content -->
        <div class="px-3 py-2">
          <div class="code-snippet-wrapper">
            <CodeBlock code={parsedResult.content} language="plaintext" maxHeight={300} />
          </div>
        </div>
      {:else if toolState !== 'error' && result}
        <!-- Raw result fallback -->
        <div class="px-3 py-2">
          <div class="code-snippet-wrapper">
            <CodeBlock
              code={typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
              language="json"
              maxHeight={300}
            />
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* Override CodeBlock styling for compact display in context engine results */
  .code-snippet-wrapper :global(.code-block-container) {
    margin: 0 !important;
    border: none !important;
    border-radius: 0 !important;
  }

  .code-snippet-wrapper :global(.code-pre) {
    font-size: 12px !important;
    line-height: 18px !important;
    padding: 8px 12px !important;
  }

  .code-snippet-wrapper :global(.code-line) {
    min-height: 18px !important;
  }

  /* Override CodeBlock styling for hover card - no background, compact, scrollable */
  .snippet-hover-code {
    max-height: 120px;
    overflow: auto;
  }

  .snippet-hover-code :global(.code-block-container) {
    margin: 0 !important;
    border: none !important;
    border-radius: 0 !important;
    background: transparent !important;
  }

  .snippet-hover-code :global(.code-pre) {
    font-size: 11px !important;
    line-height: 16px !important;
    padding: 0 !important;
    background: transparent !important;
  }

  .snippet-hover-code :global(.code-line) {
    min-height: 16px !important;
  }
</style>
