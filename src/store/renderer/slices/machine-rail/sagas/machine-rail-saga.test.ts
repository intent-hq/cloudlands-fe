import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const notifyError = vi.hoisted(() => vi.fn());
const notifyWarning = vi.hoisted(() => vi.fn());
const notifyDismiss = vi.hoisted(() => vi.fn());
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: notifyError, warning: notifyWarning, dismiss: notifyDismiss },
}));

import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import type { ConnectionRecord } from '$shared/types/connections';
import type { MachineRailState } from '$shared/types/machine-rail';
import {
  addRailMachineRequested,
  openRailMachineMenuRequested,
  machineRailReducer,
  removeRailMachineRequested,
  selectRailMachineRequested,
  setMachineRailEnabledRequested,
} from '../machine-rail-slice';
import { MACHINE_HIDDEN_ATTRIBUTE } from '$shared/types/machine-rail';
import { machineRailSaga } from './machine-rail-saga';

// The root attribute app.css keys the rail inset on.
const MACHINE_RAIL_ATTRIBUTE = 'data-machine-rail';

const initialState = machineRailReducer(undefined, { type: '@@INIT' } as never);

const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

const railState = (overrides: Partial<MachineRailState> = {}): MachineRailState => ({
  enabled: true,
  homeId: 'local',
  machineIds: ['local'],
  selectedId: 'local',
  ...overrides,
});

/** A stand-in for main: answers requests and can push `machine-rail:changed`. */
function installMain(initial: MachineRailState) {
  const listeners = new Map<string, (payload: any) => void>();
  const invoke = vi.fn(async (channel: string, _params?: unknown): Promise<MachineRailState> => {
    void channel;
    return initial;
  });
  const api = {
    invoke,
    on: vi.fn((channel: string, listener: (payload: any) => void) => {
      listeners.set(channel, listener);
      return 'listener-1';
    }),
    offById: vi.fn(),
  };
  (window as unknown as { electronAPI?: unknown }).electronAPI = api;
  return {
    invoke,
    push: (state: MachineRailState) => listeners.get('machine-rail:changed')?.(state),
    pushToast: (toast: unknown) => listeners.get('machine-rail:toast')?.(toast),
    pushMenuRequest: () => listeners.get('machine-rail:menu-requested')?.({ id: 'local' }),
  };
}

function createHarness(windowBackendId = 'local') {
  let state = {
    machineRail: initialState,
    connections: {
      windowBackendId,
      connections: createCollection<ConnectionRecord, 'id'>('id', [
        {
          id: 'b',
          label: 'Build box',
          host: '10.0.0.2',
          port: 5181,
          fingerprint: null,
          isLocal: false,
        },
      ]),
    },
    guestSessions: { sessions: createCollection<{ id: string }, 'id'>('id') },
  };
  const channel = stdChannel();
  const listeners = new Set<() => void>();
  const dispatch = vi.fn((action: any) => {
    state = { ...state, machineRail: machineRailReducer(state.machineRail, action) };
    channel.put(action);
    for (const listener of listeners) listener();
    return action;
  });
  const reduxStore = {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const task = runSaga(
    { channel, dispatch, getState: reduxStore.getState, context: { reduxStore } },
    machineRailSaga,
  );
  return { dispatch, task, getState: () => state };
}

describe('machineRailSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    document.documentElement.removeAttribute(MACHINE_HIDDEN_ATTRIBUTE);
    document.documentElement.removeAttribute(MACHINE_RAIL_ATTRIBUTE);
  });

  it('reads the rail from main on start', async () => {
    const main = installMain(railState({ machineIds: ['local', 'b'] }));
    const { task, getState } = createHarness();
    await settle();
    expect(main.invoke).toHaveBeenCalledWith('machine-rail:get-state', {});
    expect(getState().machineRail.machineIds).toEqual(['local', 'b']);
    task.cancel();
  });

  it.each([
    ['select', selectRailMachineRequested('b'), 'machine-rail:select', { id: 'b' }],
    ['add', addRailMachineRequested('b'), 'machine-rail:add', { id: 'b' }],
    ['remove', removeRailMachineRequested('b'), 'machine-rail:remove', { id: 'b' }],
    ['open menu', openRailMachineMenuRequested('b'), 'machine-rail:open-menu', { id: 'b' }],
    [
      'set enabled',
      setMachineRailEnabledRequested(false),
      'machine-rail:set-enabled',
      { enabled: false },
    ],
  ])('sends the %s request to main and applies its reply', async (_name, action, wire, params) => {
    const main = installMain(railState());
    const { dispatch, task, getState } = createHarness();
    await settle();
    const reply = railState({ machineIds: ['local', 'b'], selectedId: 'b' });
    main.invoke.mockResolvedValueOnce(reply);
    dispatch(action);
    await settle();
    expect(main.invoke).toHaveBeenLastCalledWith(wire, params);
    expect(getState().machineRail).toMatchObject(reply);
    task.cancel();
  });

  it('mirrors a pushed change from main', async () => {
    const main = installMain(railState());
    const { task, getState } = createHarness();
    await settle();
    main.push(railState({ machineIds: ['local', 'b'], selectedId: 'b' }));
    await settle();
    expect(getState().machineRail.selectedId).toBe('b');
    task.cancel();
  });

  it('keeps the state and reports an error when main refuses a request', async () => {
    const main = installMain(railState());
    const { dispatch, task, getState } = createHarness();
    await settle();
    main.invoke.mockRejectedValueOnce(new Error('Unknown machine'));
    dispatch(addRailMachineRequested('gone'));
    await settle();
    expect(getState().machineRail).toMatchObject(railState());
    expect(notifyError).toHaveBeenCalledTimes(1);
    task.cancel();
  });

  it('hides the page of a renderer whose machine is not the one shown', async () => {
    const main = installMain(railState({ machineIds: ['local', 'b'], selectedId: 'b' }));
    const { task } = createHarness('local');
    await settle();
    expect(document.documentElement.hasAttribute(MACHINE_HIDDEN_ATTRIBUTE)).toBe(true);
    main.push(railState({ machineIds: ['local', 'b'], selectedId: 'local' }));
    await settle();
    expect(document.documentElement.hasAttribute(MACHINE_HIDDEN_ATTRIBUTE)).toBe(false);
    task.cancel();
  });

  it('shows a toast forwarded from another machine under its name; activating it switches there', async () => {
    const main = installMain(railState({ machineIds: ['local', 'b'] }));
    const { task } = createHarness();
    await settle();
    notifyWarning.mockReturnValueOnce('toast-7');
    main.pushToast({ kind: 'warning', message: 'Agent needs you', machineId: 'b' });
    await settle();
    expect(notifyWarning).toHaveBeenCalledTimes(1);
    const [text, options] = notifyWarning.mock.calls[0] as [string, { class: string }];
    expect(text).toContain('Build box');
    expect(text).toContain('Agent needs you');

    // The toast host renders the toast with the classes it was given.
    const rendered = document.createElement('li');
    rendered.className = options.class;
    const close = document.createElement('button');
    const body = document.createElement('span');
    rendered.append(body, close);
    document.body.append(rendered);
    try {
      close.click();
      await settle();
      expect(main.invoke).not.toHaveBeenCalledWith('machine-rail:select', { id: 'b' });
      body.click();
      await settle();
      expect(main.invoke).toHaveBeenLastCalledWith('machine-rail:select', { id: 'b' });
      expect(notifyDismiss).toHaveBeenCalledWith('toast-7');
    } finally {
      rendered.remove();
    }
    task.cancel();
  });

  it("counts a request from main to open this machine's status menu", async () => {
    const main = installMain(railState());
    const { task, getState } = createHarness();
    await settle();
    expect(getState().machineRail.menuRequests).toBe(0);
    main.pushMenuRequest();
    await settle();
    expect(getState().machineRail.menuRequests).toBe(1);
    expect(getState().machineRail.machineIds).toEqual(['local']);
    task.cancel();
  });

  it('does nothing without the desktop bridge', async () => {
    const { dispatch, task } = createHarness();
    await settle();
    expect(dispatch).not.toHaveBeenCalled();
    expect(task.isRunning()).toBe(false);
  });
});
