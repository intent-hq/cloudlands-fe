import {
  notificationStreams,
  requestContinuation,
  requestStream,
  responseEndsStream,
  responseRejectsStream,
  responseStream,
  subscriptionGroup,
  unsubscribeStream,
  unsubscribeSucceeded,
  type StreamHandle,
} from './stream-correlation';
import { createHash, randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import type { RpcTrafficEvent, RpcTrafficSource } from '$features/backend/main/rpc-traffic';
import type {
  DevConsoleCaptureSelection,
  DevConsoleFrame,
  DevConsolePayload,
  DevConsoleRecord,
  DevConsoleSnapshot,
  DevConsoleUpdate,
} from '$shared/types/dev-console';

interface CaptureOptions {
  maxRecords?: number;
  maxFramesPerRecord?: number;
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
  order: number;
  unmatched?: Map<string, boolean>;
  revision: number;
  key: string;
  scope: string;
  handles: Set<string>;
  ambiguousHandles: Set<string>;
  parentKey?: string;
  unsubscribeKey?: string;
  replacementKey?: string;
  replied: boolean;
  closed: boolean;
  retainedBytes: number;
  lastRequestAt: number;
  lastResponseAt?: number;
}
type CaptureListener = () => void | Promise<void>;

interface Session {
  id: string;
  revision: number;
  sequence: number;
  records: Map<string, Entry>;
  streams: Map<string, Set<Entry>>;
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
  private readonly maxFrames: number;

  constructor(options: CaptureOptions = {}) {
    this.maxFrames = Math.max(2, positiveInteger(options.maxFramesPerRecord ?? 256));
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
        streams: new Map(),
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
    session.streams.clear();
    session.fullCapture.clear();
    session.retainedBytes = 0;
  }

  /** Clear visible history/counters, keeping prospective capture choices and unique row IDs. */
  clearSession(backendId: string, sessionId: string): boolean {
    const session = this.session(backendId, sessionId);
    if (!session) return false;
    session.records.clear();
    session.streams.clear();
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
        .filter((entry) => afterRevision > session.revision || entry.revision > afterRevision)
        .map(({ record }) => {
          const { text: _payloadText, ...payload } = record.payload;
          const response = record.response
            ? (({ text: _text, ...meta }) => meta)(record.response)
            : undefined;
          const { frames: _frames, ...row } = record;
          return { ...row, payload, response };
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
          frames: record.frames?.map((frame) => ({ ...frame, payload: { ...frame.payload } })),
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
    const scope = JSON.stringify([prefix, event.connectionGeneration]);
    const keyFor = (key: string) => JSON.stringify([scope, key]);
    if (event.type === 'response') {
      const key = keyFor(event.key);
      const entry = session.records.get(key);
      // Evicted, already replied and disconnected requests cannot regain associations.
      if (!entry || entry.replied || entry.closed) return;
      entry.replied = true;
      // Apply definitive rejection before payload retention can evict this request.
      if (event.status === 'error' && responseRejectsStream(entry.record.rpcMethod, event.payload))
        this.releaseHandles(session, entry, true);
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
        if (event.status === 'success') {
          const handle = responseStream(entry.record.rpcMethod, event.payload);
          if (handle && entry.record.streamState !== 'ended') {
            if (handle.family === 'subscription' && entry.replacementKey) {
              for (const target of [...(session.streams.get(entry.replacementKey) ?? [])])
                this.endStream(session, target);
              session.streams.set(entry.replacementKey, new Set([entry]));
              entry.handles.add(entry.replacementKey);
            }
            this.bind(session, entry, handle);
            this.replayUnmatched(session, entry, handle);
          }
          if (responseEndsStream(entry.record.rpcMethod, event.payload))
            this.endStream(session, entry);
          if (entry.unsubscribeKey && unsubscribeSucceeded(event.payload)) {
            for (const target of [...(session.streams.get(entry.unsubscribeKey) ?? [])])
              this.endStream(session, target);
          }
        } else this.endStream(session, entry);
        this.append(session, entry, 'response', entry.record.rpcMethod, response);
        this.complete(entry, event.status);
        const parent = entry.parentKey && session.records.get(entry.parentKey);
        if (parent && !parent.closed) {
          this.appendValue(session, parent, 'response', entry.record.rpcMethod, event.payload);
        }
        entry.revision = session.revision + 1;
        this.enforceLimits(session);
      }
      this.changed(session);
      return;
    }
    const unmatched = new Map<string, boolean>();
    if (event.type === 'notification') {
      const direction = event.direction ?? 'inbound';
      const origin = direction === 'inbound' ? 'outbound' : 'inbound';
      // A single envelope can belong to its event subscription and an explicit
      // invocation stream, but never more than once to the same RPC.
      const matched = new Set<Entry>();
      for (const match of notificationStreams(event.method, event.payload)) {
        const target = this.findStream(session, scope, origin, match.handle, true);
        if (!target) {
          unmatched.set(this.streamKey(scope, origin, match.handle), match.terminal);
          continue;
        }
        if (matched.has(target)) continue;
        matched.add(target);
        this.appendValue(session, target, 'response', event.method, event.payload);
        if (match.terminal) this.endStream(session, target, match.handle.family === 'host-exec');
      }
    }
    const continuation = requestContinuation(event.method, event.payload);
    const parent =
      continuation && this.findStream(session, scope, event.direction ?? 'inbound', continuation);
    if (parent) this.appendValue(session, parent, 'request', event.method, event.payload);
    const selection: DevConsoleCaptureSelection = {
      direction: event.direction ?? 'inbound',
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
      this.enforceLimits(session);
      this.changed(session);
      return;
    }
    const sequence = ++session.sequence;
    const key = keyFor(event.type === 'request' ? event.key : `notification:${sequence}`);
    const startedAt = this.now();
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
    const entry: Entry = {
      record,
      registrationId: registration.id,
      startedAt,
      order: sequence,
      unmatched: unmatched.size ? unmatched : undefined,
      revision: session.revision + 1,
      key,
      scope,
      handles: new Set(),
      ambiguousHandles: new Set(),
      replied: false,
      closed: false,
      retainedBytes: payload.retainedBytes,
      lastRequestAt: startedAt,
    };
    if (event.type === 'request') {
      record.totalBytes = payload.originalBytes ?? 0;
      record.frameCount = 1;
      record.droppedFrames = 0;
      record.frames = [
        {
          sequence: 0,
          side: 'request',
          rpcMethod: event.method,
          timestamp: record.timestamp,
          intervalMs: 0,
          intervalFromRequest: true,
          payload,
        },
      ];
      const handle = requestStream(event.method, event.payload);
      if (handle) this.bind(session, entry, handle);
      const group = subscriptionGroup(event.payload);
      if (group !== undefined)
        entry.replacementKey =
          'group:' + this.streamKey(scope, event.direction, { family: 'subscription', id: group });
      const unsubscribe = unsubscribeStream(event.method, event.payload);
      if (unsubscribe) entry.unsubscribeKey = this.streamKey(scope, event.direction, unsubscribe);
      if (parent) entry.parentKey = parent.key;
    }
    session.records.set(key, entry);
    session.retainedBytes += payload.retainedBytes;
    this.enforceLimits(session);
    this.changed(session);
  }

  private streamKey(
    scope: string,
    direction: DevConsoleRecord['direction'],
    handle: StreamHandle,
  ): string {
    // Protocol IDs are caller-controlled strings. Keep correlation metadata fixed-size
    // even when the retained payload preview discarded most of a very large ID.
    const identity = createHash('sha256').update(JSON.stringify(handle.id)).digest('hex');
    return JSON.stringify([scope, direction, handle.family, identity]);
  }

  private bind(session: Session, entry: Entry, handle: StreamHandle): void {
    const key = this.streamKey(entry.scope, entry.record.direction, handle);
    let owners = session.streams.get(key);
    if (!owners) session.streams.set(key, (owners = new Set()));
    for (const owner of owners) {
      // Host requests are provisional until their outcome is known. The owner count
      // blocks capture during overlap; uncertain removal below preserves its history.
      if (owner === entry || handle.family === 'host-exec') continue;
      owner.ambiguousHandles.add(key);
      entry.ambiguousHandles.add(key);
    }
    owners.add(entry);
    entry.handles.add(key);
    entry.record.streamState = 'open';
  }

  private findStream(
    session: Session,
    scope: string,
    direction: DevConsoleRecord['direction'],
    handle: StreamHandle,
    trailingOutput = false,
  ): Entry | undefined {
    const key = this.streamKey(scope, direction, handle);
    const owners = session.streams.get(key);
    // Retained host executions may still emit output after exit. If their ID is
    // reused, even an ended owner makes trailing output ambiguous. Never guess.
    const owner = owners?.size === 1 ? owners.values().next().value : undefined;
    // Eviction of another owner cannot disambiguate output already in flight.
    // Collision history lives on bounded retained records, never a global tombstone.
    if (!owner || owner.closed || owner.ambiguousHandles.has(key)) return;
    return owner.record.streamState !== 'ended' || (trailingOutput && handle.family === 'host-exec')
      ? owner
      : undefined;
  }

  private replayUnmatched(session: Session, entry: Entry, handle: StreamHandle): void {
    if (this.findStream(session, entry.scope, entry.record.direction, handle) !== entry) return;
    const key = this.streamKey(entry.scope, entry.record.direction, handle);
    // A server-minted invocation ID may arrive after its first output. Recover
    // only still-retained diagnostic previews, never raw transport payloads or
    // notifications predating this request. Their observation times stay intact.
    for (const notification of session.records.values()) {
      const terminal = notification.unmatched?.get(key);
      if (terminal === undefined || notification.order <= entry.order) continue;
      notification.unmatched?.delete(key);
      let payload = notification.record.payload;
      if (
        !session.fullCapture.has(selectionKey(entry.record)) &&
        payload.retainedBytes > this.limits.previewBytes
      ) {
        const text = new StringDecoder('utf8').write(
          Buffer.from(payload.text, 'utf8').subarray(0, this.limits.previewBytes),
        );
        payload = {
          ...payload,
          text,
          state: 'truncated',
          retainedBytes: Buffer.byteLength(text, 'utf8'),
        };
      }
      this.append(session, entry, 'response', notification.record.rpcMethod, payload, 0, {
        timestamp: notification.record.timestamp,
        monotonic: notification.startedAt,
      });
      if (terminal) {
        this.endStream(session, entry, handle.family === 'host-exec');
        if (handle.family !== 'host-exec') break;
      }
    }
  }

  private releaseHandles(session: Session, entry: Entry, rejected = false): void {
    for (const key of entry.handles) {
      const owners = session.streams.get(key);
      owners?.delete(entry);
      // Removing an accepted, evicted or uncertain owner cannot disambiguate frames
      // already in flight. A pre-spawn rejection never owned those frames. Do not
      // clear older ambiguity, and keep all history on bounded retained records.
      if (!rejected) for (const owner of owners ?? []) owner.ambiguousHandles.add(key);
      if (owners?.size === 0) session.streams.delete(key);
    }
    entry.handles.clear();
  }

  private endStream(session: Session, entry: Entry, trailingOutput = false): void {
    // Host pipe readers can outlive the exit event. Keep this diagnostic handle
    // only while its bounded record is retained; new continuations are excluded.
    if (!trailingOutput) this.releaseHandles(session, entry);
    if (entry.record.streamState) entry.record.streamState = 'ended';
    entry.revision = session.revision + 1;
  }

  private appendValue(
    session: Session,
    entry: Entry,
    side: DevConsoleFrame['side'],
    method: string,
    value: unknown,
  ): void {
    let discardedBytes = 0;
    const payload = this.payload(session, entry.record, value, (bytes) => {
      discardedBytes = bytes;
    });
    if (!payload) session.oversize++;
    this.append(session, entry, side, method, payload, discardedBytes);
  }

  private append(
    session: Session,
    entry: Entry,
    side: DevConsoleFrame['side'],
    method: string,
    payload: DevConsolePayload | null,
    discardedBytes = 0,
    observation?: { timestamp: number; monotonic: number },
  ): void {
    const record = entry.record;
    const frames = record.frames;
    if (!frames) return;
    const now = observation?.monotonic ?? this.now();
    const timestamp = observation?.timestamp ?? Date.now();
    const last = side === 'request' ? entry.lastRequestAt : entry.lastResponseAt;
    const sequence = record.frameCount ?? 0;
    record.frameCount = sequence + 1;
    // Oversize full frames are discarded, but their serialized size still counts.
    record.totalBytes = (record.totalBytes ?? 0) + (payload?.originalBytes ?? discardedBytes);
    if (side === 'request') entry.lastRequestAt = now;
    else entry.lastResponseAt = now;
    record.completedAt = timestamp;
    record.durationMs = Math.max(0, now - entry.startedAt);
    if (payload) {
      frames.push({
        sequence,
        side,
        rpcMethod: method,
        timestamp,
        intervalMs: Math.max(0, now - (last ?? entry.startedAt)),
        intervalFromRequest: last === undefined,
        payload,
      });
      entry.retainedBytes += payload.retainedBytes;
      session.retainedBytes += payload.retainedBytes;
      // Retain the original request and reply for ordinary-RPC compatibility;
      // discard the oldest additional frame until both per-RPC bounds hold.
      while (frames.length > this.maxFrames || entry.retainedBytes > this.limits.maxPayloadBytes) {
        const index = frames.findIndex(
          (frame) => frame.payload !== record.payload && frame.payload !== record.response,
        );
        if (index < 0) break;
        const [removed] = frames.splice(index, 1);
        entry.retainedBytes -= removed.payload.retainedBytes;
        session.retainedBytes -= removed.payload.retainedBytes;
        record.droppedFrames = (record.droppedFrames ?? 0) + 1;
      }
    } else record.droppedFrames = (record.droppedFrames ?? 0) + 1;
    entry.revision = session.revision + 1;
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
    onOversize?: (bytes: number) => void,
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
    if (full && originalBytes > this.limits.maxPayloadBytes) {
      onOversize?.(originalBytes);
      return null;
    }
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
      if (entry.registrationId !== registration.id) continue;
      entry.unmatched?.clear();
      entry.closed = true;
      this.releaseHandles(session, entry);
      if (entry.record.status === 'pending' || entry.record.streamState === 'open') {
        this.endStream(session, entry);
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
    this.releaseHandles(session, entry);
    session.retainedBytes -= entry.retainedBytes;
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
        frames: record.frames?.map((frame) => ({ ...frame, payload: { ...frame.payload } })),
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
