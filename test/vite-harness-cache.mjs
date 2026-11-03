import path from 'node:path';

// Vite's default `cacheDir` is `node_modules/.vite` per root, shared by the app
// sandbox (`dev:ui` / `dev:web`) and every in-process harness started from the
// same checkout. Two Vite instances re-optimizing into one directory invalidate
// each other's optimized deps, which surfaces as 504 "Outdated Optimize Dep"
// (intent-hq/intent#4625). Each harness therefore gets its own cache directory.
export const VITE_HARNESS_CACHE_ROOT = path.join('node_modules', '.vite-harness');

const HARNESS_NAME = /^[a-z0-9][a-z0-9._-]*$/i;

/**
 * Resolve the per-harness Vite `cacheDir`.
 *
 * @param {string} name Stable harness name, e.g. the spec file's base name.
 * @param {{ override?: string, root?: string, workerIndex?: number }} [options] `override` selects the cache root when
 *   set (used to keep existing `*_VITE_CACHE_DIR` env knobs working); `root`
 *   defaults to `process.cwd()`. `workerIndex` isolates concurrent Playwright
 *   workers of the same spec while retaining stable paths for cold/warm runs.
 * @returns {string} Absolute cache directory path.
 */
export function viteHarnessCacheDir(name, { override, root = process.cwd(), workerIndex } = {}) {
  if (workerIndex !== undefined && (!Number.isSafeInteger(workerIndex) || workerIndex < 0)) {
    throw new Error('Vite harness workerIndex must be a nonnegative safe integer.');
  }
  if (override && workerIndex === undefined) return path.resolve(root, override);
  if (typeof name !== 'string' || !HARNESS_NAME.test(name)) {
    throw new Error(
      `Vite harness name must match ${HARNESS_NAME} (received ${JSON.stringify(name)}).`,
    );
  }
  const cache = override
    ? path.resolve(root, override)
    : path.join(root, VITE_HARNESS_CACHE_ROOT, name);
  return workerIndex === undefined ? cache : path.join(cache, `worker-${workerIndex}`);
}

/**
 * Wait until a dev server's client dependency optimizer is idle: the initial
 * scan finished and every discovered dependency is committed to the cache.
 *
 * Vite scans and pre-bundles in the background after `listen()`. A harness
 * that starts tests immediately makes the first test share CPU and the esbuild
 * service with that work, and `server.close()` must then cancel it mid-build
 * (the Electron browser lifetime lane's cold-start worker teardown timeout).
 * Settling in the harness setup keeps that cost out of every test.
 *
 * @param {import('vite').ViteDevServer} server Listening dev server.
 * @param {{ timeoutMs?: number }} [options] Upper bound for the whole wait.
 * @returns {Promise<void>}
 */
export async function settleDepsOptimizer(server, { timeoutMs = 120_000 } = {}) {
  const optimizer = server.environments.client.depsOptimizer;
  if (!optimizer) return;
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Vite dependency optimization did not settle in ${timeoutMs}ms.`)),
      timeoutMs,
    );
  });
  try {
    const seen = new Set();
    for (;;) {
      await Promise.race([optimizer.scanProcessing, expired]);
      const pending = Object.values(optimizer.metadata.discovered)
        .map((dep) => dep.processing)
        .filter((processing) => processing && !seen.has(processing));
      if (pending.length === 0 && !optimizer.scanProcessing) return;
      for (const processing of pending) seen.add(processing);
      await Promise.race([Promise.all(pending), expired]);
    }
  } finally {
    clearTimeout(timer);
  }
}
