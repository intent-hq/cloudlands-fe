/** JSON-safe contracts shared by the native Dev Console and its renderer. */
type DevConsoleDirection = 'outbound' | 'inbound';
type DevConsoleRecordKind = 'request' | 'notification';
type DevConsoleStatus =
  'pending' | 'received' | 'success' | 'error' | 'timeout' | 'disconnected' | 'send-error';

/** Exact, prospective match. A request selector applies to both params and replies. */
export interface DevConsoleCaptureSelection {
  direction: DevConsoleDirection;
  kind: DevConsoleRecordKind;
  method: string;
}

export interface DevConsolePayload {
  /** Serialized JSON, or its UTF-8-safe prefix. Truncated text need not be valid JSON. */
  text: string;
  state: 'complete' | 'truncated' | 'absent' | 'unserializable';
  /** Null only when serialization failed and the size is unknown. */
  originalBytes: number | null;
  retainedBytes: number;
}

/** Arrival order across both sides; intervals are independent per side. */
export interface DevConsoleFrame {
  sequence: number;
  side: 'request' | 'response';
  rpcMethod: string;
  timestamp: number;
  intervalMs: number;
  /** True only for the first observation on this side; survives frame retention. */
  intervalFromRequest?: boolean;
  payload: DevConsolePayload;
}

export interface DevConsoleRecord extends DevConsoleCaptureSelection {
  id: string;
  /** Original wire method; method is the event type for events.event notifications. */
  rpcMethod: string;
  backendId: string;
  /** Client registration identity; shared by app windows using the same transport. */
  connectionId: string;
  /** Increments each time that transport creates a socket. */
  connectionGeneration: number;
  requestId?: number | string;
  timestamp: number;
  completedAt?: number;
  durationMs?: number;
  status: DevConsoleStatus;
  payload: DevConsolePayload;
  response?: DevConsolePayload;
  /** Bounded history including the original request and reply; fetched only on selection. */
  frames?: DevConsoleFrame[];
  /** Includes discarded frames, and each original request/reply exactly once. */
  totalBytes?: number;
  frameCount?: number;
  droppedFrames?: number;
  streamState?: 'open' | 'ended';
}

export interface DevConsoleSnapshot {
  backendId: string;
  sessionId: string;
  revision: number;
  /** Arrival order, oldest first. Replies update their originating row in place. */
  records: DevConsoleRecord[];
  fullCapture: DevConsoleCaptureSelection[];
  retainedPayloadBytes: number;
  evictedRecords: number;
  /** Records rejected because a payload, or the complete request/reply pair, cannot fit. */
  droppedRecords: number;
  oversizePayloads: number;
  limits: { maxRecords: number; maxPayloadBytes: number; previewBytes: number };
}

/** Live rows omit payload text. Fetch a selected record explicitly. */
export type DevConsoleRow = Omit<DevConsoleRecord, 'payload' | 'response' | 'frames'> & {
  payload: Omit<DevConsolePayload, 'text'>;
  response?: Omit<DevConsolePayload, 'text'>;
};
export interface DevConsoleUpdate extends Omit<DevConsoleSnapshot, 'records'> {
  /** Authoritative arrival order; also removes evicted or cleared rows. */
  recordIds: string[];
  /** Only rows changed since the requested revision (all rows on first read). */
  upserts: DevConsoleRow[];
}
