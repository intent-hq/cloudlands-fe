import { afterEach, describe, expect, it, vi } from 'vitest';

const { clientLogger } = vi.hoisted(() => ({
  clientLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: vi.fn(() => clientLogger),
}));

import { createActionTypeRingBuffer } from './middlewares/action-ring-buffer';
import { startLongTaskWatchdog, type LongTaskWatchdogStoreLike } from './long-task-watchdog';

/** Contract from the task spec, independent of the module's exported constants. */
const WARN_MS = 250;
const ERROR_MS = 2000;
const RATE_LIMIT_MS = 1000;

type ObserverCallback = (list: { getEntries(): PerformanceEntry[] }) => void;

/** Fake PerformanceObserver: records observe() options, lets tests emit entries. */
function createFakeObserver() {
  const instances: Array<{
    callback: ObserverCallback;
    connected: boolean;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
  const observeOptions: unknown[] = [];
  class FakeObserver {
    static supportedEntryTypes = ['longtask'];
    readonly callback: ObserverCallback;
    connected = false;
    disconnect = vi.fn(() => {
      this.connected = false;
    });
    constructor(callback: ObserverCallback) {
      this.callback = callback;
      instances.push(this);
    }
    observe(options: unknown) {
      this.connected = true;
      observeOptions.push(options);
    }
  }
  const emit = (durations: number[], startTime = 100) => {
    for (const instance of instances) {
      if (!instance.connected) continue;
      instance.callback({
        getEntries: () =>
          durations.map(
            (duration) => ({ duration, startTime, entryType: 'longtask' }) as PerformanceEntry,
          ),
      });
    }
  };
  return {
    Observer: FakeObserver as unknown as typeof PerformanceObserver,
    instances,
    observeOptions,
    emit,
  };
}

/** Fake store whose readable notifies subscribers synchronously on setState. */
function createFakeStore(initialTabId: string | null) {
  let state: unknown = { tabState: { currentTabId: initialTabId } };
  const listeners = new Set<(state: unknown) => void>();
  const store: LongTaskWatchdogStoreLike & {
    setTab(id: string | null): void;
    readonly subscriberCount: number;
  } = {
    get state() {
      return state;
    },
    get subscriberCount() {
      return listeners.size;
    },
    getReadableState: () => ({
      subscribe(run) {
        listeners.add(run);
        run(state);
        return () => listeners.delete(run);
      },
    }),
    setTab(id) {
      state = { tabState: { currentTabId: id } };
      for (const run of listeners) run(state);
    },
  };
  return store;
}

const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

describe('startLongTaskWatchdog', () => {
  it('observes longtask entries and logs the attribution payload', () => {
    const fake = createFakeObserver();
    const store = createFakeStore('ws-a');
    const actionTypes = createActionTypeRingBuffer(20);
    const log = vi.fn();
    stops.push(startLongTaskWatchdog(store, { observerFactory: fake.Observer, actionTypes, log }));

    expect(fake.observeOptions).toEqual([{ entryTypes: ['longtask'] }]);

    store.setTab('ws-b');
    actionTypes.push('tabState/setCurrentTab');
    actionTypes.push('workspace/loadRequested');
    fake.emit([300], 1234.6);

    expect(log).toHaveBeenCalledOnce();
    const [severity, message, payload] = log.mock.calls[0];
    expect(severity).toBe('warn');
    expect(message).toContain('300');
    expect(payload).toEqual({
      durationMs: 300,
      startTimeMs: 1235,
      pathname: window.location.pathname,
      activeWorkspaceId: 'ws-b',
      previousWorkspaceId: 'ws-a',
      recentActionTypes: ['tabState/setCurrentTab', 'workspace/loadRequested'],
      suppressed: 0,
    });
  });

  it('classifies severity by threshold and ignores short tasks', () => {
    const fake = createFakeObserver();
    const log = vi.fn();
    stops.push(
      startLongTaskWatchdog(createFakeStore(null), {
        observerFactory: fake.Observer,
        actionTypes: createActionTypeRingBuffer(1),
        log,
        rateLimitMs: 0,
      }),
    );

    fake.emit([WARN_MS - 1, WARN_MS, ERROR_MS - 1, ERROR_MS]);

    expect(log.mock.calls.map((c) => c[0])).toEqual(['warn', 'warn', 'error']);
    expect(log.mock.calls[0][2]).toMatchObject({
      activeWorkspaceId: null,
      previousWorkspaceId: null,
    });
  });

  it('emits the report as the top-level log payload for both severities', () => {
    clientLogger.warn.mockClear();
    clientLogger.error.mockClear();
    const fake = createFakeObserver();
    stops.push(
      startLongTaskWatchdog(createFakeStore('ws-a'), {
        observerFactory: fake.Observer,
        actionTypes: createActionTypeRingBuffer(1),
        rateLimitMs: 0,
      }),
    );

    fake.emit([WARN_MS, ERROR_MS]);

    expect(clientLogger.warn).toHaveBeenCalledOnce();
    expect(clientLogger.warn.mock.calls[0][1]).toMatchObject({
      durationMs: WARN_MS,
      activeWorkspaceId: 'ws-a',
    });
    expect(clientLogger.error).toHaveBeenCalledOnce();
    const [, errorArg, errorData] = clientLogger.error.mock.calls[0];
    expect(errorArg).toBeUndefined();
    expect(errorData).toMatchObject({
      durationMs: ERROR_MS,
      activeWorkspaceId: 'ws-a',
    });
  });

  it('rate-limits per severity bucket and reports the suppressed count', () => {
    const fake = createFakeObserver();
    const log = vi.fn();
    let clock = 0;
    stops.push(
      startLongTaskWatchdog(createFakeStore('ws-a'), {
        observerFactory: fake.Observer,
        actionTypes: createActionTypeRingBuffer(1),
        log,
        now: () => clock,
      }),
    );

    fake.emit([300, 300, 300, 2500, 2500]);
    expect(log.mock.calls.map((c) => c[0])).toEqual(['warn', 'error']);

    clock = RATE_LIMIT_MS - 1;
    fake.emit([300]);
    expect(log).toHaveBeenCalledTimes(2);

    clock = RATE_LIMIT_MS;
    fake.emit([300, 2500]);
    expect(log).toHaveBeenCalledTimes(4);
    expect(log.mock.calls[2][2]).toMatchObject({ suppressed: 3 });
    expect(log.mock.calls[3][2]).toMatchObject({ suppressed: 1 });

    clock = RATE_LIMIT_MS * 2;
    fake.emit([300]);
    expect(log.mock.calls[4][2]).toMatchObject({ suppressed: 0 });
  });

  it('keeps exactly one observer alive and disconnects on stop', () => {
    const fake = createFakeObserver();
    const log = vi.fn();
    const options = {
      observerFactory: fake.Observer,
      actionTypes: createActionTypeRingBuffer(1),
      log,
    };

    const stopFirst = startLongTaskWatchdog(createFakeStore('ws-a'), options);
    const stopSecond = startLongTaskWatchdog(createFakeStore('ws-a'), options);
    stops.push(stopFirst, stopSecond);

    expect(fake.instances).toHaveLength(2);
    expect(fake.instances[0].disconnect).toHaveBeenCalledOnce();
    expect(fake.instances[1].disconnect).not.toHaveBeenCalled();

    fake.emit([500]);
    expect(log).toHaveBeenCalledOnce();

    stopSecond();
    stopSecond();
    expect(fake.instances[1].disconnect).toHaveBeenCalledOnce();

    log.mockClear();
    fake.emit([500]);
    expect(log).not.toHaveBeenCalled();
  });

  it('releases the store subscription on stop', () => {
    const fake = createFakeObserver();
    const store = createFakeStore('ws-a');
    const stop = startLongTaskWatchdog(store, {
      observerFactory: fake.Observer,
      actionTypes: createActionTypeRingBuffer(1),
      log: vi.fn(),
    });
    expect(store.subscriberCount).toBe(1);

    stop();

    expect(store.subscriberCount).toBe(0);
  });

  it('is a no-op when longtask observation is unsupported', () => {
    class Unsupported {
      static supportedEntryTypes = ['paint'];
      observe = vi.fn();
      disconnect = vi.fn();
    }
    const stop = startLongTaskWatchdog(createFakeStore('ws-a'), {
      observerFactory: Unsupported as unknown as typeof PerformanceObserver,
    });
    expect(stop).toBeTypeOf('function');
    expect(() => stop()).not.toThrow();
  });
});
