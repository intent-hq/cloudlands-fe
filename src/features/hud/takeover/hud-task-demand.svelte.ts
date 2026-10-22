import { onMount, untrack } from 'svelte';
import { on } from 'svelte/events';
import { store } from '$store/renderer/store';
import {
  acquireWorkspaceTasksDemand,
  releaseWorkspaceTasksDemand,
} from '$store/renderer/slices/workspace-tasks/workspace-tasks-slice';

/** Track a displayed map inside the HUD window, which can remain mounted while hidden. */
export function trackHudTaskDemand(displayedWorkspaceId: () => string | undefined): void {
  let documentVisible = $state(false);
  onMount(() => {
    const updateVisibility = () => {
      documentVisible = document.visibilityState === 'visible';
    };
    updateVisibility();
    return on(document, 'visibilitychange', updateVisibility);
  });

  const workspaceId = $derived(documentVisible ? displayedWorkspaceId() : undefined);
  $effect(() => {
    const id = workspaceId;
    if (!id) return;
    const demandId = crypto.randomUUID();
    untrack(() => store.dispatch(acquireWorkspaceTasksDemand(id, demandId)));
    return () => store.dispatch(releaseWorkspaceTasksDemand(id, demandId));
  });
}
