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
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { fileTrackingStore } from '$features/file-tracking/file-tracking.store.svelte';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import ChatChangesPanel from '$lib/components/chat/ChatChangesPanel.svelte';
  import { Button } from '$lib/components/ui/button';
  import { selectLineWrapping, selectFoldUnchanged, selectDiffSideBySide } from '$lib/store/slices/ui-layout/ui-layout-selectors';
  import { toggleLineWrapping, toggleFoldUnchanged, toggleDiffSideBySide } from '$lib/store/slices/ui-layout/ui-layout-slice';
  import { dispatch } from '$lib/store/redux-dispatch-bridge';
  import Fa from 'svelte-fa';
  import { faTextWidth, faMap, faColumns, faCompressAlt } from '@fortawesome/free-solid-svg-icons';
  import { invoke } from '$lib/electron-bridge';

  const lineWrapping = selectLineWrapping();
  const foldUnchanged = selectFoldUnchanged();
  const diffSideBySide = selectDiffSideBySide();

  let { tab, workspaceId, isActive }: TabTypeComponentProps = $props();

  const headerContext = getPanelHeaderContext();
  const workspace = $derived(workspaceStore.findById(WorkspaceId(workspaceId)));
  const workspacePath = $derived(workspace?.worktreePath || workspace?.repositoryPath || '');

  // Get commit data from tab
  const commitHash = $derived((tab.data?.commitHash as string) || '');
  const commitMessage = $derived((tab.data?.commitMessage as string) || '');
  const allCommits = $derived(fileTrackingStore.commits || []);
  const olderCommits = $derived(fileTrackingStore.olderCommits || []);
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

    invoke<{ success: boolean; data?: any; error?: string }>('git:commit-details', {
      workspaceId: wsId,
      commitHash: hash,
    })
      .then((result) => {
        if (result?.success && result.data) {
          fetchedFileDetails =
            result.data.fileDetails ||
            (result.data.files || []).map((f: string) => ({ path: f, additions: 0, deletions: 0 }));
          fetchedCommitInfo = {
            author: result.data.author,
            authorEmail: result.data.email,
            date: result.data.date,
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
        filePath: filePath.startsWith('/') ? filePath : `${workspacePath}/${filePath}`,
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
  <Button
    variant="ghost-light"
    size="icon-xs"
    onclick={() => {
      changesAllExpanded = !changesAllExpanded;
      if (changesAllExpanded) changesPanelRef?.expandAll();
      else changesPanelRef?.collapseAll();
    }}
    tooltip={changesAllExpanded ? 'Collapse all files' : 'Expand all files'}
    tooltipSide="bottom"
    class={changesAllExpanded ? 'text-foreground' : 'text-muted-foreground'}
  >
    <Fa icon={faCompressAlt} size="xs" class={changesAllExpanded ? '' : 'rotate-180'} />
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
{/snippet}

{#key commitHash}
  <ChatChangesPanel
    bind:this={changesPanelRef}
    isLoading={fileTrackingStore.loading || isFetchingDetails}
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
      window.dispatchEvent(
        new CustomEvent('workspace:open-agent', {
          detail: { agentId, openInAdjacentPanel, sourcePanelId },
        }),
      );
    }}
    onOpenNote={(noteId, event) => {
      const openInAdjacentPanel = event?.metaKey || event?.ctrlKey || false;
      const panelElement = (event?.target as HTMLElement | null)?.closest('[data-panel-id]');
      const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
      window.dispatchEvent(
        new CustomEvent('workspace:open-note', {
          detail: { noteId, openInAdjacentPanel, sourcePanelId },
        }),
      );
    }}
  />
{/key}
