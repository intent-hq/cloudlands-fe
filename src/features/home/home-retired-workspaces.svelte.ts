import { fromStore, type Readable } from 'svelte/store';
import type { Workspace } from '$shared/types';
import { retiredWorkspacesOptIn } from '$lib/utils/retired-workspaces-opt-in.svelte';
import type { HomeFilter } from './home-model';

/**
 * The Home Archived chip is the only Home path that opts in to retired rows
 * (archived workspaces whose folder was purged, PROTOCOL §5.1). It
 * re-reads when the principal admission (connection) changes while the chip
 * stays selected, so a read that failed or was discarded across a reconnect
 * recovers without reselecting the chip. Call during component initialisation.
 */
export function homeRetiredWorkspaces(
  view: () => { filter: HomeFilter; preview: boolean },
  workspaces$: Readable<readonly Workspace[]>,
  admission$: Readable<unknown>,
): void {
  const workspaces = fromStore(workspaces$);
  const admission = fromStore(admission$);
  retiredWorkspacesOptIn({
    active: () => {
      const { filter, preview } = view();
      return filter === 'archived' && !preview;
    },
    workspaces: () => workspaces.current,
    key: () => admission.current,
  });
}
