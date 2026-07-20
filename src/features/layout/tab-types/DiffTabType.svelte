<script lang="ts">
  /**
   * Diff Tab Type Component
   *
   * Shows a diff view for a file with tracked changes.
   * Includes header actions for view controls.
   */

  import type { TabTypeComponentProps } from './registry';
  import {
  openTab,
  openTabInAdjacentOrSplit,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { selectFocusedPanelId } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import { requestPanelFocus } from '$store/renderer/slices/app-layout/app-layout-slice';

  import { getPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import {
  selectFileTrackingChanges,
  selectFileTrackingCommits,
} from '$store/renderer/slices/changes/changes-selectors';
  import { refreshRequested } from '$store/renderer/slices/changes/changes-slice';
  import { gitClient } from '$features/git/git.client';
  import { gitCache } from '$features/git/git-cache';
  import { loadGitStatus } from '$store/renderer/slices/git/git-slice';
  import {
  ChangeStage,
  type TrackedChange,
} from '$features/file-tracking/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { TrackedChangeDiffViewer } from '$lib/components/ui/diff';
  import { Button } from '$lib/components/ui/button';
  import OpenComboButton from '$lib/components/ui/OpenComboButton.svelte';
  import {
  selectLineWrapping,
  selectFoldUnchanged,
  selectDiffSideBySide,
} from '$store/renderer/slices/ui-layout/ui-layout-selectors';
  import {
  toggleLineWrapping,
  toggleFoldUnchanged,
  toggleDiffSideBySide,
} from '$store/renderer/slices/ui-layout/ui-layout-slice';

  import { toast } from '$lib/components/ui/toast';
  import Fa from 'svelte-fa';
  import {
  faFile,
  faTextWidth,
  faMap,
  faColumns,
} from '@fortawesome/free-solid-svg-icons';
  import { store as appStore } from '$store/renderer/store';

  const lineWrapping = selectLineWrapping();
  const foldUnchanged = selectFoldUnchanged();
  const diffSideBySide = selectDiffSideBySide();
  const headerToggleActiveClass =
    'text-foreground bg-sidebar hover:text-foreground hover:bg-sidebar';
  const headerToggleInactiveClass = 'text-subtle';

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
    const store = appStore;
    if (openInAdjacentPanel) {
      store.dispatch(openTabInAdjacentOrSplit(workspaceId, tabData, sourcePanelId));
      const focusedId = selectFocusedPanelId.select(store.state, workspaceId);
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
    console.log('[DiffTabType] handleStageHunk called', {
      filePath,
      patchLength: hunkPatch.length,
    });
    if (!workspaceId) {
      toast.error('No workspace available');
      return;
    }
    const result = await gitClient.stageHunk(WorkspaceId(workspaceId), filePath, hunkPatch);
    if (result.ok) {
      toast.success('Hunk staged');
      gitCache.invalidateWorkspace(workspaceId);
      appStore.dispatch(loadGitStatus(workspaceId, true));
      // Refresh file tracking to update the changes panel and diff viewer
      appStore.dispatch(refreshRequested(workspaceId, true));
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
      appStore.dispatch(loadGitStatus(workspaceId, true));
      // Refresh file tracking to update the changes panel and diff viewer
      appStore.dispatch(refreshRequested(workspaceId, true));
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
    onclick={() => appStore.dispatch(toggleLineWrapping())}
    tooltip={$lineWrapping ? 'Wrapping lines. Click to disable.' : 'Click to wrap lines'}
    tooltipSide="bottom"
    aria-pressed={$lineWrapping}
    class={$lineWrapping ? headerToggleActiveClass : headerToggleInactiveClass}
  >
    <Fa icon={faTextWidth} size="xs" />
  </Button>
  <Button
    variant="ghost-light"
    size="icon-xs"
    onclick={() => appStore.dispatch(toggleFoldUnchanged())}
    tooltip={$foldUnchanged
      ? 'Folding unchanged lines. Click to disable.'
      : 'Click to fold unchanged lines'}
    tooltipSide="bottom"
    aria-pressed={$foldUnchanged}
    class={$foldUnchanged ? headerToggleActiveClass : headerToggleInactiveClass}
  >
    <Fa icon={faMap} size="xs" />
  </Button>
  <Button
    variant="ghost-light"
    size="icon-xs"
    onclick={() => appStore.dispatch(toggleDiffSideBySide())}
    tooltip={$diffSideBySide ? 'Click to show unified view' : 'Click to show split view'}
    tooltipSide="bottom"
    aria-pressed={$diffSideBySide}
    class={$diffSideBySide ? headerToggleActiveClass : headerToggleInactiveClass}
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
      {refreshKey}
      {branchBaseRef}
      {branchBaseCommitSha}
      onStageHunk={change.stage === ChangeStage.Unstaged ? handleStageHunk : undefined}
      onUnstageHunk={change.stage === ChangeStage.Staged ? handleUnstageHunk : undefined}
    />
  {/key}
{/if}
