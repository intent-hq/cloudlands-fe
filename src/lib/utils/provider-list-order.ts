/**
 * Provider list ordering for the settings provider panel.
 *
 * Single source of the row order shared by ProviderSelector's loading
 * skeleton and loaded states: filter hidden providers, then sort by display
 * name. Grouped lists additionally pin the active provider first in Enabled.
 */

interface OrderableProviderEntry {
  id: string;
  displayName: string;
  /** Daemon's env-var / feature-code visibility verdict (PROTOCOL §5.38). */
  visible?: boolean;
}

export interface ProviderEntryGroups<T> {
  enabled: T[];
  discovered: T[];
  supported: T[];
}

export interface GroupProviderEntriesOptions {
  isProviderEnabled: (providerId: string) => boolean;
  availabilityByProviderId: Readonly<Record<string, { readonly available: boolean } | undefined>>;
  hiddenProviderIds?: readonly string[];
  activeProviderId?: string | null;
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
 * catalog's own `visible` flag stands in so gated providers (e.g. mock) do
 * not flash in the skeleton.
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

/** Partition settings providers by state, with the active provider first in Enabled. */
export function groupProviderEntries<T extends OrderableProviderEntry>(
  entries: readonly T[],
  {
    isProviderEnabled,
    availabilityByProviderId,
    hiddenProviderIds,
    activeProviderId,
  }: GroupProviderEntriesOptions,
): ProviderEntryGroups<T> {
  const groups: ProviderEntryGroups<T> = {
    enabled: [],
    discovered: [],
    supported: [],
  };

  for (const entry of orderProviderEntries(entries, hiddenProviderIds)) {
    if (isProviderEnabled(entry.id) || (activeProviderId && entry.id === activeProviderId)) {
      groups.enabled.push(entry);
    } else if (availabilityByProviderId[entry.id]?.available === true) {
      groups.discovered.push(entry);
    } else {
      groups.supported.push(entry);
    }
  }

  if (activeProviderId) {
    const activeIndex = groups.enabled.findIndex((entry) => entry.id === activeProviderId);
    if (activeIndex > 0) {
      groups.enabled.unshift(...groups.enabled.splice(activeIndex, 1));
    }
  }

  return groups;
}
