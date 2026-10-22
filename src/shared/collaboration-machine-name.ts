/** Collaborator-facing label only; never use for client identity or paired-device aliases. */
export function collaborationMachineName(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const status = value as {
    collaborationName?: unknown;
    prettyHostname?: unknown;
    hostname?: unknown;
  };
  for (const name of [status.collaborationName, status.prettyHostname, status.hostname]) {
    if (typeof name === 'string' && normalizeCollaborationMachineName(name))
      return normalizeCollaborationMachineName(name);
  }
  return null;
}

/** Matches sharing.machineName: trimmed Unicode scalar count and no control characters. */
export function validCollaborationMachineName(value: string): boolean {
  return [...normalizeCollaborationMachineName(value)].length <= 100 && !/\p{Cc}/u.test(value);
}
/** Rust str::trim uses Unicode White_Space; JS trim additionally strips FEFF. */
export function normalizeCollaborationMachineName(value: string): string {
  return value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
}
