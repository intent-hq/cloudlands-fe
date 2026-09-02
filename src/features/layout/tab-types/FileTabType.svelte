<script lang="ts">
  /**
   * File Tab Type Component
   *
   * Renders a file editor with auto-save, diff indicators, and header actions.
   */

  import type { TabTypeComponentProps } from './registry';
  import { getPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import {
    closeTab,
    updateFileTabPath,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';

  import {
    selectFileContent,
    selectFileError,
    selectFileIsBinary,
    selectFileIsDirty,
    selectFileLastUpdated,
    selectFileLoading,
    selectFileNotFoundCandidates,
    selectFileSaving,
  } from '$store/renderer/slices/files/files-selectors';
  import {
    loadFileContentRequested,
    removeFileContentEntry,
    saveFileContentRequested,
    updateFileContent,
  } from '$store/renderer/slices/files/files-slice';
  import { selectFileTrackingChanges } from '$store/renderer/slices/changes/changes-selectors';
  import type { TrackedChange } from '$features/file-tracking/types';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { invoke } from '$lib/electron-bridge';
  import { appClient } from '$lib/client';
  import { backendRequest } from '$lib/client/live/backend-transport';
  import { resolveFileBySuffix } from '$lib/services/files/resolve-file-by-suffix';
  import { LineType } from '$shared/types';
  import { getLanguageFromPath } from '$lib/utils/file-utils';
  import { isAbsolutePath, isAbsolutePathOutsideRoot, isTildePath } from '$lib/utils/path-utils';
  import { parseHunksToLineChanges, type LineChange } from '$lib/utils/line-change-decorations';
  import CodeEditor from '$lib/components/editor/CodeEditor.svelte';
  import MarkdownFileEditor from '$lib/components/editor/MarkdownFileEditor.svelte';
  import FileViewer from '$lib/components/editor/FileViewer.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import * as Menu from '$lib/components/ui/menu';
  import ViewSettingsDropdown from '../components/ViewSettingsDropdown.svelte';
  import OpenComboButton from '$features/external-editors/components/OpenComboButton.svelte';
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
  import { faFloppyDisk, faPencil, faTrash } from '@fortawesome/free-solid-svg-icons';
  import { deleteWithUndo } from '$lib/utils/reversible-actions';
  import { m } from '$shared/paraglide/messages.js';
  import { writable } from 'svelte/store';
  import { store as appStore } from '$store/renderer/store';
  import { getEffectiveShortcut } from '$lib/utils/effective-shortcuts';
  import { matchesShortcut, type ShortcutId } from '$lib/utils/shortcut-bindings';

  const lineWrapping = selectLineWrapping();
  const diffIndicators = selectDiffIndicators();
  let { tab, workspaceId, isActive, isPanelFocused }: TabTypeComponentProps = $props();

  // svelte-ignore state_referenced_locally
  const filePathStore = writable<string | null | undefined>(tab.filePath);
  $effect(() => {
    filePathStore.set(tab.filePath);
  });

  // svelte-ignore state_referenced_locally
  const fileContentStore = selectFileContent(workspaceId, filePathStore);
  // svelte-ignore state_referenced_locally
  const fileLoadingStore = selectFileLoading(workspaceId, filePathStore);
  // svelte-ignore state_referenced_locally
  const fileSavingStore = selectFileSaving(workspaceId, filePathStore);
  // svelte-ignore state_referenced_locally
  const fileErrorStore = selectFileError(workspaceId, filePathStore);
  // svelte-ignore state_referenced_locally
  const fileNotFoundCandidatesStore = selectFileNotFoundCandidates(workspaceId, filePathStore);
  // svelte-ignore state_referenced_locally
  const isFileBinaryStore = selectFileIsBinary(workspaceId, filePathStore);
  // svelte-ignore state_referenced_locally
  const isFileDirtyStore = selectFileIsDirty(workspaceId, filePathStore);
  // svelte-ignore state_referenced_locally
  const fileLastUpdatedStore = selectFileLastUpdated(workspaceId, filePathStore);

  // svelte-ignore state_referenced_locally
  const ftChanges$ = selectFileTrackingChanges(workspaceId);
  const headerContext = getPanelHeaderContext();

  // svelte-ignore state_referenced_locally
  const workspace = selectWorkspaceById(workspaceId);
  const repoPath = $derived(
    $workspace?.worktreePath || $workspace?.repositoryPath || $workspace?.path || null,
  );

  const fileContent = $derived($fileContentStore);
  const fileLoading = $derived($fileLoadingStore);
  const fileSaving = $derived($fileSavingStore);
  const fileError = $derived($fileErrorStore);
  // Suffix-resolution candidates recorded by the read saga on a not-found
  // error (see files-read-saga); capped for display in the error panel.
  const MAX_NOT_FOUND_CANDIDATES = 5;
  const fileNotFoundCandidates = $derived(
    ($fileNotFoundCandidatesStore ?? []).slice(0, MAX_NOT_FOUND_CANDIDATES),
  );
  const isFileBinary = $derived($isFileBinaryStore);
  const isFileDirty = $derived($isFileDirtyStore);
  const fileLastUpdated = $derived($fileLastUpdatedStore);
  const saveStatusLabel = $derived(
    fileSaving
      ? m.ui_saveIndicator_saving_tooltip()
      : isFileDirty
        ? m.ui_saveIndicator_autoSaving_tooltip()
        : m.ui_saveIndicator_saved_tooltip(),
  );

  type EditorShortcutAction = 'undo' | 'redo' | 'copy' | 'select-all' | 'toggle-task-list';
  let codeEditorRef = $state<{
    focus: () => boolean;
    runShortcut: (action: Exclude<EditorShortcutAction, 'toggle-task-list'>) => boolean;
  } | null>(null);
  let markdownEditorRef = $state<{
    runShortcut: (action: EditorShortcutAction) => boolean;
  } | null>(null);
  let isMounted = $state(true);
  let fileLineChanges = $state<LineChange[]>([]);
  let resolvedWorkspaceMediaPath = $state<string | null>(null);

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
  // /Users/dev/.claude/...) are not readable through the daemon's contained
  // file.* surface — render a dedicated warning instead of attempting the read.
  // Tilde paths join the same bucket: the renderer cannot expand `~` (no Node
  // APIs, see `expandPath`), so a read would be doomed regardless of location.
  const isOutsideWorkspace = $derived(
    !!(
      tab.filePath &&
      (isTildePath(tab.filePath) || (repoPath && isAbsolutePathOutsideRoot(tab.filePath, repoPath)))
    ),
  );
  const fileAbsolutePath = $derived(
    tab.filePath && repoPath
      ? isAbsolutePath(tab.filePath)
        ? tab.filePath
        : `${repoPath}/${tab.filePath}`
      : null,
  );
  const isAllowlistedMediaPath = $derived(
    !!tab.filePath && /\.(?:png|jpe?g|gif|webp|mp4|webm)$/i.test(tab.filePath),
  );
  const workspaceMediaPath = $derived.by(() => {
    const filePath = tab.filePath;
    if (!filePath || !workspaceId || isOutsideWorkspace || !/^[A-Za-z0-9._-]+$/.test(workspaceId)) {
      return null;
    }

    const normalizedPath = filePath.replace(/\\/g, '/');
    let relativePath = normalizedPath;
    if (isAbsolutePath(filePath)) {
      if (!repoPath) return null;
      const normalizedRoot = repoPath.replace(/\\/g, '/').replace(/\/+$/, '');
      const caseInsensitive =
        /^[A-Za-z]:\//.test(normalizedRoot) || normalizedRoot.startsWith('//');
      const comparedPath = caseInsensitive ? normalizedPath.toLowerCase() : normalizedPath;
      const comparedRoot = caseInsensitive ? normalizedRoot.toLowerCase() : normalizedRoot;
      if (!comparedPath.startsWith(`${comparedRoot}/`)) return null;
      relativePath = normalizedPath.slice(normalizedRoot.length + 1);
    }

    const segments = relativePath.split('/');
    if (
      segments.length === 0 ||
      segments.some(
        (segment) =>
          !segment ||
          segment === '.' ||
          segment === '..' ||
          segment.includes('\0') ||
          segment.includes('/') ||
          segment.includes('\\'),
      ) ||
      /^[A-Za-z]:/.test(segments[0]) ||
      !/\.(?:png|jpe?g|gif|webp|mp4|webm)$/i.test(segments[segments.length - 1])
    ) {
      return null;
    }

    return segments.join('/');
  });
  const workspaceMediaUrl = $derived(
    resolvedWorkspaceMediaPath && workspaceId
      ? `workspace-file://${workspaceId}/${resolvedWorkspaceMediaPath
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`
      : null,
  );
  const fileLanguage = $derived(tab.filePath ? getLanguageFromPath(tab.filePath) : 'plaintext');
  const isMarkdownFile = $derived(fileLanguage === 'markdown');
  let markdownPreview = $state(true); // default to rich text for markdown files

  // Media cannot use the UTF-8 file.read fallback. Confirm the exact contained
  // path first, then use the existing bounded ignored-artifact resolver. Hold
  // rendering until this completes so an incorrect workspace-file URL is not
  // committed before a unique candidate can retarget the owning tab.
  $effect(() => {
    if (!isActive) return;
    const requestedPath = workspaceMediaPath;
    const sourceFilePath = tab.filePath;
    const wsId = workspaceId;
    const tabId = tab.id;
    resolvedWorkspaceMediaPath = null;
    if (!requestedPath || !sourceFilePath || !wsId) return;

    let cancelled = false;
    const isCurrent = () =>
      !cancelled && workspaceId === wsId && tab.id === tabId && tab.filePath === sourceFilePath;

    void (async () => {
      let exactFile = false;
      try {
        const stat = await backendRequest<{ isFile?: boolean }>('file.stat', {
          workspaceId: wsId,
          path: requestedPath,
        });
        exactFile = stat?.isFile === true;
      } catch {
        // A missing exact path is the expected entry into suffix recovery.
      }
      if (!isCurrent()) return;
      if (exactFile) {
        resolvedWorkspaceMediaPath = requestedPath;
        return;
      }
      if (!/\.(?:png|jpe?g|gif|webp|mp4|webm)$/i.test(requestedPath)) {
        resolvedWorkspaceMediaPath = requestedPath;
        return;
      }

      const { candidates, truncated } = await resolveFileBySuffix(wsId, requestedPath);
      if (!isCurrent()) return;
      if (!truncated && candidates.length === 1) {
        appStore.dispatch(updateFileTabPath(wsId, sourceFilePath, candidates[0], tabId));
        return;
      }

      // Missing, ambiguous, and truncated results remain on the requested path;
      // the binary protocol will report absence without falling back to file.read.
      resolvedWorkspaceMediaPath = requestedPath;
    })();

    return () => {
      cancelled = true;
    };
  });

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

  // Auto-save is debounced inside filesWriteSaga (keyed by ws::path).
  // Flush any pending save when the file/workspace changes or the tab unmounts
  // so an in-flight edit is never lost.
  $effect(() => {
    const wsId = workspaceId;
    const filePath = tab.filePath;
    return () => {
      if (!wsId || !filePath) return;
      const content = selectFileContent.select(appStore.state, wsId, filePath);
      const dirty = selectFileIsDirty.select(appStore.state, wsId, filePath);
      const absolutePath = isAbsolutePath(filePath)
        ? filePath
        : repoPath
          ? `${repoPath}/${filePath}`
          : null;
      if (dirty && content !== null && absolutePath) {
        appStore.dispatch(saveFileContentRequested(wsId, filePath, absolutePath, content));
      }
    };
  });

  // Load file when path changes (never for out-of-workspace paths — the
  // daemon rejects them, so no file.read is dispatched for that state)
  $effect(() => {
    const filePath = tab.filePath;
    const absolutePath = fileAbsolutePath;
    const wsId = workspaceId;
    if (!isActive) return;

    // `file.read` is scoped by workspaceId and accepts a repository-relative
    // path. Do not block the read while the workspace entity/root hydrates —
    // doing so leaves activity-opened tabs stuck at "Preparing to load file".
    // The effect runs again with the resolved absolute path once hydration lands.
    const waitingForAbsoluteRoot = !!filePath && isAbsolutePath(filePath) && !repoPath;
    if (
      filePath &&
      wsId &&
      !isOutsideWorkspace &&
      !isAllowlistedMediaPath &&
      !waitingForAbsoluteRoot
    ) {
      appStore.dispatch(loadFileContentRequested(wsId, filePath, absolutePath ?? filePath));
    }
  });

  function getFileContentForEditor(): string {
    return fileContent ?? '';
  }

  function setFileContentFromEditor(content: string) {
    if (!tab.filePath || !workspaceId || !fileAbsolutePath) return;
    // Optimistic local update + debounced file.write through the seam.
    appStore.dispatch(updateFileContent(workspaceId, tab.filePath, content));
  }

  function saveFileContent() {
    if (!tab.filePath || !fileAbsolutePath || fileContent === null || fileSaving) return;
    appStore.dispatch(
      saveFileContentRequested(workspaceId, tab.filePath, fileAbsolutePath, fileContent),
    );
  }

  // Retarget this tab to a suffix-resolution candidate (mirrors the read
  // saga's unique-match flow): drop the stale not-found entry, then update
  // the tab path — the load effect re-issues the read against it. Scoped to
  // this tab's id so other tabs open on the same path resolve independently.
  function openNotFoundCandidate(candidate: string) {
    const currentPath = tab.filePath;
    if (!currentPath || !workspaceId) return;
    appStore.dispatch(removeFileContentEntry(workspaceId, currentPath));
    appStore.dispatch(updateFileTabPath(workspaceId, currentPath, candidate, tab.id));
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
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
    const matches = (id: ShortcutId) => matchesShortcut(e, getEffectiveShortcut(id), isMac);
    if (matches('editor.save')) {
      e.preventDefault();
      if (isFileDirty && !fileSaving) saveFileContent();
      return;
    }
    const action = matches('editor.undo')
      ? 'undo'
      : matches('editor.redo')
        ? 'redo'
        : matches('editor.toggle-task-list')
          ? 'toggle-task-list'
          : matches('editor.copy')
            ? 'copy'
            : matches('editor.select-all')
              ? 'select-all'
              : null;
    if (!action) return;
    const handled =
      markdownEditorRef?.runShortcut(action) ||
      (action !== 'toggle-task-list' && codeEditorRef?.runShortcut(action));
    if (handled) e.preventDefault();
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
    const savedContent = selectFileContent.select(appStore.state, workspaceId, filePath) ?? '';

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
        appStore.dispatch(
          saveFileContentRequested(workspaceId, filePath, absolutePath, savedContent),
        );
      },
    );
  }

  // Register header state and actions
  $effect(() => {
    if (!headerContext || !isActive) return;
    const headerState = { isDirty: isFileDirty, isSaving: fileSaving };
    untrack(() => {
      headerContext.registerActions({ display: fileDisplayActions, actions: fileActions });
      headerContext.registerState(headerState);
    });
  });
</script>

<svelte:window onkeydown={(event) => isActive && handleKeyDown(event)} />

{#snippet fileDisplayActions()}
  <!-- Save/edit affordances are hidden for out-of-workspace paths -->
  {#if !isOutsideWorkspace}
    <Menu.CommandItem icon={faFloppyDisk} label={saveStatusLabel} disabled />
  {/if}
  {#if tab.filePath && !isOutsideWorkspace}
    <ViewSettingsDropdown
      embedded
      showFold={false}
      showSplit={false}
      showPreview={isMarkdownFile}
      previewEnabled={markdownPreview}
      onTogglePreview={() => (markdownPreview = !markdownPreview)}
      showWrap={!isMarkdownFile || !markdownPreview}
      wrapEnabled={$lineWrapping}
      onToggleWrap={() => appStore.dispatch(toggleLineWrapping())}
      showDiff={!isMarkdownFile || !markdownPreview}
      diffEnabled={$diffIndicators}
      onToggleDiff={() => appStore.dispatch(toggleDiffIndicators())}
    />
  {/if}
{/snippet}

{#snippet fileActions()}
  {#if tab.filePath && !isOutsideWorkspace}
    {#if fileHasChanges}
      <Menu.CommandItem
        icon={faPencil}
        label={m.layout_fileTab_goToChanges_tooltip()}
        onclick={handleGoToChanges}
      />
    {/if}
    <Menu.CommandItem
      icon={faTrash}
      label={m.layout_fileTab_deleteFile_tooltip()}
      onclick={handleDeleteFile}
      destructive
    />
    <OpenComboButton
      filePath={tab.filePath}
      {workspaceId}
      isDirectory={false}
      embedded
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
    {:else if workspaceMediaUrl}
      <FileViewer
        filePath={resolvedWorkspaceMediaPath ?? tab.filePath}
        sourceUrl={workspaceMediaUrl}
      />
    {:else if isAllowlistedMediaPath}
      <div class="flex items-center justify-center h-full text-subtle">
        <p>{m.layout_fileTab_preparing_label()}</p>
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
        <p class="text-danger">{m.layout_fileTab_errorLoading_label()}</p>
        <p class="text-xs">{fileError}</p>
        <p class="text-xs font-mono">{tab.filePath}</p>
        {#if fileNotFoundCandidates.length > 0}
          <p class="text-xs mt-2">{m.layout_fileTab_didYouMean_label()}</p>
          <ul class="flex flex-col items-center gap-1">
            {#each fileNotFoundCandidates as candidate (candidate)}
              <li>
                <button
                  type="button"
                  class="text-xs font-mono text-primary cursor-pointer hover:underline"
                  onclick={() => openNotFoundCandidate(candidate)}
                >
                  {candidate}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
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
          bind:this={markdownEditorRef}
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
