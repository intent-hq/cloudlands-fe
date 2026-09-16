/**
 * Resolve the Playwright CT component-bundle cache dir (`use.ctCacheDir`) for
 * playwright-ct.config.ts.
 *
 * Kept as a pure function (no `process` access) so vitest can cover the
 * resolution without launching a browser.
 *
 * - `CT_PORT` unset or blank → `playwright/.cache` (Playwright's default).
 * - Otherwise → `playwright/.cache-<CT_PORT>`.
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

export interface ResolveCtCacheDirOptions {
  env: Record<string, string | undefined>;
}

export function resolveCtCacheDir({ env }: ResolveCtCacheDirOptions): string {
  const port = env.CT_PORT?.trim();
  if (!port) return CT_CACHE_DIR_DEFAULT;
  return `${CT_CACHE_DIR_DEFAULT}-${port}`;
}
