import { ctPort } from '../scripts/verification-lock.mjs';

/**
 * Resolve the Playwright CT component server port (`use.ctPort`) and the
 * component-bundle cache dir (`use.ctCacheDir`) for playwright-ct.config.ts
 * from one normalized `CT_PORT` read.
 *
 * Kept free of `process` access so vitest can cover the resolution without
 * launching a browser.
 *
 * - `CT_PORT` set → the trimmed numeric port and `playwright/.cache-<port>`,
 *   exactly as before the per-worktree default existed.
 * - `CT_PORT` unset or blank (empty / whitespace-only) → `ctPort()`'s default
 *   (3100 on CI, otherwise a per-worktree port derived from the package root)
 *   and Playwright's default `playwright/.cache`: the worktree-unique port
 *   already keeps that cache private to this checkout.
 *
 * The port comes from `ctPort()` in scripts/verification-lock.mjs, so the
 * server port, the host-wide `ct-<port>` lock, and the cache dir never
 * disagree for the same environment.
 *
 * `CT_PORT` already isolates the component server and the host-wide
 * `ct-<CT_PORT>` lock, but the generated component registry/bundle under
 * `playwright/.cache` was still shared: two concurrent runs in the same
 * checkout on distinct ports overwrote each other's bundle (cloudlands-fe
 * PR #2441, Wave 8). Keying the cache dir by the same port makes per-port
 * runs independent within one worktree too. Playwright resolves the value
 * relative to the config file's directory.
 */
const CT_CACHE_DIR_DEFAULT = 'playwright/.cache';

export interface ResolveCtPortConfigOptions {
  env: Record<string, string | undefined>;
  /** Package root that keys the per-worktree default; tests pin it. */
  root?: string;
}

export interface CtPortConfig {
  port: number;
  cacheDir: string;
}

export function resolveCtPortConfig({ env, root }: ResolveCtPortConfigOptions): CtPortConfig {
  const port = ctPort(env, { root });
  if (!env.CT_PORT?.trim()) return { port, cacheDir: CT_CACHE_DIR_DEFAULT };
  return { port, cacheDir: `${CT_CACHE_DIR_DEFAULT}-${port}` };
}
