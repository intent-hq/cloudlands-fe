/**
 * Version comparison for host-requirement probes.
 *
 * Dependency-light (no stores, no side effects) so it is importable from
 * both the Electron main process and renderer bridge seeders.
 */

/**
 * Compare a probed version against a minimum. Extracts the first
 * `major.minor.patch` triple so prerelease suffixes and prefixes (`v22.1.0`,
 * `auggie 0.13.4`) are tolerated — mirrors the main-process check that treats
 * `0.13.0-beta.1` as meeting a `0.13.0` requirement. An unparseable version
 * never meets the requirement.
 */
export function meetsMinimumVersion(version: string, minimum: string): boolean {
  const parse = (raw: string): number[] | null => {
    const match = raw.match(/(\d+)\.(\d+)\.(\d+)/);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  };
  const current = parse(version);
  const required = parse(minimum);
  if (!current || !required) return false;
  for (let i = 0; i < 3; i++) {
    if (current[i] !== required[i]) return current[i] > required[i];
  }
  return true;
}
