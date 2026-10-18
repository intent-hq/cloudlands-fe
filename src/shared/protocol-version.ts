/**
 * The one place that parses a daemon `protocolVersion`.
 *
 * Clients never cap the protocol version (docs/protocol/versioning.md →
 * Compatibility Policy): a feature is gated on an advertised capability, or
 * on a minimum `major.minor` through {@link protocolVersionAtLeast}. There is
 * deliberately no "at most" or "exact major" helper — the major moves for
 * unrelated changes, and a cap silently disables working features on every
 * newer daemon (script monitors and script lists on protocol 15,
 * intent-hq/intent#7206). `scripts/check-protocol-version-parsing.mjs` keeps
 * other modules from parsing or comparing versions by hand.
 *
 * Main-process and renderer safe: no imports, no side effects.
 */

/** Daemons report `major.minor`, optionally `.patch`; surrounding whitespace is ignored. */
const PROTOCOL_VERSION_PATTERN = /^(\d+)\.(\d+)(?:\.\d+)?$/;

/**
 * Parse a well-formed `major.minor[.patch]` protocol version. Missing,
 * non-string and malformed values (a bare major, a pre-release suffix, a `v`
 * prefix) are `null`.
 */
export function parseProtocolVersion(version: unknown): { major: number; minor: number } | null {
  if (typeof version !== 'string') return null;
  const match = version.trim().match(PROTOCOL_VERSION_PATTERN);
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : null;
}

/**
 * Whether `version` is at least `major.minor`, compared numerically
 * (`10.10` ≥ `10.4`; any greater major passes regardless of minor). Missing or
 * malformed versions are `false`, so an additive feature is never sent to a
 * daemon that has not proven it.
 */
export function protocolVersionAtLeast(version: unknown, major: number, minor = 0): boolean {
  const parsed = parseProtocolVersion(version);
  if (!parsed) return false;
  if (parsed.major !== major) return parsed.major > major;
  return parsed.minor >= minor;
}

/**
 * The numeric major segment (the part before the first `.`), for the
 * warn-only local/remote mismatch notice — never for gating. Accepts a bare
 * major (`'1'`); `null` when absent or not a non-negative integer.
 */
export function protocolMajor(version: string | null | undefined): number | null {
  if (typeof version !== 'string') return null;
  const major = version.trim().split('.')[0];
  if (!/^\d+$/.test(major)) return null;
  return Number(major);
}
