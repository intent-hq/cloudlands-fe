import { v4 as uuid } from 'uuid';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { NoteSplice } from '$lib/client/note-pages';
import type { NoteTransactionOwner } from '../note-transaction-relay';
import { createNoteResourceOwner } from '../note-resource-owner';
import { noteDocumentCoordinates } from './note-document-coordinates';
import type { NoteEditAuthority } from './note-edit-authority';
import type { NoteDocumentSession } from './note-document-edit-session';
import {
  noteLocalPointLimits,
  prepareLocalPointInsertion,
  replayLocalPoint,
  validateLocalPoint,
  validateLocalPointOutput,
  type NoteLocalPointInput,
} from './note-local-point-history';
import {
  prepareNoteLocalPointSession,
  moveNoteLocalPointSession,
} from './note-local-point-session';

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
}
function fail(): never {
  throw new Error('Unsupported local point owner');
}

/** Explicit producer-only owner. Its runtime proof stays with the local group,
 * never Redux, the native undo plugin, a receipt or an ordinary text authority. */
export function createNoteLocalPointOwner(options: Options): NoteTransactionOwner & {
  retain(): () => void;
  dispose(): void;
} {
  const { read, publish, admit, resources } = options;
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
    pending = undefined;
    finalized = undefined;
    native = undefined;
    endpoint = undefined;
    endpointOutput = undefined;
    planned = undefined;
    context = undefined;
    if (p && p !== a) close(p);
    if (a) close(a);
  };
  const rawCurrent = () => {
    if (retired || !native || !context) return false;
    try {
      const valid = context.current();
      const time = now();
      const owner = accepted?.owner ?? pending?.allocation.owner ?? preparingOwner;
      const granted = !owner || !!resources.read().owners[owner];
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
  const current = () => {
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
    return finalCurrent(output, candidate);
  };
  const historyEligible = (key: object) => {
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
    return {
      initial: p.candidate,
      selection: p.state.selection,
      current: () => historyEligible(key),
      adopted: () =>
        !!planned && planned.key === key && planned.published && read() === committed && current(),
      commit() {
        if (!historyEligible(key)) fail();
        const plan = planned!;
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
      },
    };
  };
  return {
    get initial() {
      if (!current() || !endpoint) return fail();
      return endpoint;
    },
    current,
    prepare(transaction, before) {
      if (preparingOwner) return undefined;
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
            const drop = context.retain();
            let dropped = false;
            dropContext = () => {
              if (!dropped) {
                dropped = true;
                drop();
              }
            };
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
    retain() {
      if (!accepted || !current()) return fail();
      borrowers++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (--borrowers === 0) {
          const release = releaseDeferred;
          releaseDeferred = undefined;
          release?.();
        }
      };
    },
    dispose,
  };
}
