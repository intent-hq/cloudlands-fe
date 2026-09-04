/**
 * @vitest-environment jsdom
 *
 * Regression tests for the "Update Ready" (downloaded) toast persistence:
 * - a manual check re-surfaces the toast even when the 24h dismiss cooldown
 *   was armed (showToastChecking clears it, so the re-landed 'downloaded'
 *   status shows the toast persistently instead of flash-dismissing it);
 * - internal programmatic dismissals (dismiss-then-recreate, unmount
 *   cleanup) never arm the cooldown;
 * - explicit user dismissals (sonner onDismiss without the internal flag,
 *   close-button componentProps onDismiss path) still arm the cooldown.
 */
import { render } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sonner = vi.hoisted(() => {
  let nextId = 0;
  const toasts = new Map<number, any>();
  const pendingDismissals: Array<() => void> = [];
  return {
    toasts,
    // When true, toast.dismiss(id) queues the onDismiss delivery instead of
    // firing it synchronously — mirroring real svelte-sonner, which defers it
    // (dismiss flag -> Toaster $effect sets delete -> Toast $effect invokes
    // onDismiss), so in dismiss-then-recreate the new toast is created BEFORE
    // the old toast's onDismiss arrives. Default (false) fires synchronously.
    deferDismiss: false,
    flushDismissals() {
      while (pendingDismissals.length > 0) {
        pendingDismissals.shift()!();
      }
    },
    reset() {
      nextId = 0;
      toasts.clear();
      pendingDismissals.length = 0;
      this.deferDismiss = false;
      this.custom.mockClear();
      this.dismiss.mockClear();
    },
    custom: vi.fn((_component: unknown, options: any) => {
      const id = ++nextId;
      toasts.set(id, options);
      return id;
    }),
    // Mirror svelte-sonner: toast.dismiss(id) triggers that toast's
    // sonner-level onDismiss with the toast object (deferred when
    // deferDismiss is set — see above).
    dismiss: vi.fn((id: number) => {
      const options = toasts.get(id);
      toasts.delete(id);
      const deliver = () => options?.onDismiss?.({ id });
      if (sonner.deferDismiss) {
        pendingDismissals.push(deliver);
      } else {
        deliver();
      }
    }),
  };
});
vi.mock('svelte-sonner', () => ({
  toast: { custom: sonner.custom, dismiss: sonner.dismiss },
}));

const storeHolder = vi.hoisted(() => ({
  getState: undefined as undefined | (() => unknown),
  onDispatch: undefined as undefined | ((action: unknown) => void),
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => storeHolder.getState?.() ?? {},
    dispatch: (action: unknown) => storeHolder.onDispatch?.(action),
  });
});

import type { AutoUpdateState } from '$store/renderer/slices/auto-update/auto-update-types';
import {
  autoUpdateReducer,
  dismissDownloadedToast,
  hideToast,
  setUpdateState,
  showToastChecking,
  simulateSetState,
} from '$store/renderer/slices/auto-update/auto-update-slice';
import { store as appStore } from '$store/renderer/store';
import UpdateNotification from '../UpdateNotification.svelte';

const DISMISS_COOLDOWN_MS = 24 * 60 * 60 * 1000;

let autoUpdateState: AutoUpdateState;
let dispatched: Array<{ type: string }>;

storeHolder.getState = () => ({ autoUpdate: autoUpdateState });
storeHolder.onDispatch = (action) => {
  dispatched.push(action as { type: string });
  autoUpdateState = autoUpdateReducer(autoUpdateState, action as any);
  (appStore as any).emitState();
};

const dispatchedTypes = () => dispatched.map((action) => action.type);

const downloadedState = (overrides: Partial<AutoUpdateState> = {}): AutoUpdateState => ({
  status: 'downloaded',
  currentVersion: '1.0.0',
  updateInfo: { version: '2.0.0', releaseDate: '2026-08-01', releaseNotes: null },
  progress: null,
  error: null,
  channel: 'stable',
  toastVisible: false,
  downloadedToastDismissedAt: null,
  ...overrides,
});

function mount(initial: AutoUpdateState) {
  autoUpdateState = initial;
  dispatched = [];
  const utils = render(UpdateNotification);
  flushSync();
  dispatched = [];
  return utils;
}

describe('UpdateNotification downloaded-toast persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sonner.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Reproduces the report: downloaded + cooldown armed -> manual check ->
  // status re-lands downloaded -> the toast is shown and stays.
  it('shows the toast persistently after a manual check despite an armed cooldown', () => {
    mount(downloadedState({ downloadedToastDismissedAt: Date.now() - 60_000 }));
    dispatched = [];

    // Manual check entry point (menu show-toast event / saga recovery)
    (appStore as any).dispatch(showToastChecking());
    flushSync();
    expect(sonner.custom).toHaveBeenCalledTimes(1);

    // The check re-lands on 'downloaded'
    (appStore as any).dispatch(setUpdateState(downloadedState() as any));
    flushSync();

    expect(autoUpdateState.toastVisible).toBe(true);
    expect(dispatchedTypes()).not.toContain(dismissDownloadedToast.type);
    expect(dispatchedTypes()).not.toContain(hideToast.type);
    expect(sonner.dismiss).not.toHaveBeenCalled();
  });

  it('internal dismiss-then-recreate does not arm the cooldown or hide the re-shown toast', () => {
    mount(downloadedState());
    expect(sonner.custom).toHaveBeenCalledTimes(1);

    // Arm the cooldown with 1s remaining so the re-show timer fires while
    // the toast is still up, exercising the dismiss-then-recreate path.
    (appStore as any).dispatch(
      simulateSetState({
        downloadedToastDismissedAt: Date.now() - DISMISS_COOLDOWN_MS + 1000,
      }),
    );
    flushSync();
    dispatched = [];

    vi.advanceTimersByTime(1000);
    flushSync();

    expect(sonner.dismiss).toHaveBeenCalledTimes(1);
    expect(sonner.custom).toHaveBeenCalledTimes(2);
    expect(dispatchedTypes()).not.toContain(dismissDownloadedToast.type);
    expect(dispatchedTypes()).not.toContain(hideToast.type);
    expect(autoUpdateState.toastVisible).toBe(true);
  });

  // Same dismiss-then-recreate path, but with real svelte-sonner ordering:
  // the new toast is created first and the OLD toast's onDismiss is delivered
  // afterwards. Without the currentToastId === dismissed.id guard the deferred
  // delivery would clear the NEW toast's currentToastId.
  it('deferred onDismiss delivery (real sonner ordering) neither arms the cooldown nor clears the new toast id', () => {
    mount(downloadedState());
    expect(sonner.custom).toHaveBeenCalledTimes(1);
    sonner.deferDismiss = true;

    (appStore as any).dispatch(
      simulateSetState({
        downloadedToastDismissedAt: Date.now() - DISMISS_COOLDOWN_MS + 1000,
      }),
    );
    flushSync();
    dispatched = [];

    vi.advanceTimersByTime(1000);
    flushSync();
    // New toast (id 2) exists before the old toast's onDismiss arrives.
    expect(sonner.custom).toHaveBeenCalledTimes(2);
    sonner.flushDismissals();
    flushSync();

    expect(dispatchedTypes()).not.toContain(dismissDownloadedToast.type);
    expect(dispatchedTypes()).not.toContain(hideToast.type);
    expect(autoUpdateState.toastVisible).toBe(true);
    // currentToastId still points at the new toast: a toastVisible-driven
    // re-show is NOT triggered (which would call toast.custom a third time).
    (appStore as any).dispatch(simulateSetState({ toastVisible: true }));
    flushSync();
    expect(sonner.custom).toHaveBeenCalledTimes(2);
  });

  it('unmount cleanup does not arm the cooldown while status is downloaded', () => {
    const { unmount } = mount(downloadedState());
    expect(sonner.custom).toHaveBeenCalledTimes(1);

    unmount();

    expect(sonner.dismiss).toHaveBeenCalledTimes(1);
    expect(dispatchedTypes()).not.toContain(dismissDownloadedToast.type);
    expect(dispatchedTypes()).not.toContain(hideToast.type);
  });

  it('explicit sonner-level dismissal (swipe / clear all) arms the cooldown', () => {
    mount(downloadedState());
    const options = sonner.toasts.get(1);

    // Sonner invokes onDismiss directly for user-driven dismissals.
    options.onDismiss({ id: 1 });
    flushSync();

    expect(dispatchedTypes()).toContain(dismissDownloadedToast.type);
    expect(autoUpdateState.downloadedToastDismissedAt).toEqual(expect.any(Number));
    expect(autoUpdateState.toastVisible).toBe(false);
  });

  it('explicit close via the componentProps onDismiss path arms the cooldown', () => {
    mount(downloadedState());
    const options = sonner.toasts.get(1);

    // UpdateToast's close button calls the componentProps onDismiss.
    options.componentProps.onDismiss();
    flushSync();

    expect(dispatchedTypes()).toContain(dismissDownloadedToast.type);
    expect(autoUpdateState.downloadedToastDismissedAt).toEqual(expect.any(Number));
    expect(autoUpdateState.toastVisible).toBe(false);
  });

  // UpdateToast's not-available/error auto-dismiss $effect is programmatic:
  // even if the status flips to 'downloaded' before sonner's deferred
  // onDismiss delivery runs, it must never arm the cooldown.
  it('programmatic auto-dismiss (componentProps onAutoDismiss) never arms the cooldown', () => {
    mount(downloadedState());
    const options = sonner.toasts.get(1);
    (appStore as any).dispatch(simulateSetState({ status: 'error', error: 'boom' }));
    flushSync();
    dispatched = [];
    sonner.deferDismiss = true;

    options.componentProps.onAutoDismiss();
    // Status flips to 'downloaded' between the dismiss and the deferred
    // onDismiss delivery — the race the internal-dismiss routing closes.
    autoUpdateState = { ...autoUpdateState, status: 'downloaded' };
    sonner.flushDismissals();
    flushSync();

    expect(sonner.dismiss).toHaveBeenCalledTimes(1);
    expect(dispatchedTypes()).not.toContain(dismissDownloadedToast.type);
    expect(autoUpdateState.downloadedToastDismissedAt).toBeNull();
  });
});
