<script lang="ts">
  /**
   * Changes Tab Type Component
   *
   * Shows a commit changeset with all files in the commit.
   * Includes header actions for expand/collapse and view controls.
   */

  import { writable } from 'svelte/store';
  import type { TabTypeComponentProps } from './registry';
  import { getPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import {
    selectFileTrackingCommits,
    selectFileTrackingOlderCommits,
    selectFileTrackingLoading,
  } from '$store/renderer/slices/changes/changes-selectors';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { selectGitRoots } from '$store/renderer/slices/git-roots/git-roots-selectors';
  import ChatChangesPanel from '$lib/components/chat/ChatChangesPanel.svelte';
  import ViewSettingsDropdown from '../components/ViewSettingsDropdown.svelte';
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

  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { openWorkspaceNote } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { selectCommitDetails } from '$store/renderer/slices/git/git-selectors';
  import { loadCommitDetails } from '$store/renderer/slices/git/git-slice';
  import { isAbsolutePath } from '$lib/utils/path-utils';
  import { store as appStore } from '$store/renderer/store';

  const lineWrapping = selectLineWrapping();
  const foldUnchanged = selectFoldUnchanged();
  const diffSideBySide = selectDiffSideBySide();
  let { tab, workspaceId, isActive }: TabTypeComponentProps = $props();

  const headerContext = getPanelHeaderContext();
  // svelte-ignore state_referenced_locally
  const workspace = selectWorkspaceById(workspaceId);
  // svelte-ignore state_referenced_locally
  const gitRoots$ = selectGitRoots(workspaceId);

  // Get commit data from tab
  const commitHash = $derived((tab.data?.commitHash as string) || '');
  const commitMessage = $derived((tab.data?.commitMessage as string) || '');
  // Secondary git root scoping the changeset (multi git root tracking).
  // Absent → primary-root behavior, byte-identical to before.
  const gitRootId = $derived((tab.data?.gitRootId as string) || '');
  const commitHashStore = writable('');
  const gitRootIdStore = writable('');
  $effect(() => commitHashStore.set(commitHash));
  $effect(() => gitRootIdStore.set(gitRootId));
  // svelte-ignore state_referenced_locally
  const commitDetails$ = selectCommitDetails(workspaceId, commitHashStore, gitRootIdStore);
  // Root path used to absolutize the daemon's root-relative file paths: the
  // registered secondary root's path when `gitRootId` is set, else the
  // workspace worktree.
  const gitRootPath = $derived(
    gitRootId ? $gitRoots$.find((r) => r.id === gitRootId)?.path || '' : '',
  );
  const workspacePath = $derived(
    gitRootPath || $workspace?.worktreePath || $workspace?.repositoryPath || '',
  );
  // svelte-ignore state_referenced_locally
  const ftCommits$ = selectFileTrackingCommits(workspaceId);
  // svelte-ignore state_referenced_locally
  const ftOlderCommits$ = selectFileTrackingOlderCommits(workspaceId);
  // svelte-ignore state_referenced_locally
  const ftLoading$ = selectFileTrackingLoading(workspaceId);
  const allCommits = $derived($ftCommits$ || []);
  const olderCommits = $derived($ftOlderCommits$ || []);
  const targetCommit = $derived(
    allCommits.find((c) => c.hash === commitHash) ||
      olderCommits.find((c) => c.hash === commitHash),
  );
  const storeCommitFiles = $derived(targetCommit?.files || []);

  // Trigger the saga-owned read when file metadata is absent.
  $effect(() => {
    const hash = commitHash;
    const storeFiles = storeCommitFiles;
    const wsId = workspaceId;
    const rootId = gitRootId;
    if (!hash || !wsId || storeFiles.length > 0 || $commitDetails$) return;
    appStore.dispatch(loadCommitDetails(wsId, hash, rootId || undefined));
  });

  const fetchedCommitInfo = $derived($commitDetails$?.data ?? null);
  const isFetchingDetails = $derived($commitDetails$?.loading ?? false);
  const commitFiles = $derived(
    storeCommitFiles.length > 0 ? storeCommitFiles : (fetchedCommitInfo?.files ?? []),
  );

  // State for expand/collapse and panel ref
  let changesAllExpanded = $state(true);
  let changesPanelRef = $state<{ expandAll: () => void; collapseAll: () => void } | null>(null);

  // Build changes array for the panel
  const changes = $derived(
    commitFiles.map((file: { path?: string; additions?: number; deletions?: number } | string) => {
      const filePath = typeof file === 'string' ? file : file.path || '';
      const additions = typeof file === 'string' ? 0 : file.additions || 0;
      const deletions = typeof file === 'string' ? 0 : file.deletions || 0;
      return {
        filePath: isAbsolutePath(filePath) ? filePath : `${workspacePath}/${filePath}`,
        action: 'modify' as const,
        additions,
        deletions,
        toolName: 'local',
        toolCallId: `commit-${commitHash}-${filePath}`,
        staged: false,
        category: 'committed' as const,
        commitHash,
        commitMessage,
      };
    }),
  );

  // Register header actions
  $effect(() => {
    if (!headerContext || !isActive) return;
    headerContext.registerActions({ display: changesDisplayActions });
  });
</script>

{#snippet changesDisplayActions()}
  <ViewSettingsDropdown
    embedded
    showExpand
    expanded={changesAllExpanded}
    onToggleExpand={() => {
      changesAllExpanded = !changesAllExpanded;
      if (changesAllExpanded) changesPanelRef?.expandAll();
      else changesPanelRef?.collapseAll();
    }}
    foldEnabled={$foldUnchanged}
    onToggleFold={() => appStore.dispatch(toggleFoldUnchanged())}
    wrapEnabled={$lineWrapping}
    onToggleWrap={() => appStore.dispatch(toggleLineWrapping())}
    splitEnabled={$diffSideBySide}
    onToggleSplit={() => appStore.dispatch(toggleDiffSideBySide())}
  />
{/snippet}

{#key commitHash}
  <ChatChangesPanel
    bind:this={changesPanelRef}
    isLoading={$ftLoading$ || isFetchingDetails}
    {changes}
    gitRootId={gitRootId || undefined}
    gitRootPath={gitRootPath || undefined}
    commitInfo={{
      hash: commitHash,
      message: commitMessage,
      author: targetCommit?.author || fetchedCommitInfo?.author,
      authorEmail: targetCommit?.authorEmail || fetchedCommitInfo?.authorEmail,
      date: targetCommit?.date || fetchedCommitInfo?.date,
      agentId: targetCommit?.agentId,
      linkedNoteId: targetCommit?.linkedNoteId,
    }}
    onOpenAgent={(agentId, event) => {
      const openInAdjacentPanel = event?.metaKey || event?.ctrlKey || false;
      const panelElement = (event?.target as HTMLElement | null)?.closest('[data-panel-id]');
      const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
      appStore.dispatch(
        openAgentTabRequested(workspaceId, { agentId, openInAdjacentPanel, sourcePanelId }),
      );
    }}
    onOpenNote={(noteId, event) => {
      const openInAdjacentPanel = event?.metaKey || event?.ctrlKey || false;
      const panelElement = (event?.target as HTMLElement | null)?.closest('[data-panel-id]');
      const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
      appStore.dispatch(
        openWorkspaceNote(workspaceId, noteId, { openInAdjacentPanel, sourcePanelId }),
      );
    }}
  />
{/key}
