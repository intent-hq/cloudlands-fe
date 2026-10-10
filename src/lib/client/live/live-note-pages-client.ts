import type { takeLocalPointDispatchArm } from '$features/notes/virtualized/editing/note-local-point-staged-save';
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
import {
  backendRequest,
  onBackendNotification,
  onBackendReconnected,
  captureNoteSaveConnection,
} from './backend-transport';
import { parseNoteSaveCommand, type NoteSaveConnection } from '$shared/types/note-save-connection';

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
  bound?: NoteSaveConnection;
  contextClaimed?: boolean;
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
    const bound = slot.bound,
      bindingCheck = bound?.captureCurrent();
    if (bound && !bindingCheck) throw new Error('Save connection lost');
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
    if (slot.bound !== bound || (bound && !bindingCheck?.()))
      throw new Error('Save connection lost');
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
/** Dispatch-only bounded JSON DATA copy. No application-owned full key list is
 * allocated. The logical allowance does not measure engine enumeration internals. */
function copyDispatchOutcome(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Save data root');
  let nodes = 0,
    units = 0,
    wire = 0;
  const charge = (amount: number) => {
    wire += amount;
    if (wire > 4096) throw new Error('Save data bytes');
  };
  const stringWire = (value: string) => {
    charge(2);
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (c < 32) charge(c === 8 || c === 9 || c === 10 || c === 12 || c === 13 ? 2 : 6);
      else if (c === 34 || c === 92) charge(2);
      else if (c < 128) charge(1);
      else if (c < 2048) charge(2);
      else if (
        c >= 0xd800 &&
        c <= 0xdbff &&
        i + 1 < value.length &&
        value.charCodeAt(i + 1) >= 0xdc00 &&
        value.charCodeAt(i + 1) <= 0xdfff
      ) {
        charge(4);
        i++;
      } else charge(c >= 0xd800 && c <= 0xdfff ? 6 : 3);
    }
  };
  const copy = (v: unknown, depth: number): unknown => {
    if (depth > 8) throw new Error('Save data depth');
    if (v === null || typeof v === 'boolean') {
      charge(v === null ? 4 : v ? 4 : 5);
      return v;
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
      charge(String(v).length);
      return v;
    }
    if (typeof v === 'string') {
      units += v.length;
      if (units > 4096) throw new Error('Save data size');
      stringWire(v);
      return v;
    }
    if (!v || typeof v !== 'object') throw new Error('Save data type');
    const array = Array.isArray(v),
      prototype = Object.getPrototypeOf(v);
    if (
      array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null
    )
      throw new Error('Save data prototype');
    if (++nodes > 512) throw new Error('Save data nodes');
    if (array) {
      const length = Object.getOwnPropertyDescriptor(v, 'length');
      if (
        !length ||
        !('value' in length) ||
        !Number.isSafeInteger(length.value) ||
        length.value < 0 ||
        length.value > 512 - nodes
      )
        throw new Error('Save data array bound');
      charge(length.value * 5); // Prepay every slot, including sparse null/comma output.
    }
    charge(2);
    const result: unknown[] | Record<string, unknown> = array ? [] : {};
    // Count inherited iterations too; only own enumerable JSON fields are copied.
    for (const key in v) {
      if (++nodes > 512) throw new Error('Save data nodes');
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (!d) continue;
      if (!('value' in d)) throw new Error('Save data accessor');
      units += key.length;
      if (units > 4096) throw new Error('Save data size');
      charge(1); // Conservative comma allowance, including the first field.
      if (!array) {
        stringWire(key);
        charge(1);
      }
      Object.defineProperty(result, key, { value: copy(d.value, depth + 1), enumerable: true });
    }
    return Object.freeze(result);
  };
  const result = copy(value, 0);
  if (bytes(result) > 4096) throw new Error('Save data bytes');
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
          raw = slot.bound
            ? await boundValue(slot.bound, { kind: 'status' })
            : await backendRequest('note.operationStatus', {
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
              raw = slot.bound
                ? await boundValue(
                    slot.bound,
                    parseNoteSaveCommand({
                      kind: 'receipt',
                      output: params.kind,
                      ref: params.ref,
                      ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
                      ...(params.textId === undefined ? {} : { textId: params.textId }),
                      ...(params.offset === undefined ? {} : { offset: params.offset }),
                    }),
                  )
                : await backendRequest('note.operation.read', params);
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

const dispatchBrand = Symbol('live note dispatch');
export interface LiveNoteSaveDispatch {
  readonly [dispatchBrand]: true;
  prepareBinding(): Promise<void>;
  invoke(): Promise<NoteSaveOutcome>;
  status(): Promise<NoteSaveOutcome>;
  entered(): boolean;
  release(): Promise<void>;
}
type DispatchSlot = {
  observer: LiveNoteSaveObserver;
  identity: NoteSealedSaveIdentity;
  entered: boolean;
  busy: boolean;
  retired: boolean;
  unknown: boolean;
  pending?: Promise<NoteSaveOutcome>;
  result?: NoteSaveOutcome;
};
const dispatches = new WeakMap<object, DispatchSlot>();
const dispatchedObservers = new WeakSet<object>();
async function boundValue(
  connection: NoteSaveConnection,
  command: Parameters<NoteSaveConnection['request']>[0],
) {
  const result = await connection.request(command);
  if (result.settlement.status === 'rejected')
    throw Object.assign(new Error(result.settlement.error.message), {
      code: result.settlement.error.rpcCode,
    });
  return result.settlement.value;
}
/** A local fixed-path invocation receipt is NOT evidence of server delivery. */
export async function loadLiveNoteSaveDispatch() {
  const { takeLocalPointDispatchArm } =
    await import('$features/notes/virtualized/editing/note-local-point-staged-save');
  return (key: unknown): LiveNoteSaveDispatch =>
    createLiveNoteSaveDispatch(key, takeLocalPointDispatchArm);
}
function createLiveNoteSaveDispatch(
  key: unknown,
  takeArm: typeof takeLocalPointDispatchArm,
): LiveNoteSaveDispatch {
  let arm: ReturnType<typeof takeLocalPointDispatchArm> | undefined = takeArm(key);
  const observer = arm.observer;
  const observed = liveSaveObservers.get(observer);
  if (!observed?.data || dispatchedObservers.has(observer) || !saveObserverCurrent(observed))
    throw new Error('Live save dispatch unavailable');
  dispatchedObservers.add(observer);
  const requiresBinding = arm.bound === true;
  let bindingWork: Promise<void> | undefined,
    bindingStarted = false;
  const slot: DispatchSlot = {
    observer,
    identity: observed.data.identity,
    entered: false,
    busy: false,
    retired: false,
    unknown: false,
  };
  const request = (commit: boolean): Promise<NoteSaveOutcome> => {
    if (slot.busy || slot.retired || (commit ? slot.entered : !slot.entered))
      return Promise.reject(new Error('Live save dispatch already consumed'));
    slot.busy = true;
    let resolve!: (value: NoteSaveOutcome) => void, reject!: (error: unknown) => void;
    const pending = new Promise<NoteSaveOutcome>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    slot.pending = pending; // Own receipt BEFORE any callback or synchronous transport reentry.
    void (async () => {
      let started = false;
      try {
        if (!saveObserverCurrent(observed) || slot.retired)
          throw new Error('Live save dispatch lost');
        const bindingCheck = requiresBinding ? observed.bound?.captureCurrent() : undefined;
        if (requiresBinding && !bindingCheck) throw new Error('Live save connection lost');
        const owned = arm;
        if (!owned || !owned.current()) throw new Error('Live dispatch arm lost');
        const finalCheck = owned.finalCheck(),
          time = owned.now();
        if (
          arm !== owned ||
          slot.retired ||
          !finalCheck?.(time) ||
          (requiresBinding && !bindingCheck?.())
        )
          throw new Error('Live dispatch final check lost');
        const op = slot.identity;
        if (commit) slot.entered = true;
        started = true;
        const raw = requiresBinding
          ? await boundValue(observed.bound!, { kind: commit ? 'commit' : 'status' })
          : await backendRequest(commit ? 'note.operation.commit' : 'note.operationStatus', {
              ...op.scope,
              operationId: op.operationId,
              headerDigest: op.headerDigest,
              payloadDigest: op.payloadDigest,
            });
        // Authentication/data recovery survives authority loss after actual invocation.
        const result = outcome(copyDispatchOutcome(raw), op);
        if (
          slot.result?.kind === 'noteCommitReceipt' &&
          JSON.stringify(slot.result) !== JSON.stringify(result)
        )
          throw new Error('Live save outcome changed');
        slot.result = result;
        if (result.kind === 'noteCommitReceipt' && observed.data && !observed.retired)
          observed.data.receipt = result;
        resolve(result);
      } catch (error) {
        if (started) slot.unknown = true;
        reject(error);
      } finally {
        slot.busy = false;
        if (slot.pending === pending) slot.pending = undefined;
      }
    })();
    return pending;
  };
  let releasing: Promise<void> | undefined;
  const api: LiveNoteSaveDispatch = Object.freeze({
    [dispatchBrand]: true as const,
    prepareBinding() {
      if (!requiresBinding || bindingStarted || slot.retired || slot.entered)
        return Promise.reject(new Error('Bound save capture unavailable'));
      bindingStarted = true;
      let yes!: () => void, no!: (e: unknown) => void;
      bindingWork = new Promise<void>((resolve, reject) => {
        yes = resolve;
        no = reject;
      });
      void (async () => {
        let awaitingCapture = false;
        try {
          if (!arm?.current() || slot.retired || !saveObserverCurrent(observed))
            throw new Error('Bound save capture lost');
          const op = slot.identity;
          const acquisition = captureNoteSaveConnection({
            scope: op.scope,
            operationId: op.operationId,
            baseRevision: op.baseRevision,
            headerDigest: op.headerDigest,
            payloadDigest: op.payloadDigest,
            expiresAt: op.expiresAt,
            viewLength: 59,
          });
          awaitingCapture = true;
          const bound = await acquisition;
          observed.bound = bound; // Own returned product even if acquisition revoked the issuer.
          awaitingCapture = false;
          if (slot.retired || !arm?.current() || !saveObserverCurrent(observed))
            throw new Error('Bound save capture lost');
          yes();
        } catch (e) {
          if (awaitingCapture) slot.unknown = true;
          no(e);
        }
      })();
      return bindingWork;
    },
    invoke: () => request(true),
    status: () => request(false),
    entered: () => slot.entered,
    release() {
      if (releasing) return releasing;
      slot.retired = true;
      releasing = (async () => {
        try {
          await bindingWork;
        } catch {
          /* Missing capture/release evidence retains charge. */
        }
        try {
          await slot.pending;
        } catch {
          /* Unknown debt remains independently latched. */
        }
        arm = undefined;
        if (observed.bound) await observed.bound.release();
        if (slot.unknown) throw new Error('Live save dispatch cleanup unknown');
      })();
      return releasing;
    },
  });
  dispatches.set(api, slot);
  return api;
}
export function liveNoteDispatchOutcome(
  dispatch: unknown,
  observer?: LiveNoteSaveObserver,
): NoteSaveOutcome | undefined {
  const slot = dispatch && typeof dispatch === 'object' ? dispatches.get(dispatch) : undefined;
  if (!slot || (observer && slot.observer !== observer))
    throw new Error('Foreign live save dispatch');
  return slot.result;
}

type GuardedIO = {
  busy: boolean;
  retired: boolean;
  unknown: boolean;
  pending?: Promise<unknown>;
  release?: Promise<void>;
};
const guardedIO = new WeakMap<object, GuardedIO>();
export function guardedNoteSaveCleanupKnown(stage: unknown): boolean {
  const io = stage && typeof stage === 'object' ? guardedIO.get(stage) : undefined;
  return !!io && !io.busy && !io.unknown;
}
export function releaseGuardedNoteSave(stage: unknown): Promise<void> {
  const slot = stage && typeof stage === 'object' ? guardedIO.get(stage) : undefined;
  if (!slot) return Promise.reject(new Error('Unknown guarded stage'));
  if (slot.release) return slot.release;
  slot.retired = true;
  slot.release = (async () => {
    try {
      await slot.pending;
    } catch {
      /* Rejection never proves remote cleanup. */
    }
    if (slot.unknown) throw new Error('Guarded stage cleanup unknown');
  })();
  return slot.release;
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
  /** Opt-in liveness restriction at the ORIGINAL fixed send closure. These callbacks
   * cannot authenticate outcomes; provenance still comes only from backendRequest. */
  createGuardedSaveOperation(
    input: NoteStagedSaveInput,
    current: () => boolean,
    now: () => number,
    captureFinalCheck: () => ((time: number) => boolean) | undefined,
  ): ReturnType<typeof createNoteStagedSaveOperation> {
    const guard = () => {
      const valid = current(),
        check = captureFinalCheck(),
        time = now();
      if (!valid || !check || !check(time) || time >= Date.parse(input.expiresAt))
        throw new Error('Guarded save lost before send');
    };
    const io: GuardedIO = { busy: false, retired: false, unknown: false };
    const stage = createNoteStagedSaveOperation(
      (method, params) => {
        if (io.busy || io.retired) return Promise.reject(new Error('Guarded stage busy/retired'));
        // Own the deferred before guard/transport callbacks can reenter.
        io.busy = true;
        let yes!: (v: unknown) => void, no!: (e: unknown) => void;
        const pending = new Promise<unknown>((resolve, reject) => {
          yes = resolve;
          no = reject;
        });
        io.pending = pending;
        void (async () => {
          let entered = false;
          try {
            if (method !== 'note.operation.cancel') guard();
            if (io.retired) throw new Error('Guarded stage retired');
            entered = true;
            yes(await backendRequest(method, params));
          } catch (e) {
            if (entered) io.unknown = true;
            no(e);
          } finally {
            io.busy = false;
            if (io.pending === pending) io.pending = undefined;
          }
        })();
        return pending;
      },
      input,
      current,
      now,
    );
    guardedIO.set(stage, io);
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

/** Lazy native-side issuer: importing the Live client must not load a DOM resolver. */
export async function openLiveAfterRevisionIO(key: unknown) {
  const { takeLocalPointAfterRevisionArm } =
    await import('$features/notes/virtualized/editing/note-local-point-staged-save');
  const arm = takeLocalPointAfterRevisionArm(key);
  const dispatch = dispatches.get(arm.dispatch),
    slot = liveSaveObservers.get(arm.observer);
  const receipt = dispatch?.result;
  if (
    !dispatch ||
    dispatch.observer !== arm.observer ||
    dispatch.retired ||
    dispatch.unknown ||
    !dispatch.entered ||
    receipt?.kind !== 'noteCommitReceipt' ||
    !slot?.bound ||
    slot.contextClaimed ||
    slot.unknownCleanup ||
    slot.data?.receipt !== receipt
  )
    throw new Error('After revision IO unavailable');
  slot.contextClaimed = true;
  const bound = slot.bound;
  let retired = false,
    usedSource = false,
    requests = 0,
    pending: Promise<unknown> | undefined;
  let unknown = false,
    release: Promise<void> | undefined;
  const current = () =>
    !retired &&
    !dispatch.retired &&
    slot.bound === bound &&
    slot.data?.receipt === receipt &&
    saveObserverCurrent(slot) &&
    !retired;
  const reader = new NotePageReader(async (method, params) => {
    const page = params.page as import('../note-pages').NotePageRequest;
    if (
      method !== 'note.get' ||
      params.workspaceId !== receipt.scope.workspaceId ||
      params.noteId !== receipt.scope.noteId ||
      page.maxWireBytes !== 8192 ||
      page.maxItems !== 64
    )
      throw new Error('After revision request mismatch');
    let command: Parameters<NoteSaveConnection['request']>[0];
    if (page.kind === 'source') {
      if (
        usedSource ||
        page.at !== 0 ||
        page.maxSourceBytes !== 4096 ||
        page.snapshotId ||
        page.cursor ||
        page.sourceRevision !== receipt.afterRevision ||
        page.noteInstanceId !== receipt.scope.noteInstanceId
      )
        throw new Error('After revision source unavailable');
      usedSource = true;
      command = { kind: 'source' };
    } else if (page.kind === 'context' && usedSource) {
      command = {
        kind: 'context',
        contextRef: page.contextRef,
        ...(page.cursor ? { cursor: page.cursor } : {}),
      };
    } else throw new Error('After revision request unsupported');
    if (++requests > 96 || !current()) throw new Error('After revision IO lost');
    let entered = false,
      settled = false;
    try {
      entered = true;
      const result = await bound.request(command);
      settled = true;
      if (result.settlement.status === 'rejected') {
        const error = new Error(result.settlement.error.message);
        Object.assign(error, { code: result.settlement.error.rpcCode });
        throw error;
      }
      const data = copyObservedData(result.settlement.value, 8192);
      if (!result.current || !current()) throw new Error('After revision result retired');
      return data;
    } catch (error) {
      // Only a returned settlement envelope proves this request finished. A
      // rejected IPC Promise stays unknown even if its Error carries a numeric code.
      if (entered && !settled) unknown = true;
      throw error;
    }
  });
  return Object.freeze({
    captureCurrent() {
      if (!current()) return undefined;
      const check = bound.captureCurrent();
      return () =>
        !retired &&
        !dispatch.retired &&
        slot.bound === bound &&
        slot.data?.receipt === receipt &&
        !slot.retired &&
        check?.() === true;
    },
    read(page: import('../note-pages').NotePageRequest) {
      if (retired || slot.busy || pending)
        return Promise.reject(new Error('After revision IO busy'));
      slot.busy = true;
      let yes!: (v: import('../note-pages').NoteReadPage) => void, no!: (e: unknown) => void;
      const work = new Promise<import('../note-pages').NoteReadPage>((a, b) => {
        yes = a;
        no = b;
      });
      pending = slot.pending = work;
      void (async () => {
        try {
          if (!current()) throw new Error('After revision IO lost');
          const value = await reader.read(receipt.scope.workspaceId, receipt.scope.noteId, page);
          if (!current()) throw new Error('After revision decode retired');
          yes(value);
        } catch (error) {
          retired = true;
          no(error);
        } finally {
          slot.busy = false;
          if (slot.pending === work) slot.pending = undefined;
          pending = undefined;
        }
      })();
      return work;
    },
    release() {
      if (release) return release;
      retired = true;
      release = (async () => {
        try {
          await pending;
        } catch {
          /* Primary failure is retained by caller. */
        }
        if (unknown) throw new Error('After revision IO settlement unknown');
      })();
      return release;
    },
  });
}
