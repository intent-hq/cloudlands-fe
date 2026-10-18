import { protocolVersionAtLeast } from '$shared/protocol-version';

export function supportsReasoningEffortProtocol(protocolVersion?: string | null): boolean {
  return protocolVersionAtLeast(protocolVersion, 5, 2);
}
