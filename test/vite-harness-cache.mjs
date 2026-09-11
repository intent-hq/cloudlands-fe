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
 * @param {{ override?: string, root?: string }} [options] `override` wins when
 *   set (used to keep existing `*_VITE_CACHE_DIR` env knobs working); `root`
 *   defaults to `process.cwd()`.
 * @returns {string} Absolute cache directory path.
 */
export function viteHarnessCacheDir(name, { override, root = process.cwd() } = {}) {
  if (override) return path.resolve(root, override);
  if (typeof name !== 'string' || !HARNESS_NAME.test(name)) {
    throw new Error(
      `Vite harness name must match ${HARNESS_NAME} (received ${JSON.stringify(name)}).`,
    );
  }
  return path.join(root, VITE_HARNESS_CACHE_ROOT, name);
}
