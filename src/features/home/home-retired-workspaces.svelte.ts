import type { Workspace } from '$shared/types';
import { retiredWorkspacesOptIn } from '$lib/utils/retired-workspaces-opt-in.svelte';
import type { HomeFilter } from './home-model';

/** The Home Retired chip is the only Home path that opts in to retired rows. */
export function homeRetiredWorkspaces(input: {
  filter: () => HomeFilter;
  preview: () => boolean;
  workspaces: () => readonly Workspace[];
}): void {
  retiredWorkspacesOptIn({
    active: () => input.filter() === 'retired' && !input.preview(),
    workspaces: input.workspaces,
  });
}
