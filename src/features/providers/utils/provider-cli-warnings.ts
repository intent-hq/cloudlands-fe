/** The optional CLI verdict fields in host.providerDiscovery (§5.14). */
export interface ProviderCliDiscovery {
  id: string;
  displayName: string;
  gatedOff?: string | null;
  cliResolved?: boolean;
  cliVersion?: string;
  /** Adapter-declared lower bound, absent for legacy/manual provider gates. */
  cliMinimumVersion?: string;
  cliVersionOk?: boolean;
}

export interface ProviderCliWarning {
  providerId: string;
  providerName: string;
  version: string;
  minimumVersion: string;
}

/**
 * Trust the daemon's verdict and requirement, never duplicate its minimum table.
 * Only adapter-derived minima opt in. Legacy Pi daemons return false even for
 * unknown probes, but never carry cliMinimumVersion. The daemon owns parsing
 * and lower-bound comparison; unknown versions omit the verdict.
 */
export function providerCliWarnings(providers: ProviderCliDiscovery[]): ProviderCliWarning[] {
  return providers.flatMap((row) => {
    const version = row.cliVersion?.trim();
    const minimumVersion = row.cliMinimumVersion?.trim();
    if (
      row.gatedOff ||
      row.cliResolved !== true ||
      row.cliVersionOk !== false ||
      !version ||
      !minimumVersion
    )
      return [];
    return [{ providerId: row.id, providerName: row.displayName, version, minimumVersion }];
  });
}
