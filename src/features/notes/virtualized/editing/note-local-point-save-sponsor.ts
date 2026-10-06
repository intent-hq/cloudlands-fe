import { pointUploadCost, pointUploadControlCost } from './note-local-point-staged-save';
import { v4 as uuid } from 'uuid';
import type {
  NotePagesState,
  NotePageSession,
  NoteLocalPointSaveRecord,
} from '$store/renderer/slices/note-pages/note-pages-types';
import type { NoteDocumentSession } from './note-document-edit-session';
import type { NoteStagedSaveInput } from '$lib/client/note-source-operation';
import { stageTextDigest } from '$lib/client/note-source-operation';
import { sameNoteScope, type NoteCommitReceipt } from '$lib/client/note-pages';
import {
  claimLiveNoteStagedSave,
  liveNoteDispatchOutcome,
  type LiveNoteSaveDispatch,
  type LiveNoteSaveObserver,
  type LiveNoteSaveLoss,
} from '$lib/client/live/live-note-pages-client';
import type { NoteResourceLedger, NoteResourceCost } from '../note-resource-ledger';
import { createNoteResourceOwner } from '../note-resource-owner';
import {
  currentLocalPointSaveEvidence,
  releaseLocalPointSaveEvidence,
  type NoteLocalPointSaveEvidence,
  type NoteLocalPointRecipe,
} from './note-local-point-history';
import {
  takeNoteLocalPointSponsorCapture,
  consumePointUploadOwnerCapture,
  type PointUploadOwnerCapture,
} from './note-local-point-owner';
import { readLocalPointCanonicalReceipt } from './note-local-point-canonical-receipt';
import { beforeSourceDeadline, parseSourceDeadline } from '$shared/source-session-expiry';

export const pointSponsorCost = Object.freeze({
  payloadBytes: 1048576,
  stringUnits: 1048576,
  objectNodes: 327680,
  domNodes: 0,
  physicalReads: 0,
  assemblies: 1,
});
const certificateCost = Object.freeze({
  payloadBytes: 65536,
  stringUnits: 65536,
  objectNodes: 8192,
  domNodes: 0,
  physicalReads: 0,
  assemblies: 1,
});
// One serial status/receipt workspace, admitted before the first status request.
// Same allowance as reserveNoteReceiptTranscript(semanticUnits=262144); not a
// second transcript allocation. Status finishes before receipt traversal starts.
const receiptCost = Object.freeze({
  payloadBytes: 2199552,
  stringUnits: 2199552,
  objectNodes: 110592,
  domNodes: 0,
  physicalReads: 1,
  assemblies: 1,
});
type Resources = Parameters<typeof createNoteResourceOwner>[0];
type Ticket = ReturnType<ReturnType<typeof createNoteResourceOwner>['reservation']>;
export interface PointSponsorObservation {
  dispatch?(
    action: Parameters<
      typeof import('$store/renderer/slices/note-pages/note-pages-slice').notePagesReducer
    >[1],
  ): void;
  read(): NotePagesState;
  subscribe(listener: () => void): () => void;
  panel: string;
  signal?: AbortSignal;
}
/** Internal actual-owner capture. Only the owner's private registry issues one. */
export interface NoteLocalPointSponsorCapture {
  document: NoteDocumentSession;
  recipe: NoteLocalPointRecipe;
  evidence: NoteLocalPointSaveEvidence;
  observation: PointSponsorObservation;
  note: NotePageSession;
  resources: Resources;
  owner: string;
  ticket: Ticket;
  precommitCurrent(): boolean;
  nativeSaveCurrent(): boolean;
  now(): number;
  dropBorrow(): void;
  loss: LiveNoteSaveLoss;
}
const sponsorBrand = Symbol('point save sponsor'),
  certificateBrand = Symbol('point certificate');
interface PointCanonicalCertificate {
  readonly [certificateBrand]: true;
}
export interface PointSaveSponsor {
  readonly [sponsorBrand]: true;
  readonly input: NoteStagedSaveInput;
  precommitCurrent(): boolean;
  bindSealed(stage: unknown): Promise<void>;
  /** Intent-only quarantine; this is NOT evidence of a commit RPC invocation. */
  handoffForOutcomeObservation(): void;
  observeOutcome(): Promise<'pending' | 'unknown' | 'committed'>;
  certificate(): Promise<PointCanonicalCertificate>;
  release(): Promise<void>;
}
type Summary = Awaited<ReturnType<typeof readLocalPointCanonicalReceipt>>;
type Data = {
  capture: NoteLocalPointSponsorCapture;
  input: NoteStagedSaveInput;
  phase: 'captured' | 'bound' | 'handedOff' | 'receiptBound';
  quarantine?: { generation: number; state: NonNullable<NotePageSession['state']> };
  receipt?: NoteCommitReceipt;
  observer?: LiveNoteSaveObserver;
  upload?: {
    record?: NoteLocalPointSaveRecord;
    transition?: { before?: NoteLocalPointSaveRecord; after?: NoteLocalPointSaveRecord };
    receiptAwait: boolean;
  };
};
type SponsorSlot = {
  data?: Data;
  busy: boolean;
  revision: number;
  checking: boolean;
  checkGeneration: number;
  finalCheck?: (time: number) => boolean;
  allocations: Array<{ owner: string; id: string; cost: NoteResourceCost }>;
  certificateUsed: boolean;
  certificate?: object;
  off?: () => void;
  subscriptionUnknown: boolean;
  abortSignal?: AbortSignal;
  abort?: () => void;
  cleanup?: {
    capture: NoteLocalPointSponsorCapture;
    observer?: LiveNoteSaveObserver;
    certificate?: Ticket;
    transcript?: Ticket;
  };
  pending?: Promise<unknown>;
  release?: Promise<void>;
};
const sponsorSlots = new WeakMap<object, SponsorSlot>();
const certificates = new WeakMap<object, { slot: SponsorSlot; summary?: Summary }>();
function fail(): never {
  throw new Error('Local point save sponsor unavailable');
}
function retire(slot: SponsorSlot) {
  const d = slot.data;
  slot.data = undefined;
  slot.finalCheck = undefined;
  if (d) releaseLocalPointSaveEvidence(d.capture.evidence);
  if (slot.certificate) {
    const cert = certificates.get(slot.certificate);
    if (cert) cert.summary = undefined;
  }
}
function observeState(slot: SponsorSlot): boolean {
  const d = slot.data;
  if (!d) return false;
  try {
    const c = d.capture,
      scope = c.document.scope;
    const note = c.observation.read().byWorkspaceId[scope.workspaceId]?.notes[scope.noteId];
    if (
      slot.data !== d ||
      !note ||
      note.document !== c.document ||
      !Object.hasOwn(note.panels, c.observation.panel) ||
      c.observation.signal?.aborted ||
      note.status !== 'ready' ||
      !note.state ||
      note.state.deleted ||
      !sameNoteScope(note.state.scope, scope)
    )
      fail();
    if (d.upload) {
      const u = d.upload,
        t = u.transition;
      if (
        note.drafts !== c.note.drafts ||
        note.history !== c.note.history ||
        note.pending ||
        (t
          ? note.localPointSave !== t.before && note.localPointSave !== t.after
          : note.localPointSave !== u.record)
      )
        fail();
    }
    if (d.phase === 'captured' || d.phase === 'bound') {
      if (
        note.generation !== c.note.generation ||
        note.state !== c.note.state ||
        note.needsReconcile ||
        !c.precommitCurrent()
      )
        fail();
    } else if (d.quarantine) {
      if (
        note.generation !== d.quarantine.generation ||
        note.state !== d.quarantine.state ||
        !note.needsReconcile
      )
        fail();
    } else if (note.state !== c.note.state || note.generation !== c.note.generation) {
      if (
        note.generation === c.note.generation ||
        !note.needsReconcile ||
        note.state.sourceRevision === c.document.baseRevision
      )
        fail();
      d.quarantine = { generation: note.generation, state: note.state };
    }
    if (d.receipt && d.quarantine && d.quarantine.state.sourceRevision !== d.receipt.afterRevision)
      fail();
    return slot.data === d;
  } catch {
    retire(slot);
    return false;
  }
}
// Capture own DATA fields before callbacks, then compare without calling user code.
function own(value: object, key: PropertyKey): unknown {
  const d = Object.getOwnPropertyDescriptor(value, key);
  if (!d || !('value' in d)) fail();
  return d.value;
}
function pinFields(value: object): () => boolean {
  const keys = Reflect.ownKeys(value);
  if (keys.length > 64) fail();
  const fields = keys.map((key) => [key, own(value, key)] as const);
  const proto = Object.getPrototypeOf(value);
  return () =>
    Object.getPrototypeOf(value) === proto &&
    Reflect.ownKeys(value).length === fields.length &&
    fields.every(([key, v]) => own(value, key) === v);
}
function allocation(slot: SponsorSlot, owner: string, cost: NoteResourceCost) {
  const ledger = slot.data!.capture.resources.read();
  const ids = ledger.owners[owner];
  if (!ids || ids.length !== 1 || !ledger.resources[ids[0]]) fail();
  slot.allocations.push({ owner, id: ids[0], cost });
}
function checkAllocations(slot: SponsorSlot, ledger: NoteResourceLedger) {
  const owners = ledger.owners,
    resources = ledger.resources;
  const checks: Array<() => boolean> = [
    () => own(ledger, 'owners') === owners && own(ledger, 'resources') === resources,
  ];
  for (const { owner, id, cost } of slot.allocations) {
    const ids = own(ledger.owners, owner);
    const resource = own(ledger.resources, id);
    if (
      !Array.isArray(ids) ||
      ids.length !== 1 ||
      own(ids, '0') !== id ||
      !resource ||
      typeof resource !== 'object'
    )
      fail();
    const heldCost = own(resource, 'cost');
    if (
      !heldCost ||
      typeof heldCost !== 'object' ||
      !Object.entries(cost).every(([k, v]) => own(heldCost, k) === v)
    )
      fail();
    checks.push(
      () => own(owners, owner) === ids && own(resources, id) === resource,
      pinFields(ids),
      pinFields(resource),
      pinFields(heldCost),
    );
  }
  return () => checks.every((check) => check());
}
function current(slot: SponsorSlot) {
  const d = slot.data;
  if (!d || slot.checking) return false;
  slot.checking = true;
  const checkGeneration = ++slot.checkGeneration;
  slot.finalCheck = undefined;
  try {
    if (!d.capture.loss.current() || !observeState(slot)) fail();
    const ledger = d.capture.resources.read();
    const allocationCheck = checkAllocations(slot, ledger);
    const scope = d.capture.document.scope;
    const root = d.capture.observation.read();
    const workspaces = root.byWorkspaceId;
    const workspace = workspaces[scope.workspaceId];
    const notes = workspace?.notes;
    const note = notes?.[scope.noteId];
    if (!workspace || !notes) fail();
    const links: Array<readonly [object, PropertyKey, unknown]> = [
      [root, 'byWorkspaceId', workspaces],
      [workspaces, scope.workspaceId, workspace],
      [workspace, 'notes', notes],
      [notes, scope.noteId, note],
    ];
    if (!links.every(([object, key, value]) => own(object, key) === value)) fail();
    if (
      !note ||
      note.document !== d.capture.document ||
      !note.state ||
      note.status !== 'ready' ||
      note.state.deleted ||
      !Object.hasOwn(note.panels, d.capture.observation.panel)
    )
      fail();
    const receiptAwait = d.upload?.transition
      ? note.localPointSave === d.upload.transition.after && !!d.upload.transition.after?.receipt
      : d.upload?.receiptAwait;
    const generation = d.quarantine?.generation ?? d.capture.note.generation;
    const state = d.quarantine?.state ?? d.capture.note.state;
    if (
      note.generation !== generation ||
      note.state !== state ||
      (d.quarantine || receiptAwait ? !note.needsReconcile : note.needsReconcile)
    )
      fail();
    const pins = [note, note.state, note.state.scope, note.panels].map(pinFields);
    const revision = slot.revision,
      phase = d.phase;
    // Capture this exact invocation's pure finalizer before the last callback.
    // Reentry may not replace it with a newer valid snapshot.
    const finalCheck = (time: number) => {
      try {
        if (
          slot.data !== d ||
          slot.checkGeneration !== checkGeneration ||
          !d.capture.loss.current() ||
          slot.revision !== revision ||
          d.phase !== phase ||
          d.capture.observation.signal?.aborted ||
          !allocationCheck() ||
          !links.every(([object, key, value]) => own(object, key) === value) ||
          !pins.every((check) => check()) ||
          (d.receipt &&
            !beforeSourceDeadline(time, parseSourceDeadline(d.receipt.receiptExpiresAt))) ||
          !currentLocalPointSaveEvidence(d.capture.evidence, time)
        )
          fail();
        return true;
      } catch {
        retire(slot);
        return false;
      }
    };
    const time = d.capture.now();
    if (!finalCheck(time)) fail();
    slot.finalCheck = finalCheck;
    return true;
  } catch {
    retire(slot);
    return false;
  } finally {
    slot.checking = false;
  }
}
function serial<T>(slot: SponsorSlot, action: (data: Data) => Promise<T>): Promise<T> {
  if (slot.busy || !slot.data) return Promise.reject(new Error('Sponsor operation unavailable'));
  slot.busy = true;
  let resolve!: (v: T) => void, reject!: (error: unknown) => void;
  const pending = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  slot.pending = pending;
  void (async () => {
    try {
      if (!current(slot) || !slot.data) fail();
      const d = slot.data,
        value = await action(d);
      if (slot.data !== d || !current(slot)) fail();
      resolve(value);
    } catch (error) {
      retire(slot);
      reject(error);
    } finally {
      slot.busy = false;
      if (slot.pending === pending) slot.pending = undefined;
    }
  })();
  return pending;
}
const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
          .join(',')}}`
      : JSON.stringify(v);

function sponsorAPI(slot: SponsorSlot, input: NoteStagedSaveInput): PointSaveSponsor {
  const api: PointSaveSponsor = Object.freeze({
    [sponsorBrand]: true as const,
    input,
    precommitCurrent: () =>
      !!slot.data && ['captured', 'bound'].includes(slot.data.phase) && current(slot),
    bindSealed: (stage: unknown) =>
      serial(slot, async (d) => {
        if (d.phase !== 'captured' || d.observer) fail();
        const allocator = createNoteResourceOwner(d.capture.resources);
        const certOwner = `point-certificate:${uuid()}`,
          ioOwner = `point-receipt:${uuid()}`;
        const cert = allocator.reservation(certOwner, certificateCost);
        const io = allocator.reservation(ioOwner, receiptCost);
        slot.cleanup!.certificate = cert;
        slot.cleanup!.transcript = io;
        if (
          !cert.construct(
            () => ({}),
            () => {},
          ) ||
          !io.construct(
            () => ({}),
            () => {},
          ) ||
          !current(slot)
        )
          fail();
        allocation(slot, certOwner, certificateCost);
        allocation(slot, ioOwner, receiptCost);
        if (!current(slot)) fail();
        const observer = claimLiveNoteStagedSave(
          stage,
          d.capture.loss,
          () => current(slot),
          d.capture.now,
          () => {
            const check = slot.finalCheck;
            slot.finalCheck = undefined;
            return check;
          },
        );
        slot.cleanup!.observer = observer;
        d.observer = observer;
        const s = observer.identity,
          h = observer.header,
          expected = d.input;
        if (
          !sameNoteScope(s.scope, expected.scope) ||
          s.operationId !== expected.operationId ||
          s.expiresAt !== expected.expiresAt ||
          s.baseRevision !== expected.header.baseRevision ||
          s.viewLength !== 59 ||
          canonical(h) !== canonical(expected.header)
        )
          fail();
        const group = d.capture.document.history[0].id,
          textId = `group:${group}:0`,
          text = d.capture.recipe.forward[0].text;
        const digest = await stageTextDigest(text);
        if (!current(slot)) fail();
        const records = [
          [{ kind: 'text', id: textId, offset: 0, text }],
          [
            {
              kind: 'splice',
              localSequence: group,
              ordinal: 0,
              start: 1,
              end: 1,
              replacement: { textId, length: 57, utf8Bytes: 57, sha256: digest },
            },
          ],
        ];
        const manifest = [];
        for (const [i, stream] of ['text', 'dirty', 'selection', 'mutation', 'live'].entries()) {
          const lastDigest =
            i < 2
              ? await stageTextDigest(
                  canonical({ stream, sequence: 0, previousDigest: null, records: records[i] }),
                )
              : null;
          if (!current(slot)) fail();
          manifest.push({ stream, chunks: i < 2 ? 1 : 0, records: i < 2 ? 1 : 0, lastDigest });
        }
        if (canonical(s.manifest) !== canonical(manifest)) fail();
        d.phase = 'bound';
      }),
    handoffForOutcomeObservation() {
      const d = slot.data;
      if (slot.busy || !d || d.phase !== 'bound') return fail();
      slot.busy = true; // Before any observer/clock callbacks or nested async work.
      try {
        if (
          !current(slot) ||
          !beforeSourceDeadline(d.capture.now(), parseSourceDeadline(d.input.expiresAt)) ||
          !current(slot) ||
          slot.data !== d ||
          d.phase !== 'bound'
        )
          fail();
        d.phase = 'handedOff';
      } catch (error) {
        retire(slot);
        throw error;
      } finally {
        slot.busy = false;
      }
    },
    observeOutcome: () =>
      serial(slot, async (d) => {
        if (!['handedOff', 'receiptBound'].includes(d.phase) || !d.observer) fail();
        const result = await d.observer.observeOutcome();
        if (!current(slot)) fail();
        if (result.kind === 'noteCommitReceipt') {
          d.receipt = result;
          if (!d.capture.loss.current() || !observeState(slot)) fail();
          d.phase = 'receiptBound';
          return 'committed' as const;
        }
        if (result.outcome !== 'pending' && result.outcome !== 'unknown') fail();
        return result.outcome;
      }),
    certificate: () =>
      serial(slot, async (d) => {
        if (
          slot.certificateUsed ||
          d.phase !== 'receiptBound' ||
          !d.receipt ||
          !d.observer ||
          !d.quarantine ||
          d.quarantine.state.sourceRevision !== d.receipt.afterRevision
        )
          fail();
        slot.certificateUsed = true;
        const summary = await readLocalPointCanonicalReceipt(
          d.observer,
          {
            group: d.capture.document.history[0].id,
            literal: d.capture.recipe.insertion.point.literal,
          },
          () => current(slot),
        );
        if (!current(slot) || JSON.stringify(summary).length > 4096) fail();
        const credential = Object.freeze({ [certificateBrand]: true as const });
        certificates.set(credential, { slot, summary });
        slot.certificate = credential;
        return credential;
      }),
    release() {
      if (slot.release) return slot.release;
      retire(slot);
      let resolve!: () => void, reject!: (e: unknown) => void;
      slot.release = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      void (async () => {
        try {
          try {
            await slot.pending;
          } catch {
            /* Observer retains unknown transport debt below. */
          }
          const cleanup = slot.cleanup;
          if (cleanup) {
            const errors: unknown[] = [];
            try {
              await cleanup.observer?.release();
            } catch (error) {
              errors.push(error);
            }
            try {
              slot.off?.();
              slot.off = undefined;
            } catch (error) {
              errors.push(error);
            }
            try {
              if (slot.abort) slot.abortSignal?.removeEventListener('abort', slot.abort);
              slot.abort = undefined;
              slot.abortSignal = undefined;
            } catch (error) {
              errors.push(error);
            }
            try {
              cleanup.capture.loss.release();
            } catch (error) {
              errors.push(error);
            }
            if (slot.subscriptionUnknown)
              errors.push(new Error('Sponsor subscription cleanup unknown'));
            if (errors.length) throw new AggregateError(errors, 'Sponsor cleanup incomplete');
            cleanup.capture.dropBorrow();
            cleanup.transcript?.release();
            cleanup.certificate?.release();
            cleanup.capture.ticket.release();
            slot.cleanup = undefined;
          }
          resolve();
        } catch (error) {
          reject(error);
        }
      })();
      return slot.release;
    },
  });
  return api;
}

/** Accepts only an actual owner registered by createNoteLocalPointOwner. No
 * structural group/root/recipe/current-Boolean constructor is exposed. */
export function createNoteLocalPointSaveSponsor(owner: unknown): PointSaveSponsor {
  const capture = takeNoteLocalPointSponsorCapture(owner);
  const group = capture.document.history[0].id;
  const input: NoteStagedSaveInput = Object.freeze({
    scope: Object.freeze({ ...capture.document.scope }),
    operationId: uuid(),
    expiresAt: new Date(Date.parse(capture.recipe.identity.expiresAt)).toISOString(),
    header: Object.freeze({
      baseRevision: capture.document.baseRevision,
      editorSessionId: uuid(),
      localEditSequence: group,
      liveGeneration: capture.document.generation,
      selectionGeneration: capture.recipe.identity.selectionGeneration,
      action: 'mutate',
      output: 'source',
      selection: 'all',
    }),
  });
  const slot: SponsorSlot = {
    busy: false,
    checking: false,
    checkGeneration: 0,
    revision: 0,
    allocations: [],
    subscriptionUnknown: false,
    certificateUsed: false,
    data: { capture, input, phase: 'captured' },
    cleanup: { capture },
  };
  const api = sponsorAPI(slot, input);
  sponsorSlots.set(api, slot);
  try {
    allocation(slot, capture.owner, pointSponsorCost);
    slot.subscriptionUnknown = true; // Ownership claimed BEFORE callbackful registration.
    slot.off = capture.observation.subscribe(() => {
      slot.revision++;
      observeState(slot);
    });
    if (typeof slot.off !== 'function') fail();
    slot.subscriptionUnknown = false;
    slot.abort = () => retire(slot);
    slot.abortSignal = capture.observation.signal;
    slot.abortSignal?.addEventListener('abort', slot.abort, { once: true });
    if (!current(slot)) fail();
    return api;
  } catch (error) {
    void api.release().catch(() => undefined); // Ticket remains held if cleanup is unknown.
    throw error;
  }
}
export function currentPointCanonicalCertificate(value: unknown): boolean {
  const cert = value && typeof value === 'object' ? certificates.get(value) : undefined;
  return !!cert?.summary && current(cert.slot);
}

interface PointSaveUploadAccess {
  input: NoteStagedSaveInput;
  port: Pick<PointSponsorObservation, 'read' | 'subscribe'> & {
    dispatch: NonNullable<PointSponsorObservation['dispatch']>;
  };
  resources: NoteLocalPointSponsorCapture['resources'];
  document: NoteDocumentSession;
  note: NotePageSession;
  text: string;
  now(): number;
  loss: LiveNoteSaveLoss;
  current(): boolean;
  precommitCurrent(): boolean;
  nativeCurrent(): boolean;
  finalCheck(): ((time: number) => boolean) | undefined;
  observer(): LiveNoteSaveObserver;
  transition(next: NoteLocalPointSaveRecord | undefined): (installed: boolean) => void;
  receive(dispatch: LiveNoteSaveDispatch): ReturnType<typeof liveNoteDispatchOutcome>;
  retire(): void;
  retirement(): Promise<void>;
}

/** Narrow actual-owner transfer. No source/recipe/port reconstruction from DTOs. */
export function openPointSaveUpload(owner: PointUploadOwnerCapture): PointSaveUploadAccess {
  if (!consumePointUploadOwnerCapture(owner)) return fail();
  const slot = sponsorSlots.get(owner.sponsor);
  const d = slot?.data;
  if (!slot || !d || d.upload || !d.capture.observation.dispatch || !current(slot)) return fail();
  allocation(slot, owner.uploadOwner, pointUploadCost);
  allocation(slot, owner.controlOwner, pointUploadControlCost);
  d.upload = { receiptAwait: false };
  const port = Object.freeze({
    read: d.capture.observation.read,
    dispatch: d.capture.observation.dispatch,
    subscribe: d.capture.observation.subscribe,
  });
  return Object.freeze({
    input: d.input,
    port,
    resources: d.capture.resources,
    document: d.capture.document,
    note: d.capture.note,
    text: d.capture.recipe.forward[0].text,
    now: d.capture.now,
    loss: d.capture.loss,
    current: () => current(slot),
    precommitCurrent: owner.sponsor.precommitCurrent,
    nativeCurrent: d.capture.nativeSaveCurrent,
    finalCheck() {
      const check = slot.finalCheck;
      slot.finalCheck = undefined;
      return check;
    },
    observer() {
      if (slot.data !== d || !d.observer) return fail();
      return d.observer;
    },
    transition(next: NoteLocalPointSaveRecord | undefined) {
      if (slot.data !== d || !d.upload || d.upload.transition) return fail();
      d.upload.transition = { before: d.upload.record, after: next };
      return (installed: boolean) => {
        if (d.upload) {
          if (installed) {
            d.upload.record = next;
            d.upload.receiptAwait = !!next?.receipt;
          }
          d.upload.transition = undefined;
        }
      };
    },
    receive(dispatch: LiveNoteSaveDispatch) {
      if (!d.observer) return fail();
      const receipt = liveNoteDispatchOutcome(dispatch, d.observer);
      if (receipt?.kind === 'noteCommitReceipt' && slot.data === d) {
        d.receipt = receipt;
        d.phase = 'receiptBound';
      }
      return receipt;
    },
    retire: () => retire(slot),
    retirement: owner.sponsor.release,
  });
}
