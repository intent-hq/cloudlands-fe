import { v4 as uuid } from 'uuid';
import type { NotePagesClient } from '$lib/client/note-pages';
import type {
  NotePagesState,
  NotePageSession,
} from '$store/renderer/slices/note-pages/note-pages-types';
import * as a from '$store/renderer/slices/note-pages/note-pages-slice';
import { currentNoteSaveContinuation } from '$store/renderer/slices/note-pages/note-save-continuation-publication';
import { currentNoteNativeHistoryWitness } from './note-native-history-witness';
import { readNoteStagedReceiptResult } from './note-staged-receipt-result';
import { parseSourceDeadline, beforeSourceDeadline } from '$shared/source-session-expiry';

type Port = {
  read(): NotePagesState;
  dispatch(action: Parameters<typeof a.notePagesReducer>[1]): unknown;
  subscribe(listener: () => void): () => void;
};
/** Borrow the separately admitted continuity witness before receipt IO. Its owner and
 * observer survive receipt physical cleanup and synchronous reducer publication.
 * Cancellation cannot release snapshot debt while nested receipt IO is pending. */
export async function reconcileNoteStagedSaveContinuation(
  port: Port,
  client: NotePagesClient,
  ws: string,
  id: string,
  capture: NonNullable<NotePageSession['committedDocumentSave']>,
  signal: AbortSignal,
) {
  if (!('headerDigest' in capture.operation)) return;
  const operation = capture.operation;
  const read = () => port.read().byWorkspaceId[ws]?.notes[id];
  const continuity = currentNoteSaveContinuation(read(), capture);
  const initial = read();
  const before = initial?.document;
  if (!continuity || !initial || !before) return;
  const releasePin = continuity.pin();
  if (!releasePin) return;
  const owner = `staged-continuation:${uuid()}`;
  const deadline = parseSourceDeadline(capture.receipt.receiptExpiresAt);
  let lost = false,
    admitted = false;
  let witness: typeof continuity.witness | undefined;
  const current = () => {
    const note = read();
    lost ||=
      signal.aborted ||
      !beforeSourceDeadline(Date.now(), deadline) ||
      !currentNoteSaveContinuation(note, capture) ||
      note?.drafts !== initial.drafts ||
      note?.history !== initial.history ||
      (admitted && !Object.hasOwn(port.read().resourceLedger.owners, owner)) ||
      (witness !== undefined &&
        (!note?.document || !currentNoteNativeHistoryWitness(note.document, witness)));
    if (lost) continuity.refuse();
    return !lost;
  };
  const unsubscribe = port.subscribe(current);
  try {
    admitted = true;
    const resource = port.read().resourceLedger.resources[continuity.owner];
    if (!resource) return;
    port.dispatch(
      a.pageResourcesRequested(owner, [{ id: continuity.owner, cost: resource.cost }], 1),
    );
    if (!Object.hasOwn(port.read().resourceLedger.owners, owner)) return;
    if (!current()) return;
    witness = continuity.witness;
    const proof = await readNoteStagedReceiptResult(
      port,
      client,
      capture.receipt,
      operation,
      continuity.captured,
      current,
      signal,
    );
    if (!current()) return;
    const latest = read()?.document;
    if (!latest) return;
    // No awaits after proof cleanup. Middleware-triggered loss remains latched
    // by this observer and the save continuity registry until the reducer CAS.
    port.dispatch(
      a.pageDocumentSaveReconciled(ws, id, capture, latest, proof, Date.now(), {
        before,
        witness,
        owner,
        drafts: initial.drafts,
        history: initial.history,
      }),
    );
  } finally {
    unsubscribe();
    releasePin();
    port.dispatch(a.pageResourcesReleased(owner));
  }
}
