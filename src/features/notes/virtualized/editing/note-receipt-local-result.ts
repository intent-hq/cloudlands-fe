import { beforeSourceDeadline, parseSourceDeadline } from '$shared/source-session-expiry';
import {
  sameNoteScope,
  type NoteCommitReceipt,
  type NotePagesClient,
  type NoteSpliceOperation,
} from '$lib/client/note-pages';
import { composeNoteEdits, noteSavePayloadDigest } from './note-edit-plan';
import { reserveNoteReceiptTranscript } from './note-receipt-transcript';

const uint = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const token = (s: unknown): s is string =>
  typeof s === 'string' && s.length > 0 && new TextEncoder().encode(s).length <= 256;
const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid receipt record');
  return v as Record<string, unknown>;
};
// Brent cycle detection retains one checkpoint, not every cursor in a large
// transcript. Mapping record checks independently enforce the expected prefix.
function cursorProgress() {
  let checkpoint: string | undefined,
    distance = 0,
    power = 1;
  return (cursor: string | null) => {
    if (cursor === null) return;
    if (cursor === checkpoint) throw new Error('Cyclic receipt transcript');
    if (checkpoint === undefined) checkpoint = cursor;
    else if (++distance === power) {
      checkpoint = cursor;
      distance = 0;
      power = Math.min(Number.MAX_SAFE_INTEGER, power * 2);
    }
  };
}

/** Narrow exact-caller-result proof under the contract that effects enumerate
 * EVERY additional source replacement. General effects, warnings and alternate
 * mapping decompositions are refused, retaining the caller's reconciliation gate.
 * Input is the captured inline operation, not the current draft journal. This
 * returns no Redux authority: its owner must atomically recheck captured content,
 * revision, receipt and journal before adopting a reconciled document. */
export async function readNoteLocalReceiptResult(
  port: Parameters<typeof reserveNoteReceiptTranscript>[0],
  client: Pick<NotePagesClient, 'readReceipt'>,
  originalReceipt: NoteCommitReceipt,
  originalOperation: NoteSpliceOperation,
  baseLength: number,
  ownerCurrent: () => boolean,
  signal?: AbortSignal,
) {
  if (
    !uint(baseLength) ||
    originalOperation.splices.length < 1 ||
    originalOperation.splices.length > 32
  )
    throw new Error('Unsupported receipt input');
  let insertedBytes = 0;
  for (const s of originalOperation.splices) {
    if (typeof s.text !== 'string' || s.text.length > 16_384)
      throw new Error('Oversized receipt input');
    insertedBytes += new TextEncoder().encode(s.text).length;
    if (insertedBytes > 16_384) throw new Error('Oversized receipt input');
  }
  if (
    ![
      ...Object.values(originalOperation.scope),
      originalOperation.baseRevision,
      originalOperation.operationId,
      originalOperation.expiresAt,
    ].every(token)
  )
    throw new Error('Invalid receipt input identity');
  const operation = Object.freeze({
    ...originalOperation,
    scope: Object.freeze({ ...originalOperation.scope }),
    splices: Object.freeze(
      originalOperation.splices.map(({ start, end, text }) => Object.freeze({ start, end, text })),
    ),
  });
  const receipt = Object.freeze({
    ...originalReceipt,
    scope: Object.freeze({ ...originalReceipt.scope }),
  });
  const finalLength = operation.splices.reduce(
    (n, s) => n + s.text.length - s.end + s.start,
    baseLength,
  );
  if (
    !uint(finalLength) ||
    finalLength !== receipt.sourceLength ||
    !sameNoteScope(operation.scope, receipt.scope) ||
    operation.operationId !== receipt.operationId ||
    operation.payloadDigest !== receipt.payloadDigest ||
    operation.baseRevision !== receipt.beforeRevision
  )
    throw new Error('Receipt does not match captured write');
  const deadline = parseSourceDeadline(receipt.receiptExpiresAt);
  let ownerLost = false;
  const current = () => {
    let present = false;
    try {
      present = ownerCurrent();
    } catch {
      /* Ownership failure is permanent. */
    }
    ownerLost ||=
      !present || signal?.aborted === true || !beforeSourceDeadline(Date.now(), deadline);
    return !ownerLost;
  };
  // Observe through awaited release, after the driver's own delivery lifetime.
  // Otherwise loss + revival during resource retirement could publish a result.
  const unsubscribe = port.subscribe(() => {
    current();
  });
  let lease: ReturnType<typeof reserveNoteReceiptTranscript> | undefined;
  try {
    lease = reserveNoteReceiptTranscript(port, client, receipt, baseLength, current, signal);
    const ready = await lease.ready;
    // Composition scratch and digest allocations are covered by admitted DATA.
    // No untouched source is hydrated; only the bounded inline text is visited.
    composeNoteEdits(baseLength, [{ splices: operation.splices }]);
    // Digest work occurs after DATA admission, before the first receipt request.
    if (
      (await noteSavePayloadDigest({ ...operation, splices: [...operation.splices] })) !==
      receipt.payloadDigest
    )
      throw new Error('Captured write digest mismatch');
    if (!ready.current()) throw new Error('Receipt owner changed');
    let index = 0;
    const mappingCursor = cursorProgress();
    while (
      !(await ready.consumeNext('mapping', (page) => {
        mappingCursor(page.nextCursor);
        for (const value of page.items) {
          const item = record(value),
            expected = operation.splices[index];
          if (
            !expected ||
            !uint(item.start) ||
            !uint(item.end) ||
            !uint(item.insertedLength) ||
            item.start !== expected.start ||
            item.end !== expected.end ||
            item.insertedLength !== expected.text.length
          )
            throw new Error('Receipt mapping differs from captured write');
          index++;
        }
      }))
    ) {
      /* The sink retains only the next expected splice index. */
    }
    if (index !== operation.splices.length) throw new Error('Incomplete receipt mapping');
    const effectsCursor = cursorProgress();
    let attributionGeneration: string | undefined, commentRevision: string | undefined;
    while (
      !(await ready.consumeNext('effects', (page) => {
        effectsCursor(page.nextCursor);
        if (page.outputKind !== 'effects' || page.convertedCount !== 0)
          throw new Error('Receipt requires canonical reconciliation');
        for (const value of page.items) {
          const item = record(value);
          if (
            item.kind !== 'annotationInvalidation' ||
            item.sourceRevision !== receipt.afterRevision ||
            !token(item.attributionGeneration) ||
            !token(item.commentRevision)
          )
            throw new Error('Receipt requires canonical reconciliation');
          if (
            (attributionGeneration !== undefined &&
              attributionGeneration !== item.attributionGeneration) ||
            (commentRevision !== undefined && commentRevision !== item.commentRevision)
          )
            throw new Error('Receipt annotation identity changed');
          attributionGeneration = item.attributionGeneration;
          commentRevision = item.commentRevision;
        }
      }))
    ) {
      /* No output page, effect array or source join is retained. */
    }
    if (!ready.current()) throw new Error('Receipt owner changed');
  } finally {
    // Never release from a page sink: release waits for that sink's settlement.
    try {
      await lease?.release();
    } finally {
      unsubscribe();
    }
  }
  if (!current()) throw new Error('Receipt owner changed during retirement');
  return Object.freeze({
    receipt,
    baseLength,
    sourceLength: finalLength,
    exactLocalResult: true as const,
  });
}
