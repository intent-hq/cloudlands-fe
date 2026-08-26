import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Trigger wiring for the keychain-sync lifecycle
 * (features/backend/main/keychain-sync-lifecycle.ts): startup/focus/mutation
 * triggers funnel into one debounced single-flight reconcile, all gated on
 * the opt-in pref (default OFF = fully inert).
 *
 * `electron.app` is re-mocked as a real EventEmitter so tests can emit
 * `browser-window-focus`; connections-store is mocked so the mutation-hook
 * seam can be driven directly without touching disk.
 */

const { appEmitter, mutationListeners } = vi.hoisted(() => {
  // Minimal on/emit/removeListener emitter (vi.mock factories hoist above
  // imports, so node's EventEmitter is not importable here).
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const appEmitter = {
    on(event: string, fn: (...args: unknown[]) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
      return appEmitter;
    },
    removeListener(event: string, fn: (...args: unknown[]) => void) {
      handlers.get(event)?.delete(fn);
      return appEmitter;
    },
    emit(event: string, ...args: unknown[]) {
      for (const fn of handlers.get(event) ?? []) fn(...args);
    },
  };
  return {
    appEmitter,
    mutationListeners: new Set<() => void>(),
  };
});

vi.mock('electron', () => ({
  app: appEmitter,
  default: { app: appEmitter },
}));

vi.mock('../connections-store', () => ({
  listSyncRecords: vi.fn(async () => []),
  applyRemoteSyncRecord: vi.fn(async () => true),
  onConnectionsMutated: (listener: () => void) => {
    mutationListeners.add(listener);
    return () => mutationListeners.delete(listener);
  },
}));

import {
  initKeychainSyncLifecycle,
  storeSyncAdapter,
  type KeychainSyncLifecycle,
} from '../keychain-sync-lifecycle';
import { applyRemoteSyncRecord } from '../connections-store';
import type { ReconcileResult } from '../keychain-sync';

function reconcileResult(overrides: Partial<ReconcileResult> = {}): ReconcileResult {
  return {
    status: { state: 'active' },
    pulled: [],
    pushed: [],
    deletedLocally: [],
    purged: [],
    skipped: [],
    errors: [],
    ...overrides,
  };
}

const DEBOUNCE = 1000;
const FOCUS_MIN = 60_000;

let lifecycle: KeychainSyncLifecycle | null = null;

function init(opts: {
  enabled?: boolean;
  reconcileFn?: ReturnType<typeof vi.fn>;
  onRemoteApplied?: () => void;
  onStatusChanged?: (status: unknown) => void;
}) {
  const reconcileFn = opts.reconcileFn ?? vi.fn(async () => reconcileResult());
  lifecycle = initKeychainSyncLifecycle({
    isEnabled: async () => opts.enabled ?? true,
    reconcileFn: reconcileFn as never,
    onRemoteApplied: opts.onRemoteApplied,
    onStatusChanged: opts.onStatusChanged as never,
    debounceMs: DEBOUNCE,
    focusMinIntervalMs: FOCUS_MIN,
  });
  return reconcileFn;
}

function fireMutation() {
  for (const listener of mutationListeners) listener();
}

beforeEach(() => {
  vi.useFakeTimers();
  mutationListeners.clear();
});

afterEach(() => {
  lifecycle?.dispose();
  lifecycle = null;
  vi.useRealTimers();
});

describe('keychain-sync lifecycle triggers', () => {
  it('runs a startup reconcile (debounced) when enabled', async () => {
    const reconcileFn = init({ enabled: true });
    expect(reconcileFn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(reconcileFn).toHaveBeenCalledTimes(1);
    expect(reconcileFn).toHaveBeenCalledWith(storeSyncAdapter);
  });

  it('pref off = fully inert: no reconcile on startup, focus, or mutation', async () => {
    const reconcileFn = init({ enabled: false });
    appEmitter.emit('browser-window-focus');
    fireMutation();
    await vi.advanceTimersByTimeAsync(FOCUS_MIN * 2);
    expect(reconcileFn).not.toHaveBeenCalled();
  });

  it('a store mutation schedules an async push reconcile', async () => {
    const reconcileFn = init({ enabled: true });
    await vi.advanceTimersByTimeAsync(DEBOUNCE); // startup pass
    reconcileFn.mockClear();

    fireMutation();
    expect(reconcileFn).not.toHaveBeenCalled(); // never synchronous
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(reconcileFn).toHaveBeenCalledTimes(1);
  });

  it('burst of mutations collapses into one reconcile (debounce)', async () => {
    const reconcileFn = init({ enabled: true });
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    reconcileFn.mockClear();

    fireMutation();
    fireMutation();
    fireMutation();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(reconcileFn).toHaveBeenCalledTimes(1);
  });

  it('app focus triggers a reconcile, rate-limited to one per interval', async () => {
    const reconcileFn = init({ enabled: true });
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    reconcileFn.mockClear();

    // The startup run happened at t=DEBOUNCE; focus gating is independent.
    appEmitter.emit('browser-window-focus');
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(reconcileFn).toHaveBeenCalledTimes(1);

    // Rapid re-focus within the min interval: no second run.
    appEmitter.emit('browser-window-focus');
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(reconcileFn).toHaveBeenCalledTimes(1);

    // After the interval passes, focus reconciles again.
    await vi.advanceTimersByTimeAsync(FOCUS_MIN);
    appEmitter.emit('browser-window-focus');
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(reconcileFn).toHaveBeenCalledTimes(2);
  });

  it('triggers during a running reconcile queue exactly one follow-up (single-flight)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const reconcileFn = vi.fn(async () => {
      await gate;
      return reconcileResult();
    });
    init({ enabled: true, reconcileFn });
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(reconcileFn).toHaveBeenCalledTimes(1); // in flight, blocked on gate

    // Several triggers while the first run is still in flight.
    fireMutation();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    fireMutation();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(reconcileFn).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(reconcileFn).toHaveBeenCalledTimes(2);

    // No further stragglers.
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 5);
    expect(reconcileFn).toHaveBeenCalledTimes(2);
  });

  it('onRemoteApplied fires only when a reconcile pulled or deleted locally', async () => {
    const onRemoteApplied = vi.fn();
    const reconcileFn = vi
      .fn()
      .mockResolvedValueOnce(reconcileResult({ pushed: ['a:1'] }))
      .mockResolvedValueOnce(reconcileResult({ pulled: ['a:1'] }))
      .mockResolvedValueOnce(reconcileResult({ deletedLocally: ['b:2'] }));
    init({ enabled: true, reconcileFn, onRemoteApplied });

    await vi.advanceTimersByTimeAsync(DEBOUNCE); // push-only pass
    expect(onRemoteApplied).not.toHaveBeenCalled();

    fireMutation();
    await vi.advanceTimersByTimeAsync(DEBOUNCE); // pulled
    expect(onRemoteApplied).toHaveBeenCalledTimes(1);

    fireMutation();
    await vi.advanceTimersByTimeAsync(DEBOUNCE); // deletedLocally
    expect(onRemoteApplied).toHaveBeenCalledTimes(2);
  });

  it('a reconcile failure is swallowed (fail-soft) and later triggers still run', async () => {
    const reconcileFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('adapter exploded'))
      .mockResolvedValue(reconcileResult());
    init({ enabled: true, reconcileFn });

    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(reconcileFn).toHaveBeenCalledTimes(1);

    fireMutation();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(reconcileFn).toHaveBeenCalledTimes(2);
  });

  it('getStatus reflects the last completed reconcile', async () => {
    const reconcileFn = vi.fn(async () =>
      reconcileResult({
        status: { state: 'unavailable', reason: 'helper-missing', message: 'dev build' },
      }),
    );
    init({ enabled: true, reconcileFn });
    expect(lifecycle!.getStatus()).toBeNull();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(lifecycle!.getStatus()).toEqual({
      state: 'unavailable',
      reason: 'helper-missing',
      message: 'dev build',
    });
  });

  it('onStatusChanged fires on the first status and on availability changes only', async () => {
    const onStatusChanged = vi.fn();
    const reconcileFn = vi
      .fn()
      .mockResolvedValueOnce(reconcileResult({ status: { state: 'active' } }))
      .mockResolvedValueOnce(reconcileResult({ status: { state: 'active' } }))
      .mockResolvedValueOnce(
        reconcileResult({
          status: { state: 'unavailable', reason: 'unavailable', message: 'locked' },
        }),
      )
      .mockResolvedValueOnce(
        reconcileResult({
          status: { state: 'unavailable', reason: 'unavailable', message: 'locked' },
        }),
      )
      .mockResolvedValueOnce(
        reconcileResult({
          status: { state: 'unavailable', reason: 'helper-missing', message: 'dev build' },
        }),
      );
    init({ enabled: true, reconcileFn, onStatusChanged });

    await vi.advanceTimersByTimeAsync(DEBOUNCE); // first status → fires
    expect(onStatusChanged).toHaveBeenCalledTimes(1);
    expect(onStatusChanged).toHaveBeenLastCalledWith({ state: 'active' });

    fireMutation();
    await vi.advanceTimersByTimeAsync(DEBOUNCE); // same status → no fire
    expect(onStatusChanged).toHaveBeenCalledTimes(1);

    fireMutation();
    await vi.advanceTimersByTimeAsync(DEBOUNCE); // active → unavailable → fires
    expect(onStatusChanged).toHaveBeenCalledTimes(2);

    fireMutation();
    await vi.advanceTimersByTimeAsync(DEBOUNCE); // same reason → no fire
    expect(onStatusChanged).toHaveBeenCalledTimes(2);

    fireMutation();
    await vi.advanceTimersByTimeAsync(DEBOUNCE); // reason changed → fires
    expect(onStatusChanged).toHaveBeenCalledTimes(3);
    expect(onStatusChanged).toHaveBeenLastCalledWith({
      state: 'unavailable',
      reason: 'helper-missing',
      message: 'dev build',
    });
  });

  it('resetStatus clears getStatus to null and re-fires onStatusChanged on an unchanged verdict', async () => {
    const onStatusChanged = vi.fn();
    const reconcileFn = vi.fn(async () => reconcileResult({ status: { state: 'active' } }));
    init({ enabled: true, reconcileFn, onStatusChanged });

    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(lifecycle!.getStatus()).toEqual({ state: 'active' });
    expect(onStatusChanged).toHaveBeenCalledTimes(1);

    // Disable → re-enable (T4 toggle): the stale verdict must not linger.
    lifecycle!.resetStatus();
    expect(lifecycle!.getStatus()).toBeNull();

    // The fresh reconcile lands the SAME verdict, but previous === null now,
    // so the status push still fires and the UI leaves the "checking" line.
    lifecycle!.requestReconcile();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(lifecycle!.getStatus()).toEqual({ state: 'active' });
    expect(onStatusChanged).toHaveBeenCalledTimes(2);
  });

  it('dispose detaches focus + mutation triggers and cancels the pending debounce', async () => {
    const reconcileFn = init({ enabled: true });
    lifecycle!.dispose();
    appEmitter.emit('browser-window-focus');
    fireMutation();
    await vi.advanceTimersByTimeAsync(FOCUS_MIN * 2);
    expect(reconcileFn).not.toHaveBeenCalled();
    expect(mutationListeners.size).toBe(0);
    lifecycle = null;
  });

  it('storeSyncAdapter delegates applyRemote to the store (account unused)', async () => {
    const record = {
      label: 'A',
      host: 'h',
      hosts: ['h'],
      port: 1,
      fingerprint: 'F',
      hostname: null,
      detectHosts: true,
      token: 't',
      updatedAt: 5,
    };
    await storeSyncAdapter.applyRemote('h:1', record);
    expect(vi.mocked(applyRemoteSyncRecord)).toHaveBeenCalledWith(record);
  });
});
