import { readCollaboration, onlineHostPrincipals } from '$features/presence/collaboration-recovery';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import { withRecoveryLifetime } from '../../../middlewares/event-recovery';
import { buffers } from 'redux-saga';
import type { Action } from '@redux-saga/types';
import { actionChannel, call, put, take, type SagaGenerator } from 'typed-redux-saga';
import { takeLatestFromSelector, type SelectorChannelPayload } from '@themislib/themis/saga';
import { appClient } from '$lib/client';
import { refreshLiveClientsRequested } from '../../browser-clients/browser-clients-slice';
import {
  selectHostMembershipState,
  selectHostUserPresenceSession,
} from '../host-membership-selectors';
import {
  hostUserPresenceStarted,
  hostUserPresenceSettled,
  hostUserPresenceCleared,
} from '../host-membership-slice';

function* session({ payload }: SelectorChannelPayload<string | null>): SagaGenerator<void> {
  if (!payload) return;
  // Subscribe before reading: a transition during the snapshot gets a trailing read.
  const triggers = yield* actionChannel(
    (action: Action) =>
      action.type === refreshLiveClientsRequested.type &&
      'payload' in action &&
      Array.isArray(action.payload) &&
      !action.payload[0],
    buffers.sliding(1),
  );
  yield* put(hostUserPresenceStarted(payload));
  try {
    while (true) {
      const epoch = (yield* selectHostMembershipState.effect()).presence.epoch;
      const receipt = rendererEventRecovery.capture('host-user-presence');
      try {
        // The browser-client mirror may contain only mounted-workspace reads.
        // Read the authenticated host roster independently, including empty instances.
        const clients = yield* call(() =>
          readCollaboration('host-user-presence', () => appClient.clients.list()),
        );
        if (clients && payload === (yield* selectHostUserPresenceSession.effect()))
          yield* put(
            withRecoveryLifetime(
              hostUserPresenceSettled(payload, epoch, onlineHostPrincipals(clients)),
              receipt,
            ),
          );
      } catch {
        if (payload === (yield* selectHostUserPresenceSession.effect()))
          yield* put(withRecoveryLifetime(hostUserPresenceSettled(payload, epoch, null), receipt));
      }
      yield* take(triggers);
    }
  } finally {
    triggers.close();
    yield* put(hostUserPresenceCleared(payload));
  }
}

export function* hostUserPresenceSaga(): SagaGenerator<void> {
  yield* takeLatestFromSelector(selectHostUserPresenceSession, session);
}
