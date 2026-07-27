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
  import { Button } from '$lib/components/ui/button';
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
  import Fa from 'svelte-fa';
  import {
  faTextWidth,
  faMap,
  faColumns,
  faCompressAlt,
} from '@fortawesome/free-solid-svg-icons';
  import { appClient } from '$lib/client';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';

  const lineWrapping = selectLineWrapping();
  const foldUnchanged = selectFoldUnchanged();
  const diffSideBySide = selectDiffSideBySide();
  const headerToggleActiveClass =
    'text-foreground bg-sidebar hover:text-foreground hover:bg-sidebar';
  const headerToggleInactiveClass = 'text-subtle';

  let { tab, workspaceId, isActive }: TabTypeComponentProps = $props();

  const headerContext = getPanelHeaderContext();
  const workspace = selectWorkspaceById(workspaceId);
  const workspacePath = $derived($workspace?.worktreePath || $workspace?.repositoryPath || '');

  // Get commit data from tab
  const commitHash = $derived((tab.data?.commitHash as string) || '');
  const commitMessage = $derived((tab.data?.commitMessage as string) || '');
  const ftCommits$ = selectFileTrackingCommits(workspaceId);
  const ftOlderCommits$ = selectFileTrackingOlderCommits(workspaceId);
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
          fetchedFileDetails = result.fileDetails.length > 0
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
    tooltip={changesAllExpanded
      ? m.layout_diffHeader_collapseAllFiles_tooltip()
      : m.layout_diffHeader_expandAllFiles_tooltip()}
    tooltipSide="bottom"
    aria-pressed={changesAllExpanded}
    class={changesAllExpanded ? headerToggleActiveClass : headerToggleInactiveClass}
  >
    <Fa icon={faCompressAlt} size="xs" class={changesAllExpanded ? '' : 'rotate-180'} />
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
  <Button
    variant="ghost-light"
    size="icon-xs"
    onclick={() => appStore.dispatch(toggleFoldUnchanged())}
    tooltip={$foldUnchanged
      ? m.layout_diffHeader_foldingOn_tooltip()
      : m.layout_diffHeader_foldLines_tooltip()}
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
    tooltip={$diffSideBySide
      ? m.layout_diffHeader_unifiedView_tooltip()
      : m.layout_diffHeader_splitView_tooltip()}
    tooltipSide="bottom"
    aria-pressed={$diffSideBySide}
    class={$diffSideBySide ? headerToggleActiveClass : headerToggleInactiveClass}
  >
    <Fa icon={faColumns} size="xs" />
  </Button>
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
      appStore.dispatch(openAgentTabRequested(workspaceId, { agentId, openInAdjacentPanel, sourcePanelId }));
    }}
    onOpenNote={(noteId, event) => {
      const openInAdjacentPanel = event?.metaKey || event?.ctrlKey || false;
      const panelElement = (event?.target as HTMLElement | null)?.closest('[data-panel-id]');
      const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
      appStore.dispatch(openWorkspaceNote(workspaceId, noteId, { openInAdjacentPanel, sourcePanelId }));
    }}
  />
{/key}
