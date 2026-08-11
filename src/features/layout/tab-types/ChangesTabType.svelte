<script lang="ts">
  /**
   * Changes Tab Type Component
   *
   * Shows a commit changeset with all files in the commit.
   * Includes header actions for expand/collapse and view controls.
   */

  import { untrack } from 'svelte';
  import type { TabTypeComponentProps } from './registry';
  import { getPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import {
    selectFileTrackingCommits,
    selectFileTrackingOlderCommits,
    selectFileTrackingLoading,
  } from '$store/renderer/slices/changes/changes-selectors';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
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
  import { appClient } from '$lib/client';
  import { isAbsolutePath } from '$lib/utils/path-utils';
  import { store as appStore } from '$store/renderer/store';

  const lineWrapping = selectLineWrapping();
  const foldUnchanged = selectFoldUnchanged();
  const diffSideBySide = selectDiffSideBySide();
  let { tab, workspaceId, isActive }: TabTypeComponentProps = $props();

  const headerContext = getPanelHeaderContext();
  // svelte-ignore state_referenced_locally
  const workspace = selectWorkspaceById(workspaceId);
  const workspacePath = $derived($workspace?.worktreePath || $workspace?.repositoryPath || '');

  // Get commit data from tab
  const commitHash = $derived((tab.data?.commitHash as string) || '');
  const commitMessage = $derived((tab.data?.commitMessage as string) || '');
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

  // Fetched commit details for commits not in the store (or with empty files like older commits)
  let fetchedFileDetails = $state<Array<{ path: string; additions: number; deletions: number }>>(
    [],
  );
  let fetchedCommitInfo = $state<{ author?: string; authorEmail?: string; date?: string } | null>(
    null,
  );
  let isFetchingDetails = $state(false);
  let fetchedForHash = $state('');

  // Fetch commit details when store doesn't have file info
  $effect(() => {
    const hash = commitHash;
    const storeFiles = storeCommitFiles;
    const wsId = workspaceId;

    if (!hash || !wsId) return;
    // If store already has files for this commit, no need to fetch
    if (storeFiles.length > 0) return;
    // Don't re-fetch for the same hash
    if (untrack(() => fetchedForHash) === hash) return;

    untrack(() => {
      isFetchingDetails = true;
      fetchedForHash = hash;
    });

    // Daemon-backed read (PROTOCOL §5.6): `appClient.git.commitDetails`
    // folds transport/gate errors to `null` and the daemon degrades non-repo /
    // remote / unknown-hash workspaces to an empty envelope, so this $effect
    // never throws into the renderer.
    appClient.git
      .commitDetails(wsId, hash)
      .then((result) => {
        if (result) {
          fetchedFileDetails =
            result.fileDetails.length > 0
              ? result.fileDetails
              : result.files.map((f) => ({ path: f, additions: 0, deletions: 0 }));
          fetchedCommitInfo = {
            author: result.author || undefined,
            authorEmail: result.authorEmail || undefined,
            date: result.date || undefined,
          };
        }
        isFetchingDetails = false;
      })
      .catch(() => {
        isFetchingDetails = false;
      });
  });

  // Use store files if available, otherwise use fetched details
  const commitFiles = $derived(storeCommitFiles.length > 0 ? storeCommitFiles : fetchedFileDetails);

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
    headerContext.registerActions(changesActions);
  });
</script>

{#snippet changesActions()}
  <ViewSettingsDropdown
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
