import {
  createNoteLocalPointUpload,
  pointUploadCost,
  pointUploadControlCost,
} from './note-local-point-staged-save';
import { retainLiveNoteSaveLoss } from '$lib/client/live/live-note-pages-client';
import { v4 as uuid } from 'uuid';
import type { EditorView } from '@tiptap/pm/view';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { NoteSplice } from '$lib/client/note-pages';
import type { NoteTransactionOwner } from '../note-transaction-relay';
import { createNoteResourceOwner } from '../note-resource-owner';
import { noteDocumentCoordinates } from './note-document-coordinates';
import type { NoteEditAuthority } from './note-edit-authority';
import type { NoteDocumentSession } from './note-document-edit-session';
import {
  noteLocalPointLimits,
  captureLocalPointBase,
  prepareLocalPointInsertion,
  replayLocalPoint,
  validateLocalPoint,
  validateLocalPointOutput,
  validateLocalPointMountedOutput,
  type NoteLocalPointInput,
  captureLocalPointSaveEvidence,
  currentLocalPointSaveEvidence,
  releaseLocalPointSaveEvidence,
} from './note-local-point-history';
import {
  prepareNoteLocalPointSession,
  moveNoteLocalPointSession,
} from './note-local-point-session';
import {
  createNoteLocalPointSaveSponsor,
  pointSponsorCost,
  type NoteLocalPointSponsorCapture,
  type PointSaveSponsor,
  type PointSponsorObservation,
} from './note-local-point-save-sponsor';

const sponsorIssuers = new WeakMap<object, () => NoteLocalPointSponsorCapture>();
/** Private owner identity is mandatory; a copied owner/group/recipe cannot issue. */
export function takeNoteLocalPointSponsorCapture(owner: unknown): NoteLocalPointSponsorCapture {
  const issue = owner && typeof owner === 'object' ? sponsorIssuers.get(owner) : undefined;
  return issue ? issue() : fail();
}

type UploadTicket = ReturnType<ReturnType<typeof createNoteResourceOwner>['reservation']>;
export interface PointUploadOwnerCapture {
  sponsor: PointSaveSponsor;
  upload: UploadTicket;
  control: UploadTicket;
  controlOwner: string;
  controlResource: string;
  uploadOwner: string;
  uploadResource: string;
  releaseFence(): void;
}
const uploadCaptures = new WeakSet<object>();
export function consumePointUploadOwnerCapture(value: PointUploadOwnerCapture): boolean {
  return uploadCaptures.delete(value);
}
const uploadIssuers = new WeakMap<object, () => PointUploadOwnerCapture>();
export function takeNoteLocalPointUploadOwner(owner: unknown): PointUploadOwnerCapture {
  const issue = owner && typeof owner === 'object' ? uploadIssuers.get(owner) : undefined;
  return issue ? issue() : fail();
}

type Candidate = NoteTransactionOwner['initial'];
interface Options {
  base: NoteEditAuthority;
  initialState: EditorState;
  identity: NoteLocalPointInput['identity'];
  read(): NoteDocumentSession | undefined;
  publish(before: NoteDocumentSession, after: NoteDocumentSession, splices: NoteSplice[]): void;
  admit(before: NoteDocumentSession, after: NoteDocumentSession, splices: NoteSplice[]): boolean;
  resources: Parameters<typeof createNoteResourceOwner>[0];
  /** Genuine prepared edit-context lifetime, independent of the mounted view. */
  context: { current(): boolean; retain(): () => void };
  now?: () => number;
  retainInitial?: boolean;
  sponsorObservation?: PointSponsorObservation;
}
function fail(): never {
  throw new Error('Unsupported local point owner');
}

/** Explicit producer-only owner. Its runtime proof stays with the local group,
 * never Redux, the native undo plugin, a receipt or an ordinary text authority. */
export function createNoteLocalPointOwner(options: Options): NoteTransactionOwner & {
  releaseInitial(): void;
  retain(): () => void;
  retainPrepared(candidate: Candidate, transaction: Transaction): () => void;
  dispose(): void;
  saveSponsor(): PointSaveSponsor;
  prepareUpload(): ReturnType<typeof createNoteLocalPointUpload>;
} {
  const { read, publish, admit, resources } = options;
  const retainedInitial = options.retainInitial === true;
  let context: Options['context'] | undefined = options.context;
  const now = options.now ?? Date.now;
  const original = read();
  if (
    !original ||
    original.history.length ||
    original.replay.length ||
    original.dirty.length ||
    original.cursor ||
    original.length !== original.baseLength
  )
    fail();
  const origin = original;
  let committed = origin;
  let native:
    { base: NoteEditAuthority; state: EditorState; identity: Options['identity'] } | undefined = {
    base: options.base,
    state: options.initialState,
    identity: Object.freeze({ ...options.identity }),
  };
  let endpoint: Candidate | undefined = {
    doc: options.base.doc,
    projection: options.base,
    coordinates: noteDocumentCoordinates(origin, options.base),
  };
  const deadline = Date.parse(options.identity.expiresAt);
  const pins: Array<{ object: object; key: string; value: unknown }> = [];
  const pin = (object: object, keys: readonly string[]) => {
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (!descriptor || !('value' in descriptor)) fail();
      pins.push({ object, key, value: descriptor.value });
    }
  };
  pin(origin, [
    'scope',
    'baseRevision',
    'baseLength',
    'length',
    'generation',
    'selection',
    'history',
    'cursor',
    'dirty',
    'replay',
    'limits',
  ]);
  pin(origin.scope, ['backendId', 'workspaceId', 'noteId', 'noteInstanceId']);
  pin(origin.selection, ['anchor', 'head', 'anchorAffinity', 'headAffinity']);
  pin(origin.limits, [
    'historyEntries',
    'retainedBytes',
    'splices',
    'transactionSteps',
    'windowBytes',
  ]);
  for (const array of [origin.history, origin.dirty, origin.replay]) pin(array, ['length']);
  const originalCurrent = () =>
    pins.every(({ object, key, value }) => {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      return !!descriptor && 'value' in descriptor && descriptor.value === value;
    });
  const allocator = createNoteResourceOwner(resources);
  const initialOwner = `local-point-base:${uuid()}`;
  const initialTicket = allocator.reservation(initialOwner, {
    payloadBytes: 8 * noteLocalPointLimits.recipeBytes,
    stringUnits: 8 * noteLocalPointLimits.recipeBytes,
    objectNodes: 8 * (noteLocalPointLimits.mappingEntries + noteLocalPointLimits.nativeNodes),
    domNodes: 0,
    physicalReads: 0,
    assemblies: 1,
  });
  let initialGuard: ReturnType<typeof captureLocalPointBase> | undefined;
  let initialPhysical = retainedInitial;
  let initialDrop: (() => void) | undefined;
  let initialConstructing = true;
  const dropInitial = () => {
    if (!retainedInitial || initialConstructing || initialPhysical || borrowers) return;
    initialDrop?.();
    initialDrop = undefined;
    initialTicket.release();
  };
  type Allocation = {
    owner: string;
    ticket: ReturnType<typeof allocator.reservation>;
    capture: ReturnType<typeof prepareLocalPointInsertion>;
    dropContext: () => void;
  };
  type Prepared = {
    allocation: Allocation;
    transaction: Transaction;
    state: NoteDocumentSession;
    splices: NoteSplice[];
    candidate: Candidate;
    output: ReturnType<typeof replayLocalPoint>;
  };
  let pending: Prepared | undefined, accepted: Allocation | undefined;
  let acceptedRoot: Transaction | undefined;
  let sponsorTaken = false,
    uploadTaken = false,
    saveLocked = false,
    nativeWork = 0;
  let saveState: EditorState | undefined;
  let saveDocView: unknown;
  let saveView: { view: EditorView; idle(): boolean } | undefined;
  let endpointOutput: ReturnType<typeof replayLocalPoint> | undefined;
  type HistoryPlan = {
    key: object;
    before: NoteDocumentSession;
    state: NoteDocumentSession;
    splices: NoteSplice[];
    output: ReturnType<typeof replayLocalPoint>;
    candidate: Candidate;
    published: boolean;
  };
  let planned: HistoryPlan | undefined;
  let retired = false,
    borrowers = 0,
    finalized: Candidate | undefined;
  let preparingOwner: string | undefined;
  let releaseDeferred: (() => void) | undefined;
  const close = (allocation: Allocation) => {
    allocation.capture.proof.release();
    const release = () => {
      allocation.dropContext();
      allocation.ticket.release();
    };
    if (borrowers) releaseDeferred = release;
    else release();
  };
  const dispose = () => {
    if (retired) return;
    retired = true;
    const a = accepted,
      p = pending?.allocation;
    accepted = undefined;
    acceptedRoot = undefined;
    pending = undefined;
    saveView = undefined;
    saveState = undefined;
    saveDocView = undefined;
    finalized = undefined;
    initialGuard?.release();
    initialGuard = undefined;
    native = undefined;
    endpoint = undefined;
    endpointOutput = undefined;
    planned = undefined;
    context = undefined;
    if (p && p !== a) close(p);
    if (a) close(a);
    dropInitial();
  };
  const rawCurrent = () => {
    if (retired || !native || !context) return false;
    try {
      const valid = context.current();
      const time = now();
      const owner = accepted?.owner ?? pending?.allocation.owner ?? preparingOwner;
      const ledger = resources.read();
      const granted =
        (!retainedInitial || !!ledger.owners[initialOwner]) && (!owner || !!ledger.owners[owner]);
      const latest = read();
      if (
        !valid ||
        !Number.isFinite(deadline) ||
        time >= deadline ||
        latest !== committed ||
        !originalCurrent() ||
        !granted
      ) {
        dispose();
        return false;
      }
      return true;
    } catch {
      dispose();
      return false;
    }
  };
  const finalCurrent = (
    output: ReturnType<typeof replayLocalPoint> | undefined,
    candidate: Candidate | undefined,
  ) => {
    // All context/resource/clock callbacks have already run. The final session
    // read precedes only own-data checks and the trusted pure native credential.
    try {
      const latest = read();
      if (
        retired ||
        latest !== committed ||
        !originalCurrent() ||
        (retainedInitial && !initialGuard?.current()) ||
        (output && (!candidate || !validateLocalPointOutput(output, candidate)))
      ) {
        dispose();
        return false;
      }
      return true;
    } catch {
      dispose();
      return false;
    }
  };
  const nativeSaveCurrent = () => {
    if (!saveLocked || retired || nativeWork || !saveView || !saveState) return false;
    const state = Object.getOwnPropertyDescriptor(saveView.view, 'state');
    const docView = Object.getOwnPropertyDescriptor(saveView.view, 'docView');
    return (
      !!state &&
      'value' in state &&
      state.value === saveState &&
      !!docView &&
      'value' in docView &&
      !!saveDocView &&
      docView.value === saveDocView
    );
  };
  const current = () => {
    if (
      saveLocked &&
      (!saveView ||
        nativeWork ||
        saveView.view.isDestroyed ||
        saveView.view.state !== saveState ||
        !saveView.idle())
    )
      return false;
    if (!rawCurrent()) return false;
    const capture = accepted?.capture ?? pending?.allocation.capture;
    if (capture && !validateLocalPoint(capture.proof, capture.recipe, origin)) {
      dispose();
      return false;
    }
    const output = pending?.output ?? endpointOutput,
      candidate = pending?.candidate ?? endpoint;
    if (output && !output.current()) {
      dispose();
      return false;
    }
    const valid = finalCurrent(output, candidate);
    if (saveLocked && !nativeSaveCurrent()) {
      dispose();
      return false;
    }
    return valid;
  };
  const historyEligible = (key: object) => {
    if (saveLocked) return false;
    const p = planned;
    if (
      !p ||
      p.key !== key ||
      p.published ||
      committed !== p.before ||
      !admit(p.before, p.state, p.splices) ||
      !current()
    )
      return false;
    if (
      !p.output.current() ||
      !finalCurrent(p.output, p.candidate) ||
      planned !== p ||
      p.published ||
      committed !== p.before
    ) {
      dispose();
      return false;
    }
    return true;
  };
  const historyResult = (key: object) => {
    const p = planned;
    if (!p || p.key !== key) return fail();
    const commit = (view?: EditorView, state?: EditorState) => {
      const selection = state?.selection;
      const plugins = state?.plugins.slice();
      const anchor =
        state &&
        p.candidate.projection.pmAt(p.state.selection.anchor, p.state.selection.anchorAffinity);
      const head =
        state &&
        p.candidate.projection.pmAt(p.state.selection.head, p.state.selection.headAffinity);
      if (!historyEligible(key)) fail();
      const plan = planned!;
      // No owner, clock, admission or schema callbacks after this installed-state
      // fence. The private credential proves the exact endpoint, not the view argument.
      if (
        view &&
        (!state ||
          view.isDestroyed ||
          view.state !== state ||
          state.doc !== plan.candidate.doc ||
          state.schema !== plan.candidate.doc.type.schema ||
          state.selection !== selection ||
          selection?.anchor !== anchor ||
          selection?.head !== head ||
          selection.$anchor.doc !== state.doc ||
          selection.$head.doc !== state.doc ||
          !plugins ||
          state.plugins.length !== plugins.length ||
          state.plugins.some((plugin, i) => plugin !== plugins[i]))
      )
        fail();
      if (!validateLocalPointOutput(plan.output, plan.candidate)) fail();
      publish(plan.before, plan.state, plan.splices);
      if (read() !== plan.state || !validateLocalPointOutput(plan.output, plan.candidate)) {
        dispose();
        fail();
      }
      const old = endpointOutput;
      committed = plan.state;
      endpoint = plan.candidate;
      endpointOutput = plan.output;
      plan.published = true;
      old?.release();
    };
    return {
      initial: p.candidate,
      selection: p.state.selection,
      nativeOutput: p.output,
      abandon() {
        if (planned?.key !== key || planned.published) return;
        planned.output.release();
        planned = undefined;
      },
      current: () => historyEligible(key),
      adopted: () =>
        !!planned && planned.key === key && planned.published && read() === committed && current(),
      commit: () => commit(),
      commitNative: (view: EditorView, state: EditorState) => commit(view, state),
    };
  };
  const borrowNative = () => {
    borrowers++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--borrowers === 0) {
        const release = releaseDeferred;
        releaseDeferred = undefined;
        release?.();
        if (retired) dropInitial();
      }
    };
  };
  if (retainedInitial)
    try {
      const granted = initialTicket.construct(
        () => {
          if (!context) fail();
          initialDrop = context.retain();
          if (!context.current() || read() !== origin || retired) fail();
          initialGuard = captureLocalPointBase(options.base);
          if (!current()) fail();
          return {};
        },
        () => {
          initialGuard?.release();
          initialGuard = undefined;
          initialDrop?.();
          initialDrop = undefined;
        },
      );
      if (!granted) {
        initialPhysical = false;
        initialTicket.release();
        fail();
      }
    } catch (error) {
      initialPhysical = false;
      throw error;
    } finally {
      initialConstructing = false;
    }
  const api: NoteTransactionOwner & {
    releaseInitial(): void;
    retain(): () => void;
    retainPrepared(candidate: Candidate, transaction: Transaction): () => void;
    dispose(): void;
    saveSponsor(): PointSaveSponsor;
    prepareUpload(): ReturnType<typeof createNoteLocalPointUpload>;
  } = {
    saveSponsor: () => createNoteLocalPointSaveSponsor(api),
    prepareUpload: () => createNoteLocalPointUpload(api),
    saveAdmission: {
      bind(view, idle) {
        if (saveLocked || nativeWork) return fail();
        saveView = { view, idle };
      },
      enter() {
        nativeWork++;
        let done = false;
        return () => {
          if (!done) {
            done = true;
            nativeWork--;
          }
        };
      },
      permits(state) {
        return !saveLocked || state === saveState;
      },
      permitsSelection(selection) {
        return (
          !saveLocked ||
          (['anchor', 'head', 'anchorAffinity', 'headAffinity'] as const).every(
            (key) => selection[key] === committed.selection[key],
          )
        );
      },
      mutable: () => !saveLocked,
    },
    releaseInitial() {
      if (!initialPhysical) return;
      initialPhysical = false;
      if (retired) dropInitial();
    },
    get initial() {
      if (!current() || !endpoint) return fail();
      return endpoint;
    },
    current,
    retainedEndpoint() {
      if (!accepted || !endpoint || !endpointOutput || !current()) return undefined;
      return Object.freeze({
        initial: endpoint,
        selection: committed.selection,
        nativeOutput: endpointOutput,
      });
    },
    prepare(transaction, before) {
      if (saveLocked) return undefined;
      if (preparingOwner || borrowers || releaseDeferred) return undefined;
      if (
        !current() ||
        !native ||
        accepted ||
        pending ||
        committed !== origin ||
        !before.doc.eq(native.base.doc) ||
        !transaction.before.eq(before.doc)
      )
        return undefined;
      const owner = `local-point:${uuid()}`;
      // Simultaneous original/caller native graphs, typed steps/maps, projections,
      // immutable recipe/group and traversal scratch. Logical DATA allowance only.
      const ticket = allocator.reservation(owner, {
        payloadBytes: 16 * noteLocalPointLimits.recipeBytes,
        stringUnits: 16 * noteLocalPointLimits.recipeBytes,
        objectNodes: 8 * (noteLocalPointLimits.mappingEntries + noteLocalPointLimits.nativeNodes),
        domNodes: 0,
        physicalReads: 0,
        assemblies: 1,
      });
      let capture: Allocation['capture'] | undefined;
      let dropContext: (() => void) | undefined;
      try {
        preparingOwner = owner;
        const token = ticket.construct(
          () => {
            if (!context) fail();
            // The initial guard already owns the second and final context borrow.
            // It remains held until both initial physical use and point borrowers
            // settle; point capture shares that exact lifetime, never a third borrow.
            if (retainedInitial) {
              if (!initialDrop) fail();
              dropContext = () => {};
            } else {
              const drop = context.retain();
              let dropped = false;
              dropContext = () => {
                if (!dropped) {
                  dropped = true;
                  drop();
                }
              };
            }
            if (!rawCurrent() || !native) fail();
            capture = prepareLocalPointInsertion({
              origin,
              base: native.base,
              beforeState: native.state,
              candidateTransaction: transaction,
              selection: origin.selection,
              identity: native.identity,
              admission: { allowance: noteLocalPointLimits, current: rawCurrent },
              now,
            });
            return {};
          },
          () => {
            capture?.proof.release();
            dropContext?.();
          },
        );
        if (!token || !capture || !dropContext || !native) {
          ticket.release();
          return undefined;
        }
        const allocation = { owner, ticket, capture, dropContext };
        const result = prepareNoteLocalPointSession(origin, capture.recipe, capture.proof);
        const endpoint = replayLocalPoint(capture.proof, capture.recipe, 'redo', {
          origin,
          doc: native.base.doc,
          source: native.base.source,
          scope: origin.scope,
          sourceRevision: origin.baseRevision,
          snapshotId: native.identity.snapshotId,
          generation: origin.generation,
        });
        const candidate = {
          doc: endpoint.doc,
          projection: endpoint.projection,
          coordinates: noteDocumentCoordinates(result.state, endpoint.projection),
        };
        pending = {
          allocation,
          transaction,
          state: result.state,
          splices: result.splices,
          candidate,
          output: endpoint,
        };
        if (!admit(origin, result.state, result.splices) || !current()) return undefined;
        return candidate;
      } catch (error) {
        if (!pending) {
          capture?.proof.release();
          dropContext?.();
          ticket.release();
        }
        throw error;
      } finally {
        preparingOwner = undefined;
      }
    },
    nativeOutput(candidate, transaction) {
      const p = pending;
      return p && p.candidate === candidate && p.transaction === transaction && current()
        ? p.output
        : undefined;
    },
    finalize(candidate, selection, transactions) {
      const p = pending;
      if (
        !p ||
        p.candidate !== candidate ||
        transactions.length !== 1 ||
        transactions[0] !== p.transaction ||
        !selection.eq(p.transaction.selection) ||
        !admit(origin, p.state, p.splices) ||
        !current()
      )
        return undefined;
      finalized = candidate;
      return candidate;
    },
    commit({ after }) {
      const p = pending;
      if (!p || after !== finalized || after !== p.candidate || !current()) fail();
      publish(origin, p.state, p.splices);
      if (read() !== p.state || !validateLocalPointOutput(p.output, p.candidate, p.transaction)) {
        dispose();
        fail();
      }
      committed = p.state;
      endpoint = p.candidate;
      endpointOutput = p.output;
      accepted = p.allocation;
      acceptedRoot = p.transaction;
      pending = undefined;
      finalized = undefined;
    },
    settled() {
      const p = pending;
      pending = undefined;
      finalized = undefined;
      if (p) close(p.allocation);
    },
    history(direction) {
      if (saveLocked) return undefined;
      if (!current() || !accepted || !native || !endpoint) return undefined;
      if (planned && !planned.published) planned.output.release();
      planned = undefined;
      const before = committed;
      const a = accepted;
      const result = moveNoteLocalPointSession(
        before,
        origin,
        a.capture.recipe,
        a.capture.proof,
        direction,
      );
      // The endpoint retained by the accepted candidate is updated only after
      // synchronous source publication acknowledgement.
      const nextEndpoint = replayLocalPoint(a.capture.proof, a.capture.recipe, direction, {
        origin,
        doc: endpoint.doc,
        source: endpoint.projection.source,
        scope: origin.scope,
        sourceRevision: origin.baseRevision,
        snapshotId: native.identity.snapshotId,
        generation: before.generation,
      });
      const key = {};
      planned = {
        key,
        before,
        state: result.state,
        splices: result.splices,
        output: nextEndpoint,
        candidate: {
          doc: nextEndpoint.doc,
          projection: nextEndpoint.projection,
          coordinates: noteDocumentCoordinates(result.state, nextEndpoint.projection),
        },
        published: false,
      };
      return historyResult(key);
    },
    retainPrepared(candidate, transaction) {
      const p = pending;
      if (
        !p ||
        p.candidate !== candidate ||
        p.transaction !== transaction ||
        !current() ||
        pending !== p
      )
        return fail();
      return borrowNative();
    },
    retain() {
      if (!accepted || !current()) return fail();
      return borrowNative();
    },
    dispose,
  };
  uploadIssuers.set(api, () => {
    if (uploadTaken || sponsorTaken || saveLocked || nativeWork || pending || planned || !saveView)
      return fail();
    uploadTaken = true;
    const binding = saveView;
    // Busy state is checked again after the callbackful current/idle reads.
    if (
      !binding.idle() ||
      !current() ||
      nativeWork ||
      pending ||
      planned ||
      saveView !== binding ||
      binding.view.isDestroyed ||
      !endpoint ||
      !validateLocalPointMountedOutput(endpointOutput, endpoint, binding.view.state.doc)
    )
      return fail();
    saveLocked = true;
    saveState = binding.view.state;
    saveDocView = Object.getOwnPropertyDescriptor(binding.view, 'docView')?.value;
    const uploadOwner = `point-upload:${uuid()}`,
      controlOwner = `point-pending:${uuid()}`;
    const upload = allocator.reservation(uploadOwner, pointUploadCost);
    const control = allocator.reservation(controlOwner, pointUploadControlCost);
    try {
      // These two provisional products are empty DATA, with no IO/native product yet.
      if (
        !upload.construct(
          () => ({}),
          () => {},
        ) ||
        !control.construct(
          () => ({}),
          () => {},
        )
      )
        return fail(); // The single catch below owns both cleanup attempts.
      const uploadResource = resources.read().owners[uploadOwner]?.[0];
      const controlResource = resources.read().owners[controlOwner]?.[0];
      if (
        !uploadResource ||
        !controlResource ||
        nativeWork ||
        !binding.idle() ||
        saveView !== binding ||
        binding.view.state !== saveState ||
        !current()
      )
        return fail();
      const sponsor = createNoteLocalPointSaveSponsor(api);
      const value = {
        sponsor,
        upload,
        control,
        controlOwner,
        controlResource,
        uploadOwner,
        uploadResource,
        releaseFence() {
          saveLocked = false;
          saveState = undefined;
        },
      };
      Object.freeze(value);
      uploadCaptures.add(value);
      return value;
    } catch (error) {
      // A subscriber may throw after installing a reservation. Both tickets own
      // only empty provisional DATA; a failed release remains charged by its owner.
      const errors: unknown[] = [];
      for (const ticket of [upload, control]) {
        try {
          ticket.release();
        } catch (cleanup) {
          errors.push(cleanup);
        }
      }
      if (errors.length)
        throw new AggregateError([error, ...errors], 'Upload admission cleanup unknown');
      saveLocked = false;
      saveState = undefined;
      saveDocView = undefined;
      throw error;
    }
  });
  sponsorIssuers.set(api, () => {
    if (sponsorTaken) return fail();
    sponsorTaken = true; // Consume before resource/context/read callbacks.
    if (!accepted || retired) return fail();
    // Pure existing-allocation borrow precedes callbackful subscription. If its
    // cleanup is unknown this charged allocation cannot be released/reissued.
    const dropBorrow = borrowNative();
    const loss = retainLiveNoteSaveLoss();
    try {
      const observation = options.sponsorObservation;
      if (
        !loss.current() ||
        !observation ||
        !accepted ||
        !acceptedRoot ||
        !endpointOutput ||
        !current() ||
        committed.history.length !== 1 ||
        committed.cursor !== 1 ||
        committed.generation !== committed.history[0].id ||
        committed.length !== 59
      ) {
        // Unknown subscription disposal remains a bounded control debt; do not
        // mint a sponsor or a fresh capture when it cannot be established.
        loss.release();
        dropBorrow();
        return fail();
      }
      const a = accepted,
        root = acceptedRoot,
        output = endpointOutput,
        document = committed;
      const owner = `point-sponsor:${uuid()}`;
      const ticket = allocator.reservation(owner, pointSponsorCost);
      let evidence: ReturnType<typeof captureLocalPointSaveEvidence> | undefined;
      const capture = ticket.construct(
        () => {
          if (!current() || accepted !== a || acceptedRoot !== root || committed !== document)
            fail();
          const note =
            observation.read().byWorkspaceId[document.scope.workspaceId]?.notes[
              document.scope.noteId
            ];
          if (!note || note.document !== document || !current()) fail();
          evidence = captureLocalPointSaveEvidence(
            a.capture.proof,
            a.capture.recipe,
            origin,
            root,
            document,
            output,
          );
          if (
            !current() ||
            accepted !== a ||
            committed !== document ||
            observation.read().byWorkspaceId[document.scope.workspaceId]?.notes[
              document.scope.noteId
            ] !== note ||
            !loss.current() ||
            !currentLocalPointSaveEvidence(evidence, now()) ||
            !loss.current()
          )
            fail();
          return {
            document,
            recipe: a.capture.recipe,
            evidence,
            observation,
            note,
            resources,
            owner,
            ticket,
            loss,
            precommitCurrent: current,
            nativeSaveCurrent,
            now,
            dropBorrow,
          };
        },
        () => {
          if (evidence) releaseLocalPointSaveEvidence(evidence);
          loss.release();
          dropBorrow(); // Unknown cleanup retains original and sponsor tickets.
        },
      );
      if (!capture) {
        loss.release();
        ticket.release();
        return fail();
      }
      return capture;
    } catch (error) {
      // Attempt known disposal; a failed loss lease keeps the original borrow.
      try {
        loss.release();
        dropBorrow();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], 'Sponsor capture cleanup unknown');
      }
      throw error;
    }
  });
  return api;
}
