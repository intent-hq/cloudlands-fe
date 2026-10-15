import type { BackendTransport } from './backend-transport-types';

/** Wire lock normalization shared with the source host's lock event and hydration owners. */
export function toLockRecord(value: unknown): Record<string, true> {
  const record: Record<string, true> = {};
  if (!Array.isArray(value)) return record;
  for (const entry of value)
    if (typeof entry === 'string')
      Object.defineProperty(record, entry, {
        value: true,
        enumerable: true,
        configurable: true,
        writable: true,
      });
  return record;
}
export function parseAgentLocks(value: unknown, strict = true) {
  const data = value as { lockedAgentIds?: unknown; lockedFilePaths?: unknown } | null;
  if (
    strict &&
    (!data ||
      !Array.isArray(data.lockedAgentIds) ||
      !Array.isArray(data.lockedFilePaths) ||
      !data.lockedAgentIds.every((id) => typeof id === 'string') ||
      !data.lockedFilePaths.every((path) => typeof path === 'string'))
  )
    throw new Error('Invalid agent lock snapshot');
  return {
    lockedAgentIds: toLockRecord(data?.lockedAgentIds),
    lockedFilePaths: toLockRecord(data?.lockedFilePaths),
  };
}
export function createBackendAgentLockReader(request: BackendTransport['request'], strict = true) {
  return async (workspaceId: string) =>
    parseAgentLocks(await request('file-tracking.getAgentLocks', { workspaceId }), strict);
}
