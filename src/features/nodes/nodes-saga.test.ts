/**
 * @vitest-environment jsdom
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
  remoteMachineExposeRequested,
  remoteMachinesLoaded,
  remoteMachinesRefreshRequested,
} from '$features/remote-machines/remote-machines-slice';
import type { ConnectionRecord } from '$shared/types/connections';
import type { PairLinkInspectResult } from '$shared/types/pair-link';
import { nodesSaga } from './nodes-saga';
import {
  nodeConnectionOpened,
  nodeLinkReceived,
  pasteClosed,
  pasteLinkRequested,
  pasteLinkRetried,
  pasteLinkSubmitted,
} from './nodes-slice';
import { stashPastedLink } from './pasted-link';

const TOKEN = 'owner-secret-token';
const LINK = `intent://pair?v=1&host=192.0.2.20&port=7443&fp=AA%3A20&token=${TOKEN}`;
const CHANNELS = IPC_CHANNELS.CONNECTIONS;

const NODE: ConnectionRecord = {
  id: 'gpu-rig',
  label: 'GPU rig',
  host: '192.0.2.20',
  port: 7443,
  fingerprint: 'AA:20',
  isLocal: false,
  daemonMode: 'node',
};

let task: Task;
let channel: ReturnType<typeof stdChannel>;
let seen: { type: string; payload?: unknown[] }[];
let inspectReply: PairLinkInspectResult | Promise<PairLinkInspectResult>;
let invoke: ReturnType<typeof vi.fn>;
let clipboard: string;

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

function setSupport({ labs, supported }: { labs: boolean; supported: boolean }) {
  store.dispatch(setLabsRemoteAgentsEnabled(labs));
  store.dispatch(
    remoteMachinesLoaded({ supported, machines: [], localFingerprint: null, executorBackends: [] }),
  );
}

const nodeInspected = (): PairLinkInspectResult => ({
  ok: true,
  pendingId: 'p1',
  kind: 'node',
  label: 'GPU rig',
  existingId: null,
});

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
  setSupport({ labs: true, supported: true });
  inspectReply = nodeInspected();
  clipboard = '';
  invoke = vi.fn(async (name: string) => {
    if (name === CHANNELS.PAIR_LINK_INSPECT) return inspectReply;
    if (name === CHANNELS.PAIR_LINK_COMMIT) return { ok: true, connection: NODE };
    return { ok: true };
  });
  (window as unknown as { electronAPI: unknown }).electronAPI = { invoke };
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { readText: vi.fn(async () => clipboard) },
  });
  ui.confirm.mockResolvedValue(true);
  start();
});

afterEach(() => {
  task.cancel();
  vi.clearAllMocks();
});

describe('paste an intent:// link', () => {
  it('adds a full machine directly: no prompt, row highlighted, paste row closed', async () => {
    inspectReply = {
      ok: true,
      pendingId: 'p1',
      kind: 'machine',
      label: 'Lab PC',
      existingId: null,
    };
    invoke.mockImplementation(async (name: string) =>
      name === CHANNELS.PAIR_LINK_INSPECT
        ? inspectReply
        : { ok: true, connection: { ...NODE, id: 'lab-pc', daemonMode: 'regular' } },
    );
    submit(LINK);
    await vi.waitFor(() => expect(store.state.nodes.highlightId).toBe('lab-pc'));
    expect(calls(CHANNELS.PAIR_LINK_COMMIT)).toEqual([
      [CHANNELS.PAIR_LINK_COMMIT, { pendingId: 'p1' }],
    ]);
    expect(ui.confirm).not.toHaveBeenCalled();
    expect(store.state.nodes.paste.phase).toBe('closed');
  });

  it('adds a node, then asks before making it available', async () => {
    submit(LINK);
    await vi.waitFor(() => expect(types()).toContain(remoteMachineExposeRequested.toString()));
    expect(ui.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ confirmLabel: 'Make available', cancelLabel: 'Not now' }),
    );
    const expose = seen.find((a) => a.type === remoteMachineExposeRequested.toString());
    expect(expose?.payload).toEqual(['gpu-rig', undefined, true]);
    expect(store.state.nodes.highlightId).toBe('gpu-rig');
  });

  it('Not now keeps the node saved and makes nothing available', async () => {
    ui.confirm.mockResolvedValue(false);
    submit(LINK);
    await vi.waitFor(() => expect(ui.confirm).toHaveBeenCalled());
    await Promise.resolve();
    expect(calls(CHANNELS.PAIR_LINK_COMMIT)).toHaveLength(1);
    expect(types()).not.toContain(remoteMachineExposeRequested.toString());
  });

  it('does not ask again for a node that is already available', async () => {
    store.dispatch(
      remoteMachinesLoaded({
        supported: true,
        machines: [
          {
            id: 'd-gpu',
            name: 'GPU rig',
            hosts: ['192.0.2.20'],
            port: 7443,
            fingerprint: 'AA:20',
            state: 'connected',
            runningAgents: 0,
            observedAt: '2026-11-07T00:00:00Z',
            addedAt: '2026-11-07T00:00:00Z',
          },
        ],
        localFingerprint: null,
        executorBackends: [],
      }),
    );
    submit(LINK);
    await vi.waitFor(() => expect(store.state.nodes.highlightId).toBe('gpu-rig'));
    expect(ui.confirm).not.toHaveBeenCalled();
  });

  it('refuses a node while Labs Remote agents is off: nothing saved', async () => {
    setSupport({ labs: false, supported: false });
    submit(LINK);
    await vi.waitFor(() => expect(store.state.nodes.paste.error?.code).toBe('labs-off'));
    expect(calls(CHANNELS.PAIR_LINK_DISCARD)).toEqual([
      [CHANNELS.PAIR_LINK_DISCARD, { pendingId: 'p1' }],
    ]);
    expect(calls(CHANNELS.PAIR_LINK_COMMIT)).toHaveLength(0);
    expect(store.state.nodes.paste.error?.node).toBe('GPU rig');
  });

  it('refuses a node when the backend cannot run agents elsewhere: nothing saved', async () => {
    setSupport({ labs: true, supported: false });
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
    expect(calls(CHANNELS.PAIR_LINK_DISCARD)).toHaveLength(1);
    expect(calls(CHANNELS.PAIR_LINK_COMMIT)).toHaveLength(0);
  });

  it('rejects text that is not a link without asking main', async () => {
    submit('build box please');
    await vi.waitFor(() => expect(store.state.nodes.paste.error?.code).toBe('not-a-link'));
    expect(invoke).not.toHaveBeenCalled();
  });

  it('shows the routes tried, and Try again tests the same link again', async () => {
    inspectReply = { ok: false, code: 'unreachable', routes: ['192.0.2.20:7443'] };
    submit(LINK);
    await vi.waitFor(() =>
      expect(store.state.nodes.paste.error?.routes).toEqual(['192.0.2.20:7443']),
    );
    inspectReply = nodeInspected();
    dispatch(pasteLinkRetried());
    await vi.waitFor(() => expect(calls(CHANNELS.PAIR_LINK_COMMIT)).toHaveLength(1));
    expect(calls(CHANNELS.PAIR_LINK_INSPECT).map(([, params]) => params)).toEqual([
      { uri: LINK },
      { uri: LINK },
    ]);
  });

  it('keeps the token out of state: only a masked link is shown while testing', async () => {
    let resolve!: (value: PairLinkInspectResult) => void;
    inspectReply = new Promise((r) => (resolve = r));
    submit(LINK);
    await vi.waitFor(() => expect(store.state.nodes.paste.phase).toBe('testing'));
    expect(store.state.nodes.paste.masked).toContain('token=••••');
    expect(JSON.stringify(store.state)).not.toContain(TOKEN);
    resolve({ ok: false, code: 'rejected' });
    await vi.waitFor(() => expect(store.state.nodes.paste.error?.code).toBe('rejected'));
    expect(JSON.stringify(store.state)).not.toContain(TOKEN);
  });

  it('never puts the link in an action', async () => {
    submit(LINK);
    await vi.waitFor(() => expect(calls(CHANNELS.PAIR_LINK_COMMIT)).toHaveLength(1));
    expect(JSON.stringify(seen)).not.toContain(TOKEN);
  });

  it('Cancel while the backend is checked drops the tested credential: nothing saved', async () => {
    setSupport({ labs: true, supported: false });
    submit(LINK);
    await vi.waitFor(() => expect(types()).toContain(remoteMachinesRefreshRequested.toString()));
    dispatch(pasteClosed());
    await vi.waitFor(() =>
      expect(calls(CHANNELS.PAIR_LINK_DISCARD)).toEqual([
        [CHANNELS.PAIR_LINK_DISCARD, { pendingId: 'p1' }],
      ]),
    );
    expect(calls(CHANNELS.PAIR_LINK_COMMIT)).toHaveLength(0);
  });

  it('ignores a second paste while one is being tested', async () => {
    let resolve!: (value: PairLinkInspectResult) => void;
    inspectReply = new Promise((r) => (resolve = r));
    submit(LINK);
    await vi.waitFor(() => expect(store.state.nodes.paste.phase).toBe('testing'));
    submit(LINK);
    resolve(nodeInspected());
    await vi.waitFor(() => expect(calls(CHANNELS.PAIR_LINK_COMMIT)).toHaveLength(1));
    expect(calls(CHANNELS.PAIR_LINK_INSPECT)).toHaveLength(1);
  });

  it('Cancel while testing stops: nothing is saved', async () => {
    let resolve!: (value: PairLinkInspectResult) => void;
    inspectReply = new Promise((r) => (resolve = r));
    submit(LINK);
    await vi.waitFor(() => expect(store.state.nodes.paste.phase).toBe('testing'));
    dispatch(pasteClosed());
    resolve(nodeInspected());
    await vi.waitFor(() =>
      expect(calls(CHANNELS.PAIR_LINK_DISCARD)).toEqual([
        [CHANNELS.PAIR_LINK_DISCARD, { pendingId: 'p1' }],
      ]),
    );
    expect(calls(CHANNELS.PAIR_LINK_COMMIT)).toHaveLength(0);
    expect(store.state.nodes.paste.phase).toBe('closed');
  });

  it('tests a link from the clipboard at once, else opens the field', async () => {
    clipboard = 'not a link';
    dispatch(pasteLinkRequested());
    await vi.waitFor(() => expect(store.state.nodes.paste.phase).toBe('field'));
    expect(store.state.nodes.paste.error).toBeNull();
    expect(invoke).not.toHaveBeenCalled();

    clipboard = `  ${LINK}\n`;
    dispatch(pasteLinkRequested());
    await vi.waitFor(() => expect(calls(CHANNELS.PAIR_LINK_INSPECT)).toHaveLength(1));
    expect(calls(CHANNELS.PAIR_LINK_INSPECT)[0][1]).toEqual({ uri: LINK });
  });
});

describe('a node link opened from outside the app', () => {
  it('opens Settings → Machines and asks with the same prompt', async () => {
    dispatch(nodeLinkReceived({ pendingId: 'p9', label: 'GPU rig', existingId: null }));
    await vi.waitFor(() => expect(ui.confirm).toHaveBeenCalled());
    expect(ui.navigateToSettings).toHaveBeenCalledWith({ tab: 'devices' });
    expect(calls(CHANNELS.PAIR_LINK_COMMIT)).toEqual([
      [CHANNELS.PAIR_LINK_COMMIT, { pendingId: 'p9' }],
    ]);
  });

  it('handles two links one after the other, each with its prompt', async () => {
    let answer!: (value: boolean) => void;
    ui.confirm.mockImplementationOnce(() => new Promise<boolean>((r) => (answer = r)));
    dispatch(nodeLinkReceived({ pendingId: 'p1', label: 'GPU rig', existingId: null }));
    await vi.waitFor(() => expect(ui.confirm).toHaveBeenCalledTimes(1));
    dispatch(nodeLinkReceived({ pendingId: 'p2', label: 'Garage Pi', existingId: null }));
    await Promise.resolve();
    expect(calls(CHANNELS.PAIR_LINK_COMMIT)).toHaveLength(1);
    answer(false);
    await vi.waitFor(() => expect(ui.confirm).toHaveBeenCalledTimes(2));
    expect(calls(CHANNELS.PAIR_LINK_COMMIT).map(([, params]) => params)).toEqual([
      { pendingId: 'p1' },
      { pendingId: 'p2' },
    ]);
  });

  it('is refused with an error when the backend cannot use nodes', async () => {
    setSupport({ labs: false, supported: false });
    dispatch(nodeLinkReceived({ pendingId: 'p9', label: 'GPU rig', existingId: null }));
    await vi.waitFor(() => expect(ui.error).toHaveBeenCalled());
    expect(calls(CHANNELS.PAIR_LINK_DISCARD)).toHaveLength(1);
    expect(calls(CHANNELS.PAIR_LINK_COMMIT)).toHaveLength(0);
    expect(String(ui.error.mock.calls[0][0])).toContain('GPU rig');
  });

  it('reports a credential that expired before the window could ask', async () => {
    invoke.mockImplementation(async (name: string) =>
      name === CHANNELS.PAIR_LINK_COMMIT ? { ok: false, code: 'expired' } : { ok: true },
    );
    dispatch(nodeLinkReceived({ pendingId: 'p9', label: 'GPU rig', existingId: null }));
    await vi.waitFor(() => expect(ui.error).toHaveBeenCalled());
    expect(ui.confirm).not.toHaveBeenCalled();
  });
});

describe('the Add machine dialog reached a node', () => {
  it('removes a just-added node the backend cannot use', async () => {
    setSupport({ labs: false, supported: false });
    store.dispatch(
      connectionsListReceived({
        connections: [NODE],
        activeId: 'build-box',
        windowBackendId: 'build-box',
      }),
    );
    dispatch(nodeConnectionOpened('gpu-rig', true));
    await vi.waitFor(() => expect(ui.error).toHaveBeenCalled());
    expect(types()).toContain('connections/forgetRequested');
  });

  it('keeps an already saved node and asks when the backend can use it', async () => {
    store.dispatch(
      connectionsListReceived({
        connections: [NODE],
        activeId: 'build-box',
        windowBackendId: 'build-box',
      }),
    );
    dispatch(nodeConnectionOpened('gpu-rig', false));
    await vi.waitFor(() => expect(ui.confirm).toHaveBeenCalled());
    expect(types()).not.toContain('connections/forgetRequested');
  });
});
