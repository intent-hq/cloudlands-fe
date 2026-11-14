<script lang="ts">
  /**
   * Shows the home's reason instead of `children` while the workspace's home
   * is detached or moving: file, diff and terminal views would only fail with
   * `home-unavailable`. Renders `children` unchanged without a home.
   */
  import type { Snippet } from 'svelte';
  import { writable } from 'svelte/store';
  import { store as appStore } from '$store/renderer/store';
  import WorkspaceHomePanelNotice from './WorkspaceHomePanelNotice.svelte';
  import {
    selectCanMoveWorkspaceHome,
    selectHomeWaiting,
    selectWorkspaceHomeView,
  } from '../workspace-home-selectors';
  import { homeWaitRequested, moveHomeDialogOpened } from '../workspace-home-slice';

  let { workspaceId, children }: { workspaceId: string; children: Snippet } = $props();

  const workspaceId$ = writable('');
  $effect(() => {
    workspaceId$.set(workspaceId);
  });
  const view$ = selectWorkspaceHomeView(workspaceId$);
  const canMove$ = selectCanMoveWorkspaceHome(workspaceId$);
  const waiting$ = selectHomeWaiting(workspaceId$);
  const view = $derived($view$);
</script>

{#if view?.unavailable}
  <WorkspaceHomePanelNotice
    {view}
    canMove={$canMove$}
    waiting={$waiting$}
    onWait={() => appStore.dispatch(homeWaitRequested(workspaceId))}
    onMove={() => appStore.dispatch(moveHomeDialogOpened(workspaceId))}
  />
{:else}
  {@render children()}
{/if}
