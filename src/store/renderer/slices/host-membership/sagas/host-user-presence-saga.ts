import { buffers } from 'redux-saga';
import type { Action } from '@redux-saga/types';
import { actionChannel, call, put, take, type SagaGenerator } from 'typed-redux-saga';
import { takeLatestFromSelector, type SelectorChannelPayload } from '@themislib/themis/saga';
import { appClient } from '$lib/client';
import { parsePrincipalSnapshot } from '$shared/types/principal';
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
      try {
        // The browser-client mirror may contain only mounted-workspace reads.
        // Read the authenticated host roster independently, including empty instances.
        const clients = yield* call([appClient.clients, appClient.clients.list]);
        const onlinePrincipalIds = new Set<string>();
        for (const client of clients) {
          const principalId = client.principalId;
          if (
            typeof principalId !== 'string' ||
            !principalId.trim() ||
            !Number.isInteger(client.connections) ||
            client.connections <= 0 ||
            !['owner', 'member', 'guest'].includes(client.hostRole ?? '') ||
            !parsePrincipalSnapshot(
              { server: { capabilities: {} } },
              { ...client, id: principalId, isAdministrator: client.hostRole === 'owner' },
            )
          )
            throw new Error('Invalid authenticated client roster');
          onlinePrincipalIds.add(principalId);
        }
        if (payload === (yield* selectHostUserPresenceSession.effect()))
          yield* put(hostUserPresenceSettled(payload, epoch, [...onlinePrincipalIds]));
      } catch {
        if (payload === (yield* selectHostUserPresenceSession.effect()))
          yield* put(hostUserPresenceSettled(payload, epoch, null));
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
