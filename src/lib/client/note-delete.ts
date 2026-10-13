/** Content-free daemon-owned deletion grace protocol. Keys are supplied by the caller. */
export interface NoteDeleteKey {
  epoch: string;
  issuedTickMs: number;
  nonce: string;
}
interface NoteDeleteIdentity {
  noteInstanceId: string;
  revision: number;
  sourceRevision: string;
}
type NoteDeleteState =
  'PENDING' | 'COMMITTING' | 'CANCELLED' | 'DELETED' | 'CONFLICT' | 'FAILED' | 'OUTCOME_UNKNOWN';
type NoteDeleteReason =
  | 'cancelled'
  | 'noteChanged'
  | 'childChanged'
  | 'noteMissing'
  | 'workspaceMissing'
  | 'authorityLost'
  | 'deadlineBudget'
  | 'storageFailure'
  | 'shutdown'
  | 'commitOutcomeUnknown';
export interface NoteDeleteReceipt {
  operationKey: NoteDeleteKey;
  workspaceId: string;
  noteId: string;
  noteInstanceId: string;
  state: NoteDeleteState;
  sequence: number;
  deadlineTickMs: number;
  deleteAt: string;
  expiresTickMs: number | null;
  reason: NoteDeleteReason | null;
}
interface NoteDeleteUnknown {
  operationKey: NoteDeleteKey;
  state: 'UNKNOWN';
  reason: 'previousEpoch' | 'unavailable';
}
export interface NoteDeletePending {
  operationKey: NoteDeleteKey;
  noteId: string;
  noteInstanceId: string;
  state: 'PENDING' | 'COMMITTING' | 'OUTCOME_UNKNOWN';
  sequence: number;
  deadlineTickMs: number;
  deleteAt: string;
  canCancel: boolean;
}
interface NoteDeleteSnapshot {
  epoch: string;
  serverTickMs: number;
  sequence: number;
}
export interface NoteDeleteStatusResponse extends NoteDeleteSnapshot {
  current: NoteDeleteIdentity | null;
  pending: NoteDeletePending[];
  operation: NoteDeleteReceipt | NoteDeleteUnknown | null;
}
export interface NoteDeleteOperationResponse extends NoteDeleteSnapshot {
  operation: NoteDeleteReceipt | NoteDeleteUnknown;
}
export type NoteDeleteStatusRequest =
  | { workspaceId: string; noteId?: never; operationKey?: never }
  | { workspaceId: string; noteId: string; operationKey?: NoteDeleteKey };
export interface NoteDeleteCancelRequest {
  workspaceId: string;
  noteId: string;
  operationKey: NoteDeleteKey;
}
export interface NoteDeleteScheduleRequest extends NoteDeleteCancelRequest {
  noteInstanceId: string;
  expectedVersion: number;
  sourceRevision: string;
  undoDelayMs?: number;
}
export interface NoteDeleteEvent {
  workspaceId: string;
  noteId: string;
  noteInstanceId: string;
  epoch: string;
  sequence: number;
  operationKey: NoteDeleteKey;
  state: NoteDeleteState;
  deadlineTickMs: number;
}
export interface NoteDeleteClient {
  capability(): Promise<boolean>;
  status(request: NoteDeleteStatusRequest): Promise<NoteDeleteStatusResponse>;
  schedule(request: NoteDeleteScheduleRequest): Promise<NoteDeleteOperationResponse>;
  cancel(request: NoteDeleteCancelRequest): Promise<NoteDeleteOperationResponse>;
  /** Subscribe before status; events invalidate state but never grant cancellation authority. */
  subscribe(workspaceId: string, listener: (event: NoteDeleteEvent) => void): () => void;
  /** Reconnect or event-stream loss requires a bounded authoritative snapshot. */
  onReconnected(listener: () => void): () => void;
}

const encoder = new TextEncoder();
const states = [
  'PENDING',
  'COMMITTING',
  'CANCELLED',
  'DELETED',
  'CONFLICT',
  'FAILED',
  'OUTCOME_UNKNOWN',
];
const reasons = [
  'cancelled',
  'noteChanged',
  'childChanged',
  'noteMissing',
  'workspaceMissing',
  'authorityLost',
  'deadlineBudget',
  'storageFailure',
  'shutdown',
  'commitOutcomeUnknown',
];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requireValue(ok: unknown): asserts ok {
  if (!ok) throw new Error('Invalid note deletion contract');
}
function object(value: unknown): Record<string, unknown> {
  requireValue(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function fields(value: unknown, required: string[], optional: string[] = []) {
  const result = object(value);
  requireValue(required.every((k) => Object.hasOwn(result, k)));
  requireValue(Object.keys(result).every((k) => required.includes(k) || optional.includes(k)));
  return result;
}
function token(value: unknown): asserts value is string {
  requireValue(
    typeof value === 'string' && value.length > 0 && encoder.encode(value).length <= 128,
  );
}
function uint(value: unknown): asserts value is number {
  requireValue(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}
function epoch(value: unknown): asserts value is string {
  requireValue(typeof value === 'string' && uuid.test(value));
}
function key(value: unknown): NoteDeleteKey {
  const k = fields(value, ['epoch', 'issuedTickMs', 'nonce']);
  epoch(k.epoch);
  epoch(k.nonce);
  uint(k.issuedTickMs);
  return { epoch: k.epoch, issuedTickMs: k.issuedTickMs, nonce: k.nonce };
}
export function noteDeleteKeyEquals(a: NoteDeleteKey, b: NoteDeleteKey): boolean {
  return a.epoch === b.epoch && a.issuedTickMs === b.issuedTickMs && a.nonce === b.nonce;
}
function identity(value: unknown): NoteDeleteIdentity {
  const i = fields(value, ['noteInstanceId', 'revision', 'sourceRevision']);
  token(i.noteInstanceId);
  uint(i.revision);
  token(i.sourceRevision);
  return {
    noteInstanceId: i.noteInstanceId,
    revision: i.revision,
    sourceRevision: i.sourceRevision,
  };
}
function wallTime(value: unknown): asserts value is string {
  requireValue(
    typeof value === 'string' &&
      encoder.encode(value).length <= 30 &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
      Number.isFinite(Date.parse(value)),
  );
}
function snapshot(value: unknown): NoteDeleteSnapshot {
  const s = object(value);
  epoch(s.epoch);
  uint(s.serverTickMs);
  uint(s.sequence);
  // This limit applies to the result object, not its JSON-RPC envelope.
  requireValue(encoder.encode(JSON.stringify(value)).length <= 524288);
  return { epoch: s.epoch, serverTickMs: s.serverTickMs, sequence: s.sequence };
}
function transition(r: Record<string, unknown>, s: NoteDeleteSnapshot) {
  const operationKey = key(r.operationKey);
  uint(r.sequence);
  uint(r.deadlineTickMs);
  requireValue(
    operationKey.epoch === s.epoch &&
      operationKey.issuedTickMs <= s.serverTickMs &&
      r.sequence <= s.sequence &&
      r.deadlineTickMs >= operationKey.issuedTickMs,
  );
  return operationKey;
}
function operation(
  value: unknown,
  request: NoteDeleteCancelRequest,
  s: NoteDeleteSnapshot,
): NoteDeleteReceipt | NoteDeleteUnknown {
  const raw = object(value);
  const operationKey = key(raw.operationKey);
  requireValue(noteDeleteKeyEquals(operationKey, request.operationKey));
  if (raw.state === 'UNKNOWN') {
    const r = fields(value, ['operationKey', 'state', 'reason']);
    requireValue(r.reason === 'previousEpoch' || r.reason === 'unavailable');
    requireValue((r.reason === 'previousEpoch') === (operationKey.epoch !== s.epoch));
    return { operationKey, state: 'UNKNOWN', reason: r.reason };
  }
  const r = fields(value, [
    'operationKey',
    'workspaceId',
    'noteId',
    'noteInstanceId',
    'state',
    'sequence',
    'deadlineTickMs',
    'deleteAt',
    'expiresTickMs',
    'reason',
  ]);
  token(r.workspaceId);
  token(r.noteId);
  token(r.noteInstanceId);
  requireValue(r.workspaceId === request.workspaceId && r.noteId === request.noteId);
  requireValue(typeof r.state === 'string' && states.includes(r.state));
  requireValue(r.reason === null || (typeof r.reason === 'string' && reasons.includes(r.reason)));
  transition(r, s);
  wallTime(r.deleteAt);
  if (r.expiresTickMs !== null) uint(r.expiresTickMs);
  if (r.state === 'PENDING' || r.state === 'COMMITTING') requireValue(r.expiresTickMs === null);
  if (r.state === 'OUTCOME_UNKNOWN') requireValue(r.expiresTickMs !== null);
  return { ...r, operationKey } as unknown as NoteDeleteReceipt;
}
function pending(value: unknown, s: NoteDeleteSnapshot): NoteDeletePending {
  const p = fields(value, [
    'operationKey',
    'noteId',
    'noteInstanceId',
    'state',
    'sequence',
    'deadlineTickMs',
    'deleteAt',
    'canCancel',
  ]);
  token(p.noteId);
  token(p.noteInstanceId);
  wallTime(p.deleteAt);
  requireValue(p.state === 'PENDING' || p.state === 'COMMITTING' || p.state === 'OUTCOME_UNKNOWN');
  requireValue(typeof p.canCancel === 'boolean' && (p.state === 'PENDING' || !p.canCancel));
  return { ...p, operationKey: transition(p, s) } as unknown as NoteDeletePending;
}
export function parseNoteDeleteStatusRequest(value: unknown): NoteDeleteStatusRequest {
  const r = fields(value, ['workspaceId'], ['noteId', 'operationKey']);
  token(r.workspaceId);
  if (r.noteId === undefined) {
    requireValue(r.operationKey === undefined);
    return { workspaceId: r.workspaceId };
  }
  token(r.noteId);
  return {
    workspaceId: r.workspaceId,
    noteId: r.noteId,
    ...(r.operationKey === undefined ? {} : { operationKey: key(r.operationKey) }),
  };
}
export function parseNoteDeleteCancelRequest(value: unknown): NoteDeleteCancelRequest {
  const r = fields(value, ['workspaceId', 'noteId', 'operationKey']);
  token(r.workspaceId);
  token(r.noteId);
  return { workspaceId: r.workspaceId, noteId: r.noteId, operationKey: key(r.operationKey) };
}
export function parseNoteDeleteScheduleRequest(value: unknown): NoteDeleteScheduleRequest {
  const r = fields(
    value,
    [
      'workspaceId',
      'noteId',
      'operationKey',
      'noteInstanceId',
      'expectedVersion',
      'sourceRevision',
    ],
    ['undoDelayMs'],
  );
  token(r.workspaceId);
  token(r.noteId);
  token(r.noteInstanceId);
  token(r.sourceRevision);
  uint(r.expectedVersion);
  if (r.undoDelayMs !== undefined) {
    uint(r.undoDelayMs);
    requireValue(r.undoDelayMs >= 1 && r.undoDelayMs <= 60000);
  }
  return {
    workspaceId: r.workspaceId,
    noteId: r.noteId,
    operationKey: key(r.operationKey),
    noteInstanceId: r.noteInstanceId,
    expectedVersion: r.expectedVersion,
    sourceRevision: r.sourceRevision,
    ...(r.undoDelayMs === undefined ? {} : { undoDelayMs: r.undoDelayMs }),
  };
}
export function parseNoteDeleteStatusResponse(
  value: unknown,
  input: NoteDeleteStatusRequest,
): NoteDeleteStatusResponse {
  const request = parseNoteDeleteStatusRequest(input);
  const r = fields(value, ['epoch', 'serverTickMs', 'sequence', 'current', 'pending', 'operation']);
  const s = snapshot(value);
  const current = r.current === null ? null : identity(r.current);
  requireValue(
    Array.isArray(r.pending) && r.pending.length <= (request.noteId === undefined ? 256 : 1),
  );
  const markers = r.pending.map((p: unknown) => pending(p, s));
  const seenKeys = new Set<string>(),
    seenInstances = new Set<string>();
  for (const marker of markers) {
    const k = JSON.stringify(marker.operationKey);
    const i = JSON.stringify([marker.noteId, marker.noteInstanceId]);
    requireValue(!seenKeys.has(k) && !seenInstances.has(i));
    seenKeys.add(k);
    seenInstances.add(i);
    if (request.noteId !== undefined)
      requireValue(
        current &&
          marker.noteId === request.noteId &&
          marker.noteInstanceId === current.noteInstanceId,
      );
  }
  if (request.noteId === undefined) requireValue(current === null);
  let resultOperation: NoteDeleteStatusResponse['operation'] = null;
  if (request.operationKey !== undefined) {
    resultOperation = operation(
      r.operation,
      {
        workspaceId: request.workspaceId,
        noteId: request.noteId,
        operationKey: request.operationKey,
      },
      s,
    );
    const requestedKey = request.operationKey;
    const marker = markers.find((p) => noteDeleteKeyEquals(p.operationKey, requestedKey));
    if (marker) {
      requireValue(resultOperation.state !== 'UNKNOWN');
      requireValue(
        marker.noteInstanceId === resultOperation.noteInstanceId &&
          marker.state === resultOperation.state &&
          marker.sequence === resultOperation.sequence &&
          marker.deadlineTickMs === resultOperation.deadlineTickMs &&
          marker.deleteAt === resultOperation.deleteAt,
      );
    }
  } else requireValue(r.operation === null);
  return { ...s, current, pending: markers, operation: resultOperation };
}
export function parseNoteDeleteOperationResponse(
  value: unknown,
  request: NoteDeleteCancelRequest,
  receiptOnly = false,
): NoteDeleteOperationResponse {
  const r = fields(value, ['epoch', 'serverTickMs', 'sequence', 'operation']);
  const s = snapshot(value);
  const op = operation(r.operation, parseNoteDeleteCancelRequest(request), s);
  requireValue(!receiptOnly || op.state !== 'UNKNOWN');
  return { ...s, operation: op };
}
export function parseNoteDeleteEvent(value: unknown, workspaceId: string): NoteDeleteEvent {
  const r = fields(value, [
    'workspaceId',
    'noteId',
    'noteInstanceId',
    'epoch',
    'sequence',
    'operationKey',
    'state',
    'deadlineTickMs',
  ]);
  token(r.workspaceId);
  token(r.noteId);
  token(r.noteInstanceId);
  epoch(r.epoch);
  uint(r.sequence);
  uint(r.deadlineTickMs);
  requireValue(
    r.workspaceId === workspaceId && typeof r.state === 'string' && states.includes(r.state),
  );
  const operationKey = key(r.operationKey);
  requireValue(operationKey.epoch === r.epoch && r.deadlineTickMs >= operationKey.issuedTickMs);
  return { ...r, operationKey } as unknown as NoteDeleteEvent;
}
