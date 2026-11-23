import { SvelteSet } from 'svelte/reactivity';

/** Collapsed workspace groups in the sandbox lists; kept for the session only. */
export const collapsedSandboxGroups = new SvelteSet<string>();

/** Cloud entries whose sandbox list is open; lists start collapsed, for the session only. */
export const expandedSandboxLists = new SvelteSet<string>();

/** One group of one entry's list: an entry name and a workspace id ("" for Other). */
export function sandboxGroupId(entryName: string | undefined, workspaceKey: string): string {
  return `${entryName ?? ''}\u0000${workspaceKey}`;
}
