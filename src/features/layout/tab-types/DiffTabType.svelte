<script lang="ts">
  /**
   * Diff Tab Type Component
   *
   * Shows a diff view for a file with tracked changes.
   * Includes header actions for view controls.
   */

  import type { TabTypeComponentProps } from './registry';
  import { openTab, openTabInAdjacentOrSplit } from '$lib/store/slices/panel-layout/panel-layout-slice';
  import { selectFocusedPanelId } from '$lib/store/slices/panel-layout/panel-layout-selectors';
  import { requestPanelFocus } from '$lib/store/slices/app-layout/app-layout-slice';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import { getPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import { selectFileTrackingChanges, selectFileTrackingCommits } from '$lib/store/slices/changes/changes-selectors';
  import { refreshRequested } from '$lib/store/slices/changes/changes-slice';
  import { gitClient } from '$features/git/git.client';
  import { gitCache } from '$features/git/git-cache';
  import { loadGitStatus } from '$lib/store/slices/git/git-slice';
  import { ChangeStage, type TrackedChange } from '$features/file-tracking/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { selectWorkspaceById } from '$lib/store/slices/workspace/workspace-selectors';
  import { TrackedChangeDiffViewer } from '$lib/components/ui/diff';
  import { Button } from '$lib/components/ui/button';
  import OpenComboButton from '$lib/components/ui/OpenComboButton.svelte';
  import { selectLineWrapping, selectFoldUnchanged, selectDiffSideBySide } from '$lib/store/slices/ui-layout/ui-layout-selectors';
  import { toggleLineWrapping, toggleFoldUnchanged, toggleDiffSideBySide } from '$lib/store/slices/ui-layout/ui-layout-slice';
  import { dispatch } from '$lib/store/redux-dispatch-bridge';
  import { toast } from '$lib/components/ui/toast';
  import { track, getFileExtension } from '$lib/services/analytics';
  import Fa from 'svelte-fa';
  import { faFile, faTextWidth, faMap, faColumns } from '@fortawesome/free-solid-svg-icons';

  const lineWrapping = selectLineWrapping();
  const foldUnchanged = selectFoldUnchanged();
  const diffSideBySide = selectDiffSideBySide();

  let { tab, workspaceId, isActive }: TabTypeComponentProps = $props();

  const ftChanges$ = selectFileTrackingChanges(workspaceId);
  const ftCommits$ = selectFileTrackingCommits(workspaceId);

  const committedStageSet = new Set<ChangeStage>([
    ChangeStage.Committed,
    ChangeStage.Pushed,
    ChangeStage.PullRequest,
    ChangeStage.Merged,
    ChangeStage.Trunk,
  ]);

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

  // Find the most-recent committed-stage entry in the store that carries a commitHash
  function findCommittedChangeByPath(path: string | null): TrackedChange | null {
    if (!path) return null;
    let latest: TrackedChange | null = null;
    let latestTs = -Infinity;
    for (const c of $ftChanges$) {
      if (!matchesPath(c, path)) continue;
      if (!committedStageSet.has(c.stage)) continue;
      if (!c.commitHash) continue;
      const ts = c.attribution?.timestamp ?? 0;
      if (ts >= latestTs) {
        latest = c;
        latestTs = ts;
      }
    }
    return latest;
  }

  // Match a commit file entry against the tab's path using the same suffix rules as matchesPath
  function commitFileMatchesPath(filePath: string, path: string): boolean {
    if (filePath === path) return true;
    if (path.endsWith('/' + filePath)) return true;
    if (filePath.endsWith('/' + path)) return true;
    return false;
  }

  // Synthesise a committed TrackedChange from the newest commit (commits are newest-first)
  // whose files[] includes this path. Lets TrackedChangeDiffViewer's committed-by-hash branch
  // render HASH^..HASH for files with only committed changes on the current branch.
  function synthesiseCommittedChangeFromCommits(path: string | null): TrackedChange | null {
    if (!path) return null;
    for (const commit of $ftCommits$) {
      if (!commit?.hash) continue;
      if (!commit.files?.some((f) => f?.path && commitFileMatchesPath(f.path, path))) continue;
      return {
        id: `diff-${path}-${commit.hash}`,
        file: path,
        relativePath: path,
        status: 'modified' as const,
        stage: ChangeStage.Committed,
        commitHash: commit.hash,
        stats: { additions: 0, deletions: 0 },
        attribution: { timestamp: commit.timestamp ?? Date.now() },
      };
    }
    return null;
  }

  // Get live diff change from store
  const diffChange = $derived.by((): TrackedChange | null => {
    if (!tab.diffPath) return null;
    return findActiveChangeByPath(tab.diffPath);
  });

  // Refresh key for diff viewer, derived from the active change's stage/stats/timestamp
  const refreshKey = $derived.by((): number => {
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

  // Resolve the TrackedChange to hand to the viewer.
  // Priority:
  //   1. Pre-supplied change with commitHash (e.g. Accept Changes flow).
  //   2. Live staged/unstaged store match.
  //   3. Pre-supplied branch-base change, so branch aggregate context is not collapsed to one commit.
  //   4. Committed-stage store entry with commitHash.
  //   5. Synthesise a committed TrackedChange from the newest commit touching this file.
  //   6. Fall back to whatever tab.data.change was.
  //   7. Synthetic blank Unstaged placeholder (truly unknown file).
  const tabChange = $derived(tab.data?.change as TrackedChange | undefined);
  const branchBaseRef = $derived(tab.data?.branchBaseRef as string | undefined);
  const branchBaseCommitSha = $derived(tab.data?.branchBaseCommitSha as string | undefined);
  const hasBranchBaseContext = $derived(Boolean(branchBaseRef || branchBaseCommitSha));
  const change: TrackedChange = $derived.by((): TrackedChange => {
    if (tabChange?.commitHash) return tabChange;
    if (diffChange) return diffChange;
    if (hasBranchBaseContext && tabChange) return tabChange;
    const committedInStore = findCommittedChangeByPath(tab.diffPath ?? null);
    if (committedInStore) return committedInStore;
    const fromCommits = synthesiseCommittedChangeFromCommits(tab.diffPath ?? null);
    if (fromCommits) return fromCommits;
    if (tabChange) return tabChange;
    return {
      id: `diff-${tab.diffPath}`,
      file: tab.diffPath || '',
      relativePath: tab.diffPath || '',
      status: 'modified' as const,
      stage: ChangeStage.Unstaged,
      stats: { additions: 0, deletions: 0 },
      attribution: { timestamp: Date.now() },
    };
  });

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
    <TrackedChangeDiffViewer
      {change}
      {workspaceId}
      viewMode={$diffSideBySide ? 'split' : 'unified'}
      foldUnchanged={$foldUnchanged}
      lineWrapping={$lineWrapping}
      refreshKey={refreshKey}
      {branchBaseRef}
      {branchBaseCommitSha}
      onStageHunk={change.stage === ChangeStage.Unstaged ? handleStageHunk : undefined}
      onUnstageHunk={change.stage === ChangeStage.Staged ? handleUnstageHunk : undefined}
    />
  {/key}
{/if}
