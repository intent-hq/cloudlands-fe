/**
 * Local code pairing, host side (B): show a code another Intent on this
 * computer types, and list or remove the Intents that connected with one.
 *
 * Reachability: the four administration methods and both events are served
 * only to local-transport (UDS / named pipe) connections. Requests go to this
 * desktop's own daemon (`localMachine`), but the events arrive only on the
 * window's own connection, so the section is offered only in the desktop app,
 * while this window is bound to the local daemon, and only when that link
 * answers the local-only methods (a `-32001` means the desktop reaches its
 * daemon over TCP/WSS, e.g. an `INTENTD_WS_URL` override).
 */
import { call, put, takeEvery, takeLatest, type SagaGenerator } from 'typed-redux-saga';
import { m } from '$shared/paraglide/messages.js';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import { confirm } from '$lib/components/patterns/confirm';
import { isElectronPlatform } from '$lib/utils/platform-capabilities';
import { store } from '$store/renderer/store';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { setLabsLocalPairingEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { selectLabsLocalPairingEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
import {
  cancelLocalCode,
  createLocalCode,
  enableLoopbackListener,
  listLocalCredentials,
  readLocalPairingCapability,
  revokeLocalCredential,
} from './local-pairing-client';
import { clearLocalPairingCodeText, receiveLocalPairingCodeText } from './local-pairing-code-text';
import {
  isListenerDown,
  isLocalLinkUnsupported,
  isRemoteAccessRefusal,
  isTerminalCode,
} from './local-pairing-model';
import {
  localPairingCancelRequested,
  localPairingCodeChanged,
  localPairingCodeCreated,
  localPairingCloseRequested,
  localPairingCodeRequested,
  localPairingCredentialRevoked,
  localPairingListenerConfirmed,
  localPairingListenerNeeded,
  localPairingLoaded,
  localPairingPanelClosed,
  localPairingPanelFailed,
  localPairingRefreshRequested,
  localPairingRemoveRequested,
  localPairingRemoveSettled,
  localPairingRemoveStarted,
} from './local-pairing-slice';
import type { LocalPairingCredential, LocalPairingSupport } from './local-pairing-types';

function labsEnabled(): boolean {
  return selectLabsLocalPairingEnabled.select(store.state);
}

/** Events reach this window only on a local-transport connection to its own daemon. */
function boundToLocalDaemon(): boolean {
  return store.state.connections?.windowBackendId === LOCAL_CONNECTION_ID;
}

function offered(): boolean {
  return labsEnabled() && isElectronPlatform() && boundToLocalDaemon();
}

let lastBoundToLocal: boolean | null = null;

/** The connection list changes often; re-read only when the window's daemon does. */
function* connectionsChanged(): SagaGenerator<void> {
  const bound = boundToLocalDaemon();
  if (bound === lastBoundToLocal) return;
  lastBoundToLocal = bound;
  yield* call(refresh);
}

function* refresh(): SagaGenerator<void> {
  if (!offered()) {
    yield* put(localPairingLoaded(labsEnabled() ? 'unsupported' : 'unknown', null));
    return;
  }
  let supported = false;
  try {
    supported = yield* call(readLocalPairingCapability);
  } catch {
    supported = false;
  }
  if (!supported) {
    yield* put(localPairingLoaded('unsupported', null));
    return;
  }
  let support: LocalPairingSupport = 'supported';
  let credentials: LocalPairingCredential[] | null = null;
  try {
    credentials = yield* call(listLocalCredentials);
  } catch (error) {
    if (isLocalLinkUnsupported(error)) support = 'unsupported';
  }
  yield* put(localPairingLoaded(support, credentials));
}

function* createCode(): SagaGenerator<void> {
  if (!offered()) return;
  const previous = store.state.localPairing.code;
  clearLocalPairingCodeText();
  try {
    const { code, localCode } = yield* call(createLocalCode);
    receiveLocalPairingCodeText({ codeId: localCode.codeId, code });
    yield* put(localPairingCodeCreated(localCode));
  } catch (error) {
    if (isListenerDown(error)) yield* put(localPairingListenerNeeded());
    else if (isRemoteAccessRefusal(error)) yield* put(localPairingPanelFailed('remote-access-on'));
    else yield* put(localPairingPanelFailed('create-failed'));
  }
  // The daemon cancels the earlier code itself (reason `replaced`).
  if (previous) clearLocalPairingCodeText(previous.codeId);
}

function* enableListenerAndCreate(): SagaGenerator<void> {
  if (!offered()) return;
  try {
    yield* call(enableLoopbackListener);
  } catch {
    yield* put(localPairingPanelFailed('listener-failed'));
    return;
  }
  try {
    const { code, localCode } = yield* call(createLocalCode);
    receiveLocalPairingCodeText({ codeId: localCode.codeId, code });
    yield* put(localPairingCodeCreated(localCode));
  } catch (error) {
    yield* put(
      localPairingPanelFailed(
        isListenerDown(error)
          ? 'listener-failed'
          : isRemoteAccessRefusal(error)
            ? 'remote-access-on'
            : 'create-failed',
      ),
    );
  }
}

function* cancelCode(): SagaGenerator<void> {
  const code = store.state.localPairing.code;
  if (!code || isTerminalCode(code)) return;
  try {
    yield* call(cancelLocalCode, code.codeId);
    // The event normally lands first; this keeps the panel right if it is late.
    yield* put(localPairingCodeChanged({ ...code, state: 'cancelled', cancelReason: 'user' }));
  } catch {
    yield* put(localPairingPanelFailed('cancel-failed'));
  }
}

/** Closing the panel or turning the lab off never leaves a usable code behind. */
function* closePanel(): SagaGenerator<void> {
  const code = store.state.localPairing.code;
  clearLocalPairingCodeText();
  yield* put(localPairingPanelClosed());
  if (!code || isTerminalCode(code)) return;
  try {
    yield* call(cancelLocalCode, code.codeId);
  } catch {
    // Best effort: the code still expires on its own within 10 minutes.
  }
}

function* labsChanged(action: ReturnType<typeof setLabsLocalPairingEnabled>): SagaGenerator<void> {
  if (action.payload[0] === false) yield* call(closePanel);
  yield* call(refresh);
}

function* removeCredential(
  action: ReturnType<typeof localPairingRemoveRequested>,
): SagaGenerator<void> {
  const [credentialId] = action.payload;
  const state = store.state.localPairing;
  if (state.removing[credentialId]) return;
  const credential = state.credentials?.find((entry) => entry.credentialId === credentialId);
  if (!credential) return;
  const accepted = yield* call(confirm, {
    title: m.localPairing_remove_confirmTitle({ name: credential.appName }),
    description: m.localPairing_remove_confirm_description({ name: credential.appName }),
    confirmLabel: m.localPairing_remove_label(),
    destructive: true,
  });
  if (!accepted) return;
  yield* put(localPairingRemoveStarted(credentialId));
  try {
    yield* call(revokeLocalCredential, credentialId);
    yield* put(localPairingCredentialRevoked(credentialId));
  } catch {
    yield* put(localPairingRemoveSettled(credentialId, true));
  }
}

/** A code that can no longer be redeemed is not kept in memory. */
function forgetSpentCode(action: ReturnType<typeof localPairingCodeChanged>): void {
  const [code] = action.payload;
  if (isTerminalCode(code)) clearLocalPairingCodeText(code.codeId);
}

export function* localPairingSaga(): SagaGenerator<void> {
  lastBoundToLocal = null;
  yield* takeEvery(localPairingCodeChanged, forgetSpentCode);
  yield* takeLatest([localPairingRefreshRequested, backendReconnected], refresh);
  yield* takeLatest(connectionsListReceived, connectionsChanged);
  yield* takeLatest(setLabsLocalPairingEnabled, labsChanged);
  yield* takeLatest(localPairingCodeRequested, createCode);
  yield* takeLatest(localPairingListenerConfirmed, enableListenerAndCreate);
  yield* takeEvery(localPairingCancelRequested, cancelCode);
  yield* takeEvery(localPairingCloseRequested, closePanel);
  yield* takeEvery(localPairingRemoveRequested, removeCredential);
}
