import { readNoteReceiptPage, type NoteReceiptReadRequest } from '../note-receipt-reader';
import {
  createNoteSourceOperation,
  createNoteMarkerSourceOperation,
  createNoteMarkerSelectionOperation,
  createNoteRenderedSearchOperation,
  type NoteRenderedSearchOperationInput,
  createNoteSelectionOperation,
  type NoteSelectionOperationInput,
  type NoteSourceOperationInput,
  createNoteStagedSaveOperation,
  type NoteStagedSaveInput,
  readConstructedNoteSave,
  type NoteSealedSaveIdentity,
} from '../note-source-operation';
import { NotePageReader } from '../note-page-reader';
import type {
  NotePagesClient,
  NoteCommitReceipt,
  NotePageState,
  NoteSpliceOperation,
  NoteStagedSaveOperation,
  NoteSaveStageState,
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
function outcome(
  value: unknown,
  op: Pick<NoteSpliceOperation, 'scope' | 'operationId' | 'payloadDigest' | 'baseRevision'> & {
    headerDigest?: string;
  },
): NoteSaveOutcome {
  const staged = 'headerDigest' in op;
  const p = object(value);
  scope(p.scope, op.scope.workspaceId, op.scope.noteId);
  const s = object(p.scope);
  if (
    s.backendId !== op.scope.backendId ||
    s.noteInstanceId !== op.scope.noteInstanceId ||
    p.operationId !== op.operationId ||
    p.payloadDigest !== op.payloadDigest ||
    (staged ? p.headerDigest !== op.headerDigest : 'headerDigest' in p || 'viewId' in p) ||
    bytes(value) > 4096
  )
    throw new Error('Mismatched note save receipt');
  if (p.kind === 'noteCommitReceipt' && p.outcome === 'committed') {
    if (
      (staged && !token(p.viewId)) ||
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

// Enrollment exists only at the fixed backendRequest construction path below.
// Standalone source-operation constructors and copied API objects never enroll.
/** Invalidation-only lease; it establishes no backend/receipt provenance. The
 * fixed live-stage registry is still required. Tiny control state exists before
 * subscription callbacks; registration failure remains unknown cleanup. */
const lossBrand = Symbol('live save loss');
export interface LiveNoteSaveLoss {
  readonly [lossBrand]: true;
  current(): boolean;
  release(): void;
}
type LossState = {
  live: boolean;
  phase: 'open' | 'closing' | 'settled' | 'unknown';
  off?: () => void;
};
const lossLeases = new WeakMap<object, LossState>();
function lossCurrent(lease: LiveNoteSaveLoss): boolean {
  const state = lossLeases.get(lease);
  return !!state && state.live && state.phase === 'open';
}
export function retainLiveNoteSaveLoss(): LiveNoteSaveLoss {
  const state: LossState = { live: true, phase: 'open' };
  const lease: LiveNoteSaveLoss = Object.freeze({
    [lossBrand]: true as const,
    current: () => lossCurrent(lease),
    release() {
      state.live = false;
      if (state.phase === 'settled') return;
      if (state.phase !== 'open') throw new Error('Save loss subscription cleanup unknown');
      state.phase = 'closing';
      const off = state.off;
      state.off = undefined;
      try {
        off?.();
        state.phase = 'settled';
      } catch (error) {
        state.phase = 'unknown';
        throw error;
      }
    },
  });
  lossLeases.set(lease, state);
  try {
    state.off = onBackendReconnected(() => {
      state.live = false;
    });
  } catch {
    state.live = false;
    state.phase = 'unknown';
  }
  return lease;
}
const liveSaveStages = new WeakMap<object, { claimed: boolean }>();
const liveSaveObserverBrand = Symbol('live save observer');
export interface LiveNoteSaveObserver {
  readonly [liveSaveObserverBrand]: true;
  readonly identity: NoteSealedSaveIdentity;
  readonly header: Readonly<NoteStagedSaveInput['header']>;
  current(): boolean;
  observeOutcome(): Promise<NoteSaveOutcome>;
  readReceipt(request: NoteReceiptReadRequest): ReturnType<typeof readNoteReceiptPage>;
  release(): Promise<void>;
}
type LiveSaveSlot = {
  data?: {
    identity: NoteSealedSaveIdentity;
    loss: LiveNoteSaveLoss;
    current: () => boolean;
    now: () => number;
    captureFinalCheck?: () => ((time: number) => boolean) | undefined;
    receipt?: NoteCommitReceipt;
  };
  retired: boolean;
  busy: boolean;
  pending?: Promise<unknown>;
  unknownCleanup: boolean;
  releasing?: Promise<void>;
};
const liveSaveObservers = new WeakMap<object, LiveSaveSlot>();
/** Registry identity, not an arbitrary current() callback, authenticates this path. */
export function isLiveNoteSaveObserver(value: unknown): value is LiveNoteSaveObserver {
  return !!value && typeof value === 'object' && !!liveSaveObservers.get(value)?.data;
}
export function readLiveNoteSaveReceipt(observer: LiveNoteSaveObserver): NoteCommitReceipt {
  const receipt = liveSaveObservers.get(observer)?.data?.receipt;
  if (!receipt) throw new Error('Missing authenticated save receipt');
  return receipt;
}
function retireSaveObserver(slot: LiveSaveSlot) {
  slot.retired = true;
  slot.data = undefined;
}
function saveObserverCurrent(slot: LiveSaveSlot) {
  const d = slot.data;
  if (!d || slot.retired) return false;
  try {
    const receipt = d.receipt;
    const valid = d.current();
    const finalCheck = d.captureFinalCheck?.();
    const time = d.now();
    if (d.captureFinalCheck && (!finalCheck || !finalCheck(time)))
      throw new Error('Save observer final proof lost');
    if (
      !valid ||
      !Number.isFinite(time) ||
      slot.data !== d ||
      d.receipt !== receipt ||
      slot.retired ||
      !lossCurrent(d.loss)
    )
      throw new Error('Save observer lost');
    if (d.receipt && time >= Date.parse(d.receipt.receiptExpiresAt))
      throw new Error('Save receipt expired');
    return true;
  } catch {
    retireSaveObserver(slot);
    return false;
  }
}
// This bounded copy precedes the ordinary outcome decoder. Accessors and mutable
// aliases cannot become a private authenticated receipt after a callback runs.
function copyObservedData(value: unknown, limit: number): unknown {
  let fields = 0,
    units = 0;
  const copy = (v: unknown, depth: number): unknown => {
    if (depth > 8) throw new Error('Save data depth');
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      units += v.length;
      if (units > limit) throw new Error('Save data size');
      return v;
    }
    if (!v || typeof v !== 'object') throw new Error('Save data type');
    const array = Array.isArray(v);
    if (
      array
        ? Object.getPrototypeOf(v) !== Array.prototype
        : ![Object.prototype, null].includes(Object.getPrototypeOf(v))
    )
      throw new Error('Save data prototype');
    const keys = Reflect.ownKeys(v);
    if (keys.length > 8192 - fields) throw new Error('Save data fields');
    const result: unknown[] | Record<string, unknown> = array ? [] : {};
    for (const key of keys) {
      fields++;
      if (typeof key !== 'string') throw new Error('Save data key');
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (!d || !('value' in d)) throw new Error('Save data accessor');
      if (array && key === 'length') {
        if (!Number.isSafeInteger(d.value) || d.value < 0 || d.value > 8192)
          throw new Error('Save data length');
        continue;
      }
      units += key.length;
      if (units > limit) throw new Error('Save data size');
      Object.defineProperty(result, key, { value: copy(d.value, depth + 1), enumerable: true });
    }
    return Object.freeze(result);
  };
  const result = copy(value, 0);
  if (bytes(result) > limit) throw new Error('Save data bytes');
  return result;
}
function saveObserverAPI(
  slot: LiveSaveSlot,
  identity: NoteSealedSaveIdentity,
  header: Readonly<NoteStagedSaveInput['header']>,
): LiveNoteSaveObserver {
  const run = <T>(action: (d: NonNullable<LiveSaveSlot['data']>) => Promise<T>): Promise<T> => {
    if (slot.busy || !slot.data) return Promise.reject(new Error('Save observer unavailable'));
    slot.busy = true; // Consume before owner, clock or transport callbacks.
    let resolve!: (value: T) => void, reject!: (error: unknown) => void;
    const pending = new Promise<T>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    slot.pending = pending;
    void (async () => {
      try {
        if (!saveObserverCurrent(slot) || !slot.data) throw new Error('Save observer lost');
        const data = slot.data;
        const result = await action(data);
        if (slot.data !== data || !saveObserverCurrent(slot)) throw new Error('Save observer lost');
        resolve(result);
      } catch (error) {
        retireSaveObserver(slot);
        reject(error);
      } finally {
        slot.busy = false;
        if (slot.pending === pending) slot.pending = undefined;
      }
    })();
    return pending;
  };
  const api: LiveNoteSaveObserver = Object.freeze({
    [liveSaveObserverBrand]: true as const,
    identity,
    header,
    current: () => saveObserverCurrent(slot),
    observeOutcome: () =>
      run(async (d) => {
        let raw: unknown;
        try {
          raw = await backendRequest('note.operationStatus', {
            ...d.identity.scope,
            operationId: d.identity.operationId,
            headerDigest: d.identity.headerDigest,
            payloadDigest: d.identity.payloadDigest,
          });
        } catch (error) {
          slot.unknownCleanup = true;
          throw error;
        }
        const snapshot = copyObservedData(raw, 4096);
        if (!saveObserverCurrent(slot)) throw new Error('Save observer lost');
        const result = outcome(snapshot, d.identity);
        if (result.kind === 'noteCommitReceipt') {
          if (d.receipt && JSON.stringify(d.receipt) !== JSON.stringify(result))
            throw new Error('Save receipt changed');
          d.receipt = result;
        } else if (result.outcome === 'conflict' || result.outcome === 'rejected') {
          retireSaveObserver(slot);
          throw new Error('Save operation refused');
        }
        return result;
      }),
    readReceipt: (request: NoteReceiptReadRequest) =>
      run(async (d) => {
        if (!d.receipt) throw new Error('Missing authenticated save receipt');
        const receipt = d.receipt;
        const supplied = copyObservedData(request, 4096) as NoteReceiptReadRequest;
        return readNoteReceiptPage(
          async (params) => {
            if (slot.data !== d || d.receipt !== receipt || !saveObserverCurrent(slot))
              throw new Error('Save observer lost before read');
            let raw: unknown;
            try {
              raw = await backendRequest('note.operation.read', params);
            } catch (error) {
              slot.unknownCleanup = true;
              throw error;
            }
            // Copy at transport completion before decoder/owner clock callbacks.
            return copyObservedData(raw, 8192);
          },
          receipt,
          supplied,
          d.now,
        );
      }),
    release() {
      if (slot.releasing) return slot.releasing;
      retireSaveObserver(slot);
      let resolve!: () => void, reject!: (error: unknown) => void;
      slot.releasing = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      void (async () => {
        try {
          try {
            await slot.pending;
          } catch {
            /* Physical debt is distinguished below. */
          }
          if (slot.unknownCleanup) throw new Error('Save observer cleanup unknown');
          resolve();
        } catch (error) {
          reject(error);
        }
      })();
      return slot.releasing;
    },
  });
  liveSaveObservers.set(api, slot);
  return api;
}
/** Read-only, one-use observation of an actual live-client sealed operation.
 * Caller reserves DATA/one physical IO slot first. This never uploads or commits. */
export function claimLiveNoteStagedSave(
  stage: unknown,
  loss: LiveNoteSaveLoss,
  current: () => boolean,
  now: () => number = Date.now,
  captureFinalCheck?: () => ((time: number) => boolean) | undefined,
): LiveNoteSaveObserver {
  const enrollment = stage && typeof stage === 'object' ? liveSaveStages.get(stage) : undefined;
  if (!enrollment || enrollment.claimed) throw new Error('Unknown or claimed live save');
  enrollment.claimed = true;
  const slot: LiveSaveSlot = { busy: false, retired: false, unknownCleanup: false };
  try {
    if (!lossCurrent(loss)) throw new Error('Save loss lease unavailable');
    const original = readConstructedNoteSave(stage);
    if (slot.retired) throw new Error('Live save claim lost during subscription');
    slot.data = { identity: original.sealed, loss, current, now, captureFinalCheck };
    if (!saveObserverCurrent(slot)) throw new Error('Live save claim lost');
    return saveObserverAPI(slot, original.sealed, original.header);
  } catch (error) {
    retireSaveObserver(slot);
    throw error;
  }
}

export class LiveNotePagesClient extends NotePageReader implements NotePagesClient {
  createSaveOperation(
    input: NoteStagedSaveInput,
    current: () => boolean,
  ): ReturnType<typeof createNoteStagedSaveOperation> {
    const stage = createNoteStagedSaveOperation(
      (method, params) => backendRequest(method, params),
      input,
      current,
    );
    liveSaveStages.set(stage, { claimed: false });
    return stage;
  }
  async stagedStatus(op: NoteStagedSaveOperation): Promise<NoteSaveOutcome | NoteSaveStageState> {
    const value = await backendRequest('note.operationStatus', {
      ...op.scope,
      operationId: op.operationId,
      headerDigest: op.headerDigest,
      payloadDigest: op.payloadDigest,
    });
    const p = object(value);
    if (p.kind !== 'noteStageState') return outcome(value, op);
    const s = object(p.scope);
    if (
      bytes(value) > 4096 ||
      Object.entries(op.scope).some(([k, v]) => s[k] !== v) ||
      p.operationId !== op.operationId ||
      p.headerDigest !== op.headerDigest ||
      p.baseRevision !== op.baseRevision ||
      p.expiresAt !== op.expiresAt ||
      !['staging', 'sealed', 'cancelled', 'expired'].includes(String(p.phase)) ||
      (p.payloadDigest !== undefined && p.payloadDigest !== op.payloadDigest) ||
      (p.phase === 'sealed' &&
        (p.payloadDigest !== op.payloadDigest || p.viewLength !== op.viewLength)) ||
      !Array.isArray(p.streams) ||
      p.streams.length !== 5 ||
      p.streams.some((entry, i) => {
        const r = object(entry),
          m = op.manifest[i];
        return (
          !m ||
          r.stream !== m.stream ||
          r.nextSequence !== m.chunks ||
          r.lastDigest !== m.lastDigest
        );
      })
    )
      throw new Error('Mismatched staged save status');
    return value as NoteSaveStageState;
  }
  async commitStaged(op: NoteStagedSaveOperation) {
    return outcome(
      await backendRequest('note.operation.commit', {
        ...op.scope,
        operationId: op.operationId,
        headerDigest: op.headerDigest,
        payloadDigest: op.payloadDigest,
      }),
      op,
    );
  }
  createMarkerSelectionOperation(
    input: NoteSelectionOperationInput,
    current: () => boolean,
  ): ReturnType<typeof createNoteMarkerSelectionOperation> {
    return createNoteMarkerSelectionOperation(
      (method, params) => backendRequest(method, params),
      input,
      current,
    );
  }
  createSourceOperation(
    input: NoteSourceOperationInput,
    current: () => boolean,
  ): ReturnType<typeof createNoteSourceOperation> {
    return createNoteSourceOperation(
      (method, params) => backendRequest(method, params),
      input,
      current,
    );
  }
  createMarkerSourceOperation(
    input: NoteSourceOperationInput,
    current: () => boolean,
  ): ReturnType<typeof createNoteMarkerSourceOperation> {
    return createNoteMarkerSourceOperation(
      (method, params) => backendRequest(method, params),
      input,
      current,
    );
  }
  createSelectionOperation(
    input: NoteSelectionOperationInput,
    current: () => boolean,
  ): ReturnType<typeof createNoteSelectionOperation> {
    return createNoteSelectionOperation(
      (method, params) => backendRequest(method, params),
      input,
      current,
    );
  }
  createRenderedSearchOperation(
    input: NoteRenderedSearchOperationInput,
    current: () => boolean,
  ): ReturnType<typeof createNoteRenderedSearchOperation> {
    return createNoteRenderedSearchOperation(
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
    if ('headerDigest' in op) throw new Error('Staged operation cannot use inline save');
    const { scope, ...params } = op;
    return outcome(await backendRequest('note.applySplices', { ...scope, ...params }), op);
  }
  async operationStatus(op: NoteSpliceOperation) {
    if ('headerDigest' in op) throw new Error('Use staged status recovery');
    return outcome(
      await backendRequest('note.operationStatus', {
        ...op.scope,
        operationId: op.operationId,
        ...('headerDigest' in op ? { headerDigest: op.headerDigest } : {}),
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
