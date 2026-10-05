import { readNoteReceiptPage, type NoteReceiptReadRequest } from '../note-receipt-reader';
import { createNoteSourceOperation, type NoteSourceOperationInput } from '../note-source-operation';
import { NotePageReader } from '../note-page-reader';
import type {
  NotePagesClient,
  NoteCommitReceipt,
  NotePageState,
  NoteSpliceOperation,
  NoteSaveOutcome,
} from '../note-pages';
import { backendRequest, onBackendNotification, onBackendReconnected } from './backend-transport';

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const token = (s: unknown): s is string =>
  typeof s === 'string' && s.length > 0 && new TextEncoder().encode(s).length <= 256;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid note page object');
  return value as Record<string, unknown>;
}
function scope(value: unknown, workspaceId: string, noteId: string) {
  const s = object(value);
  if (
    s.workspaceId !== workspaceId ||
    s.noteId !== noteId ||
    !token(s.backendId) ||
    !token(s.noteInstanceId)
  )
    throw new Error('Mismatched note page scope');
}
const uint = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
function pageState(value: unknown, workspaceId: string, noteId: string): NotePageState {
  const p = object(value);
  scope(p.scope, workspaceId, noteId);
  if (
    p.kind !== 'notePageState' ||
    p.invalidation !== 'all' ||
    typeof p.deleted !== 'boolean' ||
    !token(p.sourceRevision) ||
    !token(p.attributionGeneration) ||
    !token(p.commentRevision) ||
    !['ready', 'pending'].includes(String(p.attributionState)) ||
    typeof p.stateGeneration !== 'string' ||
    !/^(0|[1-9]\d*)$/.test(p.stateGeneration) ||
    BigInt(p.stateGeneration) > 18446744073709551615n ||
    bytes(value) > 4096
  )
    throw new Error('Invalid note state snapshot');
  return value as NotePageState;
}
function outcome(value: unknown, op: NoteSpliceOperation): NoteSaveOutcome {
  const p = object(value);
  scope(p.scope, op.scope.workspaceId, op.scope.noteId);
  const s = object(p.scope);
  if (
    s.backendId !== op.scope.backendId ||
    s.noteInstanceId !== op.scope.noteInstanceId ||
    p.operationId !== op.operationId ||
    p.payloadDigest !== op.payloadDigest ||
    bytes(value) > 4096
  )
    throw new Error('Mismatched note save receipt');
  if (p.kind === 'noteCommitReceipt' && p.outcome === 'committed') {
    if (
      p.beforeRevision !== op.baseRevision ||
      !token(p.afterRevision) ||
      !token(p.mappingRef) ||
      !token(p.effectsRef) ||
      !token(p.inverseRef) ||
      p.invalidation !== 'all' ||
      typeof p.receiptExpiresAt !== 'string' ||
      !Number.isFinite(Date.parse(p.receiptExpiresAt)) ||
      !uint(p.sourceLength)
    )
      throw new Error('Invalid note commit receipt');
  } else if (
    p.kind !== 'noteOperationStatus' ||
    !['pending', 'unknown', 'conflict', 'rejected'].includes(String(p.outcome))
  )
    throw new Error('Invalid note operation outcome');
  return value as NoteSaveOutcome;
}

export class LiveNotePagesClient extends NotePageReader implements NotePagesClient {
  createSourceOperation(input: NoteSourceOperationInput, current: () => boolean) {
    return createNoteSourceOperation(
      (method, params) => backendRequest(method, params),
      input,
      current,
    );
  }
  constructor() {
    super((method, params) => backendRequest(method, params));
  }
  readReceipt(receipt: NoteCommitReceipt, request: NoteReceiptReadRequest) {
    return readNoteReceiptPage(
      (params) => backendRequest('note.operation.read', params),
      receipt,
      request,
    );
  }
  async applySplices(op: NoteSpliceOperation) {
    const { scope, ...params } = op;
    return outcome(await backendRequest('note.applySplices', { ...scope, ...params }), op);
  }
  async operationStatus(op: NoteSpliceOperation) {
    return outcome(
      await backendRequest('note.operationStatus', {
        ...op.scope,
        operationId: op.operationId,
        payloadDigest: op.payloadDigest,
      }),
      op,
    );
  }
  subscribe(
    workspaceId: string,
    noteId: string,
    onState: (state: NotePageState) => void,
    onReset: (error?: string) => void,
  ) {
    let disposed = false,
      generation = 0,
      id: string | undefined,
      seq = -1;
    // A subscribe push can precede its ack. Keep at most one latest snapshot per ID,
    // bounded even when other windows have subscriptions on this transport.
    const early = new Map<string, Record<string, unknown>>();
    const unsubscribe = (subscriptionId: string) => {
      void backendRequest('note.unsubscribe', { workspaceId, subscriptionId }).catch(() => {});
    };
    const accept = (p: Record<string, unknown>) => {
      if (typeof p.seq !== 'number' || !Number.isSafeInteger(p.seq) || p.kind !== 'snapshot')
        throw new Error('Invalid note state sequence');
      if (p.seq <= seq) return;
      if (seq >= 0 && p.seq !== seq + 1) {
        void register('Note state sequence gap');
        return;
      }
      const state = pageState(p.snapshot, workspaceId, noteId);
      seq = p.seq;
      onState(state);
    };
    const register = async (error?: string) => {
      const mine = ++generation;
      if (id) unsubscribe(id);
      id = undefined;
      seq = -1;
      early.clear();
      onReset(error);
      try {
        const ack = await backendRequest<{ subscriptionId: string }>('note.subscribe', {
          workspaceId,
          noteId,
          projection: 'pageState',
        });
        if (disposed || mine !== generation) {
          if (ack?.subscriptionId) unsubscribe(ack.subscriptionId);
          return;
        }
        if (!token(ack?.subscriptionId))
          throw new Error('Invalid note subscription acknowledgement');
        id = ack.subscriptionId;
        const pending = early.get(id);
        early.clear();
        if (pending) accept(pending);
      } catch (e) {
        if (!disposed && mine === generation) onReset(e instanceof Error ? e.message : String(e));
      }
    };
    const off = onBackendNotification((n) => {
      if (disposed || n.method !== 'subscription.push') return;
      try {
        const p = object(n.params);
        if (typeof p.subscriptionId !== 'string') return;
        if (p.subscriptionId === id) accept(p);
        else if (!id && early.size < 16) {
          const snapshot = p.snapshot as Partial<NotePageState> | undefined;
          if (
            snapshot?.kind !== 'notePageState' ||
            snapshot.scope?.workspaceId !== workspaceId ||
            snapshot.scope.noteId !== noteId
          )
            return;
          pageState(snapshot, workspaceId, noteId);
          const previous = early.get(p.subscriptionId);
          if (!previous || Number(p.seq) > Number(previous.seq)) early.set(p.subscriptionId, p);
        }
      } catch (e) {
        onReset(e instanceof Error ? e.message : String(e));
      }
    });
    const reconnect = onBackendReconnected(() => {
      void register();
    });
    void register();
    return () => {
      disposed = true;
      generation++;
      off();
      reconnect();
      early.clear();
      if (id) unsubscribe(id);
    };
  }
}
