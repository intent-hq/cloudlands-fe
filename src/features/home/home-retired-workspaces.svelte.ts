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
export function homeRetiredWorkspaces(
  state: () => { filter: HomeFilter; workspaces: readonly Workspace[]; preview: boolean },
): void {
  $effect(() => {
    const { filter, preview } = state();
    if (filter !== 'retired' || preview) return;
    untrack(() => store.dispatch(loadRetiredWorkspacesRequested()));
  });
  const loaded = $derived(hasRetiredWorkspaces(state().workspaces));
  let hadRetired = untrack(() => loaded);
  $effect(() => {
    const now = loaded;
    untrack(() => {
      const { filter, preview } = state();
      if (!preview && shouldReloadRetiredWorkspaces(filter, hadRetired, now))
        store.dispatch(loadRetiredWorkspacesRequested());
      hadRetired = now;
    });
  });
}
