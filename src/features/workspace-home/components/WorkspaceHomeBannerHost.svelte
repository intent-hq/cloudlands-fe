<script lang="ts">
  /**
   * Store host for {@link WorkspaceHomeBanner} and this workspace's Move home
   * dialog; renders nothing without a home.
   */
  import { writable } from 'svelte/store';
  import { store as appStore } from '$store/renderer/store';
  import WorkspaceHomeBanner from './WorkspaceHomeBanner.svelte';
  import MoveHomeDialogHost from './MoveHomeDialogHost.svelte';
  import {
    selectCanMoveWorkspaceHome,
    selectHomeWaiting,
    selectWorkspaceHomeView,
  } from '../workspace-home-selectors';
  import { homeWaitRequested, moveHomeDialogOpened } from '../workspace-home-slice';

  let { workspaceId }: { workspaceId: string } = $props();

  const workspaceId$ = writable('');
  $effect(() => {
    workspaceId$.set(workspaceId);
  });
  const view$ = selectWorkspaceHomeView(workspaceId$);
  const canMove$ = selectCanMoveWorkspaceHome(workspaceId$);
  const waiting$ = selectHomeWaiting(workspaceId$);
</script>

<WorkspaceHomeBanner
  view={$view$}
  canMove={$canMove$}
  waiting={$waiting$}
  onWait={() => appStore.dispatch(homeWaitRequested(workspaceId))}
  onMove={() => appStore.dispatch(moveHomeDialogOpened(workspaceId))}
/>
<MoveHomeDialogHost {workspaceId} />
