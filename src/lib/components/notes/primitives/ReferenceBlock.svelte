<script lang="ts">
  import { NodeViewWrapper } from 'svelte-tiptap';
  import { writable } from 'svelte/store';
  import type { NodeViewProps } from '@tiptap/core';
  import type { ReferencePrimitive } from '$shared/types/notes-primitives';
  import { Button } from '$lib/components/ui/button';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import CodeBlock from '$lib/components/editor/CodeBlock.svelte';
  import Fa from 'svelte-fa';
  import { faCode, faArrowRight } from '@fortawesome/free-solid-svg-icons';
  import { slide } from 'svelte/transition';
  import { invoke } from '$lib/electron-bridge';
  import { parseSemanticId, getSemanticId } from '$shared/types/notes-primitives';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import { createLogger } from '$lib/utils/client-logger';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { onMount } from 'svelte';

  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { openWorkspaceFile } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { store as appStore } from '$store/renderer/store';
  import { getNavigationContext } from '$lib/components/layout/panel-system/panel-context';
  import { m } from '$shared/paraglide/messages.js';
  import { resolveReferenceSnapshot } from './utils/reference-snapshot';

  const logger = createLogger('ReferenceBlock');

  type ShortFormReferencePrimitive = ReferencePrimitive & {
    semanticId?: string;
    filePath?: string;
  };

  // TipTap NodeViewProps
  let { node, extension }: NodeViewProps = $props();

  // Get primitive data from node
  let primitive = $derived(node?.attrs?.data as ShortFormReferencePrimitive);

  // Component state
  let expanded = $state(false);
  let loading = $state(true); // Start loading immediately
  let editorContent = $state<string>('');
  let resolvedCode = $state<string | null>(null);
  let resolvedLanguage = $state<string>('typescript');
  let resolvedFilePath = $state<string | null>(null);
  let resolvedRange = $state<{ startLine: number; endLine: number } | null>(null);
  let error = $state<string | null>(null);
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;

  // Get semantic ID (provided or derived from filePath + range)
  let semanticId = $derived(
    primitive
      ? getSemanticId(primitive.target) || primitive.semanticId || primitive.filePath || null
      : null,
  );
  // Parse semantic ID
  let parsedId = $derived(semanticId ? parseSemanticId(semanticId) : null);
  // Get type from new format or legacy format
  let parsedType = $derived(parsedId?.type || parsedId?.refSpec?.type);
  // Get symbol value from new format or legacy format
  let parsedSymbol = $derived(parsedId?.symbol || parsedId?.refSpec?.value);
  let displayName = $derived(
    primitive?.label ||
      (parsedType === 'symbol' ? parsedSymbol : parsedId?.filePath?.split('/').pop()),
  );

  // Get workspaceId from extension options
  let workspaceId = $derived(extension?.options?.workspaceId as string | undefined);
  // svelte-ignore state_referenced_locally - intentional initial capture; the $effect below syncs later changes
  const workspaceIdStore = writable(workspaceId ?? '');
  $effect(() => {
    workspaceIdStore.set(workspaceId ?? '');
  });
  const workspaceById = selectWorkspaceById(workspaceIdStore);

  // Get workspace and its repo path for file operations
  let workspace = $derived(workspaceId ? $workspaceById : undefined);
  let workspaceRepoPath = $derived(workspace?.worktreePath || workspace?.repositoryPath || null);

  // Get line range from primitive or parsed ID
  let lineRange = $derived(
    primitive?.target?.range ||
      (parsedId?.startLine
        ? { startLine: parsedId.startLine, endLine: parsedId.endLine || parsedId.startLine }
        : null),
  );

  // Format line range for display (e.g., "L22" or "L22-25")
  let lineRangeDisplay = $derived(() => {
    if (!lineRange) return null;
    if (lineRange.startLine === lineRange.endLine) {
      return `L${lineRange.startLine}`;
    }
    return `L${lineRange.startLine}-${lineRange.endLine}`;
  });

  // Populate code content from the stored snapshot. Live resolution against
  // the working tree was retired with the legacy reference:resolve channel.
  function resolveReference() {
    if (!primitive || resolvedCode) return;
    if (!semanticId) {
      error = m.notes_referenceBlock_noTarget_error();
      loading = false;
      return;
    }
    const snapshot = resolveReferenceSnapshot(primitive);
    if (snapshot) {
      resolvedCode = snapshot.code;
      editorContent = snapshot.code;
      resolvedLanguage = snapshot.languageId;
      resolvedRange = snapshot.range;
    } else {
      error = m.notes_referenceBlock_noSnapshot_error();
    }
    loading = false;
  }

  // Auto-resolve on mount
  onMount(() => {
    resolveReference();
  });

  // Save file content with debouncing
  async function saveFileContent() {
    const filePath = resolvedFilePath || primitive?.target.filePath;
    if (!filePath || !workspaceId) return;

    // Resolve relative path to absolute using workspace repo path
    let absolutePath = filePath;
    if (!filePath.startsWith('/') && workspaceRepoPath) {
      absolutePath = `${workspaceRepoPath}/${filePath}`;
    }

    try {
      await invoke('file:write', {
        workspaceId,
        path: absolutePath,
        content: editorContent,
      });
    } catch (err) {
      logger.error('Failed to save file', { error: err, filePath, absolutePath });
    }
  }

  // Track the original content to detect changes
  let originalContent = $derived(resolvedCode || primitive?.snapshot?.code || '');

  // Watch for content changes and auto-save with debouncing
  $effect(() => {
    // Skip if content hasn't been initialized yet or is the same
    if (!editorContent || editorContent === originalContent) {
      return;
    }

    // Clear existing timeout
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    // Debounce save - wait 1 second after last change
    saveTimeout = setTimeout(() => {
      saveFileContent();
    }, 1000);
  });

  // Cleanup timeout on component destroy
  $effect(() => {
    return () => {
      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }
    };
  });

  // Open file in the app's main panel
  function openInApp(event: MouseEvent) {
    if (!primitive) return;

    // Get file path from multiple sources
    const filePath = primitive.target.filePath || parsedId?.filePath || semanticId?.split('#')[0];
    const line = primitive.target.range?.startLine || parsedId?.startLine;

    if (!filePath) {
      logger.warn('Could not determine file path');
      return;
    }

    // Check if cmd/ctrl was held - opens in adjacent panel
    const openInAdjacentPanel = event.metaKey || event.ctrlKey;

    // Get source panel ID for same-panel navigation
    const panelElement = (event.target as HTMLElement)?.closest('[data-panel-id]');
    const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;

    if (workspaceId) {
      appStore.dispatch(
        openWorkspaceFile(workspaceId, filePath, { line, openInAdjacentPanel, sourcePanelId }),
      );
    }
  }
</script>

<NodeViewWrapper>
  {#if primitive}
    {@const linkedAgentId = primitive.createdByAgentId}
    {@const filePath = primitive.target.filePath || parsedId?.filePath}
    {@const fileName = filePath?.split('/').pop() || displayName}
    {@const startLine = lineRange?.startLine || resolvedRange?.startLine || 1}
    {@const codeContent = resolvedCode || primitive.snapshot?.code || ''}
    <div
      class="ws-block-widget type-body my-2 overflow-hidden rounded-md border border-border bg-card text-foreground shadow-(--elevation-raised)"
    >
      <!-- Header row -->
      <div class="flex min-h-9 items-center gap-2 px-3 py-1.5">
        {#if linkedAgentId}
          <!-- Show agent avatar that opens the agent panel -->
          <button
            type="button"
            class="shrink-0 rounded-sm transition-opacity hover:opacity-80"
            onclick={(event) => {
              event.stopPropagation();
              if (workspaceId) {
                appStore.dispatch(
                  openAgentTabRequested(workspaceId, {
                    agentId: linkedAgentId,
                    ...getNavigationContext(event),
                  }),
                );
              }
            }}
            title={m.notes_referenceBlock_viewAgent_tooltip()}
          >
            <AgentAvatar agentId={linkedAgentId} variant="compact" />
          </button>
        {:else}
          <Fa icon={faCode} size="xs" class="shrink-0 text-muted-foreground" />
        {/if}
        <!-- Clickable area to toggle expansion -->
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-2 text-left transition-colors hover:text-foreground"
          onclick={() => (expanded = !expanded)}
        >
          <span class="type-body truncate font-medium">{fileName}</span>
          {#if filePath && filePath !== fileName}
            <span class="type-caption min-w-0 flex-1 truncate text-muted-foreground">
              {filePath}
            </span>
          {/if}
          {#if lineRangeDisplay()}
            <span class="type-caption shrink-0 tabular-nums text-muted-foreground">
              {lineRangeDisplay()}
            </span>
          {/if}
        </button>
        <Button
          variant="ghost-light"
          size="icon-xs"
          iconOnly={true}
          class="shrink-0"
          onclick={openInApp}
          title={m.notes_referenceBlock_goToFile_tooltip()}
        >
          <Fa icon={faArrowRight} size="xs" />
        </Button>
      </div>

      <!-- Code preview (shown when expanded) -->
      {#if expanded}
        <div transition:slide={{ duration: 150 }} class="overflow-x-auto">
          <div class="w-full border-t border-border">
            {#if loading}
              <div class="p-3">
                <Skeleton class="h-16 w-full rounded" />
              </div>
            {:else if error && !resolvedCode && !primitive.snapshot}
              <div class="type-caption p-3 text-muted-foreground">{error}</div>
            {:else if codeContent}
              <CodeBlock
                code={codeContent}
                language={resolvedLanguage}
                showLineNumbers={true}
                startLineNumber={startLine}
                noBorder={true}
                noMargin={true}
              />
            {:else}
              <div class="type-caption p-3 italic text-muted-foreground">
                {m.notes_referenceBlock_noContent_label()}
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <div class="ws-block-widget type-caption my-2 text-muted-foreground">
      {m.notes_referenceBlock_invalid_error()}
    </div>
  {/if}
</NodeViewWrapper>
