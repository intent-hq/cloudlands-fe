import { protocolVersionAtLeast, type ProtocolVersion } from '$shared/protocol-version';

/** First protocol version whose daemon accepts the separate reasoning-effort field. */
const REASONING_EFFORT_MIN_PROTOCOL = { major: 5, minor: 2 } as const;

/**
 * True when the daemon takes reasoning effort as its own field; older daemons
 * need the legacy model-id suffix. Minimum-only: there is no upper bound.
 */
export function supportsReasoningEffortProtocol(protocolVersion?: ProtocolVersion | null): boolean {
  const { major, minor } = REASONING_EFFORT_MIN_PROTOCOL;
  return protocolVersionAtLeast(protocolVersion, major, minor);
}

/**
 * True only for a daemon that reported a well-formed version below the minimum.
 * Unknown metadata (absent, or malformed and so parsed to `null`) keeps the
 * current contract rather than downgrading a modern daemon to the legacy
 * model-id suffix.
 */
export function usesLegacyReasoningEffort(protocolVersion?: ProtocolVersion | null): boolean {
  return !!protocolVersion && !supportsReasoningEffortProtocol(protocolVersion);
}
