import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import type { RpcTrafficEvent, RpcTrafficSource } from '$features/backend/main/rpc-traffic';
import type {
  DevConsoleCaptureSelection,
  DevConsolePayload,
  DevConsoleRecord,
  DevConsoleSnapshot,
  DevConsoleUpdate,
} from '$shared/types/dev-console';

interface CaptureOptions {
  maxRecords?: number;
  maxPayloadBytes?: number;
  previewBytes?: number;
  monotonicNow?: () => number;
}
interface Registration {
  id: string;
  backendId: string;
  connectionId: string;
  source: RpcTrafficSource;
}
interface Entry {
  record: DevConsoleRecord;
  registrationId: string;
  startedAt: number;
  revision: number;
}
type CaptureListener = () => void | Promise<void>;

interface Session {
  id: string;
  revision: number;
  sequence: number;
  records: Map<string, Entry>;
  fullCapture: Map<string, DevConsoleCaptureSelection>;
  listeners: Set<CaptureListener>;
  detach: Map<Registration, () => void>;
  retainedBytes: number;
  evicted: number;
  dropped: number;
  oversize: number;
}

function selectionKey(selection: DevConsoleCaptureSelection): string {
  return JSON.stringify([selection.direction, selection.kind, selection.method]);
}

function positiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Invalid capture limit');
  return value;
}

/** Own one bounded, in-memory capture per backend. No observer is installed while closed. */
export class DevConsoleCaptureService {
  private readonly sessions = new Map<string, Session>();
  private readonly clients = new Map<string, Map<string, Registration>>();
  private readonly limits: DevConsoleSnapshot['limits'];
  private readonly now: () => number;

  constructor(options: CaptureOptions = {}) {
    this.limits = {
      maxRecords: positiveInteger(options.maxRecords ?? 10_000),
      maxPayloadBytes: positiveInteger(options.maxPayloadBytes ?? 32 * 1024 * 1024),
      previewBytes: positiveInteger(options.previewBytes ?? 2048),
    };
    this.now = options.monotonicNow ?? (() => performance.now());
  }

  /** Register each managed client once; call the disposer when that client is removed. */
  registerClient(backendId: string, connectionId: string, source: RpcTrafficSource): () => void {
    let clients = this.clients.get(backendId);
    if (!clients) this.clients.set(backendId, (clients = new Map()));
    const previous = clients.get(connectionId);
    if (previous) this.detachClient(previous);
    const registration = { id: randomUUID(), backendId, connectionId, source };
    clients.set(connectionId, registration);
    const session = this.sessions.get(backendId);
    if (session) this.attach(session, registration);
    return () => {
      if (clients.get(connectionId) !== registration) return;
      this.detachClient(registration);
      clients.delete(connectionId);
      if (clients.size === 0) this.clients.delete(backendId);
    };
  }

  /** Idempotent for the same open console. Close then open to obtain an empty session. */
  openSession(backendId: string): DevConsoleSnapshot {
    let session = this.sessions.get(backendId);
    if (!session) {
      session = {
        id: randomUUID(),
        revision: 0,
        sequence: 0,
        records: new Map(),
        fullCapture: new Map(),
        listeners: new Set(),
        detach: new Map(),
        retainedBytes: 0,
        evicted: 0,
        dropped: 0,
        oversize: 0,
      };
      this.sessions.set(backendId, session);
      for (const registration of this.clients.get(backendId)?.values() ?? [])
        this.attach(session, registration);
    }
    return this.snapshot(backendId, session);
  }

  /** Session identity makes a delayed old-window cleanup harmless after reopen. */
  closeSession(backendId: string, sessionId: string): void {
    const session = this.session(backendId, sessionId);
    if (!session) return;
    this.sessions.delete(backendId);
    for (const detach of session.detach.values()) detach();
    session.detach.clear();
    session.listeners.clear();
    session.records.clear();
    session.fullCapture.clear();
    session.retainedBytes = 0;
  }

  /** Clear visible history/counters, keeping prospective capture choices and unique row IDs. */
  clearSession(backendId: string, sessionId: string): boolean {
    const session = this.session(backendId, sessionId);
    if (!session) return false;
    session.records.clear();
    session.retainedBytes = 0;
    session.evicted = 0;
    session.dropped = 0;
    session.oversize = 0;
    this.changed(session);
    return true;
  }

  getSnapshot(backendId: string, sessionId: string): DevConsoleSnapshot | null {
    const session = this.session(backendId, sessionId);
    return session ? this.snapshot(backendId, session) : null;
  }

  /** Payload-free delta; no retained payload strings are copied or sent on live updates. */
  getUpdate(backendId: string, sessionId: string, afterRevision: number): DevConsoleUpdate | null {
    const session = this.session(backendId, sessionId);
    if (!session) return null;
    const entries = [...session.records.values()];
    return {
      ...this.metadata(backendId, session),
      recordIds: entries.map(({ record }) => record.id),
      upserts: entries
        .filter((entry) => entry.revision > afterRevision)
        .map(({ record }) => {
          const { text: _payloadText, ...payload } = record.payload;
          const response = record.response
            ? (({ text: _text, ...meta }) => meta)(record.response)
            : undefined;
          return { ...record, payload, response };
        }),
    };
  }

  getRecord(backendId: string, sessionId: string, recordId: string): DevConsoleRecord | null {
    const session = this.session(backendId, sessionId);
    const record =
      session &&
      [...session.records.values()].find((entry) => entry.record.id === recordId)?.record;
    return record
      ? {
          ...record,
          payload: { ...record.payload },
          response: record.response ? { ...record.response } : undefined,
        }
      : null;
  }

  /** Invalidation only: window IPC should coalesce these signals before reading a snapshot. */
  subscribe(backendId: string, sessionId: string, listener: CaptureListener): () => void {
    const session = this.session(backendId, sessionId);
    if (!session) return () => {};
    session.listeners.add(listener);
    return () => {
      session.listeners.delete(listener);
    };
  }

  setFullCapture(
    backendId: string,
    sessionId: string,
    selection: DevConsoleCaptureSelection,
    enabled: boolean,
  ): boolean {
    const session = this.session(backendId, sessionId);
    if (!session) return false;
    const key = selectionKey(selection);
    if (
      enabled &&
      !session.fullCapture.has(key) &&
      session.fullCapture.size >= this.limits.maxRecords
    )
      return false;
    if (enabled) session.fullCapture.set(key, { ...selection });
    else session.fullCapture.delete(key);
    this.changed(session);
    return true;
  }

  private session(backendId: string, id: string): Session | undefined {
    const session = this.sessions.get(backendId);
    return session?.id === id ? session : undefined;
  }

  private attach(session: Session, registration: Registration): void {
    // Unique even when the same connection slot is replaced by a fresh client with id 1.
    const prefix = randomUUID();
    session.detach.set(
      registration,
      registration.source.observeTraffic((event) => {
        if (this.sessions.get(registration.backendId) !== session) return;
        this.capture(session, registration, prefix, event);
      }),
    );
  }

  private detachClient(registration: Registration): void {
    const session = this.sessions.get(registration.backendId);
    if (!session) return;
    session.detach.get(registration)?.();
    session.detach.delete(registration);
    this.disconnected(session, registration);
  }

  private capture(
    session: Session,
    registration: Registration,
    prefix: string,
    event: RpcTrafficEvent,
  ): void {
    if (event.type === 'disconnected') {
      this.disconnected(session, registration);
      return;
    }
    if (event.type === 'response') {
      const key = prefix + event.key;
      const entry = session.records.get(key);
      // Evicted requests and replies from before this session are intentionally ignored.
      if (!entry || entry.record.status !== 'pending') return;
      const response = this.payload(session, entry.record, event.payload);
      if (
        !response ||
        response.retainedBytes + entry.record.payload.retainedBytes > this.limits.maxPayloadBytes
      ) {
        this.remove(session, key);
        session.dropped++;
        session.oversize++;
      } else {
        entry.record.response = response;
        session.retainedBytes += response.retainedBytes;
        this.complete(entry, event.status);
        entry.revision = session.revision + 1;
        this.enforceLimits(session);
      }
      this.changed(session);
      return;
    }
    const selection: DevConsoleCaptureSelection = {
      direction: event.type === 'request' ? event.direction : 'inbound',
      kind: event.type === 'request' ? 'request' : 'notification',
      method:
        event.type === 'notification' && event.method === 'events.event'
          ? (this.eventName(event.payload) ?? event.method)
          : event.method,
    };
    const payload = this.payload(session, selection, event.payload);
    if (!payload) {
      session.dropped++;
      session.oversize++;
      this.changed(session);
      return;
    }
    const sequence = ++session.sequence;
    const key = prefix + (event.type === 'request' ? event.key : `notification:${sequence}`);
    const record: DevConsoleRecord = {
      ...selection,
      id: `${session.id}:${sequence}`,
      rpcMethod: event.method,
      backendId: registration.backendId,
      connectionId: registration.connectionId,
      connectionGeneration: event.connectionGeneration,
      requestId: event.type === 'request' ? event.requestId : undefined,
      timestamp: Date.now(),
      status: event.type === 'request' ? 'pending' : 'received',
      payload,
    };
    session.records.set(key, {
      record,
      registrationId: registration.id,
      startedAt: this.now(),
      revision: session.revision + 1,
    });
    session.retainedBytes += payload.retainedBytes;
    this.enforceLimits(session);
    this.changed(session);
  }

  private eventName(params: unknown): string | undefined {
    if (!params || typeof params !== 'object' || !('event' in params)) return;
    const event = params.event;
    if (event && typeof event === 'object' && 'type' in event && typeof event.type === 'string')
      return event.type;
  }

  private payload(
    session: Session,
    selection: DevConsoleCaptureSelection,
    value: unknown,
  ): DevConsolePayload | null {
    if (value === undefined)
      return { text: '', state: 'absent', originalBytes: 0, retainedBytes: 0 };
    let text: string;
    try {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) throw new TypeError('Not JSON');
      text = serialized;
    } catch {
      return { text: '', state: 'unserializable', originalBytes: null, retainedBytes: 0 };
    }
    const originalBytes = Buffer.byteLength(text, 'utf8');
    const full = session.fullCapture.has(selectionKey(selection));
    if (full && originalBytes > this.limits.maxPayloadBytes) return null;
    const cap = full
      ? this.limits.maxPayloadBytes
      : Math.min(this.limits.previewBytes, this.limits.maxPayloadBytes);
    if (originalBytes <= cap)
      return { text, state: 'complete', originalBytes, retainedBytes: originalBytes };
    // Copy only the retained prefix; never keep a slice backed by a large source buffer/string.
    const prefix = Buffer.from(text.slice(0, cap), 'utf8').subarray(0, cap);
    text = new StringDecoder('utf8').write(prefix);
    return {
      text,
      state: 'truncated',
      originalBytes,
      retainedBytes: Buffer.byteLength(text, 'utf8'),
    };
  }

  private complete(entry: Entry, status: DevConsoleRecord['status']): void {
    entry.record.status = status;
    entry.record.completedAt = Date.now();
    entry.record.durationMs = Math.max(0, this.now() - entry.startedAt);
  }

  private disconnected(session: Session, registration: Registration): void {
    let changed = false;
    for (const entry of session.records.values()) {
      if (entry.registrationId === registration.id && entry.record.status === 'pending') {
        this.complete(entry, 'disconnected');
        entry.revision = session.revision + 1;
        changed = true;
      }
    }
    if (changed) this.changed(session);
  }

  private remove(session: Session, key: string): void {
    const entry = session.records.get(key);
    if (!entry) return;
    session.retainedBytes -=
      entry.record.payload.retainedBytes + (entry.record.response?.retainedBytes ?? 0);
    session.records.delete(key);
  }

  private enforceLimits(session: Session): void {
    while (
      session.records.size > this.limits.maxRecords ||
      session.retainedBytes > this.limits.maxPayloadBytes
    ) {
      const first = session.records.keys().next().value;
      if (first === undefined) break;
      this.remove(session, first);
      session.evicted++;
    }
  }

  private changed(session: Session): void {
    session.revision++;
    for (const listener of session.listeners) {
      try {
        void listener()?.catch(() => {});
      } catch {
        /* Diagnostics never interrupt daemon traffic. */
      }
    }
  }

  private snapshot(backendId: string, session: Session): DevConsoleSnapshot {
    return {
      ...this.metadata(backendId, session),
      records: [...session.records.values()].map(({ record }) => ({
        ...record,
        payload: { ...record.payload },
        response: record.response ? { ...record.response } : undefined,
      })),
    };
  }

  private metadata(backendId: string, session: Session): Omit<DevConsoleSnapshot, 'records'> {
    return {
      backendId,
      sessionId: session.id,
      revision: session.revision,
      fullCapture: [...session.fullCapture.values()].map((selection) => ({ ...selection })),
      retainedPayloadBytes: session.retainedBytes,
      evictedRecords: session.evicted,
      droppedRecords: session.dropped,
      oversizePayloads: session.oversize,
      limits: { ...this.limits },
    };
  }
}
