<script lang="ts">
  /**
   * Covers `children` with the home's reason while the workspace's home is
   * detached or moving: file, diff and terminal views would only fail with
   * `home-unavailable`. The panel stays mounted (inert, under the notice), so
   * an unsaved edit or a terminal buffer survives until the home is back.
   * Renders `children` unchanged without a home.
   *
   * While a cloud home starts, the notice is a calm "Starting home…". A panel
   * that opened while the home was unavailable remounts once when it is
   * attached, so its failed reads run again (`nextHomeRetry`); a panel that
   * was already usable is never remounted.
   */
  import { untrack, type Snippet } from 'svelte';
  import { writable } from 'svelte/store';
  import { store as appStore } from '$store/renderer/store';
  import WorkspaceHomePanelNotice from './WorkspaceHomePanelNotice.svelte';
  import { initialHomeRetry, nextHomeRetry } from '../workspace-home';
  import {
    selectCanMoveWorkspaceHome,
    selectHomeWaiting,
    selectWorkspaceHomeView,
  } from '../workspace-home-selectors';
  import { homeWaitRequested, moveHomeDialogOpened } from '../workspace-home-slice';

  let { workspaceId, children }: { workspaceId: string; children: Snippet } = $props();

  // Seeded with the id so the first view read is this workspace's, not empty.
  const workspaceId$ = writable(untrack(() => workspaceId));
  $effect(() => {
    workspaceId$.set(workspaceId);
  });
  const view$ = selectWorkspaceHomeView(workspaceId$);
  const canMove$ = selectCanMoveWorkspaceHome(workspaceId$);
  const waiting$ = selectHomeWaiting(workspaceId$);
  const view = $derived($view$);
  // Ephemeral panel state: which mount generation the children use.
  let retry = $state(initialHomeRetry);
  $effect.pre(() => {
    const unavailable = view?.unavailable === true;
    retry = nextHomeRetry(
      untrack(() => retry),
      unavailable,
    );
  });
</script>

<!-- Both wrappers keep the flex column the panel content renderer gives its tab. -->
<div class="relative flex h-full min-h-0 w-full flex-col" data-workspace-home-panel-gate>
  <div class="flex min-h-0 w-full flex-1 flex-col" inert={view?.unavailable ? true : undefined}>
    {#key retry.generation}
      {@render children()}
    {/key}
  </div>
  {#if view?.unavailable}
    <!-- Clipped to the panel: a short panel never spills the notice onto its neighbours. -->
    <div class="absolute inset-0 z-10 overflow-hidden bg-background">
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
