<script lang="ts">
  /**
   * PostMergeActions - Post-merge reset and archive options
   * Shown when workspace commits have been merged to trunk.
   */
  import { AcceptChangesClient } from '$features/accept-changes/accept-changes.client';
  import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';

  import {
  setPostMergeState,
  setGitOperationFlag,
  loadGitStatus,
} from '$store/renderer/slices/git/git-slice';
  import {
  refreshAcceptChangesStatus,
  clearOlderCommits as ftClearOlderCommits,
  refreshRequested,
} from '$store/renderer/slices/changes/changes-slice';
  import {
  selectPostMergeState,
  selectGitOperationFlags,
} from '$store/renderer/slices/git/git-selectors';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
  loadWorkspacesRequested,
  setWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';



  import { Button } from '$lib/components/ui/button';
  import { toast } from '$lib/components/ui/toast';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import type { PostMergeState } from '$store/renderer/slices/git/git-types';
  import {
  faRotateLeft,
  faRocket,
  faSpinner,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { writable } from 'svelte/store';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    workspaceId: string;
    hasNoLocalChanges: boolean;
    trunkBranch: string;
  }

  let { workspaceId, hasNoLocalChanges, trunkBranch }: Props = $props();


  const workspaceIdStore = writable('');
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });

  const workspace = selectWorkspaceById(workspaceIdStore);
  const gitOps$ = selectGitOperationFlags(workspaceIdStore);
  const isResettingToTrunk = $derived($gitOps$.isResettingToTrunk);

  async function persistWorkspaceChanges(changes: Record<string, unknown>) {
    const result = await workspaceClient.update({ id: workspaceId as WorkspaceId, ...changes });
    if (result.ok) {
      appStore.dispatch(setWorkspaceEntity(result.data));
    }
    return result;
  }

  /** Dispatch a partial update to post-merge state, merging with current Redux state */
  function dispatchPostMergeUpdate(fields: Partial<PostMergeState>) {
    const current = selectPostMergeState.select(appStore.state, workspaceId);
    appStore.dispatch(setPostMergeState(workspaceId, { ...current, ...fields }));
  }

  // Start new workspace with same repo after merge, archiving the current one
  async function handleStartNewSpace() {
    const repo = $workspace?.repositoryPath;
    const currentWorkspaceId = $workspace?.id;

    // Archive the current workspace first
    if (currentWorkspaceId) {
      const archiveResult = await workspaceClient.archive(currentWorkspaceId);
      if (!archiveResult.ok) {
        toast.error('Failed to archive workspace');
        return;
      }
      appStore.dispatch(loadWorkspacesRequested());
    }

    // Pre-fill the create form with the current repo info via sessionStorage
    if (repo) {
      sessionStorage.setItem('workspace-prefill', JSON.stringify({ repoPath: repo }));
    }

    // Open the create workspace modal
    const { setShowCreateModal } = await import('$store/renderer/slices/sidebar-nav/sidebar-nav-slice');
    appStore.dispatch(setShowCreateModal(true));
  }

  // Reset workspace branch to trunk HEAD and continue working
  async function handleResetAndContinue() {
    if (!workspaceId || !$workspace) return;

    const capturedWsId = workspaceId;
    appStore.dispatch(setGitOperationFlag(workspaceId, 'isResettingToTrunk', true));
    try {
      const result = await AcceptChangesClient.resetToTrunk(workspaceId as WorkspaceId);

      // If workspace changed during the async call, discard stale updates
      if (workspaceId !== capturedWsId) return;

      if (result.success && result.result?.newHeadSha) {
        // Reset succeeded - now try UI follow-up (non-fatal)
        try {
          // Update baseCommitSha - this is the critical step that "resets" the sidebar boundary
          await persistWorkspaceChanges({ baseCommitSha: result.result.newHeadSha });

          // Clear older commits pagination cache which may reference commits from old history
          appStore.dispatch(ftClearOlderCommits(workspaceId));

          // Refresh all stores in parallel
          await Promise.all([
            Promise.resolve(appStore.dispatch(loadGitStatus(workspaceId, true))),
            appStore.dispatch(refreshRequested(workspaceId, true)),
          ]);

          // Also refresh aheadOfTrunk and isContentMergedToTrunk to ensure button hides itself
          appStore.dispatch(refreshAcceptChangesStatus(workspaceId));

          // Clear merge flags
          dispatchPostMergeUpdate({
            isMergedToTrunk: false,
            mergeHeadSha: null,
            isContentMergedToTrunk: false,
            hasResetToTrunk: true,
          });

          toast.success('Workspace reset — ready for new changes');
        } catch (uiError) {
          console.error('Failed to refresh UI after workspace reset:', uiError);
          dispatchPostMergeUpdate({
            isMergedToTrunk: false,
            mergeHeadSha: null,
            isContentMergedToTrunk: false,
            hasResetToTrunk: true,
          });
          toast.success('Workspace reset successful. Reload to see updated state.');
        }

        // If workspace was archived, unarchive it so the user can continue working
        // Fire-and-forget: don't block the reset UX for a best-effort unarchive
        if ($workspace.archived) {
          workspaceClient.unarchive($workspace.id).then((unarchiveResult) => {
            if (!unarchiveResult.ok) {
              console.error('Failed to unarchive workspace after reset:', unarchiveResult.error);
            } else {
              appStore.dispatch(loadWorkspacesRequested());
            }
          });
        }
      } else {
        toast.error(result.error || 'Failed to reset workspace');
      }
    } catch {
      toast.error('Failed to reset workspace');
    } finally {
      appStore.dispatch(setGitOperationFlag(workspaceId, 'isResettingToTrunk', false));
    }
  }
</script>

<div class="mt-4 pt-4 border-t border-border/50 ml-4 space-y-3">
  <!-- Reset and continue button - hidden when there are uncommitted changes or unpushed commits -->
  {#if hasNoLocalChanges}
    <div>
      <Button
        variant="outline"
        size="sm"
        class="w-full gap-2"
        onclick={handleResetAndContinue}
        disabled={isResettingToTrunk}
      >
        {#if isResettingToTrunk}
          <Fa icon={faSpinner} size="sm" class="animate-spin text-ghost" />
          <span>Resetting...</span>
        {:else}
          <Fa icon={faRotateLeft} size="sm" class="text-primary" />
          <span>Reset and continue working</span>
        {/if}
      </Button>
      <p class="text-xs text-subtle text-center mt-2">
        Reset branch to {trunkBranch} and keep working
      </p>
    </div>
  {/if}
  {#if hasNoLocalChanges && !$workspace?.archived}
    <!-- Archive and start new space button -->
    <div>
      <Button
        variant="outline"
        size="sm"
        class="w-full gap-2"
        onclick={handleStartNewSpace}
      >
        <Fa icon={faRocket} size="sm" class="text-primary" />
        <span>Archive and start new space</span>
      </Button>
      <p class="text-xs text-subtle text-center mt-2">
        Continue working on this repo in a fresh workspace
      </p>
    </div>
  {/if}
</div>
