import type { NoteCommitReceipt } from './note-pages';
import { beforeSourceDeadline, parseSourceDeadline } from '$shared/source-session-expiry';

/** One receipt page. Item semantics and complete-transcript proof belong to the
 * reconciliation owner; a validated envelope is never save-rebase authority. */
export interface NoteReceiptPage {
  kind: 'noteOperationPage';
  scope: NoteCommitReceipt['scope'];
  operationId: string;
  payloadDigest: string;
  beforeRevision: string;
  afterRevision: string;
  outputKind: 'mapping' | 'effects';
  sourceLength: number;
  items: unknown[];
  nextCursor: string | null;
  expiresAt: string;
}
export interface NoteReceiptReadRequest {
  kind: 'mapping' | 'effects';
  /** Captured input extent, not the receipt's final source length. */
  baseLength: number;
  cursor?: string;
  maxItems: number;
  maxWireBytes: number;
}
const token = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && new TextEncoder().encode(value).length <= 256;
const uint = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid receipt page object');
  return value as Record<string, unknown>;
};

/** Single bounded transport request; caller owns DATA admission and physical IO
 * settlement. No implicit cursor traversal, retries or retained page collection. */
export async function readNoteReceiptPage(
  send: (params: Record<string, unknown>) => Promise<unknown>,
  receipt: NoteCommitReceipt,
  request: NoteReceiptReadRequest,
  now: () => number = Date.now,
): Promise<NoteReceiptPage> {
  const scope = {
    backendId: receipt.scope.backendId,
    workspaceId: receipt.scope.workspaceId,
    noteId: receipt.scope.noteId,
    noteInstanceId: receipt.scope.noteInstanceId,
  };
  const identity = {
    operationId: receipt.operationId,
    payloadDigest: receipt.payloadDigest,
    beforeRevision: receipt.beforeRevision,
    afterRevision: receipt.afterRevision,
    expiresAt: receipt.receiptExpiresAt,
  };
  const { kind, baseLength, cursor, maxItems, maxWireBytes } = request;
  if (
    receipt.kind !== 'noteCommitReceipt' ||
    receipt.outcome !== 'committed' ||
    'headerDigest' in receipt ||
    'viewId' in receipt ||
    !Object.values(scope).every(token) ||
    !token(identity.operationId) ||
    !token(identity.payloadDigest) ||
    !token(identity.beforeRevision) ||
    !token(identity.afterRevision) ||
    !['mapping', 'effects'].includes(kind) ||
    !uint(baseLength) ||
    !Number.isSafeInteger(maxItems) ||
    maxItems < 1 ||
    maxItems > 128 ||
    !Number.isSafeInteger(maxWireBytes) ||
    maxWireBytes < 4096 ||
    maxWireBytes > 65536 ||
    (cursor !== undefined && !token(cursor))
  )
    throw new Error('Invalid inline receipt read');
  const ref = kind === 'mapping' ? receipt.mappingRef : receipt.effectsRef;
  if (!token(ref)) throw new Error('Invalid receipt root reference');
  const deadline = parseSourceDeadline(identity.expiresAt);
  if (!beforeSourceDeadline(now(), deadline)) throw new Error('Receipt expired');
  const result = await send({
    ...scope,
    operationId: identity.operationId,
    payloadDigest: identity.payloadDigest,
    kind,
    ref,
    ...(cursor === undefined ? {} : { cursor }),
    maxItems,
    maxWireBytes,
  });
  if (!beforeSourceDeadline(now(), deadline)) throw new Error('Receipt expired');
  const page = record(result),
    returnedScope = record(page.scope);
  if (
    page.kind !== 'noteOperationPage' ||
    page.outputKind !== kind ||
    page.operationId !== identity.operationId ||
    page.payloadDigest !== identity.payloadDigest ||
    page.beforeRevision !== identity.beforeRevision ||
    page.afterRevision !== identity.afterRevision ||
    page.expiresAt !== identity.expiresAt ||
    page.sourceLength !== baseLength ||
    Object.entries(scope).some(([key, value]) => returnedScope[key] !== value) ||
    'headerDigest' in page ||
    'viewId' in page ||
    'note' in page ||
    'content' in page ||
    !Array.isArray(page.items) ||
    page.items.length > maxItems ||
    (page.nextCursor !== null && !token(page.nextCursor)) ||
    new TextEncoder().encode(JSON.stringify(result)).length > maxWireBytes
  )
    throw new Error('Mismatched or oversized inline receipt page');
  return result as NoteReceiptPage;
}
