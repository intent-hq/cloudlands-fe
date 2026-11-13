/**
 * Set up a new machine (renderer): the wizard's paste field, the install
 * method, and the SSH setup run.
 *
 * Paste and Run it myself use the nodes paste flow on the wizard surface; a
 * completed paste closes the wizard. The SSH run lives in main
 * (`machine-setup:ssh-*`): this saga starts it with the login fields and the
 * stashed secret, mirrors its events, answers the host-key question and
 * cancels it when the wizard closes. Main keeps the captured link and returns
 * a pending id, which `addHeldLink` saves (or claims) like a pasted link.
 */

import { call, put, race, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type {
  SshAuth,
  SshLoginPrefill,
  SshSetupDefaults,
  SshSetupEvent,
  SshSetupStartParams,
  SshSetupStartResult,
} from '$shared/types/machine-setup';
import { takeEveryFromElectronChannel } from '$store/renderer/utils/ipc-channel';
import {
  getLocalStorageJSON,
  setLocalStorageJSON,
} from '$store/renderer/utils/safe-local-storage-saga';
import { addHeldLink } from '$features/nodes/nodes-saga';
import { pasteClosed, pasteCompleted, pasteFieldOpened } from '$features/nodes/nodes-slice';
import { selectNodePaste } from '$features/nodes/nodes-selectors';
import { selectMachineSetup, selectSshMachineSetupAvailable } from './machine-setup-selectors';
import {
  lastSshLoginLoaded,
  machineSetupClosed,
  machineSetupInstallPicked,
  machineSetupOpened,
  machineSetupScreenShown,
  sshDefaultsLoaded,
  sshHostKeyAnswered,
  sshRunShown,
  sshSetupAdding,
  sshSetupDone,
  sshSetupEventReceived,
  sshSetupFailed,
  sshSetupRequested,
  sshSetupStarted,
  type MachineSetupScreen,
} from './machine-setup-slice';
import { parseSshLoginPrefill } from './ssh-login';
import { takeSshSecret } from './ssh-secret';

const CHANNELS = IPC_CHANNELS.MACHINE_SETUP;
/** The last SSH host, port, username, method and key path. Never a secret. @internal */
export const LAST_SSH_LOGIN_STORAGE_KEY = 'machineSetup:lastSshLogin';

const PASTE_SCREENS: ReadonlySet<MachineSetupScreen> = new Set(['paste', 'manual']);

/**
 * The run main is still working on. Kept here, not read from state: closing
 * the wizard (or Back) clears the run from state before this saga sees it.
 */
let liveRunId: string | null = null;

function bridge() {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api?.invoke) throw new Error('machine setup bridge unavailable'); // i18n-ignore (developer diagnostic)
  return api;
}

// Each call names its channel so the IPC reachability scan can see the main handler's caller.
const invokeDefaults = async (): Promise<unknown> => bridge().invoke(CHANNELS.SSH_DEFAULTS);
const invokeStart = async (params: SshSetupStartParams): Promise<unknown> =>
  bridge().invoke(CHANNELS.SSH_START, params);
const invokeTrust = async (runId: string, trusted: boolean): Promise<unknown> =>
  bridge().invoke(CHANNELS.SSH_TRUST, { runId, trusted });
const invokeCancel = async (runId: string): Promise<unknown> =>
  bridge().invoke(CHANNELS.SSH_CANCEL, { runId });

function startReply(reply: unknown): SshSetupStartResult {
  const value = (reply ?? {}) as Record<string, unknown>;
  if (value.ok === true && typeof value.runId === 'string') return { ok: true, runId: value.runId };
  return { ok: false, code: 'busy' };
}

function sshAuth(login: SshLoginPrefill, secret: string | null): SshAuth {
  if (login.method === 'password') return { method: 'password', password: secret ?? '' };
  if (login.method === 'key')
    return { method: 'key', keyPath: login.keyPath, ...(secret ? { passphrase: secret } : {}) };
  return { method: 'agent' };
}

/** Stop the SSH run, if one is going; its later events are ignored. */
function* cancelRun(): SagaGenerator<void> {
  const runId = liveRunId;
  liveRunId = null;
  if (!runId) return;
  try {
    yield* call(invokeCancel, runId);
  } catch {
    // The run ends with its connection either way.
  }
}

/** Close the wizard's paste field when it leaves the paste screens. */
function* closeWizardPaste(): SagaGenerator<void> {
  const paste = yield* selectNodePaste.effect();
  if (paste.surface === 'wizard' && paste.phase !== 'closed') yield* put(pasteClosed());
}

function* showScreen(action: ReturnType<typeof machineSetupScreenShown>): SagaGenerator<void> {
  const [screen] = action.payload;
  if (screen !== 'sshRun') yield* call(cancelRun);
  if (PASTE_SCREENS.has(screen)) yield* put(pasteFieldOpened('wizard'));
  else yield* call(closeWizardPaste);
}

function* open(): SagaGenerator<void> {
  if (!(yield* selectSshMachineSetupAvailable.effect())) return;
  const stored = yield* call(getLocalStorageJSON<unknown>, LAST_SSH_LOGIN_STORAGE_KEY);
  yield* put(lastSshLoginLoaded(parseSshLoginPrefill(stored)));
  try {
    const defaults = (yield* call(invokeDefaults)) as Partial<SshSetupDefaults> | null;
    yield* put(sshDefaultsLoaded(defaults?.agent === true));
  } catch {
    yield* put(sshDefaultsLoaded(false));
  }
}

function* close(): SagaGenerator<void> {
  yield* call(cancelRun);
  yield* call(closeWizardPaste);
}

/** Install a backend or a node: choose a method only when SSH setup is offered. */
function* pickInstall(): SagaGenerator<void> {
  const ssh = yield* selectSshMachineSetupAvailable.effect();
  yield* put(machineSetupScreenShown(ssh ? 'method' : 'manual'));
}

/** A paste from the wizard added its machine: close, then show the row. */
function* pasteDone(): SagaGenerator<void> {
  const setup = yield* selectMachineSetup.effect();
  if (!setup.open || !PASTE_SCREENS.has(setup.screen)) return;
  yield* put(machineSetupClosed());
  yield* call(showMachines);
}

function* showMachines(): SagaGenerator<void> {
  const { navigateToSettings } = yield* call(() => import('$lib/utils/workspace-navigation'));
  yield* call(navigateToSettings, { tab: 'devices' });
}

function* startSsh(action: ReturnType<typeof sshSetupRequested>): SagaGenerator<void> {
  const [login] = action.payload;
  const secret = takeSshSecret();
  yield* put(sshRunShown(login));
  yield* call(setLocalStorageJSON, LAST_SSH_LOGIN_STORAGE_KEY, login);
  const { target } = yield* selectMachineSetup.effect();
  let started: SshSetupStartResult;
  try {
    started = startReply(
      yield* call(invokeStart, {
        host: login.host,
        port: login.port,
        username: login.username,
        auth: sshAuth(login, secret),
        target,
      }),
    );
  } catch {
    started = { ok: false, code: 'busy' };
  }
  if (!started.ok) {
    yield* put(sshSetupFailed({ code: 'failed', step: 'connecting' }));
    return;
  }
  // Closed (or Back) while the start was in flight: stop the run at once.
  const setup = yield* selectMachineSetup.effect();
  if (!setup.open || setup.screen !== 'sshRun') {
    yield* call(invokeCancel, started.runId);
    return;
  }
  liveRunId = started.runId;
  yield* put(sshSetupStarted(started.runId, login.host, login.username));
}

function* answerHostKey(action: ReturnType<typeof sshHostKeyAnswered>): SagaGenerator<void> {
  if (!liveRunId) return;
  try {
    yield* call(invokeTrust, liveRunId, action.payload[0]);
  } catch {
    // A lost answer leaves the run waiting until its own timeout.
  }
}

/** Main's run ended with a held link: add it (node prompt, claim), then finish. */
function* finishRun(event: Extract<SshSetupEvent, { type: 'done' }>): SagaGenerator<void> {
  yield* put(sshSetupAdding());
  const { added } = yield* race({
    added: call(addHeldLink, event.result.link),
    closed: take(machineSetupClosed),
  });
  if (added === undefined) return;
  if (added === 'cancelled') {
    yield* put(machineSetupClosed());
    return;
  }
  if (added) {
    yield* put(sshSetupFailed({ code: 'link-rejected', step: 'adding', addError: added }));
    return;
  }
  const { lingerUser, remoteTurnedOn } = event.result;
  if (lingerUser || remoteTurnedOn) {
    yield* put(sshSetupDone(lingerUser, remoteTurnedOn === true));
    return;
  }
  yield* put(machineSetupClosed());
  yield* call(showMachines);
}

function* receiveEvent(event: SshSetupEvent): SagaGenerator<void> {
  if (!event || typeof event.runId !== 'string' || event.runId !== liveRunId) return;
  if (event.type === 'failed' || event.type === 'done') liveRunId = null;
  if (event.type === 'failed') {
    const { type: _type, runId: _runId, ...failure } = event;
    yield* put(sshSetupFailed(failure));
    return;
  }
  yield* put(sshSetupEventReceived(event));
  if (event.type === 'done') yield* call(finishRun, event);
}

export function* machineSetupSaga(): SagaGenerator<void> {
  yield* takeEvery(machineSetupOpened, open);
  yield* takeEvery(machineSetupClosed, close);
  yield* takeEvery(machineSetupScreenShown, showScreen);
  yield* takeEvery(machineSetupInstallPicked, pickInstall);
  yield* takeEvery(pasteCompleted, pasteDone);
  yield* takeEvery(sshSetupRequested, startSsh);
  yield* takeEvery(sshHostKeyAnswered, answerHostKey);
  yield* takeEveryFromElectronChannel<SshSetupEvent>(CHANNELS.SSH_EVENT, receiveEvent);
}
