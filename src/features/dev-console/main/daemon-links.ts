import {
  LINK_TRAFFIC_FORBIDDEN,
  type LinkCaptureStatus,
  type LinkTrafficRead,
  type LinkTrafficRecord,
  type LinkTrafficRow,
} from '../../../shared/types/daemon-links';

/** The slice of the pooled JSON-RPC client the Daemon links view needs. */
export interface DaemonLinksClient {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
  getNodeCapabilities(): Readonly<Record<string, number>> | null;
  on(
    event: 'notification',
    listener: (notification: { method: string; params?: unknown }) => void,
  ): unknown;
  on(event: 'reconnected', listener: () => void): unknown;
  off(
    event: 'notification',
    listener: (notification: { method: string; params?: unknown }) => void,
  ): unknown;
  off(event: 'reconnected', listener: () => void): unknown;
}

/** Batched live records, also emitted with an empty list on every start and stop. */
const LINK_TRAFFIC_EVENT = 'remoteLinkTraffic:records';

const LINK_TRAFFIC_METHODS = {
  start: 'remoteLinkTraffic.start',
  stop: 'remoteLinkTraffic.stop',
  snapshot: 'remoteLinkTraffic.snapshot',
} as const;
/** Upper bound the daemon accepts for one snapshot page. */
const LINK_SNAPSHOT_LIMIT = 2000;

const count = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
const text = (value: unknown) => (typeof value === 'string' ? value : undefined);

/** Defensive parse: unknown or malformed fields fall back to an inactive, empty capture. */
export function parseCaptureStatus(value: unknown): LinkCaptureStatus {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const startedAt = text(raw.startedAt);
  return {
    active: raw.active === true,
    ...(startedAt ? { startedAt } : {}),
    payloads: raw.payloads === true,
    maxRecords: count(raw.maxRecords),
    maxPayloadBytes: count(raw.maxPayloadBytes),
    retained: count(raw.retained),
    evicted: count(raw.evicted),
    dropped: count(raw.dropped),
    oversized: count(raw.oversized),
    nextSeq: count(raw.nextSeq),
  };
}

function parseRecord(value: unknown): LinkTrafficRecord | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const peer = (raw.peer && typeof raw.peer === 'object' ? raw.peer : null) as Record<
    string,
    unknown
  > | null;
  if (
    typeof raw.seq !== 'number' ||
    !Number.isSafeInteger(raw.seq) ||
    typeof raw.at !== 'string' ||
    (raw.direction !== 'in' && raw.direction !== 'out') ||
    !peer ||
    (peer.kind !== 'machine' && peer.kind !== 'backend') ||
    typeof peer.id !== 'string' ||
    typeof raw.frameType !== 'string'
  )
    return null;
  const name = text(peer.name);
  const agentId = text(raw.agentId);
  const requestId = text(raw.requestId);
  return {
    seq: raw.seq,
    at: raw.at,
    direction: raw.direction,
    peer: { kind: peer.kind, id: peer.id, ...(name ? { name } : {}) },
    frameType: raw.frameType,
    ...(agentId ? { agentId } : {}),
    ...(requestId ? { requestId } : {}),
    bytes: count(raw.bytes),
    summary: text(raw.summary) ?? '',
    ...(raw.payload !== undefined ? { payload: raw.payload } : {}),
    ...(raw.truncated === true ? { truncated: true } : {}),
  };
}

/** Strip the payload so live rows stay small; the selection fetches it separately. */
export function toLinkRow(record: LinkTrafficRecord, captureStartedAt = ''): LinkTrafficRow {
  const { payload, ...rest } = record;
  const timestamp = Date.parse(record.at);
  return {
    ...rest,
    id: `link-${record.seq}`,
    timestamp: Number.isFinite(timestamp) ? timestamp : 0,
    hasPayload: payload !== undefined,
    captureStartedAt,
  };
}

function parseSnapshot(value: unknown): {
  capture: LinkCaptureStatus;
  records: LinkTrafficRecord[];
} {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const records = Array.isArray(raw.records)
    ? raw.records.map(parseRecord).filter((r): r is LinkTrafficRecord => r !== null)
    : [];
  return { capture: parseCaptureStatus(raw.capture), records };
}

/**
 * Owner-only daemon-link capture for one console's backend. Every call resolves
 * the live pooled client by the window's native backend id; the renderer never
 * names a backend. Methods are only sent when the daemon advertises
 * `remoteLinkTraffic: 1` (never in node mode, never on older daemons).
 */
export function createDaemonLinks(getClient: (backendId: string) => DaemonLinksClient | undefined) {
  const supported = (backendId: string) =>
    getClient(backendId)?.getNodeCapabilities()?.remoteLinkTraffic === 1;
  const call = async (backendId: string, method: string, params: unknown) => {
    const resolved = getClient(backendId);
    if (!resolved || resolved.getNodeCapabilities()?.remoteLinkTraffic !== 1)
      throw new Error('Daemon link capture is not supported by this daemon'); // i18n-ignore (IPC error)
    try {
      return await resolved.request(method, params);
    } catch (error) {
      // Members, guests and node mode are refused with -32003; only the message crosses IPC.
      if ((error as { rpcCode?: unknown } | null)?.rpcCode === -32003)
        throw new Error(LINK_TRAFFIC_FORBIDDEN);
      throw error;
    }
  };
  const capture = async (backendId: string, method: string) => {
    const result = (await call(backendId, method, {})) as { capture?: unknown } | undefined;
    return parseCaptureStatus(result?.capture);
  };
  /**
   * Subscribe this console to `remoteLinkTraffic:records` and call `onChange`
   * per event (start, stop, new records). The event only signals: the renderer
   * re-reads the snapshot, which also fills any gap. Re-subscribes after a
   * reconnect; the disposer unsubscribes.
   */
  function watch(backendId: string, onChange: () => void): () => void {
    const resolved = getClient(backendId);
    if (!resolved || !supported(backendId)) return () => {};
    let disposed = false;
    let subscriptionId: string | undefined;
    let epoch = 0;
    const release = (id: string | undefined) => {
      if (id) void resolved.request('events.unsubscribe', { subscriptionId: id }).catch(() => {});
    };
    const subscribe = async () => {
      const mine = ++epoch;
      const previous = subscriptionId;
      subscriptionId = undefined;
      release(previous);
      try {
        const result = (await resolved.request('events.subscribe', {
          eventTypes: [LINK_TRAFFIC_EVENT],
        })) as { subscriptionId?: unknown } | undefined;
        const id = typeof result?.subscriptionId === 'string' ? result.subscriptionId : undefined;
        if (disposed || mine !== epoch) release(id);
        else subscriptionId = id;
      } catch {
        /* Polling still reads the snapshot; the next reconnect retries. */
      }
    };
    const onNotification = (notification: { method: string; params?: unknown }) => {
      if (notification.method !== 'events.event' || !subscriptionId) return;
      const params = notification.params as
        { subscriptionId?: unknown; event?: { type?: unknown } } | undefined;
      if (params?.subscriptionId === subscriptionId && params.event?.type === LINK_TRAFFIC_EVENT)
        onChange();
    };
    const onReconnected = () => {
      if (!disposed) void subscribe();
    };
    resolved.on('notification', onNotification);
    resolved.on('reconnected', onReconnected);
    void subscribe();
    return () => {
      if (disposed) return;
      disposed = true;
      resolved.off('notification', onNotification);
      resolved.off('reconnected', onReconnected);
      release(subscriptionId);
      subscriptionId = undefined;
    };
  }
  return {
    watch,
    status: (backendId: string) => ({ supported: supported(backendId) }),
    start: (backendId: string) => capture(backendId, LINK_TRAFFIC_METHODS.start),
    stop: (backendId: string) => capture(backendId, LINK_TRAFFIC_METHODS.stop),
    async read(backendId: string, afterSeq: number): Promise<LinkTrafficRead> {
      const result = parseSnapshot(
        await call(backendId, LINK_TRAFFIC_METHODS.snapshot, {
          ...(afterSeq >= 0 ? { afterSeq } : {}),
          limit: LINK_SNAPSHOT_LIMIT,
        }),
      );
      const startedAt = result.capture.startedAt ?? '';
      return {
        capture: result.capture,
        records: result.records.map((record) => toLinkRow(record, startedAt)),
      };
    },
    /**
     * One retained record with its masked payload; null once evicted or cleared,
     * or when the daemon now holds another capture (seq restarts with each one).
     */
    async record(
      backendId: string,
      seq: number,
      captureStartedAt: string,
    ): Promise<LinkTrafficRecord | null> {
      const result = parseSnapshot(
        await call(backendId, LINK_TRAFFIC_METHODS.snapshot, {
          afterSeq: seq - 1,
          limit: 1,
        }),
      );
      if (!result.capture.active || result.capture.startedAt !== captureStartedAt) return null;
      return result.records.find((r) => r.seq === seq) ?? null;
    },
  };
}
export type DaemonLinks = ReturnType<typeof createDaemonLinks>;
