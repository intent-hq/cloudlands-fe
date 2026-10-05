import { delay, put, race, take, type SagaGenerator } from 'typed-redux-saga';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { selectPendingSubmissionsState } from '../pending-submissions-selectors';
import { SUBMISSION_TOMBSTONE_TTL } from '../pending-submissions-model';
import {
  pendingEvidenceObserved,
  pendingReadCompleted,
  pendingRetentionPruned,
  pendingSubmissionSettled,
} from '../pending-submissions-slice';

/** One root-owned expiry timer; unresolved callback identity is never expired here. */
export function* pendingRetentionSaga(): SagaGenerator<void> {
  const changes = [
    pendingEvidenceObserved.type,
    pendingReadCompleted.type,
    pendingSubmissionSettled.type,
  ];
  while (true) {
    const state = yield* selectPendingSubmissionsState.effect();
    const entries = Object.values(state.byAgentId);
    const timestamps = entries.flatMap((entry) =>
      getItems(entry.tombstones).map((item) => item.at),
    );
    if (!timestamps.length) {
      yield* take(changes);
      continue;
    }
    const now = Date.now();
    const remaining =
      timestamps.reduce((oldest, at) => Math.min(oldest, at), Infinity) +
      SUBMISSION_TOMBSTONE_TTL -
      now;
    if (remaining <= 0) {
      for (const entry of entries) {
        if (getItems(entry.tombstones).some((item) => now - item.at >= SUBMISSION_TOMBSTONE_TTL))
          yield* put(pendingRetentionPruned(entry.scope, now));
      }
    } else {
      yield* race({ changed: take(changes), expired: delay(remaining) });
    }
  }
}
