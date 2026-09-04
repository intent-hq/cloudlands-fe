<script lang="ts">
  /**
   * ContextEngineToolCall - Special tool call display for Augment's Context Engine
   *
   * Renders codebase-retrieval and git-commit-retrieval tool calls with
   * Augment branding to highlight they use Augment's proprietary context engine.
   */
  import type { ToolUseBlock } from '$shared/types';
  import { faEye } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { parseToolResult } from './tool-result-parser';
  import CodeBlock from '$lib/components/editor/CodeBlock.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import {
    CHAT_OPERATIONAL_ICON_CLASS,
    OPERATIONAL_INLINE_DETAILS_CLASS,
  } from './operational-disclosure-row';
  import { buildToolDisplayModel } from './tool-display-model';
  import ToolStatusIcon from './ToolStatusIcon.svelte';
  import ChatOperationalRow from './ChatOperationalRow.svelte';

  interface Props {
    toolUse: ToolUseBlock;
    toolState?: 'running' | 'completed' | 'error';
    result?: any;
    adjacentOperationalRow?: boolean;
    /** Called on expand — the parent dispatches lazy block hydration (§5.5). */
    onExpand?: () => void;
  }

  let {
    toolUse,
    toolState = 'completed',
    result = null,
    adjacentOperationalRow = false,
    onExpand,
  }: Props = $props();

  const parsedResult = $derived(
    result !== null && result !== undefined
      ? parseToolResult(toolUse.name, toolUse.input || {}, result)
      : null,
  );

  let expanded = $state(false);
  const detailsId = $derived(`context-engine-details-${toolUse.id}`);

  // Determine the source type (codebase vs commit history)
  const isCommitRetrieval = $derived(
    toolUse.name.toLowerCase().includes('git') || toolUse.name.toLowerCase().includes('commit'),
  );
  const isConversationRetrieval = $derived(toolUse.name.toLowerCase().includes('conversation'));

  const sourceLabel = $derived(
    isCommitRetrieval
      ? m.chat_contextEngine_sourceCommitHistory_label()
      : isConversationRetrieval
        ? m.chat_contextEngine_sourceConversations_label()
        : m.chat_contextEngine_sourceCodebase_label(),
  );

  // Get the query/information request (cast to String to handle non-string values safely)
  const query = $derived(String(toolUse.input?.information_request || toolUse.input?.query || ''));
  const displayModel = $derived(
    buildToolDisplayModel({
      toolName: toolUse.name,
      display: {
        category: 'context-engine',
        icon: faEye,
        verb: '',
        subject: sourceLabel,
        path: null,
      },
      input: toolUse.input || {},
      result,
      parsedResult,
      toolState,
    }),
  );

  // Get snippets from parsed result
  const snippets = $derived(parsedResult?.snippets || []);
  const snippetCount = $derived(snippets.length);

  const plainContentPreview = $derived.by(() => {
    const content = parsedResult?.content;
    if (!content) return '';
    if (content === `Search: ${query}` || content === `Find: ${query}`) return '';
    return getPreviewContent(content, 3);
  });

  // Only allow expanding if there are actual results to show.
  const hasResults = $derived(snippetCount > 0 || plainContentPreview.length > 0);
  const isExpandable = $derived(hasResults || toolState === 'error');

  function toggleExpanded() {
    if (!isExpandable) return;
    expanded = !expanded;
    // Expanding a slim-truncated row triggers the on-demand full-block fetch
    // (no-op for under-budget rows: the parent's truncated id list is empty).
    if (expanded) onExpand?.();
  }

  function handleDisclosureKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleExpanded();
  }

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

{#snippet leading()}
  <Fa icon={faEye} size={16} class={CHAT_OPERATIONAL_ICON_CLASS} />
{/snippet}

{#snippet summary()}
  {#each displayModel.sentenceSegments as segment}
    <span
      class="font-normal"
      data-tool-primary={segment.kind === 'primary' ? '' : undefined}
      data-tool-secondary={segment.kind !== 'primary' ? '' : undefined}>{segment.text}</span
    >
  {/each}
{/snippet}

{#snippet trailing()}
  <ToolStatusIcon status={toolState} />
{/snippet}

{#snippet details()}
  <div class="type-caption px-3 py-1 text-muted-foreground" data-testid="context-engine-brand">
    <!-- i18n-ignore (brand name) -->
    Augment Context Engine
  </div>
  <!-- Error display -->
  {#if toolState === 'error'}
    <div class="border-b border-danger/20 bg-danger-background/10 px-4 py-3">
      <div class="flex items-start gap-2">
        <div class="type-caption text-danger">
          {#if result}
            {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
          {:else}
            {m.chat_contextEngine_toolCallFailed_label()}
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
              <span class="type-caption text-subtle">{fileName}</span>
              {#if snippet.lineStart}
                <span class="type-caption text-subtle">:{snippet.lineStart}</span>
              {/if}
              {#if dirPath}
                <span class="type-caption truncate text-subtle" title={snippet.path}>{dirPath}</span
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
          <div class="text-center text-xs text-subtle py-1.5 border-t border-border mt-1">
            {snippetCount - 6 === 1
              ? m.chat_contextEngine_moreFiles_one({
                  count: formatInteger(snippetCount - 6),
                })
              : m.chat_contextEngine_moreFiles_many({
                  count: formatInteger(snippetCount - 6),
                })}
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
{/snippet}

<ChatOperationalRow
  {leading}
  {summary}
  trailing={toolState === 'running' ? undefined : trailing}
  showChevron={false}
  details={expanded ? details : undefined}
  interactive={isExpandable}
  {expanded}
  controls={detailsId}
  ariaLabel={isExpandable
    ? m.chat_toolCall_technicalDetails_label()
    : displayModel.accessibleSentence}
  title={isExpandable ? m.chat_toolCall_technicalDetails_label() : displayModel.accessibleSentence}
  summaryTitle={displayModel.accessibleSentence}
  onclick={toggleExpanded}
  onkeydown={handleDisclosureKeydown}
  {detailsId}
  detailsClass={OPERATIONAL_INLINE_DETAILS_CLASS}
  {adjacentOperationalRow}
  streaming={toolState === 'running'}
  toolIcon
  testId="context-engine-tool-call"
  disclosureTestId="context-engine-disclosure"
  summaryTestId="context-engine-query"
  toolUseId={toolUse.id}
  conversationLayer="tool-activity"
/>

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
</style>
