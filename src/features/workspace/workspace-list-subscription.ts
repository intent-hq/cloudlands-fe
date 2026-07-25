/**
 * Workspace list subscription — event-driven refresh of the workspace list.
 *
 * Daemon-side workspace mutations (rename via MCP setTitle, create, archive,
 * delete) are published as `workspace:*` events. `appClient.workspaces.subscribe`
 * (LiveWorkspacesClient) already implements snapshot + refetch-on-`workspace:*`
 * via `createDeltaSubscription`, so this module only routes each emitted
 * snapshot into the store: `replaceWorkspaceList` swaps the list wholesale and
 * `setWorkspaceHasLoaded(true)` keeps the loaded flag consistent with the
 * seeder's boot hydration.
 *
 * The `replaceWorkspaceList` reducer only replaces the visible list, so a
 * refetch never clobbers the user's selection. Refetch storms are already
 * coalesced by the delta-subscription layer. The one exception to "don't touch
 * tab state": when the workspace currently on screen disappears from a snapshot
 * (deleted by another client — the snapshot includes archived workspaces, so
 * archiving never trips this), `navigateAwayIfViewing` closes its tab and
 * routes to the next tab or home, matching the user-initiated delete UX.
 * Initial hydration (no previous snapshot) never triggers it.
 *
 * Mirrors `src/features/git/git-status-subscription.ts` and is mounted/disposed
 * alongside it in `src/routes/+layout.svelte`. Dependency-light per
 * src/store/renderer/AGENTS.md: imports the AppClient seam, the configured
 * store, and slice actions only (no selectors).
 */
import { appClient } from "$lib/client";
import type { Unsubscribe } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import {
  replaceWorkspaceList,
  setWorkspaceHasLoaded,
} from "$store/renderer/slices/workspace/workspace-slice";
import { navigateAwayIfViewing } from "./navigate-away-if-viewing";

/**
 * Start consuming daemon workspace-change notifications and converge the store
 * to each emitted snapshot. Returns an unsubscribe to call on teardown.
 */
export function startWorkspaceListSubscription(): Unsubscribe {
  let previousIds: Set<string> | null = null;
  return appClient.workspaces.subscribe((workspaces) => {
    appStore.dispatch(replaceWorkspaceList(workspaces));
    appStore.dispatch(setWorkspaceHasLoaded(true));

    const currentIds = new Set<string>(workspaces.map((workspace) => String(workspace.id)));
    if (previousIds !== null) {
      for (const id of previousIds) {
        if (!currentIds.has(id)) void navigateAwayIfViewing(id);
      }
    }
    previousIds = currentIds;
  });
}
