/**
 * Diff Highlighter Worker Pool
 *
 * Provides a worker pool for @pierre/diffs syntax highlighting.
 * This moves Shiki tokenization off the main thread, preventing UI blocking
 * when rendering diffs.
 *
 * The worker pool:
 * 1. Runs Shiki highlighting in background threads
 * 2. Caches rendered AST results for fast re-renders
 * 3. Pre-warms with common languages during idle time
 */
import {
  getOrCreateWorkerPoolSingleton,
  terminateWorkerPoolSingleton,
  type WorkerPoolManager,
} from '@pierre/diffs/worker';
import { createLogger } from './client-logger';

const logger = createLogger('diff-highlighter-worker-pool');

// Common languages that are likely to be used in diffs
// These are pre-loaded into the Shiki highlighter worker pool
export const SUPPORTED_DIFF_LANGUAGES = [
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'json',
  'css',
  'html',
  'markdown',
  'python',
  'rust',
  'go',
  'svelte',
  'yaml',
  'bash',
  'powershell',
] as const;

export type SupportedDiffLanguage = (typeof SUPPORTED_DIFF_LANGUAGES)[number];

// Set for O(1) lookup
const SUPPORTED_LANGUAGES_SET = new Set<string>(SUPPORTED_DIFF_LANGUAGES);

/**
 * Check if a language is supported for diff syntax highlighting.
 * Returns the language if supported, otherwise returns undefined (for plain text fallback).
 */
export function getSafeDiffLanguage(language: string | undefined): string | undefined {
  if (!language) return undefined;
  const normalized = language.toLowerCase();
  return SUPPORTED_LANGUAGES_SET.has(normalized) ? normalized : undefined;
}

// Themes used by the diff viewer
const THEMES = { dark: 'github-dark', light: 'github-light' } as const;

let workerPool: WorkerPoolManager | null = null;
let initPromise: Promise<WorkerPoolManager> | null = null;
let activeWorkerPoolLeases = 0;
let idleTerminationTimer: ReturnType<typeof setTimeout> | null = null;

export const DIFF_WORKER_POOL_IDLE_TERMINATION_MS = 30_000;

/**
 * Size of each rendered-AST LRU held by the pool manager.
 *
 * This is a *renderer-heap* cost, not a worker cost: the manager keeps two
 * LRUMaps of this size — one for file renders, one for diff renders — holding
 * fully themed hast trees. Measured against 250 real diffs from this repo
 * (node, post-GC): ~0.67 MB of live heap per rendered diff AST (70 KB
 * serialized; p90 164 KB, max 602 KB). At the previous value of 250 the two
 * caches could retain ~330 MB before evicting anything; at 64 they cap at
 * ~85 MB while still keeping a whole review session's files warm.
 */
export const DIFF_AST_LRU_CACHE_SIZE = 64;

// Lifecycle accounting. Each pool creation spawns `poolSize` workers, each with
// its own Shiki highlighter, so a create that is never paired with a terminate
// is a multi-hundred-MB leak. These counters make create/terminate pairs
// greppable in console-output.log (and in a debug bundle).
let poolGeneration = 0;
let poolsCreated = 0;
let poolsTerminated = 0;
let currentPoolSize = 0;
let poolCreatedAtMs = 0;

export type DiffWorkerPoolTerminationReason = 'idle' | 'unload' | 'manual';

export interface DiffWorkerPoolLifecycleStats {
  /** Monotonic id of the current (or most recent) pool. */
  generation: number;
  /** Total pools created in this renderer session. */
  created: number;
  /** Total pools terminated in this renderer session. */
  terminated: number;
  /** Pools created but not yet terminated — should never exceed 1. */
  live: number;
  /** Outstanding viewer leases; returns to 0 when every diff viewer unmounts. */
  activeLeases: number;
  /** Whether a pool object is currently held. */
  alive: boolean;
  /** Worker count of the current pool (0 when no pool is alive). */
  poolSize: number;
}

/**
 * Snapshot of worker-pool lifecycle accounting.
 *
 * Exposed for diagnostics and regression tests: `created === terminated + live`
 * always holds, and `activeLeases` must return to 0 once all diff viewers have
 * unmounted.
 */
export function inspectDiffWorkerPoolLifecycle(): DiffWorkerPoolLifecycleStats {
  return {
    generation: poolGeneration,
    created: poolsCreated,
    terminated: poolsTerminated,
    live: poolsCreated - poolsTerminated,
    activeLeases: activeWorkerPoolLeases,
    alive: workerPool !== null,
    poolSize: workerPool === null ? 0 : currentPoolSize,
  };
}

function clearIdleTerminationTimer(): void {
  if (idleTerminationTimer !== null) {
    clearTimeout(idleTerminationTimer);
    idleTerminationTimer = null;
  }
}

function scheduleIdleTermination(): void {
  clearIdleTerminationTimer();
  idleTerminationTimer = setTimeout(() => {
    idleTerminationTimer = null;
    if (activeWorkerPoolLeases === 0) {
      terminateDiffWorkerPool('idle');
    }
  }, DIFF_WORKER_POOL_IDLE_TERMINATION_MS);
}

let unloadListenerRegistered = false;

function handlePageHide(event: PageTransitionEvent): void {
  // A persisted (bfcache) pagehide means the page may come straight back —
  // terminating there would just force a rebuild of the pool.
  if (event.persisted) return;
  terminateDiffWorkerPool('unload');
}

/**
 * Terminate the pool when the renderer goes away.
 *
 * `pagehide` (not `beforeunload`) is used deliberately: `beforeunload` also
 * fires for cancelled navigations and HMR, where tearing the pool down would be
 * wasted work.
 */
function registerUnloadTermination(): void {
  if (unloadListenerRegistered || typeof window === 'undefined') return;
  window.addEventListener('pagehide', handlePageHide);
  unloadListenerRegistered = true;
}

function unregisterUnloadTermination(): void {
  if (!unloadListenerRegistered || typeof window === 'undefined') return;
  window.removeEventListener('pagehide', handlePageHide);
  unloadListenerRegistered = false;
}

/**
 * Creates a worker for the diff highlighter pool.
 * Uses the portable worker bundle for Electron compatibility.
 */
function workerFactory(): Worker {
  // Use the portable worker bundle which is self-contained
  // and works in Electron's renderer process.
  return new Worker(
    new URL('@pierre/diffs/worker/worker-portable.js', import.meta.url),
    { type: 'classic' },
  );
}

/**
 * Get or create the diff highlighter worker pool singleton.
 * This should be called when rendering diffs.
 *
 * The worker pool is initialized lazily on first call.
 */
export function getDiffWorkerPool(): WorkerPoolManager {
  if (workerPool) {
    return workerPool;
  }

  const startTime = performance.now();
  logger.debug('Initializing diff highlighter worker pool...');

  const hwConcurrency =
    typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
      ? navigator.hardwareConcurrency
      : 4;
  // Cap at 8 to match pierre's default pool size — higher counts mostly add
  // worker-boot overhead without reducing highlight latency for our workloads.
  const poolSize = Math.min(Math.max(hwConcurrency, 2), 8);

  workerPool = getOrCreateWorkerPoolSingleton({
    poolOptions: {
      workerFactory,
      poolSize,
      totalASTLRUCacheSize: DIFF_AST_LRU_CACHE_SIZE,
    },
    highlighterOptions: {
      theme: THEMES,
      langs: [...SUPPORTED_DIFF_LANGUAGES],
    },
  });

  poolGeneration += 1;
  poolsCreated += 1;
  currentPoolSize = poolSize;
  poolCreatedAtMs = startTime;
  registerUnloadTermination();

  const duration = performance.now() - startTime;
  logger.info(
    `Diff highlighter worker pool created in ${duration.toFixed(0)}ms ` +
      `(generation=${poolGeneration}, poolSize=${poolSize}, leases=${activeWorkerPoolLeases}, ` +
      `created=${poolsCreated}, terminated=${poolsTerminated})`,
  );

  // A pool created outside `acquireDiffWorkerPool` (the idle preload path) has
  // no lease to release, so nothing would ever arm the idle timer and the
  // workers would live for the whole session. Arm it here; `acquire` clears the
  // timer as soon as a real viewer takes a lease.
  if (activeWorkerPoolLeases === 0) {
    scheduleIdleTermination();
  }

  return workerPool;
}

/**
 * Acquire an active diff viewer lease on the worker pool.
 * The pool is kept alive until every active FileDiff releases its lease, then
 * terminated after a short idle window to preserve warm-cache repeated use.
 */
export function acquireDiffWorkerPool(): WorkerPoolManager {
  // Clear *after* the pool is resolved: creating a pool with no lease arms the
  // idle timer, and this lease supersedes it.
  const pool = getDiffWorkerPool();
  clearIdleTerminationTimer();
  activeWorkerPoolLeases += 1;
  return pool;
}

/**
 * Release a diff viewer lease and schedule idle cleanup when the last viewer closes.
 */
export function releaseDiffWorkerPool(): void {
  if (activeWorkerPoolLeases === 0) {
    logger.warn('Diff worker pool lease released with no active leases');
    return;
  }

  activeWorkerPoolLeases -= 1;
  if (activeWorkerPoolLeases === 0) {
    scheduleIdleTermination();
  }
}

/**
 * Inspect the current state of the worker pool's file and diff caches.
 * Returns `null` if the pool has not been created yet.
 *
 * Intended for perf smoke-tests / dev tooling — the return value exposes the
 * LRUMap instances from the installed @pierre/diffs version.
 */
export function inspectDiffCaches(): { fileCacheSize: number; diffCacheSize: number } | null {
  if (!workerPool) return null;
  const caches = workerPool.inspectCaches();
  return {
    fileCacheSize: caches.fileCache.size,
    diffCacheSize: caches.diffCache.size,
  };
}

/**
 * Initialize the worker pool during idle time.
 * This pre-warms the workers so they're ready when the first diff is rendered.
 */
export function preloadDiffHighlighter(): void {
  if (workerPool || initPromise) {
    return;
  }

  const doInit = async (): Promise<WorkerPoolManager> => {
    const pool = getDiffWorkerPool();
    await pool.initialize();
    logger.info('Diff highlighter worker pool initialized');
    return pool;
  };

  // Use requestIdleCallback to initialize during idle time
  if (typeof requestIdleCallback !== 'undefined') {
    initPromise = new Promise<WorkerPoolManager>((resolve) => {
      requestIdleCallback(
        () => {
          doInit()
            .then((pool) => resolve(pool))
            .catch((error) => {
              logger.warn('Failed to initialize worker pool:', error);
              resolve(getDiffWorkerPool());
            });
        },
        { timeout: 5000 },
      );
    });
  } else {
    initPromise = new Promise<WorkerPoolManager>((resolve) => {
      setTimeout(() => {
        doInit()
          .then((pool) => resolve(pool))
          .catch((error) => {
            logger.warn('Failed to initialize worker pool:', error);
            resolve(getDiffWorkerPool());
          });
      }, 100);
    });
  }
}

/**
 * Check if the worker pool has been created.
 */
export function isDiffHighlighterPreloaded(): boolean {
  return workerPool !== null;
}

/**
 * Wait for the worker pool to be initialized.
 * Returns immediately if already initialized.
 */
export async function waitForDiffHighlighterPreload(): Promise<void> {
  if (workerPool) {
    return;
  }
  if (initPromise) {
    await initPromise;
  }
}

/**
 * Terminate the worker pool and clean up resources.
 * Call this when the app is closing or navigating away.
 */
export function terminateDiffWorkerPool(reason: DiffWorkerPoolTerminationReason = 'manual'): void {
  clearIdleTerminationTimer();
  const leasesAtTermination = activeWorkerPoolLeases;
  activeWorkerPoolLeases = 0;

  if (workerPool) {
    terminateWorkerPoolSingleton();
    workerPool = null;
    initPromise = null;
    poolsTerminated += 1;
    unregisterUnloadTermination();

    const lifetimeMs = performance.now() - poolCreatedAtMs;
    logger.info(
      `Diff highlighter worker pool terminated ` +
        `(generation=${poolGeneration}, poolSize=${currentPoolSize}, reason=${reason}, ` +
        `leases=${leasesAtTermination}, lifetimeMs=${lifetimeMs.toFixed(0)}, ` +
        `created=${poolsCreated}, terminated=${poolsTerminated})`,
    );
    if (leasesAtTermination > 0) {
      logger.warn(
        `Diff highlighter worker pool terminated with ${leasesAtTermination} active lease(s) ` +
          `(generation=${poolGeneration}, reason=${reason})`,
      );
    }
    currentPoolSize = 0;
  }
}
