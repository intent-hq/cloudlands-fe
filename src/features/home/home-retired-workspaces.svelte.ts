import { untrack } from 'svelte';
import type { Workspace } from '$shared/types';
import { store } from '$store/renderer/store';
import { loadRetiredWorkspacesRequested } from '$store/renderer/slices/workspace-operations/workspace-operations-slice';
import { hasRetiredWorkspaces, shouldReloadRetiredWorkspaces, type HomeFilter } from './home-model';

/**
 * Retired workspaces are absent from the live list (strict `includeRetired`
 * opt-in, PROTOCOL §5.1); only the Home Retired chip fetches them. An ordinary
 * list refresh replaces the store without retired rows, so reload them if that
 * happens while the chip is selected. Call during component initialisation.
 */
export function homeRetiredWorkspaces(input: {
  filter: () => HomeFilter;
  preview: () => boolean;
  workspaces: () => readonly Workspace[];
}): void {
  // Tracks only the filter and preview mode: the list itself changes on every
  // upsert (including this load's own response), which must not re-fetch.
  $effect(() => {
    if (input.filter() !== 'retired' || input.preview()) return;
    untrack(() => store.dispatch(loadRetiredWorkspacesRequested()));
  });
  const loaded = $derived(hasRetiredWorkspaces(input.workspaces()));
  let hadRetired = untrack(() => loaded);
  $effect(() => {
    const now = loaded;
    untrack(() => {
      if (!input.preview() && shouldReloadRetiredWorkspaces(input.filter(), hadRetired, now))
        store.dispatch(loadRetiredWorkspacesRequested());
      hadRetired = now;
    });
  });
}
