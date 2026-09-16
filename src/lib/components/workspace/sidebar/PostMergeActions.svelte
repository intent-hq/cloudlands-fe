<script lang="ts">
  /**
   * PostMergeActions - Post-merge reset and archive options
   * Shown when workspace commits have been merged to trunk.
   */
  import type { AcceptChangesResult } from '$features/accept-changes/types';

  import {
    loadGitStatus,
    setPostMergeState,
    executeAcceptChangesRequested,
  } from '$store/renderer/slices/git/git-slice';
  import {
    refreshAcceptChangesStatus,
    clearOlderCommits as ftClearOlderCommits,
    refreshRequested,
  } from '$store/renderer/slices/changes/changes-slice';
  import {
    selectPostMergeState,
    selectGitOperationFlags,
    selectGitMutationRequest,
  } from '$store/renderer/slices/git/git-selectors';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
    unarchiveWorkspaceRequested,
    updateWorkspaceRequested,
  } from '$store/renderer/slices/workspace/workspace-slice';

  import { Button } from '$lib/components/ui/button';
  import { toast } from '$lib/components/ui/toast';
  import type { PostMergeState } from '$store/renderer/slices/git/git-types';
  import { faRotateLeft, faRocket, faSpinner } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { readable, writable } from 'svelte/store';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';
  import { startPostMergeWorkspaceRequested } from '$store/renderer/slices/workspace-operations/workspace-operations-slice';

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
  const resetRequest$ = selectGitMutationRequest(
    workspaceIdStore,
    readable('accept-changes'),
    readable('reset-to-trunk'),
  );
  const isResettingToTrunk = $derived(
    $gitOps$.isResettingToTrunk || ($resetRequest$?.loading ?? false),
  );
  let handledResetVersion = 0;

  /** Dispatch a partial update to post-merge state, merging with current Redux state */
  function dispatchPostMergeUpdate(fields: Partial<PostMergeState>) {
    const current = selectPostMergeState.select(appStore.state, workspaceId);
    appStore.dispatch(setPostMergeState(workspaceId, { ...current, ...fields }));
  }

  // Start new workspace with same repo after merge, archiving the current one
  function handleStartNewSpace() {
    const repo = $workspace?.repositoryPath;
    const worktree = $workspace?.worktreePath;
    const currentWorkspaceId = $workspace?.id;

    if (currentWorkspaceId) {
      appStore.dispatch(startPostMergeWorkspaceRequested(currentWorkspaceId, repo, worktree));
    }
  }

  // Reset workspace branch to trunk HEAD and continue working
  function handleResetAndContinue() {
    if (!workspaceId || !$workspace) return;
    appStore.dispatch(executeAcceptChangesRequested(workspaceId, 'reset-to-trunk'));
  }

  $effect(() => {
    const request = $resetRequest$;
    if (!request || request.loading || request.version <= handledResetVersion) return;
    handledResetVersion = request.version;
    const result = request.data as AcceptChangesResult | null;
    if (request.error || !result?.success || !result.result?.newHeadSha) {
      toast.error(request.error || result?.error || m.workspace_postMerge_resetFailed_error());
      return;
    }
    appStore.dispatch(
      updateWorkspaceRequested(
        workspaceId,
        { baseCommitSha: result.result.newHeadSha },
        'base-commit',
      ),
    );
    appStore.dispatch(ftClearOlderCommits(workspaceId));
    appStore.dispatch(loadGitStatus(workspaceId, true));
    appStore.dispatch(refreshRequested(workspaceId, true));
    appStore.dispatch(refreshAcceptChangesStatus(workspaceId));
    dispatchPostMergeUpdate({
      isMergedToTrunk: false,
      mergeHeadSha: null,
      isContentMergedToTrunk: false,
      hasResetToTrunk: true,
    });
    toast.success(m.workspace_postMerge_resetSuccess_label());
    if ($workspace?.archived) appStore.dispatch(unarchiveWorkspaceRequested($workspace.id));
  });
</script>

<div class="mt-4 pt-4 border-t border-border ml-4 space-y-3">
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
          <span>{m.workspace_postMerge_resetting_label()}</span>
        {:else}
          <Fa icon={faRotateLeft} size="sm" class="text-primary" />
          <span>{m.workspace_postMerge_resetAndContinue_label()}</span>
        {/if}
      </Button>
      <p class="text-xs text-subtle text-center mt-2">
        {m.workspace_postMerge_resetBranchTo_label({ branch: trunkBranch })}
      </p>
    </div>
  {/if}
  {#if hasNoLocalChanges && !$workspace?.archived}
    <!-- Archive and start new space button -->
    <div>
      <Button variant="outline" size="sm" class="w-full gap-2" onclick={handleStartNewSpace}>
        <Fa icon={faRocket} size="sm" class="text-primary" />
        <span>{m.workspace_postMerge_archiveStartNew_label()}</span>
      </Button>
      <p class="text-xs text-subtle text-center mt-2">
        {m.workspace_postMerge_continueFresh_label()}
      </p>
    </div>
  {/if}
</div>
