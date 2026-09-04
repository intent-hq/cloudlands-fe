/**
 * DaemonUpdatingOverlay component tests.
 *
 * Drives the real daemon-health slice through connectionStatusChanged with
 * the main-side `daemonUpdatePending` marker and asserts the updating
 * overlay's countdown window, plus DaemonStoppedOverlay's deferral to it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';

vi.mock('$store/renderer/store', async () => {
  const { daemonHealthReducer, initialState } =
    await import('$store/renderer/slices/daemon-health/daemon-health-slice');
  const { connectionsReducer, initialState: connectionsInitialState } =
    await import('$store/renderer/slices/connections/connections-slice');
  let state = { daemonHealth: initialState, connections: connectionsInitialState };
  const listeners = new Set<() => void>();
  const store = {
    get state() {
      return state;
    },
    init() {
      state = { daemonHealth: initialState, connections: connectionsInitialState };
      listeners.forEach((listener) => listener());
      return () => {};
    },
    dispose() {
      listeners.clear();
    },
    dispatch(action: { type: string }) {
      state = {
        daemonHealth: daemonHealthReducer(state.daemonHealth, action as never),
        connections: connectionsReducer(state.connections, action as never),
      };
      listeners.forEach((listener) => listener());
      return action;
    },
    createSelector<T>(select: (value: typeof state) => T) {
      return Object.assign(
        () => ({
          subscribe(run: (value: T) => void) {
            const update = () => run(select(state));
            update();
            listeners.add(update);
            return () => listeners.delete(update);
          },
        }),
        { select },
      );
    },
  };
  return { store };
});

const route = vi.hoisted(() => ({ pathname: '/' }));

vi.mock('$app/stores', () => ({
  page: {
    subscribe: (run: (value: { url: URL }) => void) => {
      run({ url: new URL(`http://localhost${route.pathname}`) });
      return () => {};
    },
  },
}));

import { store as appStore } from '$store/renderer/store';
import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
import type { BackendTransportInfo } from '$store/renderer/slices/daemon-health/daemon-health-types';
import DaemonUpdatingOverlay, { DAEMON_UPDATING_COUNTDOWN_MS } from '../DaemonUpdatingOverlay.svelte';
import DaemonStoppedOverlay, { DAEMON_STOPPED_GRACE_MS } from '../DaemonStoppedOverlay.svelte';

const externalTransport: BackendTransportInfo = { mode: 'external-uds', target: '/tmp/i.sock' };

function updatingOverlay(): HTMLElement | null {
  return screen.queryByTestId('daemon-updating-overlay');
}

function stoppedOverlay(): HTMLElement | null {
  return screen.queryByTestId('daemon-stopped-overlay');
}

/** Seconds currently shown by the countdown line. */
function countdownSeconds(): number {
  const text = screen.getByTestId('daemon-updating-countdown').textContent ?? '';
  const match = /(\d+)s/.exec(text);
  if (!match) throw new Error(`no countdown in ${JSON.stringify(text)}`);
  return Number(match[1]);
}

function dispatchAndFlush(action: Parameters<typeof appStore.dispatch>[0]) {
  appStore.dispatch(action);
  flushSync();
}

function renderBoth() {
  render(DaemonUpdatingOverlay);
  render(DaemonStoppedOverlay);
}

/** Connect, then drop the connection with the update-caused marker set. */
function dropForUpdate() {
  dispatchAndFlush(connectionStatusChanged('connected', externalTransport));
  dispatchAndFlush(
    connectionStatusChanged('disconnected', undefined, { daemonUpdatePending: true }),
  );
}

describe('DaemonUpdatingOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    route.pathname = '/';
    appStore.init();
  });

  afterEach(() => {
    cleanup();
    appStore.dispose();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('stays hidden for a disconnect that was not caused by an update', async () => {
    renderBoth();
    dispatchAndFlush(connectionStatusChanged('connected', externalTransport));
    dispatchAndFlush(connectionStatusChanged('disconnected'));
    expect(updatingOverlay()).toBeNull();
    await vi.advanceTimersByTimeAsync(DAEMON_STOPPED_GRACE_MS - 100);
    expect(updatingOverlay()).toBeNull();
    expect(stoppedOverlay()).toBeNull();
    // Unflagged drops keep the existing grace-period behaviour.
    await vi.advanceTimersByTimeAsync(200);
    expect(stoppedOverlay()).toBeTruthy();
    expect(updatingOverlay()).toBeNull();
  });

  it('shows immediately on an update-caused disconnect and holds the stopped overlay back through the countdown', async () => {
    renderBoth();
    dropForUpdate();
    expect(updatingOverlay()).toBeTruthy();
    expect(updatingOverlay()!.getAttribute('role')).toBe('alertdialog');
    expect(updatingOverlay()!.querySelector('button')).toBeNull();
    expect(stoppedOverlay()).toBeNull();

    // Well past the ordinary 2.5 s grace the stopped overlay is still deferred.
    await vi.advanceTimersByTimeAsync(DAEMON_STOPPED_GRACE_MS * 2);
    expect(updatingOverlay()).toBeTruthy();
    expect(stoppedOverlay()).toBeNull();

    await vi.advanceTimersByTimeAsync(DAEMON_UPDATING_COUNTDOWN_MS - DAEMON_STOPPED_GRACE_MS * 2 - 100);
    expect(updatingOverlay()).toBeTruthy();
    expect(stoppedOverlay()).toBeNull();
  });

  it('counts down once per second from 10 to 1 based on the latched disconnect time', async () => {
    renderBoth();
    dropForUpdate();
    expect(countdownSeconds()).toBe(DAEMON_UPDATING_COUNTDOWN_MS / 1000);

    for (let expected = DAEMON_UPDATING_COUNTDOWN_MS / 1000 - 1; expected >= 1; expected--) {
      await vi.advanceTimersByTimeAsync(1000);
      expect(countdownSeconds()).toBe(expected);
    }
    // Mid-second: the displayed value only changes on whole-second boundaries.
    await vi.advanceTimersByTimeAsync(500);
    expect(countdownSeconds()).toBe(1);
    expect(updatingOverlay()).toBeTruthy();
  });

  it('does not restart the countdown on later disconnected pushes for the same restart', async () => {
    renderBoth();
    dropForUpdate();
    await vi.advanceTimersByTimeAsync(4000);
    expect(countdownSeconds()).toBe(6);

    dispatchAndFlush(
      connectionStatusChanged('connecting', undefined, { daemonUpdatePending: true }),
    );
    dispatchAndFlush(
      connectionStatusChanged('disconnected', undefined, { daemonUpdatePending: true }),
    );
    expect(countdownSeconds()).toBe(6);
    await vi.advanceTimersByTimeAsync(1000);
    expect(countdownSeconds()).toBe(5);
  });

  it('hands over to the stopped overlay immediately when the countdown ends (no extra grace)', async () => {
    renderBoth();
    dropForUpdate();
    await vi.advanceTimersByTimeAsync(DAEMON_UPDATING_COUNTDOWN_MS - 100);
    expect(updatingOverlay()).toBeTruthy();
    expect(stoppedOverlay()).toBeNull();

    await vi.advanceTimersByTimeAsync(100);
    expect(updatingOverlay()).toBeNull();
    expect(stoppedOverlay()).toBeTruthy();
  });

  it('dismisses on reconnect mid-countdown and the stopped overlay never appears', async () => {
    renderBoth();
    dropForUpdate();
    await vi.advanceTimersByTimeAsync(5000);
    expect(updatingOverlay()).toBeTruthy();

    dispatchAndFlush(connectionStatusChanged('connected', externalTransport));
    expect(updatingOverlay()).toBeNull();
    expect(stoppedOverlay()).toBeNull();

    await vi.advanceTimersByTimeAsync(DAEMON_UPDATING_COUNTDOWN_MS + DAEMON_STOPPED_GRACE_MS);
    expect(updatingOverlay()).toBeNull();
    expect(stoppedOverlay()).toBeNull();
  });

  it.each(['/sandbox', '/sandbox/directory-picker', '/test-comments'])(
    'stays hidden on %s',
    async (pathname) => {
      route.pathname = pathname;
      render(DaemonUpdatingOverlay);
      dropForUpdate();
      await vi.advanceTimersByTimeAsync(1000);
      expect(updatingOverlay()).toBeNull();
    },
  );
});
