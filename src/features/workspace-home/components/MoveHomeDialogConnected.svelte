<script lang="ts">
  /** The open Move home dialog for one workspace, wired to the store. */
  import { writable } from 'svelte/store';
  import { store as appStore } from '$store/renderer/store';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import MoveHomeDialog from './MoveHomeDialog.svelte';
  import { homeMoveTargetKey } from '../workspace-home';
  import { moveHomeFailureText } from '../workspace-home-copy';
  import {
    selectMoveHomeFailure,
    selectMoveHomeOptions,
    selectMoveHomeSubmitting,
    selectWorkspaceHomeView,
  } from '../workspace-home-selectors';
  import { moveHomeDialogClosed, moveHomeRequested } from '../workspace-home-slice';

  let { workspaceId }: { workspaceId: string } = $props();

  const workspaceId$ = writable('');
  $effect(() => {
    workspaceId$.set(workspaceId);
  });
  const view$ = selectWorkspaceHomeView(workspaceId$);
  const options$ = selectMoveHomeOptions(workspaceId$);
  const workspace$ = selectWorkspaceById(workspaceId$);
  const submitting$ = selectMoveHomeSubmitting();
  const failure$ = selectMoveHomeFailure();

  const view = $derived($view$);
  const home = $derived($workspace$?.home);
  const currentKey = $derived(
    home?.cloudMachineId
      ? homeMoveTargetKey({ kind: 'cloud', cloudMachineId: home.cloudMachineId })
      : home?.nodeId
        ? homeMoveTargetKey({ kind: 'machine', nodeId: home.nodeId })
        : null,
  );
</script>

{#if view}
  <MoveHomeDialog
    open
    {view}
    options={$options$}
    {currentKey}
    currentNodeId={home?.nodeId ?? null}
    submitting={$submitting$}
    failureText={$failure$ ? moveHomeFailureText($failure$) : null}
    onSubmit={(to) => appStore.dispatch(moveHomeRequested(workspaceId, to))}
    onCancel={() => appStore.dispatch(moveHomeDialogClosed())}
  />
{/if}
