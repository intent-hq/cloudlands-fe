/** Private IPC correspondence DATA. These types do not mint a renderer save issuer. */
export interface NoteSaveConnectionIdentity {
  scope: { backendId: string; workspaceId: string; noteId: string; noteInstanceId: string };
  operationId: string;
  baseRevision: string;
  headerDigest: string;
  payloadDigest: string;
  expiresAt: string;
  viewLength: 59;
}
export type NoteSaveConnectionCommand =
  | { kind: 'commit' }
  | { kind: 'status' }
  | { kind: 'source' }
  | { kind: 'context'; contextRef: string; cursor?: string }
  | {
      kind: 'receipt';
      output: 'mapping' | 'effects' | 'inverse' | 'detail' | 'inverseText';
      ref: string;
      cursor?: string;
      textId?: string;
      offset?: number;
    };
export interface NoteSaveConnectionResult {
  id: string;
  current: boolean;
  settlement:
    | { status: 'fulfilled'; value: unknown }
    | { status: 'rejected'; error: { code: string; message: string; rpcCode?: number } };
}
export interface NoteSaveConnection {
  current(): boolean;
  /** Collect bridge callbacks now; the returned per-call check invokes no getters. */
  captureCurrent(): (() => boolean) | undefined;
  request(command: NoteSaveConnectionCommand): Promise<NoteSaveConnectionResult>;
  release(): Promise<void>;
}
/** One global main slot, including retired/unknown work. Logical DATA, not heap. */
export const noteSaveConnectionCost = Object.freeze({
  payloadBytes: 131072,
  stringUnits: 131072,
  objectNodes: 16384,
  physicalReads: 1,
  assemblies: 1,
  domNodes: 0,
});
export function noteSaveUnavailable(): never {
  throw new Error('Bound note save unavailable');
}
/** Charge before constructing owned copies or serialized scratch. Platform IPC
 * decoding/engine enumeration is outside this logical allocation contract. */
export function copyNoteSaveData(input: unknown, maxBytes = 16384, inspectOnly = false): unknown {
  let nodes = 0,
    wire = 0;
  const charge = (n: number) => {
    wire += n;
    if (wire > maxBytes) noteSaveUnavailable();
  };
  const string = (s: string) => {
    charge(2);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 32) charge(6);
      else if (c === 34 || c === 92) charge(2);
      else if (c < 128) charge(1);
      else if (c < 2048) charge(2);
      else if (
        c >= 0xd800 &&
        c <= 0xdbff &&
        i + 1 < s.length &&
        s.charCodeAt(i + 1) >= 0xdc00 &&
        s.charCodeAt(i + 1) <= 0xdfff
      ) {
        charge(4);
        i++;
      } else charge(c >= 0xd800 && c <= 0xdfff ? 6 : 3);
    }
  };
  const visit = (value: unknown, depth: number): unknown => {
    if (++nodes > 1024 || depth > 8) noteSaveUnavailable();
    if (value === null) {
      charge(4);
      return null;
    }
    if (typeof value === 'string') {
      string(value);
      return value;
    }
    if (typeof value === 'boolean') {
      charge(5);
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      charge(32);
      return value;
    }
    if (!value || typeof value !== 'object') return noteSaveUnavailable();
    const array = Array.isArray(value);
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      noteSaveUnavailable();
    if (array) {
      const length = Object.getOwnPropertyDescriptor(value, 'length');
      if (
        !length ||
        !('value' in length) ||
        !Number.isSafeInteger(length.value) ||
        length.value > 128
      )
        noteSaveUnavailable();
      charge(length.value * 5);
    }
    const result: Record<string, unknown> | undefined = inspectOnly
      ? undefined
      : array
        ? ([] as unknown as Record<string, unknown>)
        : Object.create(null);
    charge(2);
    let fields = 0;
    for (const key in value) {
      if (++fields > (array ? 128 : 64) || ++nodes > 1024) noteSaveUnavailable();
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d || !('value' in d) || (array && !/^(0|[1-9]\d*)$/.test(key))) noteSaveUnavailable();
      string(key);
      charge(2);
      const child = visit(d.value, depth + 1);
      if (result) Object.defineProperty(result, key, { value: child, enumerable: true });
    }
    return result ? Object.freeze(result) : value;
  };
  return visit(input, 0);
}
export function noteSaveRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return noteSaveUnavailable();
  return value as Record<string, unknown>;
}
export function noteSaveToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    new TextEncoder().encode(value).length <= 256
  );
}
function keys(value: Record<string, unknown>, allowed: string[], required = allowed) {
  if (
    Object.keys(value).some((k) => !allowed.includes(k)) ||
    required.some((k) => !Object.hasOwn(value, k))
  )
    noteSaveUnavailable();
}
export function parseNoteSaveIdentity(raw: unknown): NoteSaveConnectionIdentity {
  const v = noteSaveRecord(copyNoteSaveData(raw));
  keys(v, [
    'scope',
    'operationId',
    'baseRevision',
    'headerDigest',
    'payloadDigest',
    'expiresAt',
    'viewLength',
  ]);
  const s = noteSaveRecord(v.scope);
  keys(s, ['backendId', 'workspaceId', 'noteId', 'noteInstanceId']);
  if (
    !Object.values(s).every(noteSaveToken) ||
    !noteSaveToken(v.operationId) ||
    !noteSaveToken(v.baseRevision) ||
    typeof v.headerDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(v.headerDigest) ||
    typeof v.payloadDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(v.payloadDigest) ||
    typeof v.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(v.expiresAt)) ||
    new Date(v.expiresAt).toISOString() !== v.expiresAt ||
    v.viewLength !== 59
  )
    noteSaveUnavailable();
  return v as unknown as NoteSaveConnectionIdentity;
}
export function parseNoteSaveCommand(raw: unknown): NoteSaveConnectionCommand {
  const v = noteSaveRecord(copyNoteSaveData(raw, 8192));
  if (['commit', 'status', 'source'].includes(String(v.kind))) keys(v, ['kind']);
  else if (v.kind === 'context') {
    keys(v, ['kind', 'contextRef', 'cursor'], ['kind', 'contextRef']);
    if (!noteSaveToken(v.contextRef) || (v.cursor !== undefined && !noteSaveToken(v.cursor)))
      noteSaveUnavailable();
  } else if (v.kind === 'receipt') {
    keys(v, ['kind', 'output', 'ref', 'cursor', 'textId', 'offset'], ['kind', 'output', 'ref']);
    if (
      !['mapping', 'effects', 'inverse', 'detail', 'inverseText'].includes(String(v.output)) ||
      !noteSaveToken(v.ref) ||
      (v.cursor !== undefined && !noteSaveToken(v.cursor))
    )
      noteSaveUnavailable();
    if (v.output === 'inverseText') {
      if (
        !noteSaveToken(v.textId) ||
        (v.offset !== undefined &&
          (!Number.isSafeInteger(v.offset) || Number(v.offset) < 0 || v.cursor !== undefined))
      )
        noteSaveUnavailable();
    } else if (v.textId !== undefined || v.offset !== undefined) noteSaveUnavailable();
  } else noteSaveUnavailable();
  return v as unknown as NoteSaveConnectionCommand;
}
export function sameNoteSaveScope(raw: unknown, op: NoteSaveConnectionIdentity): boolean {
  const s = noteSaveRecord(raw);
  return Object.entries(op.scope).every(([k, v]) => s[k] === v);
}
/** Validated own ACK remains DATA even when the connection has retired. */
export function validateNoteSaveOutcome(raw: unknown, op: NoteSaveConnectionIdentity) {
  const v = noteSaveRecord(raw);
  if (
    !sameNoteSaveScope(v.scope, op) ||
    v.operationId !== op.operationId ||
    v.headerDigest !== op.headerDigest ||
    v.payloadDigest !== op.payloadDigest
  )
    noteSaveUnavailable();
  if (v.kind === 'noteCommitReceipt' && v.outcome === 'committed') {
    if (
      v.beforeRevision !== op.baseRevision ||
      !noteSaveToken(v.afterRevision) ||
      v.afterRevision === op.baseRevision ||
      v.sourceLength !== 3 ||
      v.invalidation !== 'all' ||
      !['viewId', 'mappingRef', 'effectsRef', 'inverseRef'].every((k) => noteSaveToken(v[k])) ||
      typeof v.receiptExpiresAt !== 'string' ||
      !Number.isFinite(Date.parse(v.receiptExpiresAt))
    )
      noteSaveUnavailable();
  } else if (
    v.kind !== 'noteOperationStatus' ||
    !['pending', 'unknown', 'conflict', 'rejected'].includes(String(v.outcome))
  )
    noteSaveUnavailable();
  return v;
}
