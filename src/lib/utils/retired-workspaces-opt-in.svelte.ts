import { untrack } from 'svelte';
import { WorkspaceStatusEnum, type Workspace } from '$shared/types';
import { store } from '$store/renderer/store';
import { loadRetiredWorkspacesRequested } from '$store/renderer/slices/workspace-operations/workspace-operations-slice';

/**
 * Retired workspaces are absent from the live list (strict `includeRetired`
 * opt-in, PROTOCOL §5.1). A surface that shows them (the Home Retired chip,
 * search) opts in while `active`: it loads them when it becomes active or the
 * connection `key` changes, and reloads them when an ordinary list refresh
 * drops them while it stays active. Call during component initialisation.
 */
export function retiredWorkspacesOptIn(input: {
  active: () => boolean;
  workspaces: () => readonly Workspace[];
  key?: () => unknown;
  quiet?: boolean;
}): void {
  const load = () => store.dispatch(loadRetiredWorkspacesRequested({ quiet: input.quiet }));
  // Tracks only `active` and `key`: the list changes on every upsert,
  // including this load's own response, which must not re-fetch.
  $effect(() => {
    input.key?.();
    if (input.active()) untrack(load);
  });
  const loaded = $derived(
    input.workspaces().some((workspace) => workspace.status === WorkspaceStatusEnum.Retired),
  );
  let hadRetired = untrack(() => loaded);
  $effect(() => {
    const now = loaded;
    untrack(() => {
      if (hadRetired && !now && input.active()) load();
      hadRetired = now;
    });
  });
}
