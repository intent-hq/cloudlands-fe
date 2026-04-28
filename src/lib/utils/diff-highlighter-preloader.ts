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
      totalASTLRUCacheSize: 250, // Chat-heavy sessions can touch many diffs; larger LRU keeps repeats warm.
    },
    highlighterOptions: {
      theme: THEMES,
      langs: [...SUPPORTED_DIFF_LANGUAGES],
    },
  });

  const duration = performance.now() - startTime;
  logger.info(`Diff highlighter worker pool created in ${duration.toFixed(0)}ms (poolSize=${poolSize})`);

  return workerPool;
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

  const doInit = async () => {
    const pool = getDiffWorkerPool();
    await pool.initialize();
    logger.info('Diff highlighter worker pool initialized');
  };

  // Use requestIdleCallback to initialize during idle time
  if (typeof requestIdleCallback !== 'undefined') {
    initPromise = new Promise<WorkerPoolManager>((resolve) => {
      requestIdleCallback(
        () => {
          doInit()
            .then(() => resolve(workerPool!))
            .catch((error) => {
              logger.warn('Failed to initialize worker pool:', error);
              resolve(workerPool!);
            });
        },
        { timeout: 5000 },
      );
    });
  } else {
    initPromise = new Promise<WorkerPoolManager>((resolve) => {
      setTimeout(() => {
        doInit()
          .then(() => resolve(workerPool!))
          .catch((error) => {
            logger.warn('Failed to initialize worker pool:', error);
            resolve(workerPool!);
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
export function terminateDiffWorkerPool(): void {
  if (workerPool) {
    terminateWorkerPoolSingleton();
    workerPool = null;
    initPromise = null;
    logger.info('Diff highlighter worker pool terminated');
  }
}
