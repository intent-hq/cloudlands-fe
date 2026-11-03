/**
 * Daemon-to-daemon executor-link traffic, captured by intentd and served by the
 * owner-only `remoteLinkTraffic.*` methods (advertised by
 * `client.hello.server.capabilities.remoteLinkTraffic === 1`). JSON-safe:
 * shared by the Dev Console main process and its renderer.
 */

/** Capture state and bounded-buffer accounting reported with every reply. */
export interface LinkCaptureStatus {
  active: boolean;
  startedAt?: string;
  /** Whether records carry `payload`. */
  payloads: boolean;
  maxRecords: number;
  maxPayloadBytes: number;
  retained: number;
  evicted: number;
  dropped: number;
  oversized: number;
  nextSeq: number;
}

export type LinkPeerKind = 'machine' | 'backend';

export interface LinkPeer {
  kind: LinkPeerKind;
  id: string;
  name?: string;
}

/** One captured frame, secrets already masked by the daemon. */
export interface LinkTrafficRecord {
  /** Starts at 1 after each start, increases by one per record. */
  seq: number;
  /** RFC 3339 UTC timestamp. */
  at: string;
  /** Relative to the daemon this console is connected to. */
  direction: 'in' | 'out';
  peer: LinkPeer;
  /** Open set: unknown types render as text. */
  frameType: string;
  agentId?: string;
  requestId?: string;
  /** Encoded size on the wire. */
  bytes: number;
  /** One short, already-redacted line. */
  summary: string;
  /** The redacted frame; absent when payloads are off or it was too large. */
  payload?: unknown;
  /** True when `payload` was omitted for size. */
  truncated?: boolean;
}

/** Live table rows omit the payload; a selected row fetches it on demand. */
export type LinkTrafficRow = Omit<LinkTrafficRecord, 'payload'> & {
  id: string;
  /** Parsed `at`, epoch milliseconds (sortable). */
  timestamp: number;
  hasPayload: boolean;
  /** `capture.startedAt` of the capture this row came from; seq restarts with each capture. */
  captureStartedAt: string;
};

export interface LinkTrafficRead {
  capture: LinkCaptureStatus;
  records: LinkTrafficRow[];
}

/** Error-message marker for the daemon's owner-only refusal (`-32003`); IPC keeps only messages. */
export const LINK_TRAFFIC_FORBIDDEN = 'daemon-links:forbidden';
