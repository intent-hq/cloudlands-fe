/**
 * Machine Rail Saga (Labs)
 *
 * Mirrors the window's machine rail from main into the slice (first read plus
 * every `machine-rail:changed` push) and sends rail requests to main. Main
 * owns the list, the selection and the per-machine renderers; nothing is
 * decided here.
 */

import { takeLatestFromSelector, type SelectorChannelPayload } from '@themislib/themis/saga';
import { buffers, eventChannel, type EventChannel } from 'redux-saga';
import { call, fork, put, select, take, takeEvery } from 'typed-redux-saga';

import { notify } from '$lib/components/patterns/notify';
import { createLogger } from '$lib/utils/client-logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { m } from '$shared/paraglide/messages.js';
import {
  MACHINE_HIDDEN_ATTRIBUTE,
  MACHINE_RAIL_CHANGED_EVENT,
  MACHINE_RAIL_TOAST_EVENT,
  type MachineRailState,
  type MachineRailToastEvent,
} from '$shared/types/machine-rail';
import { formatConnectionLabel, formatLocalMachineLabel } from '$lib/utils/connection-label';
import { selectConnectionRecoveryTarget } from '../../connections/connections-selectors';
import { selectIsRailMachineShown, selectMachineRailEnabled } from '../machine-rail-selectors';
import {
  addRailMachineRequested,
  machineRailStateReceived,
  removeRailMachineRequested,
  selectRailMachineRequested,
  setMachineRailEnabledRequested,
} from '../machine-rail-slice';

const logger = createLogger('MachineRailSaga');
const MACHINE_RAIL = IPC_CHANNELS.MACHINE_RAIL;

/** Root attribute while the rail takes space at the window's left edge. */
const MACHINE_RAIL_ATTRIBUTE = 'data-machine-rail';

function getApi(): Window['electronAPI'] | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined;
}

function createChangedChannel(): EventChannel<MachineRailState> {
  return eventChannel<MachineRailState>((emit) => {
    const api = getApi();
    if (!api?.on) return () => {};
    const listenerId = api.on(MACHINE_RAIL_CHANGED_EVENT, (payload: MachineRailState) =>
      emit(payload),
    );
    return () => api.offById(MACHINE_RAIL_CHANGED_EVENT, listenerId);
  }, buffers.sliding<MachineRailState>(1));
}

async function invokeRail(channel: string, params?: unknown): Promise<MachineRailState> {
  const api = getApi();
  if (!api) throw new Error('electronAPI is not available');
  return (await api.invoke(channel, params)) as MachineRailState;
}

function* request(channel: string, params: unknown) {
  try {
    const state = yield* call(invokeRail, channel, params);
    yield* put(machineRailStateReceived(state));
  } catch (error) {
    logger.warn('machine rail request failed', { channel, error });
    yield* call(notify.error, m.machineRail_requestFailed_error());
  }
}

function toggleRootAttribute(name: string, active: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.toggleAttribute(name, active);
}

/**
 * Main tracks one "current workspace" per window for its menus and listens
 * only to the renderer the window shows, so a renderer reports its route
 * again each time it becomes the shown one.
 */
async function reportShownWorkspace(): Promise<void> {
  const api = getApi();
  if (!api || typeof window === 'undefined') return;
  const match = window.location.pathname.match(/^\/workspace\/([^/?]+)/);
  const workspaceId = match && match[1] !== 'new' ? match[1] : undefined;
  await api
    .invoke(IPC_CHANNELS.WINDOW.SET_IN_WORKSPACE, { inWorkspace: !!workspaceId, workspaceId })
    .catch(() => {});
}

function* shownWorker({ payload: shown }: SelectorChannelPayload<boolean>) {
  yield* call(toggleRootAttribute, MACHINE_HIDDEN_ATTRIBUTE, !shown);
  if (shown && (yield* select(selectMachineRailEnabled.select))) yield* call(reportShownWorkspace);
}

function* enabledWorker({ payload: enabled }: SelectorChannelPayload<boolean>) {
  yield* call(toggleRootAttribute, MACHINE_RAIL_ATTRIBUTE, enabled);
}

function createToastChannel(): EventChannel<MachineRailToastEvent> {
  return eventChannel<MachineRailToastEvent>((emit) => {
    const api = getApi();
    if (!api?.on) return () => {};
    const listenerId = api.on(MACHINE_RAIL_TOAST_EVENT, (payload: MachineRailToastEvent) =>
      emit(payload),
    );
    return () => api.offById(MACHINE_RAIL_TOAST_EVENT, listenerId);
  }, buffers.expanding<MachineRailToastEvent>());
}

/** Marks a forwarded toast; a numbered variant of it identifies which one was activated. */
const FORWARDED_TOAST_CLASS = 'machine-rail-toast';

/**
 * Activations of forwarded toasts: a click or Enter anywhere on the toast
 * except its own buttons (the close button keeps its meaning).
 */
function createToastActivationChannel(): EventChannel<number> {
  return eventChannel<number>((emit) => {
    if (typeof document === 'undefined') return () => {};
    const onActivate = (event: Event): void => {
      if (event instanceof KeyboardEvent && event.key !== 'Enter') return;
      const target = event.target instanceof Element ? event.target : null;
      const toast = target?.closest(`.${FORWARDED_TOAST_CLASS}`);
      if (!toast || target?.closest('button')) return;
      for (const name of toast.classList) {
        const serial = Number(name.slice(FORWARDED_TOAST_CLASS.length + 1));
        if (name.startsWith(`${FORWARDED_TOAST_CLASS}-`) && Number.isInteger(serial)) emit(serial);
      }
    };
    document.addEventListener('click', onActivate);
    document.addEventListener('keydown', onActivate);
    return () => {
      document.removeEventListener('click', onActivate);
      document.removeEventListener('keydown', onActivate);
    };
  }, buffers.sliding<number>(1));
}

/**
 * Show a toast another machine raised while it was not shown, named after
 * that machine. Activating the toast switches the window to that machine.
 */
function* showForwardedToasts(channel: EventChannel<MachineRailToastEvent>) {
  const shown = new Map<number, { machineId: string; toastId: string | number }>();
  let nextSerial = 1;
  yield* fork(function* () {
    const activations = createToastActivationChannel();
    try {
      while (true) {
        const serial = yield* take(activations);
        const entry = shown.get(serial);
        if (!entry) continue;
        shown.delete(serial);
        yield* call(notify.dismiss, entry.toastId);
        yield* put(selectRailMachineRequested(entry.machineId));
      }
    } finally {
      activations.close();
    }
  });
  while (true) {
    const toast = yield* take(channel);
    const { connection } = yield* select(selectConnectionRecoveryTarget.select, toast.machineId);
    const machine = !connection
      ? toast.machineId
      : connection.isLocal
        ? formatLocalMachineLabel(connection)
        : formatConnectionLabel(connection);
    const serial = nextSerial++;
    const toastId = yield* call(
      notify[toast.kind],
      m.machineRail_toast_message({ machine, message: toast.message }),
      { class: `cursor-pointer ${FORWARDED_TOAST_CLASS} ${FORWARDED_TOAST_CLASS}-${serial}` },
    );
    shown.set(serial, { machineId: toast.machineId, toastId });
  }
}

function* mirrorPushes(channel: EventChannel<MachineRailState>) {
  while (true) {
    const state = yield* take(channel);
    yield* put(machineRailStateReceived(state));
  }
}

export function* machineRailSaga() {
  // The rail needs main-owned views: it exists in the desktop app only.
  if (!getApi()?.on) return;

  yield* takeLatestFromSelector(selectIsRailMachineShown, shownWorker);
  yield* takeLatestFromSelector(selectMachineRailEnabled, enabledWorker);
  yield* takeEvery(selectRailMachineRequested, function* ({ payload: [id] }) {
    yield* request(MACHINE_RAIL.SELECT, { id });
  });
  yield* takeEvery(addRailMachineRequested, function* ({ payload: [id] }) {
    yield* request(MACHINE_RAIL.ADD, { id });
  });
  yield* takeEvery(removeRailMachineRequested, function* ({ payload: [id] }) {
    yield* request(MACHINE_RAIL.REMOVE, { id });
  });
  yield* takeEvery(setMachineRailEnabledRequested, function* ({ payload: [enabled] }) {
    yield* request(MACHINE_RAIL.SET_ENABLED, { enabled });
  });

  // Subscribe before the first read so a push in between is not lost.
  const channel = createChangedChannel();
  yield* fork(mirrorPushes, channel);
  yield* fork(showForwardedToasts, createToastChannel());
  try {
    const state = yield* call(invokeRail, MACHINE_RAIL.GET_STATE, {});
    yield* put(machineRailStateReceived(state));
  } catch (error) {
    logger.warn('machine rail state read failed', error);
  }
}
