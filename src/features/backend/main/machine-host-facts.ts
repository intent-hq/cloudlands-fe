import type { ConnectionProviderSummary } from '../../../shared/types/connections';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** The daemon host's OS identifier from a `host.status` result (`os`), or null when absent. */
export function extractHostOs(result: unknown): string | null {
  if (!record(result)) return null;
  return typeof result.os === 'string' && result.os.length > 0 ? result.os : null;
}

/** The daemon host's CPU architecture from a `host.status` result (`arch`), or null when absent. */
export function extractHostArch(result: unknown): string | null {
  if (!record(result)) return null;
  return typeof result.arch === 'string' && result.arch.length > 0 ? result.arch : null;
}

/**
 * The providers a `host.providerDiscovery` result reports as usable on the
 * daemon host: `installed`, not `gatedOff` and not gated by `unavailableReason`
 * (the same rule as the provider status seeder), in registry
 * order. Null when the result is not that shape, so callers keep "unknown"
 * apart from "nothing installed".
 */
export function extractInstalledProviders(result: unknown): ConnectionProviderSummary[] | null {
  if (!record(result) || !Array.isArray(result.providers)) return null;
  return result.providers.flatMap((row): ConnectionProviderSummary[] => {
    if (!record(row) || typeof row.id !== 'string' || row.id.length === 0) return [];
    if (row.installed !== true || row.gatedOff || typeof row.unavailableReason === 'string')
      return [];
    const displayName =
      typeof row.displayName === 'string' && row.displayName.trim() ? row.displayName : row.id;
    return [{ id: row.id, displayName }];
  });
}

/**
 * The providers a `host.executionContext` result (or the complete context a
 * `host:execution-context-changed` event carries) reports enabled on that
 * daemon host (`enabledProviderIds`). Null when the projection is missing or
 * malformed, as on an older host, so enablement stays unknown.
 */
export function extractEnabledProviderIds(result: unknown): string[] | null {
  if (!record(result) || !Array.isArray(result.enabledProviderIds)) return null;
  const ids = result.enabledProviderIds;
  return ids.every((id): id is string => typeof id === 'string' && id.length > 0) ? ids : null;
}

/**
 * The installed providers the Machines row shows: only those enabled on that
 * host. Unknown enablement (null) keeps every installed provider, matching
 * the rows of hosts that predate the projection.
 */
export function onlyEnabledProviders(
  installed: ConnectionProviderSummary[] | null,
  enabledProviderIds: string[] | null,
): ConnectionProviderSummary[] | null {
  if (!installed || !enabledProviderIds) return installed;
  const enabled = new Set(enabledProviderIds);
  return installed.filter((provider) => enabled.has(provider.id));
}
