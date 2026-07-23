/**
 * Specialists list subscription — live half of the specialist reload restore.
 *
 * The daemon owns specialist file watching (the FE chokidar watcher was
 * removed) and emits `specialists:changed` when the resolved user/project set
 * changes on disk. `LiveSpecialistsClient.subscribe` listens for that event,
 * refetches `specialist.list` (debounced per burst), and pushes the fresh
 * resolved view here; we route it through `dispatchSpecialistList` — the same
 * bundled/file split (with the STAB-117 bundled-set reconstruction) the
 * post-write refetch in `specialists-mutation-service.ts` uses — so the
 * Settings pane and specialist picker update without an app restart.
 *
 * Mirrors `src/features/git/git-status-subscription.ts` and is
 * mounted/disposed from `+layout.svelte` alongside it. The subscribe's own
 * initial snapshot emit is redundant with the seeder's initial load but
 * harmless (same data, read-only). READ-ONLY: never invokes a mutation.
 */
import { appClient } from "$lib/client";
import type { Unsubscribe } from "$lib/client";
import { dispatchSpecialistList } from "./specialists-mutation-service";

/**
 * Start consuming daemon specialist-change notifications and mirror each
 * fresh resolved view into the store. Returns an unsubscribe for teardown.
 */
export function startSpecialistsListSubscription(): Unsubscribe {
  return appClient.specialists.subscribe((defs) => {
    dispatchSpecialistList(defs);
  });
}
