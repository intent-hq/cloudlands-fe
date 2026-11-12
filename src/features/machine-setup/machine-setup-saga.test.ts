/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { all, fork } from 'typed-redux-saga';

const ui = vi.hoisted(() => ({
  confirm: vi.fn(async () => true),
  navigateToSettings: vi.fn(async () => {}),
  electron: { value: true },
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock('$lib/components/patterns/confirm', () => ({ confirm: ui.confirm }));
vi.mock('$lib/utils/workspace-navigation', () => ({ navigateToSettings: ui.navigateToSettings }));
vi.mock('$lib/utils/platform-capabilities', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/utils/platform-capabilities')>()),
  isElectronPlatform: () => ui.electron.value,
}));

import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { ConnectionRecord } from '$shared/types/connections';
import type { SshLoginPrefill, SshSetupEvent } from '$shared/types/machine-setup';
import { store } from '$store/renderer/store';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import {
  setLabsRemoteAgentsEnabled,
  setLabsSshMachineSetupEnabled,
} from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { remoteMachinesLoaded } from '$features/remote-machines/remote-machines-slice';
import { nodesSaga } from '$features/nodes/nodes-saga';
import { pasteLinkSubmitted } from '$features/nodes/nodes-slice';
import { stashPastedLink } from '$features/nodes/pasted-link';
import { LAST_SSH_LOGIN_STORAGE_KEY, machineSetupSaga } from './machine-setup-saga';
import {
  machineSetupClosed,
  machineSetupInstallPicked,
  machineSetupOpened,
  machineSetupScreenShown,
  sshHostKeyAnswered,
  sshSetupRequested,
} from './machine-setup-slice';
import { stashSshSecret } from './ssh-secret';

const SETUP = IPC_CHANNELS.MACHINE_SETUP;
const CONNECTIONS = IPC_CHANNELS.CONNECTIONS;
const PASSWORD = 'hunter2-ssh-password';
const TOKEN = 'owner-secret-token';
const LINK = `intent://pair?v=1&host=192.0.2.30&port=5180&fp=AA%3A30&token=${TOKEN}`;

const LOGIN: SshLoginPrefill = {
  host: 'build.example.com',
  port: 22,
  username: 'ci',
  method: 'password',
  keyPath: '~/.ssh/id_ed25519',
};

const ADDED: ConnectionRecord = {
  id: 'build-box-2',
  label: 'build-box-2',
  host: '192.0.2.30',
  port: 5180,
  fingerprint: 'AA:30',
  isLocal: false,
  daemonMode: 'regular',
};

let task: Task;
let channel: ReturnType<typeof stdChannel>;
let seen: { type: string; payload?: unknown[] }[];
let invoke: ReturnType<typeof vi.fn>;
let listener: ((event: SshSetupEvent) => void) | null;
let commitReply: unknown;

function dispatch(action: { type: string }) {
  store.dispatch(action as Parameters<typeof store.dispatch>[0]);
  channel.put(action);
}

function start() {
  channel = stdChannel();
  seen = [];
  task = runSaga(
    {
      channel,
      getState: () => store.state,
      dispatch: (action: { type: string; payload?: unknown[] }) => {
        seen.push(action);
        dispatch(action);
      },
    },
    function* root() {
      yield* all([fork(nodesSaga), fork(machineSetupSaga)]);
    },
  );
}

const calls = (name: string) => invoke.mock.calls.filter(([channelName]) => channelName === name);
const setup = () => store.state.machineSetup;
const emit = (event: SshSetupEvent) => listener?.(event);

async function startRun(
  login: SshLoginPrefill = LOGIN,
  secret = PASSWORD,
  target: 'backend' | 'node' = 'backend',
) {
  dispatch(machineSetupOpened());
  dispatch(machineSetupInstallPicked(target));
  dispatch(machineSetupScreenShown('sshLogin'));
  if (secret) stashSshSecret(secret);
  dispatch(sshSetupRequested(login));
  await vi.waitFor(() => expect(setup().ssh?.runId).toBe('run-1'));
}

const doneEvent = (overrides: Partial<Extract<SshSetupEvent, { type: 'done' }>['result']> = {}) =>
  ({
    runId: 'run-1',
    type: 'done',
    result: {
      link: {
        kind: 'pair',
        pendingId: 'p-ssh',
        machineKind: 'machine',
        label: 'build-box-2',
        existingId: null,
      },
      lingerUser: null,
      macBackgroundOnly: false,
      ...overrides,
    },
  }) satisfies SshSetupEvent;

beforeEach(() => {
  store.init();
  localStorage.clear();
  ui.electron.value = true;
  store.dispatch(
    connectionsListReceived({
      connections: [],
      activeId: null,
      windowBackendId: null,
    }),
  );
  store.dispatch(setLabsRemoteAgentsEnabled(true));
  store.dispatch(
    remoteMachinesLoaded({
      supported: true,
      machines: [],
      localFingerprint: null,
      executorBackends: [],
    }),
  );
  store.dispatch(setLabsSshMachineSetupEnabled(true));
  listener = null;
  commitReply = { ok: true, connection: ADDED };
  invoke = vi.fn(async (name: string) => {
    if (name === SETUP.SSH_DEFAULTS) return { agent: true };
    if (name === SETUP.SSH_START) return { ok: true, runId: 'run-1' };
    if (name === CONNECTIONS.PAIR_LINK_INSPECT)
      return { ok: true, pendingId: 'p1', kind: 'machine', label: 'Lab PC', existingId: null };
    if (name === CONNECTIONS.PAIR_LINK_COMMIT) return commitReply;
    return { ok: true };
  });
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    invoke,
    on: (_name: string, callback: (event: SshSetupEvent) => void) => {
      listener = callback;
      return 'listener-1';
    },
    offById: () => {},
  };
  ui.confirm.mockResolvedValue(true);
  start();
});

afterEach(() => {
  task.cancel();
  vi.clearAllMocks();
});

describe('install method', () => {
  it('goes straight to Run it myself when Labs SSH machine setup is off', () => {
    store.dispatch(setLabsSshMachineSetupEnabled(false));
    dispatch(machineSetupOpened());
    dispatch(machineSetupInstallPicked('node'));
    expect(setup().screen).toBe('manual');
    expect(setup().target).toBe('node');
    expect(store.state.nodes.paste).toMatchObject({ phase: 'field', surface: 'wizard' });
    expect(calls(SETUP.SSH_DEFAULTS)).toHaveLength(0);
  });

  it('offers the method choice with Labs SSH on in the desktop app', async () => {
    dispatch(machineSetupOpened());
    await vi.waitFor(() => expect(setup().agentAvailable).toBe(true));
    dispatch(machineSetupInstallPicked('backend'));
    expect(setup().screen).toBe('method');
  });

  it('never offers SSH outside the desktop app', () => {
    ui.electron.value = false;
    dispatch(machineSetupOpened());
    dispatch(machineSetupInstallPicked('backend'));
    expect(setup().screen).toBe('manual');
  });
});

describe('paste in the wizard', () => {
  it('adds the link through the paste flow, then closes and shows Machines', async () => {
    dispatch(machineSetupOpened());
    dispatch(machineSetupScreenShown('paste'));
    expect(store.state.nodes.paste).toMatchObject({ phase: 'field', surface: 'wizard' });
    stashPastedLink(LINK);
    dispatch(pasteLinkSubmitted());
    await vi.waitFor(() => expect(setup().open).toBe(false));
    expect(calls(CONNECTIONS.PAIR_LINK_COMMIT)).toEqual([
      [CONNECTIONS.PAIR_LINK_COMMIT, { pendingId: 'p1' }],
    ]);
    expect(ui.navigateToSettings).toHaveBeenCalledWith({ tab: 'devices' });
    expect(store.state.nodes.paste.phase).toBe('closed');
  });

  it('Back closes the wizard paste field', () => {
    dispatch(machineSetupOpened());
    dispatch(machineSetupScreenShown('paste'));
    dispatch(machineSetupScreenShown('pick'));
    expect(store.state.nodes.paste).toMatchObject({ phase: 'closed', surface: 'inline' });
  });
});

describe('SSH setup run', () => {
  it('sends the secret only to main, mirrors steps and log, adds the machine and closes', async () => {
    await startRun();
    expect(calls(SETUP.SSH_START)).toEqual([
      [
        SETUP.SSH_START,
        {
          host: 'build.example.com',
          port: 22,
          username: 'ci',
          auth: { method: 'password', password: PASSWORD },
          target: 'backend',
        },
      ],
    ]);
    emit({ runId: 'run-1', type: 'step', step: 'installing' });
    emit({ runId: 'run-1', type: 'log', lines: ['install.sh: sha256 verified'] });
    await vi.waitFor(() => expect(setup().ssh?.step).toBe('installing'));
    expect(setup().ssh?.log).toEqual(['install.sh: sha256 verified']);

    emit(doneEvent());
    await vi.waitFor(() => expect(setup().open).toBe(false));
    expect(calls(CONNECTIONS.PAIR_LINK_COMMIT)).toEqual([
      [CONNECTIONS.PAIR_LINK_COMMIT, { pendingId: 'p-ssh' }],
    ]);
    expect(store.state.nodes.highlightId).toBe('build-box-2');
    expect(ui.navigateToSettings).toHaveBeenCalledWith({ tab: 'devices' });

    const leaked = JSON.stringify([seen, store.state, localStorage.getItem(LAST_SSH_LOGIN_STORAGE_KEY)]);
    expect(leaked).not.toContain(PASSWORD);
    expect(leaked).not.toContain(TOKEN);
    expect(JSON.parse(localStorage.getItem(LAST_SSH_LOGIN_STORAGE_KEY) ?? 'null')).toEqual(LOGIN);
  });

  it('keeps the wizard open with the extra step when lingering is still off', async () => {
    await startRun();
    emit(doneEvent({ lingerUser: 'ci' }));
    await vi.waitFor(() => expect(setup().ssh?.phase).toBe('done'));
    expect(setup().open).toBe(true);
    expect(setup().ssh?.lingerUser).toBe('ci');
    expect(calls(CONNECTIONS.PAIR_LINK_COMMIT)).toHaveLength(1);
  });

  it('asks about an unknown host key and passes the answer to main', async () => {
    await startRun();
    emit({ runId: 'run-1', type: 'host-key', fingerprint: 'SHA256:abc', algorithm: 'ssh-ed25519' });
    await vi.waitFor(() => expect(setup().ssh?.phase).toBe('hostKey'));
    expect(setup().ssh?.hostKey).toEqual({ fingerprint: 'SHA256:abc', algorithm: 'ssh-ed25519' });
    dispatch(sshHostKeyAnswered(true));
    await vi.waitFor(() =>
      expect(calls(SETUP.SSH_TRUST)).toEqual([[SETUP.SSH_TRUST, { runId: 'run-1', trusted: true }]]),
    );
    expect(setup().ssh?.phase).toBe('running');
  });

  it('shows a failure with its code and step', async () => {
    await startRun();
    emit({ runId: 'run-1', type: 'failed', code: 'unsupported-os', step: 'connecting', os: 'FreeBSD' });
    await vi.waitFor(() => expect(setup().ssh?.phase).toBe('failed'));
    expect(setup().ssh?.failure).toEqual({ code: 'unsupported-os', step: 'connecting', os: 'FreeBSD' });
  });

  it('Cancel closes the connection, ignores later events and saves nothing', async () => {
    await startRun();
    dispatch(machineSetupClosed());
    await vi.waitFor(() =>
      expect(calls(SETUP.SSH_CANCEL)).toEqual([[SETUP.SSH_CANCEL, { runId: 'run-1' }]]),
    );
    emit(doneEvent());
    await Promise.resolve();
    expect(calls(CONNECTIONS.PAIR_LINK_COMMIT)).toHaveLength(0);
    expect(setup().ssh).toBeNull();
  });

  it('Back during a run cancels it too', async () => {
    await startRun();
    dispatch(machineSetupScreenShown('sshLogin'));
    await vi.waitFor(() => expect(calls(SETUP.SSH_CANCEL)).toHaveLength(1));
  });

  it('reports a captured link the backend refuses as link-rejected', async () => {
    commitReply = { ok: false, code: 'expired' };
    await startRun();
    emit(doneEvent());
    await vi.waitFor(() => expect(setup().ssh?.phase).toBe('failed'));
    expect(setup().ssh?.failure).toMatchObject({
      code: 'link-rejected',
      step: 'adding',
      addError: { code: 'expired' },
    });
    expect(setup().open).toBe(true);
  });

  it('claims a node link after the prompt', async () => {
    store.dispatch(
      remoteMachinesLoaded({
        supported: true,
        claimInvites: true,
        machines: [],
        localFingerprint: null,
        executorBackends: [],
      }),
    );
    await startRun({ ...LOGIN, method: 'agent' }, '', 'node');
    expect(calls(SETUP.SSH_START)[0]?.[1]).toMatchObject({ auth: { method: 'agent' }, target: 'node' });
    invoke.mockImplementation(async (name: string) =>
      name === IPC_CHANNELS.REMOTE_MACHINES.INVITE_CLAIM
        ? { ok: false, code: 'node-invite-used' }
        : { ok: true },
    );
    emit({
      runId: 'run-1',
      type: 'done',
      result: {
        link: { kind: 'invite', pendingId: 'inv-1', label: 'gpu-rig' },
        lingerUser: null,
        macBackgroundOnly: false,
      },
    });
    await vi.waitFor(() => expect(setup().ssh?.phase).toBe('failed'));
    expect(ui.confirm).toHaveBeenCalled();
    expect(calls(IPC_CHANNELS.REMOTE_MACHINES.INVITE_CLAIM)).toEqual([
      [IPC_CHANNELS.REMOTE_MACHINES.INVITE_CLAIM, { pendingId: 'inv-1' }],
    ]);
    expect(setup().ssh?.failure?.addError?.code).toBe('node-invite-used');
  });

  it('prefills the next login from the last one, without a secret', async () => {
    await startRun();
    dispatch(machineSetupClosed());
    dispatch(machineSetupOpened());
    await vi.waitFor(() => expect(setup().lastLogin).toEqual(LOGIN));
  });
});
