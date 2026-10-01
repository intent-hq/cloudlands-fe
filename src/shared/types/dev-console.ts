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
