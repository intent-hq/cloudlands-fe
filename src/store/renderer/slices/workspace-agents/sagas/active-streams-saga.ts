import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import { AGENT_ACTIVE_STREAMS_RECOVERY_KEY } from '$features/agent/agent-recovery-keys';
import { getRecoveryAdmission } from '$store/renderer/middlewares/event-recovery';
import { takeLatestFromSelector, type SelectorChannelPayload } from '@themislib/themis/saga';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import { call, join, takeEvery } from 'typed-redux-saga';

import { eventReceived } from '../../workspace-events/workspace-events-slice';

import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';

function* trackAdmittedStreams({ payload: context }: SelectorChannelPayload<string | null>) {
  if (!context) return;
  try {
    yield* call([activeStreamsTracker, activeStreamsTracker.startPolling]);
    const watcher = yield* takeEvery(
      eventReceived,
      function* (action: ReturnType<typeof eventReceived>) {
        const admitted = getRecoveryAdmission(action, AGENT_ACTIVE_STREAMS_RECOVERY_KEY);
        if (admitted === null) return;
        if (
          admitted === undefined &&
          !rendererEventRecovery.push(AGENT_ACTIVE_STREAMS_RECOVERY_KEY)
        )
          return;
        const receipt =
          admitted ?? rendererEventRecovery.capture(AGENT_ACTIVE_STREAMS_RECOVERY_KEY);
        receipt.commit(() => {
          activeStreamsTracker.applyEvent(action.payload[1]);
        });
      },
    );
    yield* join(watcher);
  } finally {
    yield* call([activeStreamsTracker, activeStreamsTracker.stopPolling]);
  }
}

export function* activeStreamsSaga() {
  yield* takeLatestFromSelector(selectPrincipalActionContext, trackAdmittedStreams);
}
