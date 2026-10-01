import type { DevConsoleRecord, DevConsoleRow } from '$shared/types/dev-console';
export type TrafficTab = 'outbound' | 'inbound' | 'events';
export type TrafficColumn =
  'timestamp' | 'method' | 'kind' | 'requestId' | 'status' | 'durationMs' | 'bytes' | 'backendId';
export function trafficBytes(row: DevConsoleRow) {
  return (row.payload.originalBytes ?? 0) + (row.response?.originalBytes ?? 0);
}
export function orderTraffic(
  rows: DevConsoleRow[],
  tab: TrafficTab,
  filter: string,
  column: TrafficColumn,
  descending: boolean,
) {
  const needle = filter.trim().toLocaleLowerCase();
  const value = (r: DevConsoleRow): string | number =>
    column === 'bytes' ? trafficBytes(r) : (r[column] ?? (column === 'durationMs' ? -1 : ''));
  return rows
    .filter(
      (r) =>
        (tab === 'events'
          ? r.direction === 'inbound' && r.kind === 'notification'
          : r.direction === tab && r.kind === 'request') &&
        r.method.toLocaleLowerCase().includes(needle),
    )
    .sort((a, b) => {
      const av = value(a),
        bv = value(b);
      const comparison =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true });
      return descending ? -comparison : comparison;
    });
}
/** Owns only one selected payload. Selection identity rejects stale replies; updates coalesce. */
export function selectedPayloadReader(
  read: (id: string) => Promise<DevConsoleRecord | null>,
  change: (record: DevConsoleRecord | null) => void,
  fail: (error: string) => void,
) {
  let identity = '',
    version = 0,
    current: DevConsoleRow | null = null,
    stopped = false;
  let flight: { version: number; dirty: boolean } | null = null;
  const refresh = async () => {
    if (!current || stopped) return;
    if (flight?.version === version) {
      flight.dirty = true;
      return;
    }
    const token = { version, dirty: false };
    flight = token;
    try {
      do {
        token.dirty = false;
        const row = current;
        if (!row) return;
        const result = await read(row.id);
        if (stopped || token.version !== version) return;
        if (!token.dirty) change(result);
      } while (token.dirty);
    } catch (error) {
      if (!stopped && token.version === version) fail(String(error));
    } finally {
      if (flight === token) flight = null;
    }
  };
  return {
    select(session: string, row: DevConsoleRow | null) {
      if (stopped) return;
      const next = row ? `${session}:${row.id}` : '';
      if (next !== identity) {
        identity = next;
        version++;
        current = null;
        change(null);
      }
      if (row === current) return;
      current = row;
      if (row) void refresh();
    },
    dispose() {
      stopped = true;
      version++;
      current = null;
      identity = '';
      change(null);
    },
  };
}
export function readablePayload(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
