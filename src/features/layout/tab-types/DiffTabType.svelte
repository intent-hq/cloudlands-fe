<script lang="ts">
  /**
   * Diff Tab Type Component
   *
   * Shows a diff view for a file with tracked changes.
   * Includes header actions for view controls.
   */

  import { onMount, onDestroy } from 'svelte';
  import type { TabTypeComponentProps } from './registry';
  import { openTab, openTabInAdjacentOrSplit } from '$lib/store/slices/panel-layout/panel-layout-slice';
  import { selectFocusedPanelId } from '$lib/store/slices/panel-layout/panel-layout-selectors';
  import { requestPanelFocus } from '$lib/store/slices/app-layout/app-layout-slice';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import { getPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import { selectFileTrackingChanges } from '$lib/store/slices/changes/changes-selectors';
  import { refreshRequested } from '$lib/store/slices/changes/changes-slice';
  import { gitClient } from '$features/git/git.client';
  import { gitCache } from '$features/git/git-cache';
  import { loadGitStatus } from '$lib/store/slices/git/git-slice';
  import { ChangeStage, type TrackedChange } from '$features/file-tracking/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { selectWorkspaceById } from '$lib/store/slices/workspace/workspace-selectors';
  import { pathsMatch as filePathsMatch } from '$lib/utils/file-utils';
  import MonacoDiffViewer from '$lib/components/file-tracking/MonacoDiffViewer.svelte';
  import { Button } from '$lib/components/ui/button';
  import OpenComboButton from '$lib/components/ui/OpenComboButton.svelte';
  import { selectLineWrapping, selectFoldUnchanged, selectDiffSideBySide } from '$lib/store/slices/ui-layout/ui-layout-selectors';
  import { toggleLineWrapping, toggleFoldUnchanged, toggleDiffSideBySide } from '$lib/store/slices/ui-layout/ui-layout-slice';
  import { dispatch } from '$lib/store/redux-dispatch-bridge';
  import { toast } from '$lib/components/ui/toast';
  import { createLogger } from '$lib/utils/client-logger';
  import { track, getFileExtension } from '$lib/services/analytics';
  import Fa from 'svelte-fa';
  import { faFile, faTextWidth, faMap, faColumns } from '@fortawesome/free-solid-svg-icons';

  const lineWrapping = selectLineWrapping();
  const foldUnchanged = selectFoldUnchanged();
  const diffSideBySide = selectDiffSideBySide();

  const logger = createLogger('DiffTabType');

  let { tab, workspaceId, isActive }: TabTypeComponentProps = $props();

  const ftChanges$ = selectFileTrackingChanges(workspaceId);

  // Track recently saved files to prevent refresh key changes from causing re-renders
  // This prevents scroll jump when editing in the diff viewer
  let recentlySavedByDiffEditor = $state<Map<string, number>>(new Map());
  const SAVE_COOLDOWN_MS = 2000; // 2 seconds cooldown after save

  // Listen for diff editor save events to track which files were just saved by the editor
  let diffEditorSaveHandler: ((event: Event) => void) | null = null;

  onMount(() => {
    logger.debug('DiffTabType: Setting up diff-editor:file-saved listener', {
      tabDiffPath: tab.diffPath,
      workspaceId,
    });

    diffEditorSaveHandler = (event: Event) => {
      const customEvent = event as CustomEvent<{ filePath: string; relativePath: string; workspaceId: string }>;
      const { filePath, relativePath, workspaceId: eventWorkspaceId } = customEvent.detail;

      // Only track if workspace matches or no workspace specified
      if (workspaceId && eventWorkspaceId !== workspaceId) return;

      const now = Date.now();
      recentlySavedByDiffEditor.set(filePath, now);
      recentlySavedByDiffEditor.set(relativePath, now);

      logger.debug('DiffTabType: Tracked diff editor save', {
        filePath,
        relativePath,
        tabDiffPath: tab.diffPath,
        mapSize: recentlySavedByDiffEditor.size,
      });

      // Clean up old entries
      for (const [path, timestamp] of recentlySavedByDiffEditor.entries()) {
        if (now - timestamp > SAVE_COOLDOWN_MS) {
          recentlySavedByDiffEditor.delete(path);
        }
      }
    };

    window.addEventListener('diff-editor:file-saved', diffEditorSaveHandler);
  });

  onDestroy(() => {
    if (diffEditorSaveHandler) {
      window.removeEventListener('diff-editor:file-saved', diffEditorSaveHandler);
    }
  });

  // Check if a path was recently saved by the diff editor
  function wasRecentlySavedByDiffEditor(path: string | null | undefined): boolean {
    if (!path) return false;
    const now = Date.now();

    // Check if any saved path matches
    for (const [savedPath, timestamp] of recentlySavedByDiffEditor.entries()) {
      if (now - timestamp > SAVE_COOLDOWN_MS) {
        recentlySavedByDiffEditor.delete(savedPath);
        continue;
      }
      if (filePathsMatch(savedPath, path)) return true;
    }
    return false;
  }

  const headerContext = getPanelHeaderContext();

  const workspace = selectWorkspaceById(workspaceId);
  const repoPath = $derived($workspace?.worktreePath || $workspace?.repositoryPath || undefined);

  // Compute absolute path for diff files
  const diffAbsolutePath = $derived(
    tab.diffPath && repoPath
      ? tab.diffPath.startsWith('/')
        ? tab.diffPath
        : `${repoPath}/${tab.diffPath}`
      : null,
  );

  // Helper to match file paths
  function matchesPath(c: TrackedChange, path: string): boolean {
    if (c.file === path || c.relativePath === path) return true;
    if (c.relativePath && path.endsWith('/' + c.relativePath)) return true;
    if (c.file && path.endsWith('/' + c.file)) return true;
    if (c.relativePath && c.relativePath.endsWith('/' + path)) return true;
    if (c.file && c.file.endsWith('/' + path)) return true;
    return false;
  }

  // Find only active (staged/unstaged) changes
  function findActiveChangeByPath(path: string | null): TrackedChange | null {
    if (!path) return null;
    return (
      $ftChanges$.find(
        (c) => matchesPath(c, path) && (c.stage === 'staged' || c.stage === 'unstaged'),
      ) ?? null
    );
  }

  // Get live diff change from store
  const diffChange = $derived.by((): TrackedChange | null => {
    if (!tab.diffPath) return null;
    return findActiveChangeByPath(tab.diffPath);
  });

  // Stable refresh key that only updates when file wasn't recently saved by diff editor
  // This prevents scroll jump when editing in the diff viewer
  let stableRefreshKey = $state(0);

  // Get refresh key for diff viewer - but only update stableRefreshKey when appropriate
  const computedRefreshKey = $derived.by((): number => {
    if (!tab.diffPath) return 0;
    const storeChange = findActiveChangeByPath(tab.diffPath);
    const changesLength = $ftChanges$.length;
    if (storeChange) {
      const stageNum =
        storeChange.stage === 'staged' ? 1 : storeChange.stage === 'unstaged' ? 2 : 3;
      const statsNum = (storeChange.stats?.additions || 0) + (storeChange.stats?.deletions || 0);
      const timestampNum = storeChange.attribution?.timestamp
        ? storeChange.attribution.timestamp % 100000
        : 0;
      return stageNum * 1000000 + statsNum * 1000 + timestampNum + changesLength;
    }
    return changesLength;
  });

  // Effect to update stable refresh key only when file wasn't recently saved by diff editor
  $effect(() => {
    const newKey = computedRefreshKey;
    // If this file was recently saved by the diff editor, skip updating the refresh key
    // This prevents the component from re-keying and losing scroll position
    if (wasRecentlySavedByDiffEditor(tab.diffPath)) {
      logger.debug('DiffTabType: Skipping refresh key update - file was recently saved by diff editor', {
        tabDiffPath: tab.diffPath,
        newKey,
        stableRefreshKey,
      });
      return;
    }
    if (newKey !== stableRefreshKey) {
      logger.debug('DiffTabType: Updating refresh key', {
        tabDiffPath: tab.diffPath,
        oldKey: stableRefreshKey,
        newKey,
      });
      stableRefreshKey = newKey;
    }
  });

  // Use change from tab data (for committed changes) or live change
  const tabChange = $derived(tab.data?.change as TrackedChange | undefined);
  const change: TrackedChange = $derived(
    (tabChange?.commitHash ? tabChange : diffChange) ||
      tabChange || {
        id: `diff-${tab.diffPath}`,
        file: tab.diffPath || '',
        relativePath: tab.diffPath || '',
        status: 'modified' as const,
        stage: ChangeStage.Unstaged,
        stats: { additions: 0, deletions: 0 },
        attribution: { timestamp: Date.now() },
      },
  );

  /** Map TrackedChange status to analytics change_type */
  function getChangeType(change: TrackedChange): 'modified' | 'added' | 'deleted' | 'renamed' {
    return change.status || 'modified';
  }

  // Track when diff tab is viewed (deduped by diffPath to avoid rapid re-fires)
  let lastTrackedDiffPath = $state<string | null>(null);

  $effect(() => {
    // Only track when tab becomes active and we have a valid diff path
    if (!isActive || !tab.diffPath) return;
    // Deduplicate: don't track the same diff path if we just tracked it
    if (lastTrackedDiffPath === tab.diffPath) return;

    try {
      track('Viewed Diff', {
        file_extension: getFileExtension(tab.diffPath),
        change_type: getChangeType(change),
        is_staged: change.stage === ChangeStage.Staged,
      });
      lastTrackedDiffPath = tab.diffPath;
    } catch {
      // Analytics should never break the app
    }
  });

  // Open the diff file in the editor
  function handleGoToFile(e?: MouseEvent) {
    if (!tab.diffPath) return;
    const fileName = tab.diffPath.split('/').pop() || tab.diffPath;
    const openInAdjacentPanel = e?.metaKey || e?.ctrlKey || false;
    const panelElement = (e?.target as HTMLElement | null)?.closest('[data-panel-id]');
    const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
    const tabData = {
      type: 'file' as const,
      title: fileName,
      closable: true,
      filePath: tab.diffPath,
      workspaceId,
    };
    const store = getReduxStore();
    if (openInAdjacentPanel) {
      store.dispatch(openTabInAdjacentOrSplit(workspaceId, tabData, sourcePanelId));
      const focusedId = selectFocusedPanelId.select(store.getState(), workspaceId);
      if (focusedId) {
        store.dispatch(requestPanelFocus(workspaceId, focusedId));
      }
    } else {
      store.dispatch(openTab(workspaceId, tabData));
    }
  }

  // Register header actions
  $effect(() => {
    if (!headerContext || !isActive) return;
    headerContext.registerActions(diffActions);
  });

  // Handle staging a hunk
  async function handleStageHunk(filePath: string, hunkPatch: string) {
    console.log('[DiffTabType] handleStageHunk called', { filePath, patchLength: hunkPatch.length });
    if (!workspaceId) {
      toast.error('No workspace available');
      return;
    }
    const result = await gitClient.stageHunk(WorkspaceId(workspaceId), filePath, hunkPatch);
    if (result.ok) {
      toast.success('Hunk staged');
      // Track hunk staging event
      track('Staged Changes', { method: 'hunk' });
      gitCache.invalidateWorkspace(workspaceId);
      getReduxStore().dispatch(loadGitStatus(workspaceId, true));
      // Refresh file tracking to update the changes panel and diff viewer
      getReduxStore().dispatch(refreshRequested(workspaceId));
    } else {
      toast.error(result.error || 'Failed to stage hunk');
    }
  }

  // Handle unstaging a hunk
  async function handleUnstageHunk(filePath: string, hunkPatch: string) {
    console.log('[DiffTabType] handleUnstageHunk called', {
      filePath,
      patchLength: hunkPatch.length,
    });
    if (!workspaceId) {
      toast.error('No workspace available');
      return;
    }
    const result = await gitClient.unstageHunk(WorkspaceId(workspaceId), filePath, hunkPatch);
    if (result.ok) {
      toast.success('Hunk unstaged');
      gitCache.invalidateWorkspace(workspaceId);
      getReduxStore().dispatch(loadGitStatus(workspaceId, true));
      // Refresh file tracking to update the changes panel and diff viewer
      getReduxStore().dispatch(refreshRequested(workspaceId));
    } else {
      toast.error(result.error || 'Failed to unstage hunk');
    }
  }
</script>

{#snippet diffActions()}
  <Button
    variant="ghost-light"
    size="icon-xs"
    onclick={handleGoToFile}
    tooltip="Go to file"
    tooltipSide="bottom"
  >
    <Fa icon={faFile} size="xs" />
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
  <Button
    variant="ghost-light"
    size="icon-xs"
    onclick={() => dispatch(toggleFoldUnchanged())}
    tooltip={$foldUnchanged
      ? 'Folding unchanged lines. Click to disable.'
      : 'Click to fold unchanged lines'}
    tooltipSide="bottom"
    class={$foldUnchanged ? 'text-foreground' : 'text-muted-foreground'}
  >
    <Fa icon={faMap} size="xs" />
  </Button>
  <Button
    variant="ghost-light"
    size="icon-xs"
    onclick={() => dispatch(toggleDiffSideBySide())}
    tooltip={$diffSideBySide
      ? 'Click to show unified view'
      : 'Click to show split view'}
    tooltipSide="bottom"
    class={$diffSideBySide ? 'text-foreground' : 'text-muted-foreground'}
  >
    <Fa icon={faColumns} size="xs" />
  </Button>
  {#if diffAbsolutePath}
    <OpenComboButton
      filePath={diffAbsolutePath}
      isDirectory={false}
      compact
      workspaceFolderPath={repoPath}
    />
  {/if}
{/snippet}

{#if tab.diffPath}
  {#key tab.diffPath}
    <MonacoDiffViewer
      {change}
      {workspaceId}
      sideBySide={$diffSideBySide}
      foldUnchanged={$foldUnchanged}
      lineWrapping={$lineWrapping}
      refreshKey={stableRefreshKey}
      readOnly={false}
      onStageHunk={change.stage === ChangeStage.Unstaged ? handleStageHunk : undefined}
      onUnstageHunk={change.stage === ChangeStage.Staged ? handleUnstageHunk : undefined}
    />
  {/key}
{/if}
