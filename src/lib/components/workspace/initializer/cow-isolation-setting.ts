/**
 * Cached single-flight read of the BE-owned `workspace.cowIsolation` setting
 * (PROTOCOL §5.12). The setting is machine-global, so every consumer (each
 * visible CheckoutModePill, RepoSelector, BranchSelector) shares ONE
 * `settings.get` RPC instead of fanning one out per instance on every
 * workspace-list refetch (AGENTS.md single-flight rule; precedent
 * intent-hq/monorepo#1395). The settings-hydration service invalidates the
 * cache when a `settings:changed` delta touches the path, so toggles still
 * propagate. Dependency-light on purpose — imports only the AppClient seam —
 * so the hydration service can import the invalidator without evaluating
 * selectors mid-store-init.
 */
import { appClient } from '$lib/client';

let cached: Promise<boolean> | null = null;

/**
 * Whether the `workspace.cowIsolation` setting is on. Concurrent callers
 * share the in-flight promise; a settled success is cached until
 * `invalidateCowIsolationSetting()`. A failed read is NOT cached (the
 * rejection propagates to callers and the next call retries the wire).
 */
export function readCowIsolationSetting(): Promise<boolean> {
  if (cached) return cached;
  const inFlight = appClient.settings
    .get('workspace.cowIsolation')
    .then((setting) => setting?.value === true);
  cached = inFlight;
  inFlight.catch(() => {
    if (cached === inFlight) cached = null;
  });
  return inFlight;
}

/** Drop the cached value so the next read hits the wire (settings-changed). */
export function invalidateCowIsolationSetting(): void {
  cached = null;
}
