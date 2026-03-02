<script lang="ts">
  import type { ParsedToolResult } from './tool-result-parser';
  import Fa from 'svelte-fa';
  import {
    faCopy,
    faCheck,
    faExclamationTriangle,
    faFolder,
    faFile,
  } from '@fortawesome/free-solid-svg-icons';
  import { DiffViewer } from '$lib/components/ui/diff';
  import MarkdownRenderer from '$lib/components/editor/MarkdownRenderer.svelte';
  import CodeBlock from '$lib/components/editor/CodeBlock.svelte';
  import AgentCard from './AgentCard.svelte';
  import { sessionStore } from '$features/agent/browser';
  import { isGenericAgentName } from '$lib/utils/agent-name-generator';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';

  interface Props {
    input: Record<string, any>;
    result?: any;
    parsedResult?: ParsedToolResult | null;
    isError?: boolean;
  }

  const { input, result, parsedResult, isError = false }: Props = $props();

  let copied = $state(false);

  // Special input keys that should be shown at the top of output (not hidden)
  // These are the "query" or "request" that provides important context
  const FEATURED_INPUT_KEYS = new Set([
    'information_request', // codebase-retrieval
    'query', // search tools
    'thought', // sequential thinking
    'memory', // remember tool
    'search_query_regex', // view tool with regex search
  ]);

  // Get preview content (first N lines)
  function getPreviewContent(content: string | undefined, maxLines: number): string {
    if (!content) return '';
    const lines = content.split('\n');
    if (lines.length <= maxLines) return content;
    return lines.slice(0, maxLines).join('\n') + '\n...';
  }

  // Copy to clipboard
  async function copyToClipboard(text: string) {
    await navigator.clipboard.writeText(text);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  // Extract evaluate expressions from browser tool input actions
  const evaluateExpressions = $derived.by(() => {
    if (!input?.actions || !Array.isArray(input.actions)) return null;
    const exprs = input.actions
      .filter((a: any) => a.action === 'evaluate' && a.expression)
      .map((a: any) => a.expression as string);
    return exprs.length > 0 ? exprs : null;
  });

  // Get featured input value (the main query/request to show at top of output)
  const featuredInput = $derived.by(() => {
    for (const key of FEATURED_INPUT_KEYS) {
      if (input[key] && typeof input[key] === 'string') {
        return input[key] as string;
      }
    }
    return null;
  });

  // Format a value for display (truncates long strings to keep the expanded view clean)
  function formatValue(val: unknown): string {
    if (val == null) return '';
    if (typeof val === 'string') {
      return val.length > 150 ? val.slice(0, 150) + '…' : val;
    }
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (Array.isArray(val))
      return val.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(', ');
    try {
      const json = JSON.stringify(val, null, 2);
      return json.length > 150 ? json.slice(0, 150) + '…' : json;
    } catch {
      return String(val);
    }
  }

  // All non-empty input fields (used for error display and fallback details)
  const inputEntries = $derived.by(() => {
    if (!input) return null;
    const entries: Array<{ key: string; value: string }> = [];
    for (const [key, val] of Object.entries(input)) {
      if (val == null) continue;
      // Skip very long values in the summary (like file_content, instructions_reminder)
      if (FEATURED_INPUT_KEYS.has(key)) continue;
      // Skip internal metadata fields (e.g., _acpTitle used for path extraction fallback)
      if (key.startsWith('_')) continue;
      const formatted = formatValue(val);
      if (formatted) entries.push({ key, value: formatted });
    }
    return entries.length > 0 ? entries : null;
  });
</script>

<div class="flex flex-col text-sm">
  <!-- Error display -->
  {#if isError}
    <div class="rounded-md border border-border overflow-hidden mb-2 divide-y divide-border">
      {#if inputEntries}
        <div class="px-3 py-2 flex flex-col gap-1 bg-muted/30">
          {#each inputEntries as { key, value }}
            <div class="text-xs">
              <span class="text-subtle">{key}</span>
              <span class="text-subtle ml-1.5">{value}</span>
            </div>
          {/each}
        </div>
      {/if}
      {#if result}
        <div class="px-3 py-2 flex items-start gap-2">
          <Fa icon={faExclamationTriangle} size="xs" class="text-red-500/70 mt-0.5 shrink-0" />
          <pre
            class="m-0 whitespace-pre-wrap font-mono text-xs text-red-600 dark:text-red-400">{typeof result ===
            'string'
              ? result
              : JSON.stringify(result, null, 2)}</pre>
        </div>
      {:else if !inputEntries}
        <div class="px-3 py-2 flex items-start gap-2">
          <Fa icon={faExclamationTriangle} size="xs" class="text-red-500/70 mt-0.5 shrink-0" />
          <span class="text-xs text-subtle">No error details available</span>
        </div>
      {/if}
    </div>
  {:else if result || parsedResult}
    <!-- Output Section (no Input section - hidden for cleaner display) -->
    <div class="flex flex-col">
      <div class="p-2 bg-muted/30 relative group/details">
        <!-- Featured input (query/request) shown at top with border below -->
        {#if featuredInput}
          <div class="pb-2 mb-2 border-b border-border text-subtle italic">
            "{featuredInput}"
          </div>
        {/if}

        <!-- Copy button (appears on hover, top-right of content area) -->
        <!-- Skip for file-view since CodeBlock has its own copy button -->
        {#if parsedResult?.content && parsedResult?.type !== 'file-view'}
          <button
            class="absolute top-2 right-2 p-1.5 rounded bg-muted/80 border border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer transition-all opacity-0 group-hover/details:opacity-100 z-10"
            onclick={() => copyToClipboard(parsedResult?.content || '')}
            title="Copy content"
          >
            <Fa icon={copied ? faCheck : faCopy} size="xs" />
          </button>
        {/if}

        {#if parsedResult && parsedResult.type !== 'unknown'}
          {#if (parsedResult.type === 'file-edit' || parsedResult.type === 'note-edit') && parsedResult.oldContent && parsedResult.newContent}
            <!-- Diff view using DiffViewer component -->
            <DiffViewer
              oldContent={parsedResult.oldContent}
              newContent={parsedResult.newContent}
              fileName={parsedResult.fileName || 'file'}
              viewMode="unified"
              showHeader
              showStats
              maxHeight="250px"
            />
          {:else if parsedResult.type === 'note-edit' && (parsedResult.newContent || parsedResult.content)}
            <!-- Note edit without diff - render markdown -->
            <div
              class="overflow-hidden rounded border border-border/40 bg-muted/20 max-h-72 overflow-y-auto"
            >
              <div class="p-3">
                <MarkdownRenderer
                  content={parsedResult.newContent || parsedResult.content || ''}
                  className="text-sm"
                />
              </div>
            </div>
          {:else if parsedResult.type === 'file-edit' && parsedResult.newContent}
            <!-- File edit without diff - show new content as code block with file name header -->
            <div class="flex flex-col gap-1">
              {#if parsedResult.filePath}
                <button
                  type="button"
                  class="flex items-center gap-1.5 text-muted-foreground hover:text-foreground cursor-pointer w-fit"
                  onclick={(e) => {
                    const line = parsedResult?.lineRange?.[0];
                    const openInAdjacentPanel = e.metaKey || e.ctrlKey;
                    const panelElement = (e.target as HTMLElement)?.closest('[data-panel-id]');
                    const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
                    window.dispatchEvent(
                      new CustomEvent('workspace:open-file', {
                        detail: {
                          path: parsedResult?.filePath,
                          line,
                          openInAdjacentPanel,
                          sourcePanelId,
                        },
                      }),
                    );
                  }}
                >
                  <Fa icon={faFile} size="xs" class="text-ghost" />
                  <span>{parsedResult.fileName}</span>
                  {#if parsedResult.lineRange}
                    <span class="text-subtle"
                      >:{parsedResult.lineRange[0]}-{parsedResult.lineRange[1]}</span
                    >
                  {/if}
                  {#if parsedResult.editSummary}
                    <span class="text-subtle">{parsedResult.editSummary}</span>
                  {/if}
                </button>
              {/if}
              <CodeBlock
                code={parsedResult.newContent}
                language={parsedResult.language || 'plaintext'}
                showLineNumbers={true}
                startLineNumber={parsedResult.lineRange?.[0] || 1}
                maxHeight={288}
                noBorder
                noMargin
              />
            </div>
          {:else if parsedResult.type === 'file-edit' && parsedResult.filePath}
            <!-- File edit fallback - show file name header with result summary -->
            <div class="flex flex-col gap-1">
              <button
                type="button"
                class="flex items-center gap-1.5 text-muted-foreground hover:text-foreground cursor-pointer w-fit"
                onclick={(e) => {
                  const openInAdjacentPanel = e.metaKey || e.ctrlKey;
                  const panelElement = (e.target as HTMLElement)?.closest('[data-panel-id]');
                  const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
                  window.dispatchEvent(
                    new CustomEvent('workspace:open-file', {
                      detail: {
                        path: parsedResult?.filePath,
                        openInAdjacentPanel,
                        sourcePanelId,
                      },
                    }),
                  );
                }}
              >
                <Fa icon={faFile} size="xs" class="text-ghost" />
                <span>{parsedResult.fileName}</span>
                {#if parsedResult.editSummary}
                  <span class="text-subtle">{parsedResult.editSummary}</span>
                {/if}
              </button>
              {#if parsedResult.content}
                <!-- Use plaintext since this fallback content is status messages, not source code -->
                <CodeBlock
                  code={parsedResult.content}
                  language="plaintext"
                  showLineNumbers={false}
                  maxHeight={288}
                  noBorder
                  noMargin
                />
              {/if}
            </div>
          {:else if parsedResult.type === 'code-search' && parsedResult.snippets?.length}
            <!-- Search results - clean list view -->
            <div class="flex flex-col gap-1.5">
              {#each parsedResult.snippets.slice(0, 8) as snippet, i (`snippet-${i}-${snippet.path}`)}
                {@const fileName = snippet.path.split('/').pop() || snippet.path}
                {@const dirPath = snippet.path.split('/').slice(0, -1).join('/')}
                <div
                  class="group/snippet rounded-md overflow-hidden border border-border/60 hover:border-border transition-colors"
                >
                  <!-- File header with icon-like styling -->
                  <div
                    class="flex items-center gap-1.5 px-2 py-1 bg-muted/50 border-b border-border/40"
                  >
                    <span class="font-mono text-xs font-medium text-foreground/80">{fileName}</span>
                    {#if snippet.lineStart}
                      <span class="text-xs text-subtle">:{snippet.lineStart}</span>
                    {/if}
                    {#if dirPath}
                      <span
                        class="text-xs text-subtle truncate ml-auto"
                        title={snippet.path}>{dirPath}</span
                      >
                    {/if}
                  </div>
                  <!-- Code preview -->
                  <pre
                    class="m-0 px-2 py-1.5 font-mono text-xs leading-relaxed overflow-x-auto max-h-24 overflow-y-auto text-subtle bg-background/50">{getPreviewContent(
                      snippet.content,
                      5,
                    )}</pre>
                </div>
              {/each}
              {#if parsedResult.snippets.length > 8}
                <div
                  class="text-center text-xs text-subtle py-1 border-t border-border/30 mt-1"
                >
                  +{parsedResult.snippets.length - 8} more result{parsedResult.snippets.length -
                    8 ===
                  1
                    ? ''
                    : 's'}
                </div>
              {/if}
            </div>
          {:else if parsedResult.type === 'code-search'}
            <!-- Search results with no snippets - show "No results" message -->
            <div class="text-center py-2 text-subtle text-sm">
              No results
            </div>
            {#if parsedResult.content}
              <CodeBlock
                code={parsedResult.content}
                language="plaintext"
                showLineNumbers={false}
                maxHeight={288}
                noBorder
                noMargin
              />
            {/if}
          {:else if parsedResult.type === 'terminal'}
            <!-- Terminal output with dark theme -->
            <div class="overflow-hidden rounded bg-[#1a1b26]">
              {#if parsedResult.command}
                <div class="flex items-center gap-2 px-2 pt-2 pb-1 border-b border-[#a9b1d6]/10">
                  <span class="text-[#7aa2f7] font-mono text-xs">$</span>
                  <span class="font-mono text-xs text-[#a9b1d6]/90 truncate flex-1">{parsedResult.command}</span>
                  {#if parsedResult.exitCode !== undefined}
                    <span class="text-ui font-mono px-1.5 py-0.5 rounded {parsedResult.exitCode === 0 ? 'bg-[#9ece6a]/20 text-[#9ece6a]' : 'bg-[#f7768e]/20 text-[#f7768e]'}">
                      exit {parsedResult.exitCode}
                    </span>
                  {/if}
                </div>
              {/if}
              {#if parsedResult.content}
                <pre
                  class="m-0 p-2 font-mono text-sm leading-relaxed overflow-x-auto max-h-72 overflow-y-auto text-[#a9b1d6]">{parsedResult.content}</pre>
              {:else}
                <pre
                  class="m-0 p-2 font-mono text-sm leading-relaxed text-[#a9b1d6]/50">No output</pre>
              {/if}
            </div>
          {:else if parsedResult.type === 'file-view' && parsedResult.content}
            <!-- File view - code block with syntax highlighting -->
            <div class="flex flex-col gap-1">
              {#if parsedResult.filePath}
                <!-- Clickable file link - shows filename, links to full path -->
                <button
                  type="button"
                  class="flex items-center gap-1.5 text-muted-foreground hover:text-foreground cursor-pointer w-fit"
                  onclick={(e) => {
                    const line = parsedResult?.lineRange?.[0];
                    const openInAdjacentPanel = e.metaKey || e.ctrlKey;
                    const panelElement = (e.target as HTMLElement)?.closest('[data-panel-id]');
                    const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
                    window.dispatchEvent(
                      new CustomEvent('workspace:open-file', {
                        detail: {
                          path: parsedResult?.filePath,
                          line,
                          openInAdjacentPanel,
                          sourcePanelId,
                        },
                      }),
                    );
                  }}
                >
                  <Fa icon={faFile} size="xs" class="text-ghost" />
                  <span>{parsedResult.fileName}</span>
                  {#if parsedResult.lineRange}
                    <span class="text-subtle"
                      >:{parsedResult.lineRange[0]}-{parsedResult.lineRange[1]}</span
                    >
                  {/if}
                </button>
              {/if}
              <CodeBlock
                code={parsedResult.content}
                language={parsedResult.language || 'plaintext'}
                showLineNumbers={true}
                startLineNumber={parsedResult.lineRange?.[0] || 1}
                maxHeight={288}
                noBorder
                noMargin
              />
            </div>
          {:else if parsedResult.type === 'note-view' && parsedResult.content}
            <!-- Note view - rendered markdown -->
            <div
              class="overflow-hidden rounded border border-border/40 bg-muted/20 max-h-72 overflow-y-auto"
            >
              <div class="p-3">
                <MarkdownRenderer content={parsedResult.content} className="text-sm" />
              </div>
            </div>
          {:else if parsedResult.type === 'delegate-task'}
            <!-- Delegate task - show task name and agent card -->
            <div class="flex flex-col gap-2">
              {#if parsedResult.delegatedTaskName}
                <div class="text-sm text-subtle">
                  Task: <span class="text-foreground font-medium"
                    >{parsedResult.delegatedTaskName}</span
                  >
                </div>
              {/if}
              {#if parsedResult.agentId}
                <AgentCard agentId={parsedResult.agentId} />
              {:else}
                <div class="text-xs text-subtle italic">Agent spawned</div>
              {/if}
            </div>
          {:else if parsedResult.type === 'agent-list' && parsedResult.agents?.length}
            <!-- Agent list - show agent cards -->
            <div class="flex flex-col gap-1 max-h-64 overflow-y-auto">
              {#each parsedResult.agents as agent}
                {@const statusColor =
                  agent.status === 'responding' || agent.status === 'running'
                    ? 'text-emerald-500'
                    : agent.status === 'idle' || agent.status === 'completed'
                      ? 'text-muted-foreground'
                      : agent.status === 'error'
                        ? 'text-red-500'
                        : 'text-subtle'}
                <button
                  type="button"
                  class="flex items-center gap-2 p-2 rounded bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer text-left w-full"
                  onclick={(e) => {
                    window.dispatchEvent(
                      new CustomEvent('workspace:open-agent', {
                        detail: { agentId: agent.agentId, openInAdjacentPanel: e.metaKey || e.ctrlKey },
                      }),
                    );
                  }}
                >
                  <AuggieAvatar seed={agent.agentId} size={18} class="shrink-0" />
                  <span class="text-sm font-medium text-foreground truncate flex-1">{agent.name}</span>
                  {#if agent.status}
                    <span class="text-xs px-1.5 py-0.5 rounded bg-muted {statusColor}">{agent.status}</span>
                  {/if}
                </button>
              {/each}
              <div class="text-xs text-subtle pt-1 border-t border-border/30 mt-1">
                {parsedResult.agents.length} agent{parsedResult.agents.length === 1 ? '' : 's'}
              </div>
            </div>
          {:else if parsedResult.type === 'directory-listing' && parsedResult.files?.length}
            <!-- Directory listing - clean list -->
            <div class="flex flex-col gap-0.5 max-h-64 overflow-y-auto">
              {#each parsedResult.files as file}
                {@const isDirectory = file.endsWith('/')}
                <div
                  class="flex items-center gap-1.5 px-2 py-0.5 text-sm hover:bg-muted/30 rounded"
                >
                  <Fa
                    icon={isDirectory ? faFolder : faFile}
                    size="xs"
                    class={isDirectory ? 'text-amber-500/70' : 'text-subtle'}
                  />
                  <span class={isDirectory ? 'text-foreground/90' : 'text-subtle'}>
                    {file}
                  </span>
                </div>
              {/each}
            </div>
          {:else if parsedResult.type === 'task' && (parsedResult.taskTitle || parsedResult.taskContent)}
            <!-- Task result - structured display -->
            <div class="flex flex-col gap-2">
              {#if parsedResult.taskTitle}
                <div class="flex items-center gap-2">
                  <span class="font-medium text-foreground/90">{parsedResult.taskTitle}</span>
                  {#if parsedResult.taskStatus}
                    <span class="px-1.5 py-0.5 text-xs rounded bg-muted text-subtle"
                      >{parsedResult.taskStatus}</span
                    >
                  {/if}
                </div>
              {/if}
              {#if parsedResult.taskContent}
                <div
                  class="overflow-hidden rounded border border-border/40 bg-muted/20 p-3 max-h-48 overflow-y-auto"
                >
                  <MarkdownRenderer content={parsedResult.taskContent} className="text-sm" />
                </div>
              {/if}
            </div>
          {:else if parsedResult.type === 'task-update'}
            <!-- Task update - show task name and status -->
            <div class="flex flex-wrap items-center gap-1.5 p-2 text-sm text-foreground/80">
              {#if parsedResult.taskTitle && parsedResult.taskStatus}
                <span>Marked</span>
                <span class="font-medium text-foreground">{parsedResult.taskTitle}</span>
                <span>as</span>
                <span class="px-1.5 py-0.5 text-xs rounded bg-primary/10 text-primary font-medium">
                  {parsedResult.taskStatus}
                </span>
              {:else if parsedResult.taskStatus}
                <span>Marked task as</span>
                <span class="px-1.5 py-0.5 text-xs rounded bg-primary/10 text-primary font-medium">
                  {parsedResult.taskStatus}
                </span>
              {:else if parsedResult.taskTitle}
                <span>Updated</span>
                <span class="font-medium text-foreground">{parsedResult.taskTitle}</span>
              {:else}
                <span class="text-subtle">Task updated</span>
              {/if}
            </div>
          {:else if parsedResult.type === 'agent-report'}
            <!-- Agent report - show the report message in sans-serif -->
            <div class="p-3 text-sm text-foreground/90 max-h-48 overflow-y-auto">
              {#if parsedResult.reportMessage}
                <p class="m-0 leading-relaxed">{parsedResult.reportMessage}</p>
              {:else}
                <span class="text-subtle">Report sent to parent agent</span>
              {/if}
            </div>
          {:else if parsedResult.type === 'agent-message' && parsedResult.messageContent}
            <!-- Agent message - show "Sent message to [agent]" with clickable link, then the message -->
            {@const agentId = parsedResult.toAgentId}
            {@const session = agentId ? sessionStore.getSession(agentId) : null}
            {@const agentName =
              session?.name && !isGenericAgentName(session.name)
                ? session.name
                : agentId
                  ? `Agent ${agentId.substring(0, 8)}`
                  : 'agent'}
            <div class="flex flex-col gap-1">
              <!-- Sent message to [agent] line -->
              <div class="flex items-center gap-1.5">
                <span class="text-subtle">Sent message to</span>
                {#if agentId}
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 text-foreground/90 font-medium hover:text-foreground cursor-pointer bg-transparent border-0 p-0"
                    onclick={(e) => {
                      window.dispatchEvent(
                        new CustomEvent('workspace:open-agent', {
                          detail: { agentId, openInAdjacentPanel: e.metaKey || e.ctrlKey },
                        }),
                      );
                    }}
                  >
                    <AuggieAvatar seed={agentId} size={14} class="shrink-0" />
                    <span>{agentName}</span>
                  </button>
                {:else}
                  <span class="text-foreground/90 font-medium">agent</span>
                {/if}
              </div>
              <!-- Message content -->
              <p class="m-0 leading-relaxed whitespace-pre-wrap text-subtle">
                {parsedResult.messageContent}
              </p>
              {#if parsedResult.messagePriority === 'high'}
                <span
                  class="inline-flex self-start px-1.5 py-0.5 text-ui font-semibold rounded-full bg-amber-500/30 text-amber-600 dark:text-amber-400 border border-amber-500/30"
                >
                  High Priority
                </span>
              {/if}
            </div>
          {:else if parsedResult.type === 'comment-add'}
            <!-- Comment add result - show success message -->
            <div class="flex flex-wrap items-center gap-1.5 p-2 text-sm text-foreground/80">
              {#if parsedResult.commentMessage}
                <span>{parsedResult.commentMessage}</span>
              {:else if parsedResult.commentAnchorText}
                <span>Comment added on</span>
                <span class="font-medium text-foreground">"{parsedResult.commentAnchorText}"</span>
              {:else}
                <span class="text-subtle">Comment added</span>
              {/if}
            </div>
          {:else if parsedResult.type === 'comment-list'}
            <!-- Comment list result - show thread summaries -->
            <div class="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
              {#if parsedResult.commentThreads && parsedResult.commentThreads.length > 0}
                {#each parsedResult.commentThreads as thread}
                  <div
                    class="flex items-start gap-2 p-2 rounded bg-muted/30 hover:bg-muted/50 transition-colors"
                  >
                    <span class="text-sm font-medium text-foreground shrink-0">
                      {thread.commentCount}
                      {thread.commentCount === 1 ? 'comment' : 'comments'}
                    </span>
                    <span class="text-sm text-subtle truncate flex-1">
                      {#if thread.targetedText}
                        on "{thread.targetedText}"
                      {:else}
                        (no anchor)
                      {/if}
                    </span>
                    <span
                      class="text-xs px-1.5 py-0.5 rounded bg-muted text-subtle shrink-0"
                    >
                      {thread.status}
                    </span>
                  </div>
                {/each}
                {#if parsedResult.totalComments}
                  <div class="text-xs text-subtle pt-1 border-t border-border/30 mt-1">
                    {parsedResult.totalComments} total comment{parsedResult.totalComments === 1
                      ? ''
                      : 's'} in {parsedResult.commentThreads.length} thread{parsedResult
                      .commentThreads.length === 1
                      ? ''
                      : 's'}
                  </div>
                {/if}
              {:else}
                <span class="text-sm text-subtle p-2">No comments found</span>
              {/if}
            </div>
          {:else if parsedResult.type === 'note-list'}
            <!-- Note list result - show note titles (clickable to open) -->
            <div class="flex flex-col gap-1 max-h-64 overflow-y-auto">
              {#if parsedResult.notes && parsedResult.notes.length > 0}
                {#each parsedResult.notes as note}
                  <button
                    type="button"
                    class="flex items-center gap-2 p-2 rounded bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer text-left w-full"
                    onclick={(e) => {
                      const openInAdjacentPanel = e.metaKey || e.ctrlKey;
                      const panelElement = (e.target as HTMLElement)?.closest('[data-panel-id]');
                      const sourcePanelId =
                        panelElement?.getAttribute('data-panel-id') ?? undefined;
                      window.dispatchEvent(
                        new CustomEvent('workspace:open-note', {
                          detail: { noteId: note.id, openInAdjacentPanel, sourcePanelId },
                        }),
                      );
                    }}
                  >
                    <Fa icon={faFile} size="xs" class="text-ghost shrink-0" />
                    <span class="text-sm font-medium text-foreground truncate flex-1"
                      >{note.title}</span
                    >
                    {#if note.tags && note.tags.length > 0}
                      <div class="flex gap-1 shrink-0">
                        {#each note.tags.slice(0, 2) as tag}
                          <span class="text-xs px-1.5 py-0.5 rounded bg-muted text-subtle"
                            >{tag}</span
                          >
                        {/each}
                        {#if note.tags.length > 2}
                          <span class="text-xs text-subtle"
                            >+{note.tags.length - 2}</span
                          >
                        {/if}
                      </div>
                    {/if}
                  </button>
                {/each}
                <div class="text-xs text-subtle pt-1 border-t border-border/30 mt-1">
                  {parsedResult.notes.length} note{parsedResult.notes.length === 1 ? '' : 's'}
                </div>
              {:else}
                <span class="text-sm text-subtle p-2">No notes found</span>
              {/if}
            </div>
          {:else if parsedResult.type === 'browser'}
            <!-- Browser tool results -->
            <div class="flex flex-col gap-2">
              {#if parsedResult.screenshotBase64 || parsedResult.screenshotUrl}
                <!-- Inline screenshot -->
                <div class="overflow-hidden rounded border border-border/40">
                  <img
                    src={parsedResult.screenshotUrl || `data:image/png;base64,${parsedResult.screenshotBase64}`}
                    alt="Browser screenshot"
                    class="w-full h-auto max-h-96 object-contain bg-white"
                    style={parsedResult.screenshotWidth ? `max-width: ${Math.min(parsedResult.screenshotWidth, 600)}px` : ''}
                  />
                  {#if parsedResult.screenshotWidth && parsedResult.screenshotHeight}
                    <div class="px-2 py-1 text-ui text-subtle border-t border-border/30">
                      {parsedResult.screenshotWidth} × {parsedResult.screenshotHeight}
                    </div>
                  {/if}
                </div>
              {/if}
              {#if parsedResult.browserTabs && parsedResult.browserTabs.length > 0}
                <!-- Tab list -->
                <div class="flex flex-col gap-0.5 max-h-64 overflow-y-auto">
                  {#each parsedResult.browserTabs as tab}
                    <button
                      class="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted/30 rounded cursor-pointer text-left w-full"
                      onclick={() => {
                        if (tab.tabId) {
                          window.dispatchEvent(new CustomEvent('browser:focus-tab', { detail: { tabId: tab.tabId } }));
                        }
                      }}
                      title="Click to focus this tab"
                    >
                      <span class="w-2 h-2 rounded-full shrink-0 {tab.mounted ? 'bg-green-500/70' : 'bg-muted-foreground/30'}"></span>
                      <span class="text-foreground/90 truncate flex-1" title={tab.url}>
                        {tab.title || tab.url || tab.tabId}
                      </span>
                      {#if tab.url}
                        <span class="text-xs text-subtle truncate max-w-[200px]" title={tab.url}>
                          {tab.url}
                        </span>
                      {/if}
                    </button>
                  {/each}
                  <div class="text-xs text-subtle pt-1 border-t border-border/30 mt-1">
                    {parsedResult.browserTabs.length} tab{parsedResult.browserTabs.length === 1 ? '' : 's'}
                  </div>
                </div>
              {/if}
              {#if parsedResult.evaluateResult !== undefined || evaluateExpressions}
                <!-- Evaluate expression(s) + result -->
                <div class="overflow-hidden rounded bg-[#1a1b26]">
                  {#if evaluateExpressions}
                    <div class="px-2 pt-2 pb-1 border-b border-[#a9b1d6]/10 flex flex-col gap-0.5">
                      {#each evaluateExpressions as expr}
                        <div class="flex items-start gap-2">
                          <span class="text-[#7aa2f7] font-mono text-xs shrink-0 mt-px">›</span>
                          <pre class="m-0 font-mono text-xs text-[#a9b1d6]/90 whitespace-pre-wrap break-all">{expr}</pre>
                        </div>
                      {/each}
                    </div>
                  {/if}
                  {#if parsedResult.evaluateResult !== undefined}
                    <pre class="m-0 p-2 font-mono text-sm leading-relaxed overflow-x-auto max-h-48 overflow-y-auto text-[#a9b1d6]">{parsedResult.evaluateResult}</pre>
                  {/if}
                </div>
              {/if}
              {#if parsedResult.accessibilityTree}
                <!-- Accessibility tree -->
                <div class="overflow-hidden rounded bg-[#1a1b26]">
                  <div class="flex items-center gap-2 px-2 pt-2 pb-1 border-b border-[#a9b1d6]/10">
                    <span class="text-xs font-medium text-[#a9b1d6]/70">Accessibility Tree</span>
                  </div>
                  <pre class="m-0 p-2 font-mono text-xs leading-relaxed overflow-x-auto max-h-64 overflow-y-auto text-[#a9b1d6]/80">{parsedResult.accessibilityTree}</pre>
                </div>
              {/if}
              {#if parsedResult.error}
                <!-- Error -->
                <div class="flex items-start gap-2 p-2">
                  <Fa icon={faExclamationTriangle} size="xs" class="text-red-500/70 mt-0.5 shrink-0" />
                  <pre class="m-0 whitespace-pre-wrap font-mono text-xs text-red-600 dark:text-red-400">{parsedResult.error}</pre>
                </div>
              {/if}
              {#if parsedResult.content && !parsedResult.screenshotBase64 && !parsedResult.screenshotUrl && !parsedResult.browserTabs?.length && !parsedResult.evaluateResult && !parsedResult.accessibilityTree && !parsedResult.error}
                <!-- Fallback content for other browser actions -->
                <div class="overflow-hidden rounded">
                  <pre class="m-0 p-2 font-mono text-sm leading-relaxed overflow-x-auto max-h-48 overflow-y-auto text-foreground/80">{parsedResult.content}</pre>
                </div>
              {/if}
            </div>
          {:else if parsedResult.type === 'confirmation' && parsedResult.content}
            <!-- Confirmation/info result - clean text display -->
            <div class="overflow-hidden rounded">
              <pre
                class="m-0 p-2 text-sm leading-relaxed overflow-x-auto max-h-72 overflow-y-auto text-foreground/80 whitespace-pre-wrap">{parsedResult.content}</pre>
            </div>
          {:else if parsedResult.content}
            <!-- Plain text preview (no syntax highlighting for cleaner light/dark mode support) -->
            <div class="overflow-hidden rounded">
              <pre
                class="m-0 p-2 font-mono text-sm leading-relaxed overflow-x-auto max-h-72 overflow-y-auto text-foreground/80">{parsedResult.content}</pre>
            </div>
          {/if}
        {:else if result}
          <!-- Fallback: show input details + raw result -->
          {#if inputEntries}
            <div class="flex flex-col gap-1 pb-2 mb-2 border-b border-border/50">
              {#each inputEntries as { key, value }}
                <div class="text-xs">
                  <span class="text-subtle">{key}</span>
                  <span class="text-subtle ml-1.5 break-all">{value}</span>
                </div>
              {/each}
            </div>
          {/if}
          <div class="overflow-hidden rounded">
            <pre
              class="m-0 p-2 font-mono text-sm leading-relaxed overflow-x-auto max-h-72 overflow-y-auto text-subtle">{typeof result ===
              'string'
                ? result
                : JSON.stringify(result, null, 2)}</pre>
          </div>
        {/if}
      </div>
    </div>
  {:else if inputEntries}
    <!-- No result, but we have input details to show -->
    <div class="flex flex-col">
      <div class="p-2 bg-muted/30">
        <div class="flex flex-col gap-1">
          {#each inputEntries as { key, value }}
            <div class="text-xs">
              <span class="text-subtle">{key}</span>
              <span class="text-subtle ml-1.5 break-all">{value}</span>
            </div>
          {/each}
        </div>
        <div class="text-xs text-subtle mt-2 italic">Completed</div>
      </div>
    </div>
  {:else}
    <!-- No result and no input details — tool completed with no output -->
    <div class="p-2 bg-muted/30">
      <span class="text-xs text-subtle italic"
        >{isError ? 'No details available' : 'Completed'}</span
      >
    </div>
  {/if}
</div>
