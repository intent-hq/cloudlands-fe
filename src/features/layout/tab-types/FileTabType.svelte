<script lang="ts">
  /**
   * File Tab Type Component
   *
   * Renders a file editor with auto-save, diff indicators, and header actions.
   */

  import type { TabTypeComponentProps } from './registry';
  import { getPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import { closeTab } from '$store/renderer/slices/panel-layout/panel-layout-slice';

  import {
  selectFileContent,
  selectFileError,
  selectFileIsBinary,
  selectFileIsDirty,
  selectFileLastUpdated,
  selectFileLoading,
  selectFileSaving,
} from '$store/renderer/slices/files/files-selectors';
  import { loadFileContentRequested } from '$store/renderer/slices/files/files-slice';
  import {
  writeFileContent,
  flushFileContent,
} from '$features/files/files-write-service';
  import { selectFileTrackingChanges } from '$store/renderer/slices/changes/changes-selectors';
  import type { TrackedChange } from '$features/file-tracking/types';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { invoke } from '$lib/electron-bridge';
  import { appClient } from '$lib/client';
  import { LineType } from '$shared/types';
  import { getLanguageFromPath } from '$lib/utils/file-utils';
  import { isAbsolutePathOutsideRoot } from '$lib/utils/path-utils';
  import {
  parseHunksToLineChanges,
  type LineChange,
} from '$lib/utils/line-change-decorations';
  import CodeEditor from '$lib/components/editor/CodeEditor.svelte';
  import MarkdownFileEditor from '$lib/components/editor/MarkdownFileEditor.svelte';
  import FileViewer from '$lib/components/editor/FileViewer.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { Button } from '$lib/components/ui/button';
  import OpenComboButton from '$lib/components/ui/OpenComboButton.svelte';
  import SaveIndicator from '$lib/components/ui/SaveIndicator.svelte';
  import {
  selectLineWrapping,
  selectDiffIndicators,
} from '$store/renderer/slices/ui-layout/ui-layout-selectors';
  import {
  toggleLineWrapping,
  toggleDiffIndicators,
} from '$store/renderer/slices/ui-layout/ui-layout-slice';

  import { dispatchWindowEvent } from '$lib/utils/window-events';
  import { openWorkspaceDiff } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { untrack } from 'svelte';
  import Fa from 'svelte-fa';
  import {
  faPaintbrush,
  faTextWidth,
  faPencil,
  faTrash,
  faEye,
  faCode,
} from '@fortawesome/free-solid-svg-icons';
  import { deleteWithUndo } from '$lib/utils/reversible-actions';
  import { m } from '$shared/paraglide/messages.js';
  import { writable } from 'svelte/store';
  import { store as appStore } from '$store/renderer/store';

  const lineWrapping = selectLineWrapping();
  const diffIndicators = selectDiffIndicators();
  const headerToggleActiveClass =
    'text-foreground bg-sidebar hover:text-foreground hover:bg-sidebar';
  const headerToggleInactiveClass = 'text-subtle';

  let { tab, workspaceId, isActive, isPanelFocused }: TabTypeComponentProps = $props();

  const filePathStore = writable<string | null | undefined>(tab.filePath);
  $effect(() => {
    filePathStore.set(tab.filePath);
  });

  const fileContentStore = selectFileContent(workspaceId, filePathStore);
  const fileLoadingStore = selectFileLoading(workspaceId, filePathStore);
  const fileSavingStore = selectFileSaving(workspaceId, filePathStore);
  const fileErrorStore = selectFileError(workspaceId, filePathStore);
  const isFileBinaryStore = selectFileIsBinary(workspaceId, filePathStore);
  const isFileDirtyStore = selectFileIsDirty(workspaceId, filePathStore);
  const fileLastUpdatedStore = selectFileLastUpdated(workspaceId, filePathStore);

  const ftChanges$ = selectFileTrackingChanges(workspaceId);
  const headerContext = getPanelHeaderContext();

  const workspace = selectWorkspaceById(workspaceId);
  const repoPath = $derived($workspace?.worktreePath || $workspace?.repositoryPath || null);

  const fileContent = $derived($fileContentStore);
  const fileLoading = $derived($fileLoadingStore);
  const fileSaving = $derived($fileSavingStore);
  const fileError = $derived($fileErrorStore);
  const isFileBinary = $derived($isFileBinaryStore);
  const isFileDirty = $derived($isFileDirtyStore);
  const fileLastUpdated = $derived($fileLastUpdatedStore);

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

  // Computed values
  // Absolute paths outside the workspace root (e.g. a chat chip pointing at
  // ~/.claude/...) are not readable through the daemon's contained file.*
  // surface — render a dedicated warning instead of attempting the read.
  const isOutsideWorkspace = $derived(
    !!(tab.filePath && repoPath && isAbsolutePathOutsideRoot(tab.filePath, repoPath)),
  );
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
    return $ftChanges$.find((c) => matchesPath(c, tab.filePath!)) ?? null;
  });
  const fileHasChanges = $derived(!!fileChange);

  // Auto-save is debounced inside the files-write-service (keyed by ws::path).
  // Flush any pending save when the file/workspace changes or the tab unmounts
  // so an in-flight edit is never lost.
  $effect(() => {
    const wsId = workspaceId;
    const filePath = tab.filePath;
    return () => {
      if (wsId && filePath) flushFileContent(wsId, filePath);
    };
  });

  // Load file when path changes (never for out-of-workspace paths — the
  // daemon rejects them, so no file.read is dispatched for that state)
  $effect(() => {
    const filePath = tab.filePath;
    const absolutePath = fileAbsolutePath;
    const wsId = workspaceId;

    if (filePath && absolutePath && wsId && !isOutsideWorkspace) {
      appStore.dispatch(loadFileContentRequested(wsId, filePath, absolutePath));
    }
  });

  function getFileContentForEditor(): string {
    return fileContent ?? '';
  }

  function setFileContentFromEditor(content: string) {
    if (!tab.filePath || !workspaceId || !fileAbsolutePath) return;
    // Optimistic local update + debounced file.write through the seam.
    writeFileContent(workspaceId, tab.filePath, fileAbsolutePath, content);
  }

  function saveFileContent() {
    if (!tab.filePath || !fileAbsolutePath || fileContent === null || fileSaving) return;
    writeFileContent(workspaceId, tab.filePath, fileAbsolutePath, fileContent, { immediate: true });
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
        // Daemon-backed per-file hunks (`git.diffs`, PROTOCOL §5.6) via the
        // appClient seam — this consumer only needs hunk line data, replacing
        // the retired local `git:diff` read.
        const chunks = await appClient.git.diffs(workspaceId, {
          path: filePath,
          staged: change.stage === 'staged',
        });
        if (!isMounted) return;
        const fileChunk = chunks.find((c) => c.file === filePath) ?? chunks[0];
        if (fileChunk?.chunks && fileChunk.chunks.length > 0) {
          const hunks = fileChunk.chunks.map((chunk) => ({
            oldStart: chunk.oldStart,
            oldLines: chunk.oldLines,
            newStart: chunk.newStart,
            newLines: chunk.newLines,
            lines: chunk.lines.map((line) => {
              if (line.type === LineType.Addition) return '+' + line.content;
              if (line.type === LineType.Deletion) return '-' + line.content;
              return ' ' + line.content;
            }),
          }));
          fileLineChanges = parseHunksToLineChanges(hunks);
        }
      } catch {
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
    appStore.dispatch(
      openWorkspaceDiff(workspaceId, fileChange, {
        filePath: tab.filePath,
        changeId: fileChange.id,
        openInAdjacentPanel,
        sourcePanelId,
      }),
    );
  }

  async function handleDeleteFile() {
    const absolutePath = fileAbsolutePath;
    if (!tab.filePath || !workspaceId || !absolutePath) return;

    const filePath = tab.filePath;
    const fileName = filePath.split('/').pop() || m.layout_fileTab_file_fallback();
    // Capture current content so we can restore on undo
    const savedContent =
      selectFileContent.select(appStore.state, workspaceId, filePath) ?? '';

    await deleteWithUndo(
      `"${fileName}"`,
      async () => {
        // Delete action
        const result = await invoke<{ success: boolean; error?: string }>('file:delete', {
          path: filePath,
          workspaceId,
        });
        if (!result?.success) {
          throw new Error(result?.error || m.ui_workspaceActions_deleteFileFailed_error());
        }
        // Close the tab
        appStore.dispatch(closeTab(workspaceId, tab.id));
        dispatchWindowEvent('file:changed', { workspaceId, type: 'delete', filePath });
      },
      async () => {
        // Undo action — re-create the file with saved content (immediate write).
        writeFileContent(workspaceId, filePath, absolutePath, savedContent, { immediate: true });
      },
    );
  }

  // Register header state and actions
  $effect(() => {
    if (!headerContext || !isActive) return;
    untrack(() => {
      headerContext.registerActions(fileActions);
      headerContext.registerState({ isDirty: isFileDirty, isSaving: fileSaving });
    });
  });
</script>

<svelte:window onkeydown={handleKeyDown} />

{#snippet fileActions()}
  <!-- Save/edit affordances are hidden for out-of-workspace paths -->
  {#if !isOutsideWorkspace}
    <SaveIndicator
      isDirty={isFileDirty}
      isSaving={fileSaving}
      isAutoSaving={isFileDirty && !fileSaving}
      onSave={saveFileContent}
      size="sm"
    />
  {/if}
  {#if tab.filePath && !isOutsideWorkspace}
    <div class="w-px h-4 bg-border mx-1"></div>
    {#if isMarkdownFile}
      <Button
        variant="ghost-light"
        size="icon-xs"
        onclick={() => (markdownPreview = !markdownPreview)}
        tooltip={markdownPreview
          ? m.layout_fileTab_switchToCode_tooltip()
          : m.layout_fileTab_switchToPreview_tooltip()}
        tooltipSide="bottom"
        aria-pressed={markdownPreview}
        class={markdownPreview ? headerToggleActiveClass : headerToggleInactiveClass}
      >
        <Fa icon={markdownPreview ? faCode : faEye} size="xs" />
      </Button>
    {/if}
    {#if fileHasChanges}
      <Button
        variant="ghost-light"
        size="icon-xs"
        onclick={handleGoToChanges}
        tooltip={m.layout_fileTab_goToChanges_tooltip()}
        tooltipSide="bottom"
      >
        <Fa icon={faPencil} size="xs" />
      </Button>
    {/if}
    {#if !isMarkdownFile || !markdownPreview}
      <Button
        variant="ghost-light"
        size="icon-xs"
        onclick={() => appStore.dispatch(toggleDiffIndicators())}
        tooltip={$diffIndicators
          ? m.layout_fileTab_hideDiffIndicators_tooltip()
          : m.layout_fileTab_showDiffIndicators_tooltip()}
        tooltipSide="bottom"
        aria-pressed={$diffIndicators}
        class={$diffIndicators ? headerToggleActiveClass : headerToggleInactiveClass}
      >
        <Fa icon={faPaintbrush} size="xs" />
      </Button>
      <Button
        variant="ghost-light"
        size="icon-xs"
        onclick={() => appStore.dispatch(toggleLineWrapping())}
        tooltip={$lineWrapping
          ? m.layout_diffHeader_wrappingOn_tooltip()
          : m.layout_diffHeader_wrapLines_tooltip()}
        tooltipSide="bottom"
        aria-pressed={$lineWrapping}
        class={$lineWrapping ? headerToggleActiveClass : headerToggleInactiveClass}
      >
        <Fa icon={faTextWidth} size="xs" />
      </Button>
    {/if}
    <Button
      variant="ghost-light"
      size="icon-xs"
      onclick={handleDeleteFile}
      tooltip={m.layout_fileTab_deleteFile_tooltip()}
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
    {#if isOutsideWorkspace}
      <div class="flex flex-col items-center justify-center h-full text-subtle gap-2">
        <p>{m.layout_fileTab_outsideWorkspace_label()}</p>
        <p class="text-xs">{tab.filePath}</p>
      </div>
    {:else if fileLoading}
      <div class="flex flex-col h-full">
        <div class="flex-1 p-4 space-y-2">
          {#each [...Array(20).keys()] as i (i)}
            <div class="flex items-center gap-3">
              <Skeleton class="h-3 w-8 shrink-0" />
              <Skeleton class="h-3" style="width: {30 + Math.random() * 60}%" />
            </div>
          {/each}
        </div>
      </div>
    {:else if fileError}
      <div class="flex flex-col items-center justify-center h-full text-subtle gap-2">
        <p class="text-destructive-foreground">{m.layout_fileTab_errorLoading_label()}</p>
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
        <MarkdownFileEditor
          bind:value={getFileContentForEditor, setFileContentFromEditor}
          externalContentVersion={fileLastUpdated}
        />
      {:else}
        <CodeEditor
          bind:this={codeEditorRef}
          bind:value={getFileContentForEditor, setFileContentFromEditor}
          language={fileLanguage}
          readOnly={false}
          fileName={tab.filePath}
          {workspaceId}
          filePath={tab.filePath}
          lineWrapping={$lineWrapping}
          lineChanges={$diffIndicators ? fileLineChanges : []}
          jumpTo={jumpToLine}
          externalContentVersion={fileLastUpdated}
          {isPanelFocused}
        />
      {/if}
    {:else}
      <div class="flex items-center justify-center h-full text-subtle">
        <p>{m.layout_fileTab_preparing_label()}</p>
      </div>
    {/if}
  {/key}
{/if}
