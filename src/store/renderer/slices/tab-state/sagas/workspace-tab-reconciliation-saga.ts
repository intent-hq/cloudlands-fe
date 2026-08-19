import { takeLatestFromSelector, type SelectorChannelPayload } from '@augmentcode/themis/saga';
import { call, delay, select, type SagaGenerator } from 'typed-redux-saga';

import { closeWorkspaceTabAndNavigateAway } from '$features/workspace/navigate-away-if-viewing';
import { createLogger } from '$lib/utils/client-logger';
import { selectWorkspaceTabsToReconcile } from '../tab-state-selectors';

const logger = createLogger('WorkspaceTabReconciliationSaga');

/**
 * Reconcile the hydrated workspace-tab strip against the loaded workspace
 * list: close tabs whose workspace no longer exists or is archived (matching
 * the daemon events bridge's live archive/delete tab-close behavior).
 *
 * All triggering and guarding lives in `selectWorkspaceTabsToReconcile`, which
 * only yields tab IDs once the strip is hydrated for the ACTIVE backend and a
 * non-empty workspace list has loaded — so this runs on boot, after every list
 * refresh, and again after a backend switch re-hydrates, while never pruning
 * on daemon-down boots (empty list), optimistic tabs, or pending creations.
 *
 * `closeWorkspaceTabAndNavigateAway` closes the tab unconditionally (the
 * reducer no-ops when it is not open) and routes away only when the pruned
 * workspace is the one on screen — the same helper the live-event path uses.
 * Known limitation (no reducer change): `closeWorkspaceTab` records the pruned
 * tab in the recently-closed reopen stack.
 *
 * The worker yields one macrotask and re-reads the selector before closing
 * anything: multi-action flows (e.g. delete-with-undo's
 * `removeWorkspaceEntity` + `markWorkspacePendingDeletion`) emit between their
 * dispatches, and pruning synchronously on the first emission would act on a
 * half-applied state. `takeLatest` cancels the parked worker when the next
 * dispatch changes the prunable set, and the fresh re-read covers anything a
 * cancellation-free burst may have changed.
 */
export function* workspaceTabReconciliationSaga(): SagaGenerator<void> {
  yield* takeLatestFromSelector(
    selectWorkspaceTabsToReconcile,
    function* (_: SelectorChannelPayload<string[]>): SagaGenerator<void> {
      yield* delay(0);
      const tabsToClose = yield* select(selectWorkspaceTabsToReconcile.select);
      for (const workspaceId of tabsToClose) {
        try {
          yield* call(closeWorkspaceTabAndNavigateAway, workspaceId);
        } catch (error) {
          logger.warn(`Failed to close ghost workspace tab ${workspaceId}`, error);
        }
      }
    },
  );
}
