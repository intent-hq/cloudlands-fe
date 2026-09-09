<script lang="ts">
  /* eslint-disable max-lines */
  import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { writable } from 'svelte/store';
  import type { ParsedToolResult } from './tool-result-parser';
  import { extractPayloadText } from './tool-result-pairing';
  import Fa from 'svelte-fa';
  import {
    faCopy,
    faCheck,
    faExclamationTriangle,
    faFolder,
    faFile,
  } from '@fortawesome/free-solid-svg-icons';
  import { DiffViewer } from '$features/file-tracking/components/diff';
  import MarkdownRenderer from '$lib/components/editor/MarkdownRenderer.svelte';
  import CodeBlock from '$lib/components/editor/CodeBlock.svelte';
  import AgentCard from './AgentCard.svelte';

  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';

  import { isGenericAgentName } from '$lib/utils/agent-name-generator';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import {
    focusBrowserTabRequested,
    openAgentTabRequested,
  } from '$store/renderer/slices/app-layout/app-layout-slice';
  import {
    openWorkspaceFile,
    openWorkspaceNote,
  } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { store as appStore } from '$store/renderer/store';
  import { formatDate, formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import {
    sanitizeMultilineToolText,
    sanitizeToolPayload,
    sanitizeToolText,
  } from './tool-display-model';
  import { resolveBrowserScreenshotSource } from './browser-screenshot-source';

  interface Props {
    input: Record<string, any>;
    result?: any;
    parsedResult?: ParsedToolResult | null;
    isError?: boolean;
    /** The tool call is still running: show only the input, never a result section. */
    pending?: boolean;
    /** The tool is classified as a terminal command (gates the terminal-style pending view). */
    isTerminal?: boolean;
    workspaceId?: string;
    suppressOkOnlyResult?: boolean;
  }

  const {
    input,
    result,
    parsedResult,
    isError = false,
    pending = false,
    isTerminal = false,
    workspaceId,
    suppressOkOnlyResult = false,
  }: Props = $props();

  // This tool result is scoped by the workspaceId prop rather than ambient UI
  // state; it may render outside the route workspace. Pass the ID to AgentCard
  // so it can dispatch
  // ensureAgentSessionLoaded and resolve the delegated agent.
  // svelte-ignore state_referenced_locally - intentional initial capture; the $effect below syncs later changes
  const toolWorkspaceIdStore = writable(workspaceId ?? '');
  $effect(() => {
    toolWorkspaceIdStore.set(workspaceId ?? '');
  });
  const toolWorkspace = selectWorkspaceById(toolWorkspaceIdStore);

  let copied = $state(false);
  const sanitizedInput = $derived(sanitizeToolPayload(input) as Record<string, any>);
  const sanitizedResult = $derived(sanitizeToolPayload(result));
  const browserScreenshotSource = $derived(
    parsedResult?.type === 'browser' ? resolveBrowserScreenshotSource(parsedResult) : null,
  );

  // Disposition summary for batch delegate results ("2 started · 1 held · 1 skipped").
  // The started count always shows; held/skipped/failed only when non-zero.
  const delegateBatchSummary = $derived.by(() => {
    const batch = parsedResult?.delegateBatch;
    if (!batch) return null;
    const parts = [
      m.chat_toolDetails_delegateBatchStarted_label({ count: formatInteger(batch.started) }),
    ];
    if (batch.held > 0) {
      parts.push(m.chat_toolDetails_delegateBatchHeld_label({ count: formatInteger(batch.held) }));
    }
    if (batch.skipped > 0) {
      parts.push(
        m.chat_toolDetails_delegateBatchSkipped_label({ count: formatInteger(batch.skipped) }),
      );
    }
    if (batch.errors > 0) {
      parts.push(
        m.chat_toolDetails_delegateBatchFailed_label({ count: formatInteger(batch.errors) }),
      );
    }
    return parts.join(' · ');
  });

  // Special input keys that should be shown at the top of output (not hidden)
  // These are the "query" or "request" that provides important context
  const FEATURED_INPUT_KEYS = new Set([
    'information_request', // codebase-retrieval
    'query', // search tools
    'thought', // sequential thinking
    'memory', // remember tool
    'search_query_regex', // view tool with regex search
  ]);

  // Pick the one/many message variant and format the count
  type PluralMsg = (p: { count: string }) => string;
  function plural(count: number, one: PluralMsg, many: PluralMsg): string {
    return (count === 1 ? one : many)({ count: formatInteger(count) });
  }

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
        return sanitizeToolText(input[key]);
      }
    }
    return null;
  });

  // Format a value for display (truncates long strings to keep the expanded view clean)
  function formatValue(val: unknown): string {
    if (val == null) return '';
    if (typeof val === 'string') {
      const sanitized = sanitizeToolText(val);
      return sanitized.length > 150 ? sanitized.slice(0, 150) + '…' : sanitized;
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
    for (const [key, val] of Object.entries(sanitizedInput)) {
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

  // Full multiline command for pending terminal calls (whitespace preserved so
  // the complete command is inspectable while the result is still pending).
  // Gated on the classified terminal category: non-terminal tools that happen
  // to carry a `command` field (e.g. str-replace-editor) must fall through to
  // the JSON input view so all their fields stay inspectable.
  const pendingCommand = $derived.by(() => {
    if (!isTerminal) return null;
    if (typeof input?.command !== 'string' || !input.command.trim()) return null;
    return sanitizeMultilineToolText(input.command);
  });

  // Extract concise display text from common error payloads. Structured raw
  // data stays behind the explicit disclosure below.
  const errorText = $derived.by(() => {
    if (result == null) return null;
    const text = extractPayloadText(result);
    if (text !== null) return sanitizeToolText(text);
    if (typeof result === 'object' && typeof result.message === 'string') {
      return sanitizeToolText(result.message);
    }
    return null;
  });
</script>

{#snippet rawDetails()}
  {#if inputEntries || result != null}
    <div class="flex min-w-0 flex-col gap-2" data-tool-raw-details>
      {#if inputEntries}
        <section class="min-w-0" data-tool-detail-section="input">
          <div class="type-caption mb-1 text-muted-foreground">
            {m.chat_toolDetails_input_label()}
          </div>
          <pre
            class="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-subtle">{JSON.stringify(
              sanitizedInput,
              null,
              2,
            )}</pre>
        </section>
      {/if}
      {#if result != null}
        <section class="min-w-0" data-tool-detail-section="output">
          <div class="type-caption mb-1 text-muted-foreground">
            {m.chat_toolDetails_result_label()}
          </div>
          <pre
            class="m-0 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-subtle">{typeof sanitizedResult ===
            'string'
              ? sanitizedResult
              : JSON.stringify(sanitizedResult, null, 2)}</pre>
        </section>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet fallbackDetails()}
  <!-- The parent operational row is the only disclosure control. -->
  {@render rawDetails()}
{/snippet}

<div class="flex min-w-0 flex-col text-sm" data-tool-details-inline>
  <!-- Error display -->
  {#if isError}
    <div class="flex min-w-0 flex-col gap-2" data-tool-detail-error>
      {#if errorText}
        <div class="flex min-w-0 items-start gap-2">
          <Fa icon={faExclamationTriangle} size="xs" class="text-danger mt-0.5 shrink-0" />
          <pre
            class="m-0 min-w-0 whitespace-pre-wrap break-words font-mono text-xs text-danger">{errorText}</pre>
        </div>
      {:else}
        <div class="flex min-w-0 items-start gap-2">
          <Fa icon={faExclamationTriangle} size="xs" class="text-danger mt-0.5 shrink-0" />
          <span class="text-xs text-subtle">{m.chat_toolDetails_noErrorDetails_label()}</span>
        </div>
      {/if}
      {#if inputEntries || result != null}
        {@render rawDetails()}
      {/if}
    </div>
  {:else if pending}
    <!-- Running tool call: show the full input while the result is pending. -->
    {#if pendingCommand}
      <!-- Terminal command with whitespace preserved so multiline commands are readable -->
      <div class="overflow-hidden rounded bg-[#1a1b26]">
        <div class="flex items-start gap-2 p-2">
          <span class="text-[#7aa2f7] font-mono text-xs mt-px shrink-0">$</span>
          <pre
            class="m-0 flex-1 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words max-h-72 overflow-y-auto text-[#a9b1d6]/90">{pendingCommand}</pre>
        </div>
      </div>
    {:else}
      <div class="flex flex-col gap-2 rounded bg-muted/30 p-2">
        {#if featuredInput}
          <div class="text-subtle italic">"{featuredInput}"</div>
        {/if}
        <div>
          <div class="type-caption mb-1 text-subtle">
            {m.chat_toolDetails_input_label()}
          </div>
          <pre
            class="m-0 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-subtle">{JSON.stringify(
              sanitizedInput,
              null,
              2,
            )}</pre>
        </div>
      </div>
    {/if}
  {:else if suppressOkOnlyResult}
    <!-- Successful ok-only mutations intentionally have no expanded body. -->
  {:else if result || parsedResult}
    <!-- Output Section (no Input section - hidden for cleaner display) -->
    <div class="flex flex-col">
      <div class="relative min-w-0 group/details">
        <!-- Featured input (query/request) shown at top with border below -->
        {#if featuredInput}
          <div class="pb-2 mb-2 border-b border-border text-subtle italic">
            "{featuredInput}"
          </div>
        {/if}

        <!-- Copy remains available without adding a second disclosure control. -->
        <div
          class="absolute top-0 right-0 z-10 flex items-center opacity-0 transition-opacity group-hover/details:opacity-100 focus-within:opacity-100"
        >
          <!-- Copy button - Skip for file-view since CodeBlock has its own copy button -->
          {#if (parsedResult?.content || parsedResult?.newContent) && parsedResult?.type !== 'file-view'}
            <button
              class="cursor-pointer border-0 bg-transparent p-1 text-muted-foreground transition-colors hover:text-foreground"
              onclick={() =>
                copyToClipboard(
                  input.content || parsedResult?.newContent || parsedResult?.content || '',
                )}
              title={m.chat_toolDetails_copyContent_title()}
            >
              <Fa icon={copied ? faCheck : faCopy} size="xs" />
            </button>
          {/if}
        </div>

        {#if parsedResult && parsedResult.type !== 'unknown'}
          {#if (parsedResult.type === 'file-edit' || parsedResult.type === 'note-edit') && parsedResult.oldContent && parsedResult.newContent}
            <!-- Diff view using DiffViewer component -->
            <DiffViewer
              oldContent={parsedResult.oldContent}
              newContent={parsedResult.newContent}
              fileName={parsedResult.fileName || m.chat_toolClassifier_file_subject()}
              viewMode="unified"
              showHeader
              showStats
              maxHeight="250px"
            />
          {:else if parsedResult.type === 'note-edit' && (parsedResult.newContent || parsedResult.content)}
            <!-- Note edit without diff - render markdown -->
            <div
              class="overflow-hidden rounded border border-border bg-muted/20 max-h-72 overflow-y-auto"
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
                    if (!workspaceId || !parsedResult?.filePath) return;
                    appStore.dispatch(
                      openWorkspaceFile(workspaceId, parsedResult.filePath, {
                        line,
                        openInAdjacentPanel,
                        sourcePanelId,
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
                  if (!workspaceId || !parsedResult?.filePath) return;
                  appStore.dispatch(
                    openWorkspaceFile(workspaceId, parsedResult.filePath, {
                      openInAdjacentPanel,
                      sourcePanelId,
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
                  class="group/snippet rounded-md overflow-hidden border border-border hover:border-border transition-colors"
                >
                  <!-- File header with icon-like styling -->
                  <div
                    class="flex items-center gap-1.5 px-2 py-1 bg-muted/50 border-b border-border"
                  >
                    <span class="font-mono text-xs font-medium text-muted-foreground"
                      >{fileName}</span
                    >
                    {#if snippet.lineStart}
                      <span class="text-xs text-subtle">:{snippet.lineStart}</span>
                    {/if}
                    {#if dirPath}
                      <span class="text-xs text-subtle truncate ml-auto" title={snippet.path}
                        >{dirPath}</span
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
                <div class="text-center text-xs text-subtle py-1 border-t border-border mt-1">
                  {plural(
                    parsedResult.snippets.length - 8,
                    m.chat_toolDetails_moreResults_one,
                    m.chat_toolDetails_moreResults_many,
                  )}
                </div>
              {/if}
              {#if parsedResult.content}
                <!-- Tool-reported truncation note (e.g. rtk "+N more in <file>") -->
                <div class="text-xs text-subtle py-1 whitespace-pre-wrap">
                  {parsedResult.content}
                </div>
              {/if}
            </div>
          {:else if parsedResult.type === 'code-search'}
            <!-- No parsed snippets - only claim "No results" when the search was
                 genuinely empty; unparsed fallback content still holds real matches -->
            {#if parsedResult.noMatches || !parsedResult.content}
              <div class="text-center py-2 text-subtle text-sm">
                {m.chat_toolDetails_noResults_label()}
              </div>
            {/if}
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
                  <span class="font-mono text-xs text-[#a9b1d6]/90 truncate flex-1"
                    >{parsedResult.command}</span
                  >
                  {#if parsedResult.exitCode !== undefined}
                    <span
                      class="text-ui font-mono px-1.5 py-0.5 rounded {parsedResult.exitCode === 0
                        ? 'bg-[#9ece6a]/20 text-[#9ece6a]'
                        : 'bg-[#f7768e]/20 text-[#f7768e]'}"
                    >
                      {m.chat_toolDetails_exitCode_label({
                        code: formatInteger(parsedResult.exitCode),
                      })}
                    </span>
                  {/if}
                </div>
              {/if}
              {#if parsedResult.content}
                <pre
                  class="m-0 p-2 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words max-h-72 overflow-y-auto text-[#a9b1d6]">{parsedResult.content}</pre>
              {:else}
                <pre
                  class="m-0 p-2 font-mono text-sm leading-relaxed text-[#a9b1d6]/50">{m.chat_toolDetails_noOutput_label()}</pre>
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
                    if (!workspaceId || !parsedResult?.filePath) return;
                    appStore.dispatch(
                      openWorkspaceFile(workspaceId, parsedResult.filePath, {
                        line,
                        openInAdjacentPanel,
                        sourcePanelId,
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
              class="overflow-hidden rounded border border-border bg-muted/20 max-h-72 overflow-y-auto"
            >
              <div class="p-3">
                <MarkdownRenderer content={parsedResult.content} className="text-sm" />
              </div>
            </div>
          {:else if parsedResult.type === 'delegate-task'}
            <!-- Delegate task - show task name and agent card(s) -->
            <div class="flex flex-col gap-2">
              {#if parsedResult.delegateBatch && delegateBatchSummary}
                <!-- Batch delegate: disposition summary + cards for started agents -->
                <div class="text-sm text-subtle">{delegateBatchSummary}</div>
                {#each parsedResult.delegateBatch.startedRows as row (row.agentId)}
                  <AgentCard
                    agentId={row.agentId}
                    agentName={row.agentName}
                    workspace={$toolWorkspace ?? null}
                  />
                {/each}
              {:else}
                {#if parsedResult.delegatedTaskName}
                  <div class="text-sm text-subtle">
                    {m.chat_toolDetails_task_label()}
                    <span class="text-foreground font-medium">{parsedResult.delegatedTaskName}</span
                    >
                  </div>
                {/if}
                {#if parsedResult.agentId}
                  <AgentCard
                    agentId={parsedResult.agentId}
                    agentName={parsedResult.delegatedAgentName}
                    provider={parsedResult.delegatedAgentProvider}
                    workspace={$toolWorkspace ?? null}
                  />
                {:else}
                  <div class="text-xs text-subtle italic">
                    {m.chat_toolDetails_agentSpawned_label()}
                  </div>
                {/if}
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
                    if (!workspaceId) return;
                    appStore.dispatch(
                      openAgentTabRequested(workspaceId, {
                        agentId: agent.agentId,
                        openInAdjacentPanel: e.metaKey || e.ctrlKey,
                      }),
                    );
                  }}
                >
                  <AgentAvatar agentId={agent.agentId} size={18} class="shrink-0" />
                  <span class="text-sm font-medium text-foreground truncate flex-1"
                    >{agent.name}</span
                  >
                  {#if agent.status}
                    <span class="text-xs px-1.5 py-0.5 rounded bg-muted {statusColor}"
                      >{agent.status}</span
                    >
                  {/if}
                </button>
              {/each}
              <div class="text-xs text-subtle pt-1 border-t border-border mt-1">
                {plural(
                  parsedResult.agents.length,
                  m.chat_toolDetails_agentCount_one,
                  m.chat_toolDetails_agentCount_many,
                )}
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
                  <span class={isDirectory ? 'text-foreground' : 'text-subtle'}>
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
                  <span class="font-medium text-foreground">{parsedResult.taskTitle}</span>
                  {#if parsedResult.taskStatus}
                    <span class="px-1.5 py-0.5 text-xs rounded bg-muted text-subtle"
                      >{parsedResult.taskStatus}</span
                    >
                  {/if}
                </div>
              {/if}
              {#if parsedResult.taskContent}
                <div
                  class="overflow-hidden rounded border border-border bg-muted/20 p-3 max-h-48 overflow-y-auto"
                >
                  <MarkdownRenderer content={parsedResult.taskContent} className="text-sm" />
                </div>
              {/if}
            </div>
          {:else if parsedResult.type === 'task-update'}
            <!-- Task update - show task name and status -->
            <div class="flex flex-wrap items-center gap-1.5 p-2 text-sm text-muted-foreground">
              {#if parsedResult.taskTitle && parsedResult.taskStatus}
                <span>{m.chat_toolDetails_marked_before()}</span>
                <span class="font-medium text-foreground">{parsedResult.taskTitle}</span>
                <span>{m.chat_toolDetails_marked_middle()}</span>
                <span class="px-1.5 py-0.5 text-xs rounded bg-primary/10 text-primary font-medium">
                  {parsedResult.taskStatus}
                </span>
              {:else if parsedResult.taskStatus}
                <span>{m.chat_toolDetails_markedTaskAs_label()}</span>
                <span class="px-1.5 py-0.5 text-xs rounded bg-primary/10 text-primary font-medium">
                  {parsedResult.taskStatus}
                </span>
              {:else if parsedResult.taskTitle}
                <span>{m.chat_toolDetails_updated_label()}</span>
                <span class="font-medium text-foreground">{parsedResult.taskTitle}</span>
              {:else}
                <span class="text-subtle">{m.chat_toolDetails_taskUpdated_label()}</span>
              {/if}
            </div>
          {:else if parsedResult.type === 'agent-report'}
            <!-- Agent report - show the report message in sans-serif -->
            <div class="p-3 text-sm text-foreground max-h-48 overflow-y-auto">
              {#if parsedResult.reportMessage}
                <p class="m-0 leading-relaxed">{parsedResult.reportMessage}</p>
              {:else}
                <span class="text-subtle">{m.chat_toolDetails_reportSent_label()}</span>
              {/if}
            </div>
          {:else if parsedResult.type === 'agent-message' && parsedResult.messageContent}
            <!-- Agent message - show "Sent message to [agent]" with clickable link, then the message -->
            {@const agentId = parsedResult.toAgentId}
            {@const toolState = appStore.state}
            {@const toolWsId = workspaceId}
            {@const session =
              agentId && toolWsId ? selectAgentSession.select(toolState, agentId) : null}
            {@const agentName =
              session?.name && !isGenericAgentName(session.name)
                ? session.name
                : agentId
                  ? m.chat_agentsList_agentShortId_fallback({ id: agentId.substring(0, 8) })
                  : m.chat_toolDetails_agent_fallback()}
            <div class="flex flex-col gap-1">
              <!-- Sent message to [agent] line -->
              <div class="flex items-center gap-1.5">
                <span class="text-subtle">{m.chat_toolDetails_sentMessageTo_before()}</span>
                {#if agentId}
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 text-foreground font-medium hover:text-foreground cursor-pointer bg-transparent border-0 p-0"
                    onclick={(e) => {
                      if (!workspaceId) return;
                      appStore.dispatch(
                        openAgentTabRequested(workspaceId, {
                          agentId,
                          openInAdjacentPanel: e.metaKey || e.ctrlKey,
                        }),
                      );
                    }}
                  >
                    <AgentAvatar {agentId} size={14} class="shrink-0" />
                    <span>{agentName}</span>
                  </button>
                {:else}
                  <span class="text-foreground font-medium"
                    >{m.chat_toolDetails_agent_fallback()}</span
                  >
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
                  {m.chat_toolDetails_highPriority_label()}
                </span>
              {/if}
            </div>
          {:else if parsedResult.type === 'comment-add'}
            <!-- Comment add result - show success message -->
            <div class="flex flex-wrap items-center gap-1.5 p-2 text-sm text-muted-foreground">
              {#if parsedResult.commentMessage}
                <span>{parsedResult.commentMessage}</span>
              {:else if parsedResult.commentAnchorText}
                <span>{m.chat_toolDetails_commentAddedOn_label()}</span>
                <span class="font-medium text-foreground">"{parsedResult.commentAnchorText}"</span>
              {:else}
                <span class="text-subtle">{m.chat_toolDetails_commentAdded_label()}</span>
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
                      {plural(
                        thread.commentCount,
                        m.chat_toolDetails_commentCount_one,
                        m.chat_toolDetails_commentCount_many,
                      )}
                    </span>
                    <span class="text-sm text-subtle truncate flex-1">
                      {#if thread.targetedText}
                        {m.chat_toolDetails_onAnchor_label({ anchorText: thread.targetedText })}
                      {:else}
                        {m.chat_toolDetails_noAnchor_label()}
                      {/if}
                    </span>
                    <span class="text-xs px-1.5 py-0.5 rounded bg-muted text-subtle shrink-0">
                      {thread.status}
                    </span>
                  </div>
                {/each}
                {#if parsedResult.totalComments}
                  {@const commentsPart = plural(
                    parsedResult.totalComments,
                    m.chat_toolDetails_totalComments_one,
                    m.chat_toolDetails_totalComments_many,
                  )}
                  <div class="text-xs text-subtle pt-1 border-t border-border mt-1">
                    {parsedResult.commentThreads.length === 1
                      ? m.chat_toolDetails_inThreads_one({
                          comments: commentsPart,
                          count: formatInteger(parsedResult.commentThreads.length),
                        })
                      : m.chat_toolDetails_inThreads_many({
                          comments: commentsPart,
                          count: formatInteger(parsedResult.commentThreads.length),
                        })}
                  </div>
                {/if}
              {:else}
                <span class="text-sm text-subtle p-2">{m.chat_toolDetails_noComments_label()}</span>
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
                      if (!workspaceId) return;
                      appStore.dispatch(
                        openWorkspaceNote(workspaceId, note.id, {
                          openInAdjacentPanel,
                          sourcePanelId,
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
                          <span class="text-xs text-subtle">+{note.tags.length - 2}</span>
                        {/if}
                      </div>
                    {/if}
                  </button>
                {/each}
                <div class="text-xs text-subtle pt-1 border-t border-border mt-1">
                  {plural(
                    parsedResult.notes.length,
                    m.chat_toolDetails_noteCount_one,
                    m.chat_toolDetails_noteCount_many,
                  )}
                </div>
              {:else}
                <span class="text-sm text-subtle p-2">{m.chat_toolDetails_noNotes_label()}</span>
              {/if}
            </div>
          {:else if parsedResult.type === 'figma' && (parsedResult.figmaScreenshot || parsedResult.figmaCode || parsedResult.figmaAssets?.length || parsedResult.content)}
            <!-- Figma tool results - screenshot + code -->
            <div class="flex flex-col gap-2">
              {#if parsedResult.figmaScreenshot}
                <!-- Inline Figma screenshot -->
                <div class="overflow-hidden rounded border border-border">
                  <img
                    src={`data:${parsedResult.figmaScreenshotMimeType || 'image/png'};base64,${parsedResult.figmaScreenshot}`}
                    alt={m.chat_toolDetails_figmaScreenshot_alt()}
                    class="w-full h-auto max-h-96 object-contain bg-white"
                    style="max-width: 600px"
                  />
                </div>
              {/if}
              {#if parsedResult.figmaCode}
                <!-- Code snippet from design context -->
                <CodeBlock
                  code={parsedResult.figmaCode}
                  language="typescript"
                  showLineNumbers={false}
                  maxHeight={200}
                  noBorder
                  noMargin
                />
              {/if}
              {#if parsedResult.figmaAssets && parsedResult.figmaAssets.length > 0}
                <!-- Asset download URLs -->
                <div class="flex flex-col gap-0.5 text-xs">
                  <span class="text-subtle font-medium">{m.chat_toolDetails_assets_label()}</span>
                  {#each parsedResult.figmaAssets as asset}
                    <a
                      href={asset.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-primary hover:underline truncate"
                    >
                      {asset.name}
                    </a>
                  {/each}
                </div>
              {/if}
              {#if parsedResult.content && !parsedResult.figmaScreenshot && !parsedResult.figmaCode}
                <!-- Fallback: show raw content when no screenshot or code -->
                <div class="overflow-hidden rounded">
                  <pre
                    class="m-0 p-2 font-mono text-sm leading-relaxed overflow-x-auto max-h-72 overflow-y-auto text-muted-foreground whitespace-pre-wrap">{parsedResult.content}</pre>
                </div>
              {/if}
            </div>
          {:else if parsedResult.type === 'browser' && (parsedResult.screenshotBase64 || parsedResult.screenshotUrl || parsedResult.browserTabs?.length || parsedResult.evaluateResult !== undefined || evaluateExpressions || parsedResult.accessibilityTree || parsedResult.error || parsedResult.content)}
            <!-- Browser tool results -->
            <div class="flex flex-col gap-2">
              {#if browserScreenshotSource}
                <!-- Inline screenshot -->
                <div class="overflow-hidden rounded border border-border">
                  <img
                    src={browserScreenshotSource}
                    alt={m.chat_toolDetails_browserScreenshot_alt()}
                    class="w-full h-auto max-h-96 object-contain bg-white"
                    style={parsedResult.screenshotWidth
                      ? `max-width: ${Math.min(parsedResult.screenshotWidth, 600)}px`
                      : ''}
                  />
                  {#if parsedResult.screenshotWidth && parsedResult.screenshotHeight}
                    <div class="px-2 py-1 text-ui text-subtle border-t border-border">
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
                        if (tab.tabId && workspaceId) {
                          appStore.dispatch(focusBrowserTabRequested(workspaceId, tab.tabId));
                        }
                      }}
                      title={m.chat_toolDetails_focusTab_title()}
                    >
                      <span
                        class="w-2 h-2 rounded-full shrink-0 {tab.mounted
                          ? 'bg-green-500/70'
                          : 'bg-muted-foreground/30'}"
                      ></span>
                      <span class="text-foreground truncate flex-1" title={tab.url}>
                        {tab.title || tab.url || tab.tabId}
                      </span>
                      {#if tab.url}
                        <span class="text-xs text-subtle truncate max-w-[200px]" title={tab.url}>
                          {tab.url}
                        </span>
                      {/if}
                    </button>
                  {/each}
                  <div class="text-xs text-subtle pt-1 border-t border-border mt-1">
                    {plural(
                      parsedResult.browserTabs.length,
                      m.chat_toolDetails_tabCount_one,
                      m.chat_toolDetails_tabCount_many,
                    )}
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
                          <pre
                            class="m-0 font-mono text-xs text-[#a9b1d6]/90 whitespace-pre-wrap break-all">{expr}</pre>
                        </div>
                      {/each}
                    </div>
                  {/if}
                  {#if parsedResult.evaluateResult !== undefined}
                    <pre
                      class="m-0 p-2 font-mono text-sm leading-relaxed overflow-x-auto max-h-48 overflow-y-auto text-[#a9b1d6]">{parsedResult.evaluateResult}</pre>
                  {/if}
                </div>
              {/if}
              {#if parsedResult.accessibilityTree}
                <!-- Accessibility tree -->
                <div class="overflow-hidden rounded bg-[#1a1b26]">
                  <div class="flex items-center gap-2 px-2 pt-2 pb-1 border-b border-[#a9b1d6]/10">
                    <span class="text-xs font-medium text-[#a9b1d6]/70"
                      >{m.chat_toolDetails_accessibilityTree_label()}</span
                    >
                  </div>
                  <pre
                    class="m-0 p-2 font-mono text-xs leading-relaxed overflow-x-auto max-h-64 overflow-y-auto text-[#a9b1d6]/80">{parsedResult.accessibilityTree}</pre>
                </div>
              {/if}
              {#if parsedResult.error}
                <!-- Error -->
                <div class="flex items-start gap-2 p-2">
                  <Fa icon={faExclamationTriangle} size="xs" class="text-danger mt-0.5 shrink-0" />
                  <pre
                    class="m-0 whitespace-pre-wrap font-mono text-xs text-danger">{parsedResult.error}</pre>
                </div>
              {/if}
              {#if parsedResult.content && !parsedResult.screenshotBase64 && !parsedResult.screenshotUrl && !parsedResult.browserTabs?.length && !parsedResult.evaluateResult && !parsedResult.accessibilityTree && !parsedResult.error}
                <!-- Fallback content for other browser actions -->
                <div class="overflow-hidden rounded">
                  <pre
                    class="m-0 p-2 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words max-h-48 overflow-y-auto text-muted-foreground">{parsedResult.content}</pre>
                </div>
              {/if}
            </div>
          {:else if parsedResult.type === 'sentry-issue' && parsedResult.sentryIssue}
            <!-- Sentry issue detail card -->
            {@const issue = parsedResult.sentryIssue}
            {@const levelColor =
              issue.level === 'fatal'
                ? 'bg-red-600 text-white'
                : issue.level === 'error'
                  ? 'bg-red-500/20 text-red-600 dark:text-red-400'
                  : issue.level === 'warning'
                    ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                    : issue.level === 'info'
                      ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400'
                      : 'bg-muted text-subtle'}
            {@const statusColor =
              issue.status === 'resolved'
                ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                : issue.status === 'ignored'
                  ? 'bg-muted text-subtle'
                  : 'bg-orange-500/20 text-orange-600 dark:text-orange-400'}
            <div class="rounded-md border border-border overflow-hidden">
              <!-- Header with title and badges -->
              <div class="px-3 py-2.5 flex flex-col gap-1.5">
                <div class="flex items-start gap-2">
                  <div class="flex-1 min-w-0">
                    {#if issue.shortId}
                      <span class="text-xs text-subtle font-mono mr-1.5">{issue.shortId}</span>
                    {/if}
                    <span class="text-sm font-medium text-foreground">{issue.title}</span>
                  </div>
                </div>
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="px-1.5 py-0.5 text-ui font-medium rounded {statusColor}"
                    >{issue.status}</span
                  >
                  <span class="px-1.5 py-0.5 text-ui font-medium rounded {levelColor}"
                    >{issue.level}</span
                  >
                  {#if issue.project}
                    <span class="text-ui text-subtle">{issue.project}</span>
                  {/if}
                </div>
              </div>
              <!-- Stats row -->
              <div
                class="px-3 py-2 border-t border-border bg-muted/20 flex items-center gap-4 text-xs"
              >
                <div class="flex items-center gap-1">
                  <span class="text-subtle">{m.chat_toolDetails_events_label()}</span>
                  <span class="font-medium text-foreground">{formatInteger(issue.count)}</span>
                </div>
                <div class="flex items-center gap-1">
                  <span class="text-subtle">{m.chat_toolDetails_users_label()}</span>
                  <span class="font-medium text-foreground">{formatInteger(issue.userCount)}</span>
                </div>
                {#if issue.lastSeen}
                  <div class="flex items-center gap-1 ml-auto">
                    <span class="text-subtle">{m.chat_toolDetails_lastSeen_label()}</span>
                    <span class="text-muted-foreground">{formatDate(issue.lastSeen)}</span>
                  </div>
                {/if}
              </div>
              <!-- Stacktrace summary (if available) -->
              {#if issue.stacktraceSummary}
                <div class="px-3 py-2 border-t border-border bg-muted/10">
                  <pre
                    class="m-0 font-mono text-ui leading-relaxed text-subtle overflow-x-auto">{issue.stacktraceSummary}</pre>
                </div>
              {/if}
              <!-- Link to Sentry -->
              {#if issue.url}
                <div class="px-3 py-1.5 border-t border-border bg-muted/10">
                  <a
                    href={issue.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-ui text-primary hover:underline"
                  >
                    {m.chat_toolDetails_viewInSentry_label()}
                  </a>
                </div>
              {/if}
            </div>
          {:else if parsedResult.type === 'sentry-search' && parsedResult.sentryIssues?.length}
            <!-- Sentry search results - compact issue list -->
            <div class="flex flex-col gap-1 max-h-80 overflow-y-auto">
              {#each parsedResult.sentryIssues as issue}
                {@const levelDot =
                  issue.level === 'fatal'
                    ? 'bg-red-600'
                    : issue.level === 'error'
                      ? 'bg-red-500'
                      : issue.level === 'warning'
                        ? 'bg-amber-500'
                        : issue.level === 'info'
                          ? 'bg-blue-500'
                          : 'bg-muted-foreground'}
                {@const statusText =
                  issue.status === 'resolved'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : issue.status === 'ignored'
                      ? 'text-subtle'
                      : 'text-orange-600 dark:text-orange-400'}
                <div
                  class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/30 transition-colors"
                >
                  <span class="w-2 h-2 rounded-full shrink-0 {levelDot}"></span>
                  <div class="flex-1 min-w-0 flex items-center gap-1.5">
                    {#if issue.shortId}
                      <span class="text-ui text-subtle font-mono shrink-0">{issue.shortId}</span>
                    {/if}
                    {#if issue.url}
                      <a
                        href={issue.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-sm text-foreground truncate hover:underline">{issue.title}</a
                      >
                    {:else}
                      <span class="text-sm text-foreground truncate">{issue.title}</span>
                    {/if}
                  </div>
                  <span class="text-ui {statusText} shrink-0">{issue.status}</span>
                  {#if issue.count > 0}
                    <span class="text-ui text-subtle shrink-0">{formatInteger(issue.count)}</span>
                  {/if}
                </div>
              {/each}
              <div class="text-xs text-subtle pt-1 border-t border-border mt-1">
                {plural(
                  parsedResult.sentryIssues.length,
                  m.chat_toolDetails_issueCount_one,
                  m.chat_toolDetails_issueCount_many,
                )}
              </div>
            </div>
          {:else if parsedResult.type === 'github-issues' && parsedResult.githubIssues?.length}
            <!-- GitHub Issues/PRs list -->
            <div class="flex flex-col gap-1 max-h-72 overflow-y-auto">
              {#each parsedResult.githubIssues as issue}
                {@const stateColor =
                  issue.state === 'open'
                    ? 'text-green-600 dark:text-green-400'
                    : issue.state === 'closed'
                      ? 'text-purple-600 dark:text-purple-400'
                      : 'text-subtle'}
                {@const stateIcon =
                  issue.state === 'open' ? '●' : issue.state === 'closed' ? '✓' : '○'}
                <div
                  class="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-muted/30 transition-colors"
                >
                  <span class="shrink-0 text-xs mt-0.5 {stateColor}" title={issue.state}
                    >{stateIcon}</span
                  >
                  <div class="flex flex-col gap-0.5 min-w-0 flex-1">
                    <div class="flex items-center gap-1.5 flex-wrap">
                      <span class="text-subtle text-xs font-mono shrink-0">#{issue.number}</span>
                      {#if issue.url}
                        <a
                          href={issue.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="text-sm text-foreground hover:underline truncate">{issue.title}</a
                        >
                      {:else}
                        <span class="text-sm text-foreground truncate">{issue.title}</span>
                      {/if}
                      {#if issue.isPR}
                        <span
                          class="text-ui px-1 py-0.5 rounded bg-blue-500/15 text-blue-600 dark:text-blue-400 shrink-0"
                          >{m.chat_toolDetails_pr_badge()}</span
                        >
                      {/if}
                    </div>
                    {#if issue.labels && issue.labels.length > 0}
                      <div class="flex gap-1 flex-wrap">
                        {#each issue.labels as label}
                          <span
                            class="text-ui px-1.5 py-0.5 rounded-full font-medium"
                            style={label.color
                              ? `background-color: #${label.color}20; color: #${label.color}; border: 1px solid #${label.color}40`
                              : ''}
                            class:bg-muted={!label.color}
                            class:text-subtle={!label.color}>{label.name}</span
                          >
                        {/each}
                      </div>
                    {/if}
                  </div>
                </div>
              {/each}
              <div class="text-xs text-subtle pt-1 border-t border-border mt-1">
                {plural(
                  parsedResult.githubIssues.length,
                  m.chat_toolDetails_resultCount_one,
                  m.chat_toolDetails_resultCount_many,
                )}
              </div>
            </div>
          {:else if parsedResult.type === 'github-pr-files' && parsedResult.githubFiles?.length}
            <!-- GitHub PR Changed Files -->
            <div class="flex flex-col gap-0.5 max-h-72 overflow-y-auto">
              {#each parsedResult.githubFiles as file}
                {@const statusIcon =
                  file.status === 'added'
                    ? '+'
                    : file.status === 'removed'
                      ? '−'
                      : file.status === 'renamed'
                        ? '→'
                        : '~'}
                {@const statusColor =
                  file.status === 'added'
                    ? 'text-green-600 dark:text-green-400'
                    : file.status === 'removed'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-amber-600 dark:text-amber-400'}
                <div
                  class="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/30 transition-colors"
                >
                  <span class="shrink-0 text-xs font-mono w-3 text-center {statusColor}"
                    >{statusIcon}</span
                  >
                  <span class="text-sm text-foreground truncate flex-1 font-mono"
                    >{file.filename}</span
                  >
                  <div class="flex items-center gap-1.5 shrink-0 text-xs font-mono">
                    {#if file.additions > 0}
                      <span class="text-green-600 dark:text-green-400">+{file.additions}</span>
                    {/if}
                    {#if file.deletions > 0}
                      <span class="text-red-600 dark:text-red-400">−{file.deletions}</span>
                    {/if}
                  </div>
                </div>
              {/each}
              {#if parsedResult.githubFiles.length}
                {@const totalAdditions = parsedResult.githubFiles.reduce(
                  (s, f) => s + f.additions,
                  0,
                )}
                {@const totalDeletions = parsedResult.githubFiles.reduce(
                  (s, f) => s + f.deletions,
                  0,
                )}
                <div class="text-xs text-subtle pt-1 border-t border-border mt-1 flex gap-2">
                  <span
                    >{plural(
                      parsedResult.githubFiles.length,
                      m.chat_toolDetails_filesChanged_one,
                      m.chat_toolDetails_filesChanged_many,
                    )}</span
                  >
                  {#if totalAdditions > 0}
                    <span class="text-green-600 dark:text-green-400">+{totalAdditions}</span>
                  {/if}
                  {#if totalDeletions > 0}
                    <span class="text-red-600 dark:text-red-400">−{totalDeletions}</span>
                  {/if}
                </div>
              {/if}
            </div>
          {:else if parsedResult.type === 'github-checks' && parsedResult.githubChecks?.length}
            <!-- GitHub CI Check Runs -->
            <div class="flex flex-col gap-0.5 max-h-72 overflow-y-auto">
              {#if parsedResult.githubOverallStatus}
                {@const overallColor =
                  parsedResult.githubOverallStatus === 'success'
                    ? 'text-green-600 dark:text-green-400'
                    : parsedResult.githubOverallStatus === 'failure' ||
                        parsedResult.githubOverallStatus === 'error'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-amber-600 dark:text-amber-400'}
                <div class="flex items-center gap-2 px-2 py-1.5 mb-1 border-b border-border">
                  <span class="text-sm font-medium {overallColor}"
                    >{m.chat_toolDetails_overall_label({
                      status: parsedResult.githubOverallStatus,
                    })}</span
                  >
                </div>
              {/if}
              {#each parsedResult.githubChecks as check}
                {@const conclusion = check.conclusion || check.status}
                {@const checkIcon =
                  conclusion === 'success'
                    ? '✓'
                    : conclusion === 'failure' ||
                        conclusion === 'error' ||
                        conclusion === 'timed_out'
                      ? '✗'
                      : conclusion === 'in_progress' ||
                          conclusion === 'queued' ||
                          conclusion === 'pending'
                        ? '⏳'
                        : conclusion === 'skipped' || conclusion === 'neutral'
                          ? '–'
                          : '○'}
                {@const checkColor =
                  conclusion === 'success'
                    ? 'text-green-600 dark:text-green-400'
                    : conclusion === 'failure' ||
                        conclusion === 'error' ||
                        conclusion === 'timed_out'
                      ? 'text-red-600 dark:text-red-400'
                      : conclusion === 'in_progress' ||
                          conclusion === 'queued' ||
                          conclusion === 'pending'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-subtle'}
                <div
                  class="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/30 transition-colors"
                >
                  <span class="shrink-0 text-sm {checkColor}">{checkIcon}</span>
                  <span class="text-sm text-foreground truncate flex-1">{check.name}</span>
                  {#if check.conclusion && check.conclusion !== check.status}
                    <span class="text-xs text-subtle shrink-0">{check.conclusion}</span>
                  {/if}
                </div>
              {/each}
              {#if parsedResult.githubChecks.length}
                {@const passed = parsedResult.githubChecks.filter(
                  (c) => (c.conclusion || c.status) === 'success',
                ).length}
                {@const failed = parsedResult.githubChecks.filter((c) =>
                  ['failure', 'error', 'timed_out'].includes(c.conclusion || c.status),
                ).length}
                <div class="text-xs text-subtle pt-1 border-t border-border mt-1 flex gap-2">
                  <span
                    >{plural(
                      parsedResult.githubChecks.length,
                      m.chat_toolDetails_checkCount_one,
                      m.chat_toolDetails_checkCount_many,
                    )}</span
                  >
                  {#if passed > 0}
                    <span class="text-green-600 dark:text-green-400"
                      >{m.chat_toolDetails_checksPassed_label({
                        count: formatInteger(passed),
                      })}</span
                    >
                  {/if}
                  {#if failed > 0}
                    <span class="text-red-600 dark:text-red-400"
                      >{m.chat_toolDetails_checksFailed_label({
                        count: formatInteger(failed),
                      })}</span
                    >
                  {/if}
                </div>
              {/if}
            </div>
          {:else if parsedResult.type === 'confirmation' && parsedResult.content}
            <!-- Confirmation/info result - clean text display -->
            <div class="overflow-hidden rounded">
              <pre
                class="m-0 p-2 text-sm leading-relaxed max-h-72 overflow-y-auto text-muted-foreground whitespace-pre-wrap break-words">{parsedResult.content}</pre>
            </div>
          {:else if parsedResult.content}
            <!-- Plain text preview (no syntax highlighting for cleaner light/dark mode support) -->
            <div class="overflow-hidden rounded">
              <pre
                class="m-0 p-2 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words max-h-72 overflow-y-auto text-muted-foreground">{parsedResult.content}</pre>
            </div>
          {:else}
            <!-- Rich-typed result with nothing renderable — never leave the container empty -->
            {@render fallbackDetails()}
          {/if}
        {:else if result}
          {@render fallbackDetails()}
        {/if}
      </div>
    </div>
  {:else if inputEntries}
    {@render rawDetails()}
  {:else}
    <!-- No meaningful output: the collapsed row is the complete presentation. -->
  {/if}
</div>
