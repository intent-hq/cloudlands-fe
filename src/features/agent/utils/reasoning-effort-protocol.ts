import { protocolVersionAtLeast } from '$shared/protocol-version';

/** First protocol version whose daemon accepts the separate reasoning-effort field. */
const REASONING_EFFORT_MIN_PROTOCOL = { major: 5, minor: 2 } as const;

/**
 * True when the daemon takes reasoning effort as its own field; older daemons
 * need the legacy model-id suffix. Minimum-only: there is no upper bound.
 */
export function supportsReasoningEffortProtocol(protocolVersion?: string | null): boolean {
  const { major, minor } = REASONING_EFFORT_MIN_PROTOCOL;
  return protocolVersionAtLeast(protocolVersion, major, minor);
}
