export function supportsReasoningEffortProtocol(protocolVersion?: string | null): boolean {
  if (!protocolVersion) return false;
  const match = protocolVersion.trim().match(/^([0-9]+)(?:\.([0-9]+))?/);
  if (!match) return false;

  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);
  return major > 5 || (major === 5 && minor >= 2);
}
