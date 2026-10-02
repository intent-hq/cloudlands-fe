import { buffers } from 'redux-saga';
import { actionChannel, call, fork, put, take, takeEvery } from 'typed-redux-saga';
import { takeLatestFromSelector, type SelectorChannelPayload } from '@themislib/themis/saga';
import { store } from '$store/renderer/store';
import { appClient } from '$lib/client';
import { parsePrincipalSnapshot } from '$shared/types/principal';
import { m } from '$shared/paraglide/messages.js';
import {
  selectCollaborationCapabilities,
  selectPrincipalSnapshot,
} from '$store/renderer/slices/principal/principal-selectors';
import { selectSettingsFormRequestCurrent } from '$store/renderer/slices/settings-events/settings-events-selectors';
import {
  settingsFormRequestStarted,
  settingsFormRequestSettled,
} from '$store/renderer/slices/settings-events/settings-events-slice';
import {
  authenticatedClientsReceived,
  authenticatedClientsCleared,
  refreshLiveClientsRequested,
} from '$store/renderer/slices/browser-clients/browser-clients-slice';
import {
  beginWebsocketCredentialRequest,
  clearWebsocketCredentials,
  readPersonalPairingUri,
  receiveWebsocketCredentials,
} from '$features/settings/websocket-api-credentials';
import {
  personalDevicesRefreshRequested,
  personalPairingRequested,
} from './personal-devices-slice';
import {
  selectPersonalDevicesContext,
  selectPersonalDevicesSession,
} from './personal-devices-selectors';
import { readSelfPairing } from './self-pairing';

/** Credentials stay in the existing mount-scoped receiver, outside Redux and saga diagnostics. */
async function deliverPairing(action: ReturnType<typeof personalPairingRequested>): Promise<void> {
  const [request, context, kind] = action.payload;
  const dispatch = store.dispatch;
  const current = () =>
    dispatch === store.dispatch &&
    context === selectPersonalDevicesContext.select(store.state) &&
    selectCollaborationCapabilities.select(store.state).personalPairing &&
    selectSettingsFormRequestCurrent.select(store.state, request);
  if (!current()) return;
  try {
    if (kind === 'copy') {
      const uri = readPersonalPairingUri(request);
      if (!uri) throw new Error('Pairing not loaded');
      if (current()) await navigator.clipboard.writeText(uri);
    } else {
      const principal = selectPrincipalSnapshot.select(store.state)?.principal;
      if (!principal) return;
      const uri = await readSelfPairing(principal);
      if (!current()) return;
      const QRCode = (await import('qrcode')).default;
      const qrDataUrl = await QRCode.toDataURL(uri, { width: 544, margin: 2 });
      if (current()) receiveWebsocketCredentials(request, { pairingUri: uri, qrDataUrl });
    }
  } catch {
    // Never propagate a transport error that might contain a credential-bearing response.
    throw new Error(m.settings_personalDevices_pairing_error());
  }
}

function* pair(action: ReturnType<typeof personalPairingRequested>) {
  const [request, context] = action.payload;
  if (context !== (yield* selectPersonalDevicesContext.effect())) return;
  if (!(yield* selectCollaborationCapabilities.effect()).personalPairing) return;
  yield* put(settingsFormRequestStarted(request));
  beginWebsocketCredentialRequest(request);
  try {
    yield* call(deliverPairing, action);
    if (context === (yield* selectPersonalDevicesContext.effect()))
      yield* put(settingsFormRequestSettled(request, { status: 'succeeded' }));
  } catch {
    if (context === (yield* selectPersonalDevicesContext.effect()))
      yield* put(
        settingsFormRequestSettled(request, {
          status: 'failed',
          error: m.settings_personalDevices_pairing_error(),
        }),
      );
  }
}

function* session({ payload }: SelectorChannelPayload<string | null>) {
  if (!payload) return;
  const [context, formId, sessionId] = JSON.parse(payload) as [string, string, string];
  const triggers = yield* actionChannel(
    [refreshLiveClientsRequested, personalDevicesRefreshRequested],
    buffers.sliding(1),
  );
  try {
    while (true) {
      if ((yield* selectCollaborationCapabilities.effect()).authenticatedDevices) {
        const request = { formId, sessionId, resource: 'roster', requestId: crypto.randomUUID() };
        yield* put(settingsFormRequestStarted(request));
        try {
          const clients = yield* call([appClient.clients, appClient.clients.list]);
          // Advertised authenticatedDevices must not silently accept legacy/forged identity rows.
          if (
            !clients.every(
              (client) =>
                parsePrincipalSnapshot(
                  { server: { capabilities: {} } },
                  {
                    ...client,
                    id: client.principalId,
                    isAdministrator: client.hostRole === 'owner',
                  },
                ) && ['owner', 'member', 'guest'].includes(client.hostRole ?? ''),
            )
          )
            throw new Error('Invalid authenticated client roster');
          if (context === (yield* selectPersonalDevicesContext.effect())) {
            yield* put(authenticatedClientsReceived(context, clients));
            yield* put(settingsFormRequestSettled(request, { status: 'succeeded' }));
          }
        } catch {
          if (context === (yield* selectPersonalDevicesContext.effect())) {
            yield* put(authenticatedClientsReceived(context, []));
            yield* put(
              settingsFormRequestSettled(request, {
                status: 'failed',
                error: m.settings_personalDevices_roster_error(),
              }),
            );
          }
        }
      }
      yield* take(triggers);
    }
  } finally {
    triggers.close();
    yield* put(authenticatedClientsCleared(context));
    clearWebsocketCredentials(formId, sessionId);
  }
}

export function* personalDevicesSaga() {
  yield* fork(function* () {
    yield* takeLatestFromSelector(selectPersonalDevicesSession, session);
  });
  yield* takeEvery(personalPairingRequested, pair);
}
