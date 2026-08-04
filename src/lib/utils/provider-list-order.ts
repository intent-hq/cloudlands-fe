/**
 * Provider list ordering for the settings provider panel.
 *
 * Single source of the row order shared by ProviderSelector's loading
 * skeleton and loaded states: filter hidden providers, then sort strictly
 * alphabetically by display name (no provider pinning).
 */

interface OrderableProviderEntry {
  id: string;
  displayName: string;
  /** Daemon's env-var / feature-code visibility verdict (PROTOCOL §5.38). */
  visible?: boolean;
}

/** Strict alphabetical comparator by display name. */
export function compareProvidersByDisplayName(
  a: Pick<OrderableProviderEntry, 'displayName'>,
  b: Pick<OrderableProviderEntry, 'displayName'>,
): number {
  return a.displayName.localeCompare(b.displayName);
}

/**
 * Filter and order catalog entries for display.
 *
 * When `hiddenProviderIds` is known (provider availability has loaded), rows
 * on that list are dropped — matching the loaded state's existing behavior.
 * Before availability loads (`hiddenProviderIds === undefined`), the
 * catalog's own `visible` flag stands in so gated providers (e.g. mock,
 * cortex) do not flash in the skeleton.
 */
export function orderProviderEntries<T extends OrderableProviderEntry>(
  entries: readonly T[],
  hiddenProviderIds: readonly string[] | undefined,
): T[] {
  return entries
    .filter((entry) =>
      hiddenProviderIds ? !hiddenProviderIds.includes(entry.id) : entry.visible !== false,
    )
    .sort(compareProvidersByDisplayName);
}
