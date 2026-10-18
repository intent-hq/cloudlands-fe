/**
 * The one place that parses a daemon `protocolVersion`.
 *
 * Clients never cap the protocol version (docs/protocol/versioning.md →
 * Compatibility Policy): a feature is gated on an advertised capability, or
 * on a minimum `major.minor` through {@link protocolVersionAtLeast}, which
 * only accepts a {@link ProtocolVersion} parsed once at arrival. There is
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

declare const protocolVersionBrand: unique symbol;

/**
 * A daemon protocol version that has been validated by
 * {@link parseProtocolVersion}. Parse it once, where the version arrives
 * (`client.hello`, `system.status`, the sidecar startup probe), and carry this
 * value to every gate.
 *
 * At runtime it is the trimmed version string, so it crosses IPC and the
 * renderer store unchanged. To the type checker it is opaque: it has no string
 * methods and does not compare with `===`, `<` or `>` against a literal, so a
 * cap like `/^14\./.test(version)` or `major === 15` cannot compile. The only
 * question it answers is {@link protocolVersionAtLeast}; show it to users with
 * {@link formatProtocolVersion}.
 */
export type ProtocolVersion = { readonly [protocolVersionBrand]: 'ProtocolVersion' };

/**
 * Validate a `major.minor[.patch]` protocol version. Missing, non-string and
 * malformed values (a bare major, a pre-release suffix, a `v` prefix) are
 * `null`, which every gate treats as "not proven".
 */
export function parseProtocolVersion(version: unknown): ProtocolVersion | null {
  if (typeof version !== 'string') return null;
  const trimmed = version.trim();
  return PROTOCOL_VERSION_PATTERN.test(trimmed) ? (trimmed as unknown as ProtocolVersion) : null;
}

function segments(version: ProtocolVersion): { major: number; minor: number } | null {
  // Re-validated so a value forced through `as ProtocolVersion` still fails closed.
  const match =
    typeof version === 'string' ? (version as string).match(PROTOCOL_VERSION_PATTERN) : null;
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : null;
}

/**
 * Whether `version` is at least `major.minor`, compared numerically
 * (`10.10` ≥ `10.4`; any greater major passes regardless of minor). An
 * unknown (`null`/`undefined`) version is `false`, so an additive feature is
 * never sent to a daemon that has not proven it.
 */
export function protocolVersionAtLeast(
  version: ProtocolVersion | null | undefined,
  major: number,
  minor = 0,
): boolean {
  const parsed = version ? segments(version) : null;
  if (!parsed) return false;
  if (parsed.major !== major) return parsed.major > major;
  return parsed.minor >= minor;
}

/** The version text, for display only — never parse or compare it. */
export function formatProtocolVersion(version: ProtocolVersion): string {
  return version as unknown as string;
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
