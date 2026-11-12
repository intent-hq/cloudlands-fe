/**
 * @vitest-environment jsdom
 *
 * Add machine → Intent on this computer: the saga reads the discovery list
 * over `local-pairing:list` while the form is open, redeems the stashed code
 * over `local-pairing:redeem`, then highlights and opens the saved machine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { LocalIntent, LocalRedeemResult } from '$shared/types/local-pairing';
import { store } from '$store/renderer/store';
import { setLabsLocalPairingEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { openConnectionRequested } from '$store/renderer/slices/connections/connections-slice';
import { rowHighlighted } from '$features/nodes/nodes-slice';
import { localIntentAddSaga } from './local-intent-add-saga';
import {
  localIntentAddClosed,
  localIntentAddOpened,
  localIntentPicked,
  localIntentRedeemSubmitted,
  stashLocalCode,
} from './local-intent-add-slice';

const INTENTS: LocalIntent[] = [
  { instanceId: 'b', displayName: 'Intent Beta', dataDir: '/tmp/b', accepting: true },
  { instanceId: 'c', displayName: 'Intent (dev build)', dataDir: '/tmp/c', accepting: false },
];

let task: Task;
let channel: ReturnType<typeof stdChannel>;
let redeemReply: LocalRedeemResult;
let listReply: unknown;
const invoke = vi.fn(async (channelName: string, _payload?: unknown): Promise<unknown> => {
  if (channelName === IPC_CHANNELS.LOCAL_PAIRING.LIST) return listReply;
  if (channelName === IPC_CHANNELS.LOCAL_PAIRING.REDEEM) return redeemReply;
  return undefined;
});
const dispatched: { type: string; payload?: unknown }[] = [];

function dispatch(action: { type: string }) {
  store.dispatch(action as Parameters<typeof store.dispatch>[0]);
  channel.put(action);
}

const calls = (name: string) => invoke.mock.calls.filter(([channelName]) => channelName === name);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  invoke.mockClear();
  dispatched.length = 0;
  listReply = { ok: true, intents: INTENTS };
  redeemReply = { ok: false, error: { code: 'unknown' } };
  (window as unknown as { electronAPI: { invoke: typeof invoke } }).electronAPI = { invoke };
  store.init();
  channel = stdChannel();
  task = runSaga(
    {
      channel,
      getState: () => store.state,
      dispatch: (action: { type: string; payload?: unknown }) => {
        dispatched.push(action);
        store.dispatch(action as Parameters<typeof store.dispatch>[0]);
        channel.put(action);
      },
    },
    localIntentAddSaga,
  );
  dispatch(setLabsLocalPairingEnabled(true));
});

afterEach(() => {
  task.cancel();
  vi.useRealTimers();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

async function opened() {
  dispatch(localIntentAddOpened());
  await vi.waitFor(() => expect(store.state.localIntentAdd.intents).toEqual(INTENTS));
}

async function submit(code: string, instanceId = 'b') {
  dispatch(localIntentPicked(instanceId));
  stashLocalCode(code);
  dispatch(localIntentRedeemSubmitted());
}

describe('localIntentAddSaga', () => {
  it('reads the list on open and again while the form stays open, then stops', async () => {
    await opened();
    expect(calls(IPC_CHANNELS.LOCAL_PAIRING.LIST)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.waitFor(() => expect(calls(IPC_CHANNELS.LOCAL_PAIRING.LIST)).toHaveLength(2));
    dispatch(localIntentAddClosed());
    await vi.advanceTimersByTimeAsync(6_000);
    expect(calls(IPC_CHANNELS.LOCAL_PAIRING.LIST)).toHaveLength(2);
    expect(store.state.localIntentAdd.phase).toBe('closed');
  });

  it('keeps the list and reports a failed read', async () => {
    await opened();
    listReply = { ok: false, code: 'unavailable' };
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.waitFor(() => expect(store.state.localIntentAdd.listFailed).toBe(true));
    expect(store.state.localIntentAdd.intents).toEqual(INTENTS);
  });

  it('redeems the code for the picked Intent, then highlights and opens the machine', async () => {
    redeemReply = {
      ok: true,
      connection: { id: 'conn-b', label: 'Intent Beta' } as Extract<
        LocalRedeemResult,
        { ok: true }
      >['connection'],
    };
    await opened();
    await submit('KTP-82M');
    await vi.waitFor(() => expect(store.state.localIntentAdd.phase).toBe('added'));
    expect(calls(IPC_CHANNELS.LOCAL_PAIRING.REDEEM)).toEqual([
      [IPC_CHANNELS.LOCAL_PAIRING.REDEEM, { instanceId: 'b', code: 'KTP-82M' }],
    ]);
    expect(store.state.localIntentAdd.addedName).toBe('Intent Beta');
    const highlight = dispatched.find((a) => a.type === rowHighlighted('x').type);
    const open = dispatched.find((a) => a.type === openConnectionRequested('x').type);
    expect(highlight?.payload).toEqual(['conn-b']);
    expect(open?.payload).toEqual(['conn-b']);
  });

  it('shows the error and clears the code only when the code can never work', async () => {
    await opened();
    const resets = store.state.localIntentAdd.codeResets;
    redeemReply = { ok: false, error: { code: 'unreachable' } };
    await submit('KTP-82M');
    await vi.waitFor(() =>
      expect(store.state.localIntentAdd.error).toEqual({ code: 'unreachable' }),
    );
    expect(store.state.localIntentAdd.phase).toBe('ready');
    expect(store.state.localIntentAdd.codeResets).toBe(resets);

    redeemReply = { ok: false, error: { code: 'wrong-code', attemptsRemaining: 2 } };
    await submit('KTP-82N');
    await vi.waitFor(() =>
      expect(store.state.localIntentAdd.error).toEqual({
        code: 'wrong-code',
        attemptsRemaining: 2,
      }),
    );
    expect(store.state.localIntentAdd.codeResets).toBe(resets + 1);
  });

  it('re-reads the list when the picked Intent went away', async () => {
    await opened();
    redeemReply = { ok: false, error: { code: 'gone' } };
    listReply = { ok: true, intents: INTENTS.slice(1) };
    await submit('KTP-82M');
    await vi.waitFor(() =>
      expect(store.state.localIntentAdd.intents?.map((i) => i.instanceId)).toEqual(['c']),
    );
    expect(store.state.localIntentAdd.selectedId).toBe('c');
    expect(store.state.localIntentAdd.error).toEqual({ code: 'gone' });
  });

  it('sends nothing without a typed code', async () => {
    await opened();
    dispatch(localIntentPicked('b'));
    dispatch(localIntentRedeemSubmitted());
    await vi.waitFor(() =>
      expect(store.state.localIntentAdd.error).toEqual({ code: 'code-format' }),
    );
    expect(calls(IPC_CHANNELS.LOCAL_PAIRING.REDEEM)).toHaveLength(0);
  });

  it('closes the form when the lab is turned off', async () => {
    await opened();
    dispatch(setLabsLocalPairingEnabled(false));
    await vi.waitFor(() => expect(store.state.localIntentAdd.phase).toBe('closed'));
  });
});
