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
  machineRailReducer,
  removeRailMachineRequested,
  reorderRailMachinesRequested,
  selectRailMachineRequested,
  setMachineRailEnabledRequested,
} from '../machine-rail-slice';
import { MACHINE_HIDDEN_ATTRIBUTE } from '$shared/types/machine-rail';
import { machineRailSaga } from './machine-rail-saga';

// The root attributes app.css keys the rail inset and the hidden page on.
const MACHINE_RAIL_ATTRIBUTE = 'data-machine-rail';
const MACHINE_PAGE_HIDDEN_ATTRIBUTE = 'data-machine-page-hidden';

const initialState = machineRailReducer(undefined, { type: '@@INIT' } as never);

const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

const railState = (overrides: Partial<MachineRailState> = {}): MachineRailState => ({
  enabled: true,
  homeId: 'local',
  machineIds: ['local'],
  selectedId: 'local',
  shownId: 'local',
  pendingId: '',
  degradedIds: [],
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
    pushBackendStatus: (status: unknown) => listeners.get('backend:status')?.(status),
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
    daemonHealth: { health: 'down' as string },
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
  const setHealth = (health: string) => {
    state = { ...state, daemonHealth: { health } };
    for (const listener of listeners) listener();
  };
  return { dispatch, task, getState: () => state, setHealth };
}

describe('machineRailSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    document.documentElement.removeAttribute(MACHINE_HIDDEN_ATTRIBUTE);
    document.documentElement.removeAttribute(MACHINE_RAIL_ATTRIBUTE);
    document.documentElement.removeAttribute(MACHINE_PAGE_HIDDEN_ATTRIBUTE);
    document.getElementById('splash')?.remove();
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
    [
      'reorder',
      reorderRailMachinesRequested(['local', 'c', 'b']),
      'machine-rail:reorder',
      { machineIds: ['local', 'c', 'b'] },
    ],
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

  it("keeps the window's own page up until the selected machine is on screen", async () => {
    const rail = { machineIds: ['local', 'b'] };
    const main = installMain(railState({ ...rail, selectedId: 'b', shownId: 'local' }));
    const { task } = createHarness('local');
    await settle();
    const pageHidden = () => document.documentElement.hasAttribute(MACHINE_PAGE_HIDDEN_ATTRIBUTE);
    expect(pageHidden()).toBe(false);
    main.push(railState({ ...rail, selectedId: 'b', shownId: 'b' }));
    await settle();
    expect(pageHidden()).toBe(true);
    // Switching back shows the page at once, before main takes the other machine away.
    main.push(railState({ ...rail, selectedId: 'local', shownId: 'b' }));
    await settle();
    expect(pageHidden()).toBe(false);
    task.cancel();
  });

  it("never hides another machine's page: main hides its view instead", async () => {
    installMain(railState({ machineIds: ['local', 'b'] }));
    const { task } = createHarness('b');
    await settle();
    expect(document.documentElement.hasAttribute(MACHINE_PAGE_HIDDEN_ATTRIBUTE)).toBe(false);
    expect(document.documentElement.hasAttribute(MACHINE_HIDDEN_ATTRIBUTE)).toBe(true);
    task.cancel();
  });

  it('reports ready once its backend answers, dropping the splash of a machine not shown', async () => {
    const main = installMain(railState({ machineIds: ['local', 'b'], pendingId: 'b' }));
    const splash = document.createElement('div');
    splash.id = 'splash';
    document.body.append(splash);
    const { task } = createHarness('b');
    await settle();
    expect(main.invoke).not.toHaveBeenCalledWith('machine-rail:ready', {});
    main.pushBackendStatus({ status: 'connected' });
    await settle();
    expect(main.invoke).toHaveBeenCalledWith('machine-rail:ready', {});
    expect(document.getElementById('splash')).toBeNull();
    task.cancel();
  });

  it('keeps the splash of the machine on screen when it reports ready', async () => {
    const main = installMain(railState());
    const splash = document.createElement('div');
    splash.id = 'splash';
    document.body.append(splash);
    const { task } = createHarness('local');
    await settle();
    main.pushBackendStatus({ status: 'connected' });
    await settle();
    expect(main.invoke).toHaveBeenCalledWith('machine-rail:ready', {});
    expect(document.getElementById('splash')).toBe(splash);
    task.cancel();
  });

  it("reports its machine's degraded health to main, and its recovery", async () => {
    const main = installMain(railState());
    const { task, setHealth } = createHarness('local');
    await settle();
    setHealth('degraded');
    await settle();
    expect(main.invoke).toHaveBeenLastCalledWith('machine-rail:health', { degraded: true });
    setHealth('healthy');
    await settle();
    expect(main.invoke).toHaveBeenLastCalledWith('machine-rail:health', { degraded: false });
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

  it('does nothing without the desktop bridge', async () => {
    const { dispatch, task } = createHarness();
    await settle();
    expect(dispatch).not.toHaveBeenCalled();
    expect(task.isRunning()).toBe(false);
  });
});
