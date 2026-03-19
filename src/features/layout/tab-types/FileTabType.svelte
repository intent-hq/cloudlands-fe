<script lang="ts">
  /**
   * File Tab Type Component
   *
   * Renders a file editor with auto-save, diff indicators, and header actions.
   */

  import type { TabTypeComponentProps } from './registry';
  import { getPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { getPanelLayoutManager } from '../panel-layout-manager.svelte';
  import { fileTrackingStore } from '$features/file-tracking/file-tracking.store.svelte';
  import type { TrackedChange } from '$features/file-tracking/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
	  import { invoke, listenSync } from '$lib/electron-bridge';
  import { createLogger } from '$lib/utils/client-logger';
  import { getLanguageFromPath, pathsMatch as filePathsMatch } from '$lib/utils/file-utils';
  import { parseHunksToLineChanges, type LineChange } from '$lib/utils/line-change-decorations';
  import CodeEditor from '$lib/components/editor/CodeEditor.svelte';
  import MarkdownFileEditor from '$lib/components/editor/MarkdownFileEditor.svelte';
  import FileViewer from '$lib/components/editor/FileViewer.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { Button } from '$lib/components/ui/button';
  import OpenComboButton from '$lib/components/ui/OpenComboButton.svelte';
  import SaveIndicator from '$lib/components/ui/SaveIndicator.svelte';
  import { selectLineWrapping, selectDiffIndicators } from '$lib/store/slices/ui-layout/ui-layout-selectors';
  import { toggleLineWrapping, toggleDiffIndicators } from '$lib/store/slices/ui-layout/ui-layout-slice';
  import { dispatch } from '$lib/store/redux-dispatch-bridge';
  import { untrack } from 'svelte';
  import Fa from 'svelte-fa';
  import { faPaintbrush, faTextWidth, faPencil, faTrash, faEye, faCode } from '@fortawesome/free-solid-svg-icons';
  import { deleteWithUndo } from '$lib/utils/reversible-actions';
  import { track, getFileExtension } from '$lib/services/analytics';

  const lineWrapping = selectLineWrapping();
  const diffIndicators = selectDiffIndicators();

  const logger = createLogger('FileTabType');

  let { tab, workspaceId, isActive, isPanelFocused }: TabTypeComponentProps = $props();

  const headerContext = getPanelHeaderContext();
  const layoutManager = $derived(getPanelLayoutManager(workspaceId));
  const workspace = $derived(workspaceStore.findById(WorkspaceId(workspaceId)));
  const repoPath = $derived(workspace?.worktreePath || workspace?.repositoryPath || null);

  // File state
  let fileContent = $state<string | null>(null);
  let originalFileContent = $state<string | null>(null);
  let fileLoading = $state(false);
  let fileError = $state<string | null>(null);
  let fileSaving = $state(false);
  let currentFilePath = $state<string | null>(null);
  let isNewFile = $state(false);
  let isFileBinary = $state(false);
  let codeEditorRef = $state<{ focus: () => boolean } | null>(null);
  let isMounted = $state(true);
  let fileLineChanges = $state<LineChange[]>([]);

  // Jump to line from tab data (e.g., when opening from reference block)
  let jumpToLine = $state<{ line?: number; column?: number } | undefined>(undefined);

  // Track the last processed timestamp to detect new navigation requests
  let lastJumpTimestamp = $state<number | undefined>(undefined);

  // Extract line from tab.data when tab changes
  // Uses jumpTimestamp to detect changes even when navigating to the same line
  $effect(() => {
    const line = tab.data?.line as number | undefined;
    const timestamp = tab.data?.jumpTimestamp as number | undefined;
    // Only process if this is a new navigation request (new timestamp)
    if (line && timestamp && timestamp !== lastJumpTimestamp) {
      lastJumpTimestamp = timestamp;
      jumpToLine = { line };
    }
  });

  $effect(() => {
    isMounted = true;
    return () => {
      isMounted = false;
    };
  });

  // Track when we're saving to avoid reloading from our own save event
  let isSavingFromEditor = false;
  let saveCooldownTimeout: ReturnType<typeof setTimeout> | null = null;

  // Listen for file changes from diff viewer or external sources
  $effect(() => {
    const filePath = tab.filePath;
    const wsId = workspaceId;
    const absolutePath = fileAbsolutePath;

    if (!filePath || !wsId) return;

    // Helper to check if paths match (handles absolute vs relative paths)
    const matchesOurFile = (changedPath: string | undefined): boolean => {
      if (!changedPath) return false;
      return filePathsMatch(changedPath, filePath) || filePathsMatch(changedPath, absolutePath);
    };

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const handleFileChange = (data: any) => {
      const changedPath = data.path || data.relativePath || data.filePath;
      if (!matchesOurFile(changedPath)) return;

      // Skip if this change came from our own save
      if (isSavingFromEditor) {
        logger.debug('[FileTabType] Skipping file change reload - change came from our own save', {
          filePath,
        });
        return;
      }

      logger.info('[FileTabType] File change detected, updating content', {
        changedPath,
        filePath,
        hasContent: data.content !== undefined,
      });

      // If content is provided in the event, update directly without re-reading.
      // This avoids destroying/recreating the editor and is more efficient.
      // Guard with typeof check to avoid setting fileContent to null (which would
      // hide the editor, since the template checks `fileContent !== null`).
      if (typeof data.content === 'string') {
        const content = data.content; // capture value for the closure
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          if (isMounted && !isSavingFromEditor) {
            fileContent = content;
            originalFileContent = content;
          }
        }, 300);
        return;
      }

      // No content in event - silently re-read the file without loading flash
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (isMounted && !isSavingFromEditor && absolutePath) {
          refreshFileContent(absolutePath, wsId);
        }
      }, 300);
    };

    const handleAgentFileChange = (data: any) => {
      // Check if this change is for our workspace
      if (data.workspaceId !== wsId) return;

      const changedPath = data.filePath || data.path;
      if (!matchesOurFile(changedPath)) return;

      // Skip if this change came from our own save
      if (isSavingFromEditor) {
        logger.debug(
          '[FileTabType] Skipping agent file change reload - change came from our own save',
          { filePath },
        );
        return;
      }

      // If a content update is already pending (e.g., from a file:content-changed event
      // that arrived with inline content), don't override it with a slower re-read.
      // Both events fire in sequence for agent writes; the first already has the content.
      if (debounceTimer) return;

      logger.info('[FileTabType] Agent file change detected, scheduling refresh', {
        changedPath,
        filePath,
      });

      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (isMounted && !isSavingFromEditor && absolutePath) {
          refreshFileContent(absolutePath, wsId);
        }
      }, 300);
    };


	    // Use listenSync to ensure cleanup works under Electron context isolation.
	    const cleanupFileContentChanged = listenSync(`file:content-changed:${wsId}`, ({ payload }) =>
	      handleFileChange(payload),
	    );
	    const cleanupAgentFileChanged = listenSync('file-tracking:agent-file-changed', ({ payload }) =>
	      handleAgentFileChange(payload),
	    );

    return () => {
	      cleanupFileContentChanged();
	      cleanupAgentFileChanged();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  });

  // Computed values
  const fileAbsolutePath = $derived(
    tab.filePath && repoPath
      ? tab.filePath.startsWith('/')
        ? tab.filePath
        : `${repoPath}/${tab.filePath}`
      : null,
  );
  const fileLanguage = $derived(tab.filePath ? getLanguageFromPath(tab.filePath) : 'plaintext');
  const isMarkdownFile = $derived(fileLanguage === 'markdown');
  let markdownPreview = $state(true); // default to rich text for markdown files
  const isFileDirty = $derived(
    fileContent !== null && originalFileContent !== null && fileContent !== originalFileContent,
  );

  // Find tracked changes for the file
  function matchesPath(c: TrackedChange, path: string): boolean {
    if (c.file === path || c.relativePath === path) return true;
    if (c.relativePath && path.endsWith('/' + c.relativePath)) return true;
    if (c.file && path.endsWith('/' + c.file)) return true;
    if (c.relativePath && c.relativePath.endsWith('/' + path)) return true;
    if (c.file && c.file.endsWith('/' + path)) return true;
    return false;
  }

  const fileChange = $derived.by(() => {
    if (!tab.filePath) return null;
    return fileTrackingStore.changes.find((c) => matchesPath(c, tab.filePath!)) ?? null;
  });
  const fileHasChanges = $derived(!!fileChange);

  // Auto-save with debounce
  let autoSaveTimeoutId: ReturnType<typeof setTimeout> | null = null;
  const AUTO_SAVE_DELAY_MS = 1500;

  $effect(() => {
    if (isFileDirty && tab.filePath) {
      if (autoSaveTimeoutId) clearTimeout(autoSaveTimeoutId);
      autoSaveTimeoutId = setTimeout(() => saveFileContent(), AUTO_SAVE_DELAY_MS);
    }
    return () => {
      if (autoSaveTimeoutId) {
        clearTimeout(autoSaveTimeoutId);
        autoSaveTimeoutId = null;
      }
    };
  });

  // Load file when path changes
  $effect(() => {
    const filePath = tab.filePath;
    const absolutePath = fileAbsolutePath;
    const wsId = workspaceId;

    if (filePath && absolutePath && wsId) {
      const prevFilePath = untrack(() => currentFilePath);
      if (prevFilePath !== filePath) {
        untrack(() => {
          fileContent = null;
          originalFileContent = null;
          fileError = null;
          isNewFile = false;
          currentFilePath = filePath;
        });
      }
      loadFileContent(absolutePath, wsId);
    }
  });

  async function loadFileContent(absolutePath: string, wsId: string) {
    untrack(() => {
      fileLoading = true;
      fileError = null;
      isNewFile = false;
      isFileBinary = false;
    });
    try {
      const result = await invoke<{
        success: boolean;
        data: { content: string; isBinary?: boolean };
      }>('file:read', {
        workspaceId: wsId,
        path: absolutePath,
      });
      if (!isMounted) return;
      const content = result?.data?.content ?? '';
      const binary = result?.data?.isBinary ?? false;
      untrack(() => {
        fileContent = content;
        originalFileContent = content;
        isFileBinary = binary;
      });
    } catch (err) {
      if (!isMounted) return;
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (
        errorMessage.includes('ENOENT') ||
        errorMessage.includes('not found') ||
        errorMessage.includes('no such file')
      ) {
        untrack(() => {
          isNewFile = true;
          fileContent = '';
          originalFileContent = '';
          fileError = null;
        });
      } else {
        untrack(() => {
          fileError = errorMessage;
          fileContent = null;
          originalFileContent = null;
        });
      }
    } finally {
      if (isMounted)
        untrack(() => {
          fileLoading = false;
        });
    }
  }

  /**
   * Silently refresh file content without showing loading skeleton.
   * Used when we know the file changed (e.g., agent edit) but want to
   * keep the editor visible during the refresh.
   */
  async function refreshFileContent(absolutePath: string, wsId: string) {
    try {
      const result = await invoke<{
        success: boolean;
        data: { content: string; isBinary?: boolean };
      }>('file:read', {
        workspaceId: wsId,
        path: absolutePath,
      });
      if (!isMounted) return;
      const content = result?.data?.content ?? '';
      const binary = result?.data?.isBinary ?? false;
      fileContent = content;
      originalFileContent = content;
      fileError = null; // clear any stale error from a previous failed load
      if (binary !== isFileBinary) {
        isFileBinary = binary;
      }
    } catch (err) {
      // If the file was deleted or is unreadable, fall back to full load
      if (isMounted) {
        logger.warn('[FileTabType] Silent refresh failed, falling back to full load', {
          path: absolutePath,
          error: err,
        });
        loadFileContent(absolutePath, wsId);
      }
    }
  }

  async function saveFileContent() {
    if (!fileAbsolutePath || fileContent === null || fileSaving) return;
    fileSaving = true;

    // Set flag to prevent reloading from our own save event
    isSavingFromEditor = true;
    if (saveCooldownTimeout) {
      clearTimeout(saveCooldownTimeout);
    }

    try {
      const result = await invoke<{ success: boolean; error?: string }>('file:write', {
        path: fileAbsolutePath,
        content: fileContent,
        workspaceId,
      });
      if (result.success) originalFileContent = fileContent;
    } catch (err) {
      logger.error('[FileTabType] Error saving file', { filePath: fileAbsolutePath, error: err });
    } finally {
      fileSaving = false;
      // Keep the flag set for a short time to catch the file change event
      saveCooldownTimeout = setTimeout(() => {
        isSavingFromEditor = false;
      }, 500);
    }
  }

  // Fetch line changes for diff indicators
  $effect(() => {
    const filePath = tab.filePath;
    const change = fileChange;
    if (!filePath || !change) {
      fileLineChanges = [];
      return;
    }
    (async () => {
      try {
        type DiffChunk = {
          file: string;
          chunks: {
            oldStart: number;
            oldLines: number;
            newStart: number;
            newLines: number;
            lines: { type: string; content: string }[];
          }[];
        };
        const response = await invoke<{ success: boolean; data?: DiffChunk[]; error?: string }>(
          'git:diff',
          {
            workspaceId,
            paths: [filePath],
            staged: change.stage === 'staged',
          },
        );
        if (!isMounted) return;
        if (response.success && response.data && response.data.length > 0) {
          const fileChunk = response.data[0];
          if (fileChunk?.chunks && fileChunk.chunks.length > 0) {
            const hunks = fileChunk.chunks.map((chunk) => ({
              oldStart: chunk.oldStart,
              oldLines: chunk.oldLines,
              newStart: chunk.newStart,
              newLines: chunk.newLines,
              lines: chunk.lines.map((line) => {
                if (line.type === 'Addition') return '+' + line.content;
                if (line.type === 'Deletion') return '-' + line.content;
                return ' ' + line.content;
              }),
            }));
            fileLineChanges = parseHunksToLineChanges(hunks);
          }
        }
      } catch (err) {
        if (isMounted) fileLineChanges = [];
      }
    })();
  });

  function handleKeyDown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if (isFileDirty && !fileSaving) saveFileContent();
    }
  }

  function handleGoToChanges(e?: MouseEvent) {
    if (!tab.filePath || !fileChange) return;
    const openInAdjacentPanel = e?.metaKey || e?.ctrlKey || false;
    const panelElement = (e?.target as HTMLElement | null)?.closest('[data-panel-id]');
    const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
    window.dispatchEvent(
      new CustomEvent('workspace:open-diff', {
        detail: {
          change: fileChange,
          filePath: tab.filePath,
          changeId: fileChange.id,
          openInAdjacentPanel,
          sourcePanelId,
        },
      }),
    );
  }

  async function handleDeleteFile() {
    if (!tab.filePath || !workspaceId) return;

    const filePath = tab.filePath;
    const fileName = filePath.split('/').pop() || 'file';
    // Capture current content so we can restore on undo
    const savedContent = fileContent ?? '';

    await deleteWithUndo(
      `"${fileName}"`,
      async () => {
        // Delete action
        const result = await invoke<{ success: boolean; error?: string }>('file:delete', {
          path: filePath,
          workspaceId,
        });
        if (!result?.success) {
          throw new Error(result?.error || 'Failed to delete file');
        }
        // Close the tab
        layoutManager.closeTab(tab.id);
        window.dispatchEvent(
          new CustomEvent('file:changed', {
            detail: { workspaceId, type: 'delete', filePath },
          }),
        );
        track('Deleted File', {
          workspace_id: workspaceId,
          file_extension: getFileExtension(filePath),
        });
      },
      async () => {
        // Undo action — re-create the file with saved content
        await invoke('file:write', {
          path: filePath,
          content: savedContent,
          workspaceId,
        });
        window.dispatchEvent(
          new CustomEvent('file:changed', {
            detail: { workspaceId, type: 'create', filePath },
          }),
        );
      },
    );
  }

  // Register header state and actions
  $effect(() => {
    if (!headerContext || !isActive) return;
    headerContext.registerActions(fileActions);
    headerContext.registerState({ isDirty: isFileDirty, isSaving: fileSaving });
  });
</script>

<svelte:window onkeydown={handleKeyDown} />

{#snippet fileActions()}
  <SaveIndicator
    isDirty={isFileDirty}
    isSaving={fileSaving}
    isAutoSaving={isFileDirty && !fileSaving}
    onSave={saveFileContent}
    size="sm"
  />
  {#if tab.filePath}
    <div class="w-px h-4 bg-border mx-1"></div>
    {#if isMarkdownFile}
      <Button
        variant="ghost-light"
        size="icon-xs"
        onclick={() => (markdownPreview = !markdownPreview)}
        tooltip={markdownPreview ? 'Switch to code editor' : 'Switch to rich text preview'}
        tooltipSide="bottom"
        class={markdownPreview ? 'text-foreground' : 'text-muted-foreground'}
      >
        <Fa icon={markdownPreview ? faCode : faEye} size="xs" />
      </Button>
    {/if}
    {#if fileHasChanges}
      <Button
        variant="ghost-light"
        size="icon-xs"
        onclick={handleGoToChanges}
        tooltip="Go to changes"
        tooltipSide="bottom"
      >
        <Fa icon={faPencil} size="xs" />
      </Button>
    {/if}
    {#if !isMarkdownFile || !markdownPreview}
      <Button
        variant="ghost-light"
        size="icon-xs"
        onclick={() => dispatch(toggleDiffIndicators())}
        tooltip={$diffIndicators ? 'Hide diff indicators' : 'Show diff indicators'}
        tooltipSide="bottom"
        class={$diffIndicators ? 'text-foreground' : 'text-muted-foreground'}
      >
        <Fa icon={faPaintbrush} size="xs" />
      </Button>
      <Button
        variant="ghost-light"
        size="icon-xs"
        onclick={() => dispatch(toggleLineWrapping())}
        tooltip={$lineWrapping
          ? 'Wrapping lines. Click to disable.'
          : 'Click to wrap lines'}
        tooltipSide="bottom"
        class={$lineWrapping ? 'text-foreground' : 'text-muted-foreground'}
      >
        <Fa icon={faTextWidth} size="xs" />
      </Button>
    {/if}
    <Button
      variant="ghost-light"
      size="icon-xs"
      onclick={handleDeleteFile}
      tooltip="Delete file"
      tooltipSide="bottom"
      class="text-muted-foreground hover:text-destructive-foreground"
    >
      <Fa icon={faTrash} size="xs" />
    </Button>
    <OpenComboButton
      filePath={tab.filePath}
      isDirectory={false}
      compact
      workspaceFolderPath={repoPath ?? undefined}
    />
  {/if}
{/snippet}

{#if tab.filePath}
  {#key tab.filePath}
    {#if fileLoading}
      <div class="flex flex-col h-full">
        <div class="flex-1 p-4 space-y-2">
          {#each Array(20) as _}
            <div class="flex items-center gap-3">
              <Skeleton class="h-3 w-8 shrink-0" />
              <Skeleton class="h-3" style="width: {30 + Math.random() * 60}%" />
            </div>
          {/each}
        </div>
      </div>
    {:else if fileError}
      <div class="flex flex-col items-center justify-center h-full text-subtle gap-2">
        <p class="text-destructive-foreground">Error loading file</p>
        <p class="text-xs">{fileError}</p>
      </div>
    {:else if fileContent !== null}
      {@const isSvgFile = tab.filePath?.toLowerCase().endsWith('.svg')}
      {#if isFileBinary || isSvgFile}
        <FileViewer
          filePath={tab.filePath || ''}
          {fileContent}
          language={fileLanguage}
          isBinary={isFileBinary}
        />
      {:else if isMarkdownFile && markdownPreview}
        <MarkdownFileEditor bind:value={fileContent} />
      {:else}
        <CodeEditor
          bind:this={codeEditorRef}
          bind:value={fileContent}
          language={fileLanguage}
          readOnly={false}
          fileName={tab.filePath}
          {workspaceId}
          filePath={tab.filePath}
          lineWrapping={$lineWrapping}
          lineChanges={$diffIndicators ? fileLineChanges : []}
          jumpTo={jumpToLine}
          {isPanelFocused}
        />
      {/if}
    {:else}
      <div class="flex items-center justify-center h-full text-subtle">
        <p>Preparing to load file...</p>
      </div>
    {/if}
  {/key}
{/if}
