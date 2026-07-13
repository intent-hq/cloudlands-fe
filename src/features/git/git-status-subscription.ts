/**
 * Git status subscription — event-driven half of the git-status refresh restore.
 *
 * External/out-of-app git changes (other tools, the git-watcher, agent commits)
 * must auto-refresh the display. The daemon publishes those as `git:*` /
 * `changes:git-status` notifications. The sanctioned seam channel for them is
 * `appClient.git.subscribe`: in live mode `LiveGitClient.subscribe` is the ONLY
 * client wired to the real daemon git events (the generic `events` firehose is
 * still delegated to the mock per the R1 coexistence note, so it would never
 * deliver real daemon git changes in production). We therefore use
 * `git.subscribe` purely as the daemon's "git changed" SIGNAL and route through
 * the Part A path by dispatching `loadGitStatus` for the active workspace.
 *
 * Why re-dispatch `loadGitStatus` instead of using the status the subscription
 * already carries: the daemon notification is not workspace-scoped (the live
 * client snapshots `listWorkspaceIds()[0]`), so its payload can be for the wrong
 * workspace. Dispatching `loadGitStatus(activeWorkspaceId)` keeps a SINGLE
 * refresh mechanism (Part A) that targets the visible workspace correctly. The
 * subscribe's own snapshot fetch is redundant in live mode but harmless and
 * read-only; it never happens in the mocked-seam tests.
 *
 * No refresh loop: the refresh issues `git.status` (a read), which does not emit
 * git events, so the subscription can never re-trigger itself. Coalescing in
 * `refreshGitStatus` keeps this from thrashing with the write-service reconcile.
 *
 * READ-ONLY: never invokes a git mutation.
 */
import { appClient } from "$lib/client";
import type { Unsubscribe } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import { loadGitStatus } from "$store/renderer/slices/git/git-slice";
import { selectActiveWorkspaceId } from "$store/renderer/slices/workspace/workspace-selectors";

/**
 * Start consuming daemon git-change notifications and refresh the active
 * workspace's status on each one. Returns an unsubscribe to call on teardown.
 */
export function startGitStatusSubscription(): Unsubscribe {
  return appClient.git.subscribe(() => {
    const workspaceId = selectActiveWorkspaceId.select(appStore.state);
    if (workspaceId) {
      appStore.dispatch(loadGitStatus(workspaceId, true));
    }
  });
}
