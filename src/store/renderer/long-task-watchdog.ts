/**
 * Renderer long-task watchdog.
 *
 * One `PerformanceObserver({ entryTypes: ['longtask'] })` per renderer. Each
 * long main-thread task is logged with the context needed to attribute a
 * near-hang to a code path: duration, current route, the active and previous
 * workspace (tab) ids, and the last ~20 Redux action types recorded by the
 * action ring-buffer middleware. Nothing here is a fix — it is the breadcrumb
 * that says where the renderer was when it stalled (monorepo switch stalls).
 */
import { createLogger } from '$lib/utils/client-logger';
import {
  rendererActionTypeRingBuffer,
  type ActionTypeRingBuffer,
} from './middlewares/action-ring-buffer';

const logger = createLogger('long-task-watchdog');

/** Tasks at or above this duration are logged at `warn`. */
export const LONG_TASK_WARN_MS = 250;
/** Tasks at or above this duration are logged at `error`. */
export const LONG_TASK_ERROR_MS = 2000;
/** Minimum spacing between two log entries of the same severity. */
export const LONG_TASK_RATE_LIMIT_MS = 1000;

export type LongTaskSeverity = 'warn' | 'error';

export interface LongTaskReport {
  durationMs: number;
  startTimeMs: number;
  pathname: string | null;
  activeWorkspaceId: string | null;
  previousWorkspaceId: string | null;
  recentActionTypes: string[];
  /** Entries of this severity dropped by the rate limit since the last report. */
  suppressed: number;
}

/** Minimal readable-store shape (matches Svelte's `Readable`). */
interface StateReadable {
  subscribe(run: (state: unknown) => void): () => void;
}

/**
 * Minimal view of the themis store. `state` proxies to redux `getState()`;
 * `getReadableState` is the renderer store's synchronous per-dispatch
 * subscription, used to track workspace switches as they happen.
 */
export interface LongTaskWatchdogStoreLike {
  readonly state: unknown;
  getReadableState?(): StateReadable;
}

export interface LongTaskWatchdogOptions {
  warnMs?: number;
  errorMs?: number;
  rateLimitMs?: number;
  now?: () => number;
  actionTypes?: Pick<ActionTypeRingBuffer, 'snapshot'>;
  log?: (severity: LongTaskSeverity, message: string, report: LongTaskReport) => void;
  /** Injected in tests; defaults to `globalThis.PerformanceObserver`. */
  observerFactory?: typeof PerformanceObserver;
}

function readActiveWorkspaceId(state: unknown): string | null {
  const tabState = (state as { tabState?: { currentTabId?: unknown } } | null)?.tabState;
  const id = tabState?.currentTabId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function readPathname(): string | null {
  return typeof window !== 'undefined' ? (window.location?.pathname ?? null) : null;
}

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function defaultLog(severity: LongTaskSeverity, message: string, report: LongTaskReport): void {
  logger[severity](message, report);
}

function isLongTaskObserverSupported(ctor: typeof PerformanceObserver | undefined): boolean {
  if (typeof ctor !== 'function') return false;
  const supported = (ctor as { supportedEntryTypes?: readonly string[] }).supportedEntryTypes;
  return !supported || supported.includes('longtask');
}

/** Tracks the active tab id and the one it replaced. */
interface WorkspaceSwitchTracker {
  readonly active: string | null;
  readonly previous: string | null;
  observe(state: unknown): void;
}

function createWorkspaceSwitchTracker(): WorkspaceSwitchTracker {
  let active: string | null = null;
  let previous: string | null = null;
  let primed = false;
  return {
    get active() {
      return active;
    },
    get previous() {
      return previous;
    },
    observe(state) {
      const next = readActiveWorkspaceId(state);
      if (!primed) {
        primed = true;
        active = next;
        return;
      }
      if (next === active) return;
      previous = active;
      active = next;
    },
  };
}

let activeStop: (() => void) | null = null;

/**
 * Start the watchdog. Returns a stop handler that disconnects the observer and
 * the store subscription. Starting again while one is active replaces it, so
 * an HMR generation that forgot to dispose cannot leave two observers behind.
 */
export function startLongTaskWatchdog(
  store: LongTaskWatchdogStoreLike,
  options: LongTaskWatchdogOptions = {},
): () => void {
  activeStop?.();
  activeStop = null;

  const Observer = options.observerFactory ?? globalThis.PerformanceObserver;
  if (!isLongTaskObserverSupported(Observer)) return () => undefined;

  const warnMs = options.warnMs ?? LONG_TASK_WARN_MS;
  const errorMs = options.errorMs ?? LONG_TASK_ERROR_MS;
  const rateLimitMs = options.rateLimitMs ?? LONG_TASK_RATE_LIMIT_MS;
  const now = options.now ?? defaultNow;
  const actionTypes = options.actionTypes ?? rendererActionTypeRingBuffer;
  const log = options.log ?? defaultLog;

  const tracker = createWorkspaceSwitchTracker();
  const lastEmittedAt: Record<LongTaskSeverity, number> = { warn: -Infinity, error: -Infinity };
  const suppressed: Record<LongTaskSeverity, number> = { warn: 0, error: 0 };

  let unsubscribeState: (() => void) | null = null;
  try {
    const readable = store.getReadableState?.();
    if (readable) {
      unsubscribeState = readable.subscribe((state) => tracker.observe(state));
    } else {
      tracker.observe(store.state);
    }
  } catch (error) {
    logger.warn('Long-task watchdog could not subscribe to store state', error);
  }

  const report = (entry: PerformanceEntry) => {
    const durationMs = entry.duration;
    if (durationMs < warnMs) return;
    const severity: LongTaskSeverity = durationMs >= errorMs ? 'error' : 'warn';

    const at = now();
    if (at - lastEmittedAt[severity] < rateLimitMs) {
      suppressed[severity] += 1;
      return;
    }
    lastEmittedAt[severity] = at;

    if (!unsubscribeState) {
      try {
        tracker.observe(store.state);
      } catch {
        // Store not initialised yet; keep whatever the tracker last saw.
      }
    }

    const payload: LongTaskReport = {
      durationMs: Math.round(durationMs),
      startTimeMs: Math.round(entry.startTime),
      pathname: readPathname(),
      activeWorkspaceId: tracker.active,
      previousWorkspaceId: tracker.previous,
      recentActionTypes: actionTypes.snapshot(),
      suppressed: suppressed[severity],
    };
    suppressed[severity] = 0;
    log(severity, `Long task ${payload.durationMs}ms on ${payload.pathname ?? '?'}`, payload);
  };

  const observer = new Observer((list) => {
    for (const entry of list.getEntries()) report(entry);
  });
  try {
    observer.observe({ entryTypes: ['longtask'] });
  } catch (error) {
    unsubscribeState?.();
    logger.warn('Long-task watchdog could not observe longtask entries', error);
    return () => undefined;
  }

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    unsubscribeState?.();
    if (activeStop === stop) activeStop = null;
  };
  activeStop = stop;
  return stop;
}
