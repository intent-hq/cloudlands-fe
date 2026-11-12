/**
 * Set up a new machine: the wizard's screen and the SSH setup run. Never
 * holds a secret, the pairing link or its token: the SSH password or
 * passphrase goes straight to main (`stashSshSecret`), and main keeps the
 * captured link.
 */

import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type {
  MachineSetupTarget,
  SshLoginPrefill,
  SshSetupErrorCode,
  SshSetupEvent,
  SshSetupStep,
} from '$shared/types/machine-setup';
import type { NodeAddError } from '$features/nodes/nodes-types';

/**
 * - `pick`: the cards.
 * - `paste`: Paste an intent:// link.
 * - `details`: Enter connection details.
 * - `method`: Install a backend or node: over SSH, or run it myself (Labs on).
 * - `manual`: the install command and the link field.
 * - `sshLogin` / `sshRun`: the SSH login and its run.
 */
export type MachineSetupScreen =
  | 'pick'
  | 'paste'
  | 'details'
  | 'method'
  | 'manual'
  | 'sshLogin'
  | 'sshRun';

export interface SshRunFailure {
  code: SshSetupErrorCode;
  step: SshSetupStep;
  fingerprint?: string;
  os?: string;
  /** `link-rejected`: why the captured link was not added. */
  addError?: NodeAddError;
}

export interface SshRunState {
  runId: string | null;
  host: string;
  username: string;
  phase: 'running' | 'hostKey' | 'failed' | 'done';
  step: SshSetupStep;
  /** Redacted output, newest last, capped at `SSH_LOG_LIMIT` lines. */
  log: string[];
  hostKey: { fingerprint: string; algorithm: string } | null;
  failure: SshRunFailure | null;
  /** Done but lingering is still off: show the sudo step. */
  lingerUser: string | null;
}

export interface MachineSetupState {
  open: boolean;
  screen: MachineSetupScreen;
  target: MachineSetupTarget;
  ssh: SshRunState | null;
  /** The last SSH login (no secret), to prefill the next one. */
  lastLogin: SshLoginPrefill | null;
  /** An SSH agent is running here (main's answer; null until asked). */
  agentAvailable: boolean | null;
}

export const SSH_LOG_LIMIT = 400;

const initialState: MachineSetupState = {
  open: false,
  screen: 'pick',
  target: 'backend',
  ssh: null,
  lastLogin: null,
  agentAvailable: null,
};

/** Open the wizard on its cards (the Add machine menu, the rail). */
export const machineSetupOpened = createAction<[screen?: MachineSetupScreen]>(
  'machineSetup/opened',
);
/** Close it: stops a paste test or an SSH run; nothing more is saved. */
export const machineSetupClosed = createAction('machineSetup/closed');
/** Show another screen (cards, Back). */
export const machineSetupScreenShown = createAction<[screen: MachineSetupScreen]>(
  'machineSetup/screenShown',
);
/** Pick Install a backend or Install a node. */
export const machineSetupInstallPicked = createAction<[target: MachineSetupTarget]>(
  'machineSetup/installPicked',
);
export const lastSshLoginLoaded = createAction<[login: SshLoginPrefill | null]>(
  'machineSetup/lastSshLoginLoaded',
);
export const sshDefaultsLoaded = createAction<[agentAvailable: boolean]>(
  'machineSetup/sshDefaultsLoaded',
);
/**
 * Start (or Try again) the SSH setup with these fields; the secret, if any,
 * is stashed with `stashSshSecret` and never in the action.
 */
export const sshSetupRequested = createAction<[login: SshLoginPrefill]>(
  'machineSetup/sshSetupRequested',
);
/** The run screen for a starting run (the saga, after `sshSetupRequested`). */
export const sshRunShown = createAction<[login: SshLoginPrefill]>('machineSetup/sshRunShown');
export const sshSetupStarted = createAction<[runId: string, host: string, username: string]>(
  'machineSetup/sshSetupStarted',
);
export const sshSetupEventReceived = createAction<[event: SshSetupEvent]>(
  'machineSetup/sshSetupEventReceived',
);
/** The answer to the unknown-host-key question. */
export const sshHostKeyAnswered = createAction<[trust: boolean]>('machineSetup/sshHostKeyAnswered');
/** Main's run ended; the link is being added (node prompt, claim). */
export const sshSetupAdding = createAction('machineSetup/sshSetupAdding');
export const sshSetupFailed = createAction<[failure: SshRunFailure]>('machineSetup/sshSetupFailed');
/** Added, with one more step to show (lingering off, or a Mac nobody is logged in to). */
export const sshSetupDone = createAction<[lingerUser: string]>(
  'machineSetup/sshSetupDone',
);

export const machineSetupReducer = createReducer<MachineSetupState>(initialState);

machineSetupReducer.with(machineSetupOpened, (state, { payload: [screen] }) => ({
  ...state,
  open: true,
  screen: screen ?? 'pick',
  target: 'backend',
  ssh: null,
}));
machineSetupReducer.with(machineSetupClosed, (state) => ({
  ...state,
  open: false,
  screen: 'pick',
  ssh: null,
}));
machineSetupReducer.with(machineSetupScreenShown, (state, { payload: [screen] }) => ({
  ...state,
  screen,
  ssh: screen === 'sshRun' ? state.ssh : null,
}));
machineSetupReducer.with(machineSetupInstallPicked, (state, { payload: [target] }) => ({
  ...state,
  target,
}));
machineSetupReducer.with(lastSshLoginLoaded, (state, { payload: [lastLogin] }) => ({
  ...state,
  lastLogin,
}));
machineSetupReducer.with(sshDefaultsLoaded, (state, { payload: [agentAvailable] }) => ({
  ...state,
  agentAvailable,
}));
machineSetupReducer.with(sshRunShown, (state, { payload: [login] }) => ({
  ...state,
  screen: 'sshRun',
  lastLogin: login,
  ssh: {
    runId: null,
    host: login.host,
    username: login.username,
    phase: 'running',
    step: 'connecting',
    log: [],
    hostKey: null,
    failure: null,
    lingerUser: null,
  },
}));
machineSetupReducer.with(sshSetupStarted, (state, { payload: [runId] }) =>
  state.ssh ? { ...state, ssh: { ...state.ssh, runId } } : state,
);
machineSetupReducer.with(sshSetupEventReceived, (state, { payload: [event] }) => {
  const ssh = state.ssh;
  if (!ssh || ssh.runId !== event.runId || ssh.phase === 'failed' || ssh.phase === 'done')
    return state;
  switch (event.type) {
    case 'step':
      return { ...state, ssh: { ...ssh, step: event.step } };
    case 'log':
      return {
        ...state,
        ssh: { ...ssh, log: [...ssh.log, ...event.lines].slice(-SSH_LOG_LIMIT) },
      };
    case 'host-key':
      return {
        ...state,
        ssh: {
          ...ssh,
          phase: 'hostKey',
          hostKey: { fingerprint: event.fingerprint, algorithm: event.algorithm },
        },
      };
    default:
      return state;
  }
});
machineSetupReducer.with(sshHostKeyAnswered, (state) =>
  state.ssh?.phase === 'hostKey'
    ? { ...state, ssh: { ...state.ssh, phase: 'running', hostKey: null } }
    : state,
);
machineSetupReducer.with(sshSetupAdding, (state) =>
  state.ssh ? { ...state, ssh: { ...state.ssh, step: 'adding' } } : state,
);
machineSetupReducer.with(sshSetupFailed, (state, { payload: [failure] }) =>
  state.ssh
    ? { ...state, ssh: { ...state.ssh, phase: 'failed', step: failure.step, failure } }
    : state,
);
machineSetupReducer.with(sshSetupDone, (state, { payload: [lingerUser] }) =>
  state.ssh
    ? { ...state, ssh: { ...state.ssh, phase: 'done', lingerUser } }
    : state,
);
