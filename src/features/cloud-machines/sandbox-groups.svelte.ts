import { SvelteSet } from 'svelte/reactivity';

/** Collapsed workspace groups in the sandbox lists; kept for the session only. */
export const collapsedSandboxGroups = new SvelteSet<string>();

/** One group of one entry's list: an entry name and a workspace id ("" for Other). */
export function sandboxGroupId(entryName: string | undefined, workspaceKey: string): string {
  return `${entryName ?? ''}\u0000${workspaceKey}`;
}
