<script lang="ts">
  /**
   * Covers `children` with the home's reason while the workspace's home is
   * detached or moving: file, diff and terminal views would only fail with
   * `home-unavailable`. The panel stays mounted (inert, under the notice), so
   * an unsaved edit or a terminal buffer survives until the home is back.
   * Renders `children` unchanged without a home.
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

<!-- Both wrappers keep the flex column the panel content renderer gives its tab. -->
<div class="relative flex h-full min-h-0 w-full flex-col" data-workspace-home-panel-gate>
  <div class="flex min-h-0 w-full flex-1 flex-col" inert={view?.unavailable ? true : undefined}>
    {@render children()}
  </div>
  {#if view?.unavailable}
    <div class="absolute inset-0 z-10 bg-background">
      <WorkspaceHomePanelNotice
        {view}
        canMove={$canMove$}
        waiting={$waiting$}
        onWait={() => appStore.dispatch(homeWaitRequested(workspaceId))}
        onMove={() => appStore.dispatch(moveHomeDialogOpened(workspaceId))}
      />
    </div>
  {/if}
</div>
