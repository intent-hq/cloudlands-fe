<script lang="ts">
  /**
   * Diff Tab Type Component
   *
   * Shows a diff view for a file with tracked changes.
   * Includes header actions for view controls.
   */

  import type { TabTypeComponentProps } from './registry';
  import { openTabInRightmostColumnRequested } from '$store/renderer/slices/panel-layout/panel-layout-slice';

  import { getPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import {
    selectFileTrackingChanges,
    selectFileTrackingCommits,
  } from '$store/renderer/slices/changes/changes-selectors';
  import { refreshRequested } from '$store/renderer/slices/changes/changes-slice';
  import { gitClient } from '$features/git/git.client';
  import { gitCache } from '$features/git/git-cache';
  import { loadGitStatus } from '$store/renderer/slices/git/git-slice';
  import { ChangeStage, type TrackedChange } from '$features/file-tracking/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { TrackedChangeDiffViewer } from '$features/file-tracking/components/diff';
  import * as Menu from '$lib/components/ui/menu';
  import ViewSettingsDropdown from '../components/ViewSettingsDropdown.svelte';
  import OpenComboButton from '$features/external-editors/components/OpenComboButton.svelte';
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
  import { isAbsolutePath } from '$lib/utils/path-utils';
  import { m } from '$shared/paraglide/messages.js';
  import { faFile } from '@fortawesome/free-solid-svg-icons';
  import { store as appStore } from '$store/renderer/store';

  const lineWrapping = selectLineWrapping();
  const foldUnchanged = selectFoldUnchanged();
  const diffSideBySide = selectDiffSideBySide();
  let { tab, workspaceId, isActive }: TabTypeComponentProps = $props();

  // svelte-ignore state_referenced_locally
  const ftChanges$ = selectFileTrackingChanges(workspaceId);
  // svelte-ignore state_referenced_locally
  const ftCommits$ = selectFileTrackingCommits(workspaceId);

  const committedStageSet = new Set<ChangeStage>([
    ChangeStage.Committed,
    ChangeStage.Pushed,
    ChangeStage.PullRequest,
    ChangeStage.Merged,
    ChangeStage.Trunk,
  ]);

  const headerContext = getPanelHeaderContext();

  // svelte-ignore state_referenced_locally
  const workspace = selectWorkspaceById(workspaceId);
  const repoPath = $derived($workspace?.worktreePath || $workspace?.repositoryPath || undefined);
  const gitRootId = $derived(tab.data?.gitRootId as string | undefined);
  const gitRootPath = $derived(tab.data?.gitRootPath as string | undefined);
  const effectiveRepoPath = $derived(gitRootPath || repoPath);

  // Compute absolute path for diff files
  const diffAbsolutePath = $derived(
    tab.diffPath && effectiveRepoPath
      ? isAbsolutePath(tab.diffPath)
        ? tab.diffPath
        : `${effectiveRepoPath}/${tab.diffPath}`
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
  function handleGoToFile(_event?: MouseEvent) {
    if (!tab.diffPath) return;
    const fileName = tab.diffPath.split('/').pop() || tab.diffPath;
    const tabData = {
      type: 'file' as const,
      title: fileName,
      closable: true,
      filePath: diffAbsolutePath || tab.diffPath,
      workspaceId,
    };
    const store = appStore;
    store.dispatch(openTabInRightmostColumnRequested(workspaceId, tabData));
  }

  // Register header actions
  $effect(() => {
    if (!headerContext || !isActive) return;
    headerContext.registerActions({ display: diffDisplayActions, actions: diffActions });
  });

  // Handle staging a hunk
  async function handleStageHunk(filePath: string, hunkPatch: string) {
    console.log('[DiffTabType] handleStageHunk called', {
      filePath,
      patchLength: hunkPatch.length,
    });
    if (!workspaceId) {
      toast.error(m.layout_diffTab_noWorkspace_error());
      return;
    }
    const result = await gitClient.stageHunk(WorkspaceId(workspaceId), filePath, hunkPatch);
    if (result.ok) {
      toast.success(m.layout_diffTab_hunkStaged_toast());
      gitCache.invalidateWorkspace(workspaceId);
      appStore.dispatch(loadGitStatus(workspaceId, true));
      // Refresh file tracking to update the changes panel and diff viewer
      appStore.dispatch(refreshRequested(workspaceId, true));
    } else {
      toast.error(result.error || m.layout_diffTab_stageHunkFailed_error());
    }
  }

  // Handle unstaging a hunk
  async function handleUnstageHunk(filePath: string, hunkPatch: string) {
    console.log('[DiffTabType] handleUnstageHunk called', {
      filePath,
      patchLength: hunkPatch.length,
    });
    if (!workspaceId) {
      toast.error(m.layout_diffTab_noWorkspace_error());
      return;
    }
    const result = await gitClient.unstageHunk(WorkspaceId(workspaceId), filePath, hunkPatch);
    if (result.ok) {
      toast.success(m.layout_diffTab_hunkUnstaged_toast());
      gitCache.invalidateWorkspace(workspaceId);
      appStore.dispatch(loadGitStatus(workspaceId, true));
      // Refresh file tracking to update the changes panel and diff viewer
      appStore.dispatch(refreshRequested(workspaceId, true));
    } else {
      toast.error(result.error || m.layout_diffTab_unstageHunkFailed_error());
    }
  }
</script>

{#snippet diffDisplayActions()}
  <ViewSettingsDropdown
    embedded
    foldEnabled={$foldUnchanged}
    onToggleFold={() => appStore.dispatch(toggleFoldUnchanged())}
    wrapEnabled={$lineWrapping}
    onToggleWrap={() => appStore.dispatch(toggleLineWrapping())}
    splitEnabled={$diffSideBySide}
    onToggleSplit={() => appStore.dispatch(toggleDiffSideBySide())}
  />
{/snippet}

{#snippet diffActions()}
  <Menu.CommandItem
    icon={faFile}
    label={m.layout_diffHeader_goToFile_tooltip()}
    onclick={(event) => handleGoToFile(event)}
  />
  {#if diffAbsolutePath}
    <OpenComboButton
      filePath={diffAbsolutePath}
      {workspaceId}
      isDirectory={false}
      embedded
      workspaceFolderPath={effectiveRepoPath}
    />
  {/if}
{/snippet}

{#if tab.diffPath}
  {#key tab.diffPath}
    <TrackedChangeDiffViewer
      active={isActive}
      {change}
      {workspaceId}
      viewMode={$diffSideBySide ? 'split' : 'unified'}
      foldUnchanged={$foldUnchanged}
      lineWrapping={$lineWrapping}
      {refreshKey}
      {branchBaseRef}
      {branchBaseCommitSha}
      {gitRootId}
      {gitRootPath}
      onStageHunk={!gitRootId && change.stage === ChangeStage.Unstaged
        ? handleStageHunk
        : undefined}
      onUnstageHunk={!gitRootId && change.stage === ChangeStage.Staged
        ? handleUnstageHunk
        : undefined}
    />
  {/key}
{/if}
