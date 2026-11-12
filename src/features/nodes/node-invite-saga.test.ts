/**
 * @vitest-environment jsdom
 *
 * Adding a machine from an `intent://node` link: the paste row and links
 * opened from outside the app. Asks first, claims on the current backend,
 * shows each failure, and refuses when the backend can't use the machine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';

const ui = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  confirm: vi.fn(async () => true),
  navigateToSettings: vi.fn(async () => {}),
}));
vi.mock('$lib/components/patterns/notify', () => ({ notify: ui }));
vi.mock('$lib/components/patterns/confirm', () => ({ confirm: ui.confirm }));
vi.mock('$lib/utils/workspace-navigation', () => ({ navigateToSettings: ui.navigateToSettings }));

import { IPC_CHANNELS } from '$shared/ipc-registry';
import { store } from '$store/renderer/store';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { setLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import {
  remoteMachinesLoaded,
  remoteMachinesRefreshRequested,
} from '$features/remote-machines/remote-machines-slice';
import type { NodeInviteClaimResult, NodeInviteInspectResult } from '$shared/types/node-invite';
import type { RemoteMachine } from '$shared/types/remote-machines';
import { nodesSaga } from './nodes-saga';
import {
  nodeInviteReceived,
  pasteClosed,
  pasteLinkRetried,
  pasteLinkSubmitted,
  rowHighlighted,
} from './nodes-slice';
import { stashPastedLink } from './pasted-link';

const SECRET = 'invite-secret-value';
const LINK = `intent://node?v=1&host=192.0.2.20&port=7443&fp=AA%3A20&invite=inv_1&secret=${SECRET}`;
const CHANNELS = IPC_CHANNELS.REMOTE_MACHINES;

const MACHINE: RemoteMachine = {
  id: 'd-gpu',
  name: 'GPU rig',
  hosts: ['192.0.2.20'],
  port: 7443,
  fingerprint: 'AA:20',
  state: 'connected',
  runningAgents: 0,
  addedAt: '2026-11-10T00:00:00Z',
};

let task: Task;
let channel: ReturnType<typeof stdChannel>;
let seen: { type: string; payload?: unknown[] }[];
let inspectReply: NodeInviteInspectResult;
let claimReply: NodeInviteClaimResult | Promise<NodeInviteClaimResult>;
let invoke: ReturnType<typeof vi.fn>;

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
    nodesSaga,
  );
}

function submit(text: string) {
  stashPastedLink(text);
  dispatch(pasteLinkSubmitted());
}

const calls = (name: string) => invoke.mock.calls.filter(([channelName]) => channelName === name);
const types = () => seen.map((action) => action.type);

function setSupport({
  labs,
  supported,
  claimInvites,
}: {
  labs: boolean;
  supported: boolean;
  claimInvites: boolean;
}) {
  store.dispatch(setLabsRemoteAgentsEnabled(labs));
  store.dispatch(
    remoteMachinesLoaded({
      supported,
      claimInvites,
      machines: [],
      localFingerprint: null,
      executorBackends: [],
    }),
  );
}

beforeEach(() => {
  store.init();
  store.dispatch(
    connectionsListReceived({
      connections: [
        {
          id: 'build-box',
          label: 'Build box',
          host: '192.0.2.10',
          port: 5179,
          fingerprint: 'BB:01',
          isLocal: false,
        },
      ],
      activeId: 'build-box',
      windowBackendId: 'build-box',
    }),
  );
  setSupport({ labs: true, supported: true, claimInvites: true });
  store.dispatch(rowHighlighted(null));
  store.dispatch(pasteClosed());
  inspectReply = { ok: true, pendingId: 'inv-p1', label: 'GPU rig' };
  claimReply = { ok: true, machine: MACHINE };
  invoke = vi.fn(async (name: string) => {
    if (name === CHANNELS.INVITE_INSPECT) return inspectReply;
    if (name === CHANNELS.INVITE_CLAIM) return claimReply;
    return { ok: true };
  });
  (window as unknown as { electronAPI: unknown }).electronAPI = { invoke };
  ui.confirm.mockResolvedValue(true);
  start();
});

afterEach(() => {
  task.cancel();
  vi.clearAllMocks();
});

describe('paste an intent://node link', () => {
  it('asks to make the machine available to the current backend before claiming', async () => {
    submit(LINK);
    await vi.waitFor(() => expect(calls(CHANNELS.INVITE_CLAIM)).toHaveLength(1));
    expect(ui.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Make GPU rig available to Build box?',
        confirmLabel: 'Make available',
      }),
    );
    const claimIndex = invoke.mock.calls.findIndex(([name]) => name === CHANNELS.INVITE_CLAIM);
    expect(ui.confirm.mock.invocationCallOrder[0]).toBeLessThan(
      invoke.mock.invocationCallOrder[claimIndex],
    );
    expect(calls(CHANNELS.INVITE_CLAIM)).toEqual([
      [CHANNELS.INVITE_CLAIM, { pendingId: 'inv-p1' }],
    ]);
  });

  it('never puts the invite secret in an action or in state', async () => {
    submit(LINK);
    await vi.waitFor(() => expect(store.state.nodes.highlightId).toBe('d-gpu'));
    expect(JSON.stringify(seen)).not.toContain(SECRET);
    expect(JSON.stringify(store.state.nodes)).not.toContain(SECRET);
    expect(calls(CHANNELS.INVITE_INSPECT)).toEqual([[CHANNELS.INVITE_INSPECT, { uri: LINK }]]);
  });

  it('lists the claimed machine at once, highlights it and closes the paste row', async () => {
    submit(LINK);
    await vi.waitFor(() => expect(store.state.nodes.highlightId).toBe('d-gpu'));
    expect(store.state.remoteMachines.machines['d-gpu']?.name).toBe('GPU rig');
    expect(store.state.nodes.paste.phase).toBe('closed');
  });

  it('shows the masked link while the backend claims it', async () => {
    let finish: (reply: NodeInviteClaimResult) => void = () => {};
    claimReply = new Promise((resolve) => (finish = resolve));
    submit(LINK);
    await vi.waitFor(() => expect(store.state.nodes.paste.phase).toBe('testing'));
    expect(store.state.nodes.paste.masked).toContain('secret=••••');
    finish({ ok: true, machine: MACHINE });
    await vi.waitFor(() => expect(store.state.nodes.paste.phase).toBe('closed'));
  });

  it('Cancel while the backend claims keeps the row closed when the claim fails', async () => {
    let finish: (reply: NodeInviteClaimResult) => void = () => {};
    claimReply = new Promise((resolve) => (finish = resolve));
    submit(LINK);
    await vi.waitFor(() => expect(store.state.nodes.paste.phase).toBe('testing'));
    dispatch(pasteClosed());
    finish({ ok: false, code: 'node-invite-used' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.state.nodes.paste.phase).toBe('closed');
    expect(store.state.nodes.paste.error).toBeNull();
  });

  it('Cancel while the backend claims still lists a machine it added', async () => {
    let finish: (reply: NodeInviteClaimResult) => void = () => {};
    claimReply = new Promise((resolve) => (finish = resolve));
    submit(LINK);
    await vi.waitFor(() => expect(store.state.nodes.paste.phase).toBe('testing'));
    dispatch(pasteClosed());
    finish({ ok: true, machine: MACHINE });
    await vi.waitFor(() => expect(store.state.nodes.highlightId).toBe('d-gpu'));
    expect(store.state.remoteMachines.machines['d-gpu']).toBeDefined();
    expect(store.state.nodes.paste.phase).toBe('closed');
  });

  it('Cancel in the dialog drops the held link and claims nothing', async () => {
    ui.confirm.mockResolvedValue(false);
    submit(LINK);
    await vi.waitFor(() =>
      expect(calls(CHANNELS.INVITE_DISCARD)).toEqual([
        [CHANNELS.INVITE_DISCARD, { pendingId: 'inv-p1' }],
      ]),
    );
    expect(calls(CHANNELS.INVITE_CLAIM)).toHaveLength(0);
    expect(store.state.nodes.paste.phase).toBe('closed');
  });

  it.each([['not-a-link' as const], ['incomplete' as const], ['link-version' as const]])(
    'shows a %s link inline without asking',
    async (code) => {
      inspectReply = { ok: false, code };
      submit(LINK);
      await vi.waitFor(() => expect(store.state.nodes.paste.error?.code).toBe(code));
      expect(ui.confirm).not.toHaveBeenCalled();
      expect(calls(CHANNELS.INVITE_CLAIM)).toHaveLength(0);
    },
  );

  it.each([
    ['node-invite-invalid', 'node-invite-invalid'],
    ['node-invite-expired', 'node-invite-expired'],
    ['node-invite-used', 'node-invite-used'],
    ['node-invite-revoked', 'node-invite-revoked'],
    ['node-invite-self', 'node-invite-self'],
    ['certificate-mismatch', 'certificate-mismatch'],
    ['machine-update-required', 'machine-update-required'],
    ['invalid-node-link', 'incomplete'],
    ['not-owner', 'invite-not-owner'],
    ['backend-unsupported', 'invites-unsupported'],
    ['expired', 'expired'],
    ['failed', 'failed'],
  ] as const)('shows a %s claim failure inline, naming the machine', async (code, shown) => {
    claimReply = { ok: false, code };
    submit(LINK);
    await vi.waitFor(() => expect(store.state.nodes.paste.error?.code).toBe(shown));
    expect(store.state.nodes.paste.error?.node).toBe('GPU rig');
    expect(store.state.nodes.highlightId).toBeNull();
  });

  it('shows the routes the backend tried, and Try again claims a fresh copy', async () => {
    claimReply = { ok: false, code: 'machine-unreachable', routes: ['192.0.2.20:7443'] };
    submit(LINK);
    await vi.waitFor(() => expect(store.state.nodes.paste.error?.code).toBe('machine-unreachable'));
    expect(store.state.nodes.paste.error?.routes).toEqual(['192.0.2.20:7443']);
    claimReply = { ok: true, machine: MACHINE };
    inspectReply = { ok: true, pendingId: 'inv-p2', label: 'GPU rig' };
    dispatch(pasteLinkRetried());
    await vi.waitFor(() => expect(store.state.nodes.highlightId).toBe('d-gpu'));
    expect(calls(CHANNELS.INVITE_CLAIM).at(-1)).toEqual([
      CHANNELS.INVITE_CLAIM,
      { pendingId: 'inv-p2' },
    ]);
  });

  it('keeps whether the claim may have used the invite', async () => {
    claimReply = { ok: false, code: 'machine-unreachable', inviteSpent: true, routes: ['r'] };
    submit(LINK);
    await vi.waitFor(() => expect(store.state.nodes.paste.error?.inviteSpent).toBe(true));
    expect(store.state.nodes.paste.error?.code).toBe('machine-unreachable');
  });

  it('names a tunnel-only link "this node"', async () => {
    inspectReply = { ok: true, pendingId: 'inv-p1', label: null };
    submit(LINK);
    await vi.waitFor(() =>
      expect(ui.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Make this node available to Build box?' }),
      ),
    );
  });

  it('a failed bridge call shows a failure instead of hanging', async () => {
    invoke.mockImplementation(async (name: string) => {
      if (name === CHANNELS.INVITE_INSPECT) return inspectReply;
      throw new Error('bridge down');
    });
    submit(LINK);
    await vi.waitFor(() => expect(store.state.nodes.paste.error?.code).toBe('failed'));
  });
});

describe('refusals', () => {
  it('refuses while Labs Remote agents is off: no dialog, nothing claimed', async () => {
    setSupport({ labs: false, supported: true, claimInvites: true });
    submit(LINK);
    await vi.waitFor(() => expect(store.state.nodes.paste.error?.code).toBe('labs-off'));
    expect(ui.confirm).not.toHaveBeenCalled();
    expect(calls(CHANNELS.INVITE_CLAIM)).toHaveLength(0);
    expect(calls(CHANNELS.INVITE_DISCARD)).toHaveLength(1);
  });

  it('refuses when the backend cannot run agents on other machines, after reading it again', async () => {
    setSupport({ labs: true, supported: false, claimInvites: false });
    submit(LINK);
    await vi.waitFor(() => expect(types()).toContain(remoteMachinesRefreshRequested.toString()));
    dispatch(
      remoteMachinesLoaded({
        supported: false,
        machines: [],
        localFingerprint: null,
        executorBackends: [],
      }),
    );
    await vi.waitFor(() => expect(store.state.nodes.paste.error?.code).toBe('backend-unsupported'));
    expect(ui.confirm).not.toHaveBeenCalled();
    expect(calls(CHANNELS.INVITE_CLAIM)).toHaveLength(0);
  });

  it('refuses when the backend runs remote agents but cannot claim node links', async () => {
    setSupport({ labs: true, supported: true, claimInvites: false });
    submit(LINK);
    await vi.waitFor(() => expect(types()).toContain(remoteMachinesRefreshRequested.toString()));
    dispatch(
      remoteMachinesLoaded({
        supported: true,
        claimInvites: false,
        machines: [],
        localFingerprint: null,
        executorBackends: [],
      }),
    );
    await vi.waitFor(() => expect(store.state.nodes.paste.error?.code).toBe('invites-unsupported'));
    expect(calls(CHANNELS.INVITE_CLAIM)).toHaveLength(0);
  });

  it('proceeds when a fresh read shows the backend can claim', async () => {
    setSupport({ labs: true, supported: true, claimInvites: false });
    submit(LINK);
    await vi.waitFor(() => expect(types()).toContain(remoteMachinesRefreshRequested.toString()));
    dispatch(
      remoteMachinesLoaded({
        supported: true,
        claimInvites: true,
        machines: [],
        localFingerprint: null,
        executorBackends: [],
      }),
    );
    await vi.waitFor(() => expect(calls(CHANNELS.INVITE_CLAIM)).toHaveLength(1));
  });

  it('Cancel while support is checked stops before the dialog', async () => {
    setSupport({ labs: true, supported: false, claimInvites: false });
    submit(LINK);
    await vi.waitFor(() => expect(types()).toContain(remoteMachinesRefreshRequested.toString()));
    dispatch(pasteClosed());
    await vi.waitFor(() => expect(calls(CHANNELS.INVITE_DISCARD)).toHaveLength(1));
    expect(ui.confirm).not.toHaveBeenCalled();
    expect(store.state.nodes.paste.error).toBeNull();
  });
});

describe('a node link opened from outside the app', () => {
  it('goes to Settings → Machines, asks, claims and highlights the machine', async () => {
    dispatch(nodeInviteReceived({ pendingId: 'inv-os', label: 'GPU rig' }));
    await vi.waitFor(() => expect(store.state.nodes.highlightId).toBe('d-gpu'));
    expect(ui.navigateToSettings).toHaveBeenCalledWith({ tab: 'devices' });
    expect(ui.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Make GPU rig available to Build box?' }),
    );
    expect(calls(CHANNELS.INVITE_CLAIM)).toEqual([
      [CHANNELS.INVITE_CLAIM, { pendingId: 'inv-os' }],
    ]);
  });

  it('shows a claim failure as an error toast', async () => {
    claimReply = { ok: false, code: 'node-invite-used' };
    dispatch(nodeInviteReceived({ pendingId: 'inv-os', label: 'GPU rig' }));
    await vi.waitFor(() => expect(ui.error).toHaveBeenCalled());
    expect(ui.error.mock.calls[0][0]).toContain('already used');
  });

  it('refuses while Labs Remote agents is off and drops the held link', async () => {
    setSupport({ labs: false, supported: true, claimInvites: true });
    dispatch(nodeInviteReceived({ pendingId: 'inv-os', label: 'GPU rig' }));
    await vi.waitFor(() => expect(ui.error).toHaveBeenCalled());
    expect(ui.error.mock.calls[0][0]).toContain('Settings → Labs');
    expect(calls(CHANNELS.INVITE_DISCARD)).toEqual([
      [CHANNELS.INVITE_DISCARD, { pendingId: 'inv-os' }],
    ]);
    expect(ui.confirm).not.toHaveBeenCalled();
  });
});
