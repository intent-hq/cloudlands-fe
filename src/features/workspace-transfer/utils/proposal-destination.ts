import type { ConnectionRecord } from '$shared/types/connections';

/** A hint must identify exactly one saved target; never fall back to the first device. */
export function resolveTransferDestination(
  connections: readonly ConnectionRecord[],
  sourceId: string,
  hint?: string,
): string {
  const value = hint?.trim();
  if (!value) return '';
  const targets = connections.filter((connection) => connection.id !== sourceId);
  const exact = targets.find((connection) => connection.id === value);
  if (exact) return exact.id;
  const matches = targets.filter((connection) =>
    [connection.label, connection.hostname, connection.host].some(
      (name) => name?.toLowerCase() === value.toLowerCase(),
    ),
  );
  return matches.length === 1 ? matches[0].id : '';
}

export function transferConnectionLabel(connection: ConnectionRecord): string {
  const name = connection.label || connection.hostname || connection.id;
  return connection.host ? `${name} (${connection.host}:${connection.port})` : name;
}
