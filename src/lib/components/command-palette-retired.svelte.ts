import { fromStore, type Readable } from 'svelte/store';
import type { Workspace } from '$shared/types';
import { retiredWorkspacesOptIn } from '$lib/utils/retired-workspaces-opt-in.svelte';

/**
 * Search opts in to retired workspaces for as long as the palette is open,
 * re-reading when the principal admission (connection) changes and after an
 * ordinary list refresh drops them. Call during component initialisation.
 */
export function paletteRetiredWorkspaces(
  isOpen: () => boolean,
  workspaces$: Readable<readonly Workspace[]>,
  admission$: Readable<unknown>,
): void {
  const workspaces = fromStore(workspaces$);
  const admission = fromStore(admission$);
  retiredWorkspacesOptIn({
    active: isOpen,
    workspaces: () => workspaces.current,
    quiet: true,
    key: () => admission.current,
  });
}
