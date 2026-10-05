<script lang="ts">
  /**
   * PostMergeActions - Post-merge reset and archive options
   * Shown when workspace commits have been merged to trunk.
   */
  import {
    archiveAndStartRequested,
    resetAndContinueRequested,
  } from '$store/renderer/slices/accept-workflow/accept-workflow-slice';
  import { selectAcceptOperationPending } from '$store/renderer/slices/accept-workflow/accept-workflow-selectors';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';

  import { Button } from '$lib/components/ui/button';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { faRotateLeft, faRocket } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { readable, writable } from 'svelte/store';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

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
  const resetting$ = selectAcceptOperationPending(workspaceIdStore, readable('resetAndContinue'));
  const archiving$ = selectAcceptOperationPending(workspaceIdStore, readable('archiveAndStart'));
  const isResettingToTrunk = $derived($resetting$);
</script>

<div class="mt-4 pt-4 border-t border-border ml-4 space-y-3">
  <!-- Reset and continue button - hidden when there are uncommitted changes or unpushed commits -->
  {#if hasNoLocalChanges}
    <div>
      <Button
        variant="outline"
        size="sm"
        class="w-full gap-2"
        onclick={() => appStore.dispatch(resetAndContinueRequested(workspaceId))}
        disabled={isResettingToTrunk}
      >
        {#if isResettingToTrunk}
          <IntentMarkLoader size={14} class="text-ghost" />
          <span>{m.workspace_postMerge_resetting_label()}</span>
        {:else}
          <Fa icon={faRotateLeft} size="sm" class="text-primary-ink" />
          <span>{m.workspace_postMerge_resetAndContinue_label()}</span>
        {/if}
      </Button>
      <p class="mt-2 text-left text-xs text-subtle">
        {m.workspace_postMerge_resetBranchTo_label({ branch: trunkBranch })}
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
        onclick={() => appStore.dispatch(archiveAndStartRequested(workspaceId))}
        disabled={$archiving$}
      >
        <Fa icon={faRocket} size="sm" class="text-primary-ink" />
        <span>{m.workspace_postMerge_archiveStartNew_label()}</span>
      </Button>
      <p class="mt-2 text-left text-xs text-subtle">
        {m.workspace_postMerge_continueFresh_label()}
      </p>
    </div>
  {/if}
</div>
