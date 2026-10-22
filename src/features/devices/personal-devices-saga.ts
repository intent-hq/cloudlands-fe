import { call, put, takeEvery } from 'typed-redux-saga';
import { store } from '$store/renderer/store';
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
  beginWebsocketCredentialRequest,
  readPersonalPairingUri,
  receiveWebsocketCredentials,
} from '$features/settings/websocket-api-credentials';
import { personalPairingRequested } from './personal-devices-slice';
import { selectPersonalDevicesContext } from './personal-devices-selectors';
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
    let uri = readPersonalPairingUri(request);
    if (!uri) {
      const principal = selectPrincipalSnapshot.select(store.state)?.principal;
      if (!principal) return;
      uri = await readSelfPairing(principal);
      if (!current()) return;
      receiveWebsocketCredentials(request, { pairingUri: uri });
    }
    if (kind === 'copy') {
      if (current()) await navigator.clipboard.writeText(uri);
    } else {
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

export function* personalDevicesSaga() {
  yield* takeEvery(personalPairingRequested, pair);
}
