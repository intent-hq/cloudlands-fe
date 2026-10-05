import type { NoteCommitReceipt } from './note-pages';
import { beforeSourceDeadline, parseSourceDeadline } from '$shared/source-session-expiry';

/** One receipt page. Item semantics and complete-transcript proof belong to the
 * reconciliation owner; a validated envelope is never save-rebase authority. */
interface NoteReceiptEnvelope {
  kind: 'noteOperationPage';
  scope: NoteCommitReceipt['scope'];
  operationId: string;
  payloadDigest: string;
  sourceLength: number;
  items: unknown[];
  nextCursor: string | null;
  expiresAt: string;
}
type ReceiptPageIdentity =
  | { beforeRevision: string; afterRevision: string; headerDigest?: never; viewId?: never }
  | { headerDigest: string; viewId: string; beforeRevision?: never; afterRevision?: never };
export type NoteReceiptPage = NoteReceiptEnvelope &
  ReceiptPageIdentity &
  ({ outputKind: 'mapping' } | { outputKind: 'effects'; convertedCount: number });
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
const digest = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
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
    headerDigest: receipt.headerDigest,
    viewId: receipt.viewId,
  };
  const staged = 'headerDigest' in receipt || 'viewId' in receipt;
  const { kind, baseLength, cursor, maxItems, maxWireBytes } = request;
  if (
    receipt.kind !== 'noteCommitReceipt' ||
    receipt.outcome !== 'committed' ||
    (staged && (!digest(identity.headerDigest) || !token(identity.viewId))) ||
    !Object.values(scope).every(token) ||
    !token(identity.operationId) ||
    !digest(identity.payloadDigest) ||
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
    throw new Error('Invalid receipt read');
  const ref = kind === 'mapping' ? receipt.mappingRef : receipt.effectsRef;
  if (!token(ref)) throw new Error('Invalid receipt root reference');
  const deadline = parseSourceDeadline(identity.expiresAt);
  if (!beforeSourceDeadline(now(), deadline)) throw new Error('Receipt expired');
  const result = await send({
    ...scope,
    operationId: identity.operationId,
    ...(staged
      ? { headerDigest: identity.headerDigest }
      : { payloadDigest: identity.payloadDigest }),
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
    (staged
      ? page.headerDigest !== identity.headerDigest ||
        page.viewId !== identity.viewId ||
        'beforeRevision' in page ||
        'afterRevision' in page
      : page.beforeRevision !== identity.beforeRevision ||
        page.afterRevision !== identity.afterRevision ||
        'headerDigest' in page ||
        'viewId' in page) ||
    page.expiresAt !== identity.expiresAt ||
    page.sourceLength !== baseLength ||
    Object.entries(scope).some(([key, value]) => returnedScope[key] !== value) ||
    'note' in page ||
    'content' in page ||
    !Array.isArray(page.items) ||
    page.items.length > maxItems ||
    (kind === 'effects' && !uint(page.convertedCount)) ||
    (page.nextCursor !== null && !token(page.nextCursor)) ||
    new TextEncoder().encode(JSON.stringify(result)).length > maxWireBytes
  )
    throw new Error('Mismatched or oversized receipt page');
  if (!beforeSourceDeadline(now(), deadline)) throw new Error('Receipt expired');
  return result as NoteReceiptPage;
}
