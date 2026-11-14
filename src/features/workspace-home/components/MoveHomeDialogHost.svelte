<script lang="ts">
  /**
   * Store host for the Move home dialog. Each workspace surface mounts one
   * (inside its banner host) and shows the dialog only for its own workspace,
   * so retained surfaces never open duplicates.
   */
  import { writable } from 'svelte/store';
  import { store as appStore } from '$store/renderer/store';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import MoveHomeDialog from './MoveHomeDialog.svelte';
  import { homeMoveTargetKey } from '../workspace-home';
  import { moveHomeFailureText } from '../workspace-home-copy';
  import {
    selectMoveHomeDialogWorkspaceId,
    selectMoveHomeFailure,
    selectMoveHomeOptions,
    selectMoveHomeSubmitting,
    selectWorkspaceHomeView,
  } from '../workspace-home-selectors';
  import { moveHomeDialogClosed, moveHomeRequested } from '../workspace-home-slice';

  let { workspaceId }: { workspaceId: string } = $props();

  const dialogWorkspaceId$ = selectMoveHomeDialogWorkspaceId();
  const submitting$ = selectMoveHomeSubmitting();
  const failure$ = selectMoveHomeFailure();
  const workspaceId$ = writable('');
  $effect(() => {
    workspaceId$.set($dialogWorkspaceId$ ?? '');
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

{#if $dialogWorkspaceId$ && $dialogWorkspaceId$ === workspaceId && view}
  <MoveHomeDialog
    open
    {view}
    options={$options$}
    {currentKey}
    submitting={$submitting$}
    failureText={$failure$ ? moveHomeFailureText($failure$) : null}
    onSubmit={(to) => {
      const workspaceId = $dialogWorkspaceId$;
      if (workspaceId) appStore.dispatch(moveHomeRequested(workspaceId, to));
    }}
    onCancel={() => appStore.dispatch(moveHomeDialogClosed())}
  />
{/if}
