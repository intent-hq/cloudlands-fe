/**
 * Resolve the Playwright CT worker count for playwright-ct.config.ts.
 *
 * Kept as a pure function (no `process` / `os` access) so vitest can cover
 * the resolution without launching a browser.
 *
 * - `CI` set → 1 (the CI shards pin a single worker; see
 *   .github/workflows/intent-pr.yml).
 * - `PW_WORKERS` parses to an integer ≥ 1 → that value.
 * - Otherwise `min(4, max(1, floor(cpus / 4)))`. Playwright's own default is
 *   50% of cores, which on the 32-logical-core shared daemon host launches 16
 *   Chromium-backed workers alongside builds and other agents, and mount
 *   timeouts follow (intent-hq/cloudlands-fe#2373). The divisor 4 leaves
 *   headroom for co-tenants; `PW_WORKERS` / `--workers` are the escape hatch.
 */
const CT_WORKERS_MAX = 4;
const CT_WORKERS_CPU_DIVISOR = 4;

export interface ResolveCtWorkersOptions {
  env: Record<string, string | undefined>;
  cpus: number;
}

function parsePwWorkers(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value >= 1 ? value : undefined;
}

export function resolveCtWorkers({ env, cpus }: ResolveCtWorkersOptions): number {
  if (env.CI) return 1;
  const override = parsePwWorkers(env.PW_WORKERS);
  if (override !== undefined) return override;
  return Math.min(CT_WORKERS_MAX, Math.max(1, Math.floor(cpus / CT_WORKERS_CPU_DIVISOR)));
}
