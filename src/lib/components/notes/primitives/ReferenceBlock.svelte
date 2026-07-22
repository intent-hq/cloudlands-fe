<script lang="ts">
  import { NodeViewWrapper } from 'svelte-tiptap';
  import { writable } from 'svelte/store';
  import type { NodeViewProps } from '@tiptap/core';
  import type { ReferencePrimitive } from '$shared/types/notes-primitives';
  import { Button } from '$lib/components/ui/button';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import CodeBlock from '$lib/components/editor/CodeBlock.svelte';
  import Fa from 'svelte-fa';
  import {
  faCode,
  faArrowRight,
} from '@fortawesome/free-solid-svg-icons';
  import { slide } from 'svelte/transition';
  import { invoke } from '$lib/electron-bridge';
  import {
  parseSemanticId,
  getSemanticId,
} from '$shared/types/notes-primitives';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import { createLogger } from '$lib/utils/client-logger';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { onMount } from 'svelte';

  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { openWorkspaceFile } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { store as appStore } from '$store/renderer/store';

  const logger = createLogger('ReferenceBlock');

  // TipTap NodeViewProps
  let { node, extension }: NodeViewProps = $props();

  // Get primitive data from node
  let primitive = $derived(node?.attrs?.data as ReferencePrimitive);

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
  let semanticId = $derived(primitive ? getSemanticId(primitive.target) : null);
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
      error = 'No reference target available';
      loading = false;
      return;
    }
    if (primitive.snapshot) {
      resolvedCode = primitive.snapshot.code;
      editorContent = primitive.snapshot.code;
      // Some producers emit the legacy `language` field instead of `languageId`.
      resolvedLanguage =
        primitive.snapshot.languageId ||
        (primitive.snapshot as { language?: string }).language ||
        'text';
      resolvedRange = primitive.target?.range || null;
    } else {
      error = 'No code snapshot stored for this reference';
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
    <div class="my-2 rounded-lg border border-border overflow-hidden bg-background">
      <!-- Header row -->
      <div class="flex items-center gap-2 px-3 py-1.5">
        {#if linkedAgentId}
          <!-- Show agent avatar that opens the agent panel -->
          <button
            type="button"
            class="flex-none hover:opacity-80 transition-opacity cursor-pointer"
            onclick={(e) => {
              e.stopPropagation();
              if (workspaceId) {
                appStore.dispatch(
                  openAgentTabRequested(workspaceId, { agentId: linkedAgentId }),
                );
              }
            }}
            title="View agent"
          >
            <AuggieAvatar agentId={linkedAgentId} size={16} />
          </button>
        {:else}
          <Fa icon={faCode} size="xs" class="flex-none text-ghost" />
        {/if}
        <!-- Clickable area to toggle expansion -->
        <button
          type="button"
          class="flex items-center gap-2 flex-1 min-w-0 text-left hover:text-foreground transition-colors cursor-pointer"
          onclick={() => (expanded = !expanded)}
        >
          <span class="text-inherit font-medium truncate">{fileName}</span>
          {#if filePath && filePath !== fileName}
            <span class="text-sm text-subtle truncate flex-1 min-w-0">
              {filePath}
            </span>
          {/if}
          {#if lineRangeDisplay()}
            <span class="text-xs text-subtle font-mono flex-none">
              {lineRangeDisplay()}
            </span>
          {/if}
        </button>
        <Button
          variant="ghost-light"
          size="sm"
          class="h-6 px-2 text-xs text-subtle gap-1 flex-none"
          onclick={openInApp}
          title="Go to file"
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
              <div class="p-3 text-sm text-subtle">{error}</div>
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
              <div class="p-3 text-sm text-subtle italic">No code content</div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <div class="my-1.5 text-sm text-subtle">Invalid reference block</div>
  {/if}
</NodeViewWrapper>
