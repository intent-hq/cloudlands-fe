/**
 * Resolve the Playwright CT component server port (`use.ctPort`) and the
 * component-bundle cache dir (`use.ctCacheDir`) for playwright-ct.config.ts
 * from one normalized `CT_PORT` read.
 *
 * Kept as a pure function (no `process` access) so vitest can cover the
 * resolution without launching a browser.
 *
 * - `CT_PORT` unset or blank (empty / whitespace-only) → port 3100 and
 *   `playwright/.cache` (Playwright's defaults).
 * - Otherwise → the trimmed numeric port and `playwright/.cache-<port>`.
 *
 * The blank → unset rule mirrors `ctPort()` in scripts/verification-lock.mjs,
 * so the server port, the host-wide `ct-<port>` lock, and the cache dir never
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
const CT_PORT_DEFAULT = 3100;
const CT_CACHE_DIR_DEFAULT = 'playwright/.cache';

export interface ResolveCtPortConfigOptions {
  env: Record<string, string | undefined>;
}

export interface CtPortConfig {
  port: number;
  cacheDir: string;
}

export function resolveCtPortConfig({ env }: ResolveCtPortConfigOptions): CtPortConfig {
  const raw = env.CT_PORT?.trim();
  if (!raw) return { port: CT_PORT_DEFAULT, cacheDir: CT_CACHE_DIR_DEFAULT };
  const port = Number(raw);
  return { port, cacheDir: `${CT_CACHE_DIR_DEFAULT}-${port}` };
}
