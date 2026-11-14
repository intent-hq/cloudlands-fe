<script lang="ts">
  /** Store host for the Move home dialog (one for the app, like the Transfer wizard). */
  import { writable } from 'svelte/store';
  import { store as appStore } from '$store/renderer/store';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import MoveHomeDialog from './MoveHomeDialog.svelte';
  import { homeMoveTargetKey } from '../workspace-home';
  import { moveHomeFailureText } from '../workspace-home-copy';
  import {
    selectMoveHomeDialog,
    selectMoveHomeOptions,
    selectWorkspaceHomeView,
  } from '../workspace-home-selectors';
  import { moveHomeDialogClosed, moveHomeRequested } from '../workspace-home-slice';

  const dialog$ = selectMoveHomeDialog();
  const workspaceId$ = writable('');
  $effect(() => {
    workspaceId$.set($dialog$.workspaceId ?? '');
  });
  const view$ = selectWorkspaceHomeView(workspaceId$);
  const options$ = selectMoveHomeOptions(workspaceId$);
  const workspace$ = selectWorkspaceById(workspaceId$);

  const view = $derived($view$);
  const currentKey = $derived.by(() => {
    const home = $workspace$?.home;
    if (home?.cloudMachineId)
      return homeMoveTargetKey({ kind: 'cloud', cloudMachineId: home.cloudMachineId });
    return home?.nodeId ? homeMoveTargetKey({ kind: 'machine', nodeId: home.nodeId }) : null;
  });
</script>

{#if $dialog$.workspaceId && view}
  <MoveHomeDialog
    open
    {view}
    options={$options$}
    {currentKey}
    submitting={$dialog$.submitting}
    failureText={$dialog$.moveFailure ? moveHomeFailureText($dialog$.moveFailure) : null}
    onSubmit={(to) => {
      const workspaceId = $dialog$.workspaceId;
      if (workspaceId) appStore.dispatch(moveHomeRequested(workspaceId, to));
    }}
    onCancel={() => appStore.dispatch(moveHomeDialogClosed())}
  />
{/if}
