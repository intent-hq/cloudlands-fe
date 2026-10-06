import {
  LiveNotePagesClient,
  loadLiveNoteSaveDispatch,
  liveNoteDispatchOutcome,
  type LiveNoteSaveDispatch,
  type LiveNoteSaveObserver,
  releaseGuardedNoteSave,
  guardedNoteSaveCleanupKnown,
} from '$lib/client/live/live-note-pages-client';
import { stageTextDigest } from '$lib/client/note-source-operation';
import { v4 as uuid } from 'uuid';
import { noteSaveConnectionCost } from '$shared/types/note-save-connection';
import { createNoteResourceOwner } from '../note-resource-owner';
import type { NoteSaveOutcome } from '$lib/client/note-pages';
import type {
  NoteLocalPointSaveRecord,
  NotePageSession,
} from '$store/renderer/slices/note-pages/note-pages-types';
import {
  pageLocalPointSavePublished,
  pageResourcesRequested,
} from '$store/renderer/slices/note-pages/note-pages-slice';
import { loadLocalPointSavePublication } from '$store/renderer/slices/note-pages/note-local-point-save-publication';
export { pointUploadControlCost } from '$store/renderer/slices/note-pages/note-local-point-save-publication';
import type { NoteResourceLedger } from '../note-resource-ledger';
import { takeNoteLocalPointUploadOwner } from './note-local-point-owner';
import { openPointSaveUpload, type PointSaveSponsor } from './note-local-point-save-sponsor';

/** Existing staged serializer workspace, plus a separately retained pending DTO.
 * Logical DATA allowances; no production defaults or transitive heap claim. */
export const pointUploadCost = Object.freeze({
  payloadBytes: 2621440,
  stringUnits: 2621440,
  objectNodes: 4096,
  physicalReads: 1,
  assemblies: 1,
  domNodes: 0,
});
type Intent = {
  before: NotePageSession;
  after?: NoteLocalPointSaveRecord;
  controlOwner: string;
  controlResource: string;
  resource: NoteResourceLedger['resources'][string];
};
const intents = new WeakMap<object, Intent>();
export function takeLocalPointPublicationIntent(key: unknown): Intent {
  const value = key && typeof key === 'object' ? intents.get(key) : undefined;
  if (!value) throw new Error('Unknown local point publication');
  intents.delete(key as object);
  return value;
}
type DispatchArm = {
  bound?: boolean;
  observer: LiveNoteSaveObserver;
  current(): boolean;
  finalCheck(): ((time: number) => boolean) | undefined;
  now(): number;
};
const arms = new WeakMap<object, DispatchArm>();
/** Only this module's genuine pending issuer creates keys. Callbacks restrict
 * liveness; they never establish transport or outcome provenance. */
export function takeLocalPointDispatchArm(key: unknown): DispatchArm {
  const arm = key && typeof key === 'object' ? arms.get(key) : undefined;
  if (!arm) throw new Error('Unknown local point dispatch arm');
  arms.delete(key as object);
  return arm;
}
const fail = (): never => {
  throw new Error('Local point upload unavailable');
};

interface PointLocalUpload {
  readonly input: PointSaveSponsor['input'];
  run(): Promise<NoteSaveOutcome>;
  runBound(): Promise<NoteSaveOutcome>;
  outcome(): NoteSaveOutcome | undefined;
  observe(): Promise<NoteSaveOutcome>;
  certificate: PointSaveSponsor['certificate'];
  cancel(): void;
  release(): Promise<void>;
}

/** No caller port/send/group. This explicit lane is never selected by ordinary save sagas. */
export function createNoteLocalPointUpload(owner: unknown): PointLocalUpload {
  let captured: ReturnType<typeof takeNoteLocalPointUploadOwner> | undefined =
    takeNoteLocalPointUploadOwner(owner);
  const abandonPreparation = (value: NonNullable<typeof captured>) => {
    void (async () => {
      const errors: unknown[] = [];
      try {
        await value.sponsor.release();
      } catch (error) {
        errors.push(error);
      }
      // These tickets still own only empty provisional DATA. Sponsor's separate
      // unknown/native debt remains charged independently.
      for (const ticket of [value.upload, value.control]) {
        try {
          ticket.release();
        } catch (error) {
          errors.push(error);
        }
      }
      if (!errors.length) value.releaseFence();
    })().catch(() => {
      /* Failed known cleanup remains charged. */
    });
  };
  const initialize = () => {
    try {
      const access = openPointSaveUpload(captured!);
      const document = access.document,
        initial = access.note;
      const group = document.history[0].id,
        through = initial.history.at(-1)?.sequence;
      if (
        initial.pending ||
        initial.localPointSave ||
        initial.committedDocumentSave ||
        initial.receipts.length ||
        initial.drafts.length !== 1 ||
        initial.history.length !== 1 ||
        initial.drafts[0] !== initial.history[0] ||
        !Number.isSafeInteger(through) ||
        initial.drafts[0].splices.length !== 1 ||
        initial.drafts[0].splices[0].start !== 1 ||
        initial.drafts[0].splices[0].end !== 1 ||
        initial.drafts[0].splices[0].text !== access.text
      )
        fail();
      return { access, group, through };
    } catch (error) {
      abandonPreparation(captured!);
      throw error;
    }
  };
  let setup: ReturnType<typeof initialize> | undefined = initialize();
  let access: ReturnType<typeof openPointSaveUpload> | undefined = setup.access;
  const input = access.input,
    scope = input.scope,
    group = setup.group,
    through = setup.through;
  setup = undefined;
  let document: typeof access.document | undefined = access.document;
  let port: typeof access.port | undefined = access.port;
  let resources: typeof access.resources | undefined = access.resources;
  const documentGeneration = document.generation,
    cursor = document.cursor;
  const read = () => port?.read().byWorkspaceId[scope.workspaceId]?.notes[scope.noteId];
  let record: NoteLocalPointSaveRecord | undefined;
  let cancelled = false,
    consumed = false,
    busy = false,
    cleanupUnknown = false;
  let stage: ReturnType<LiveNotePagesClient['createGuardedSaveOperation']> | undefined;
  let dispatch: LiveNoteSaveDispatch | undefined;
  let preparePublication: Awaited<ReturnType<typeof loadLocalPointSavePublication>> | undefined;
  let createDispatch: Awaited<ReturnType<typeof loadLiveNoteSaveDispatch>> | undefined;
  let pending: Promise<NoteSaveOutcome> | undefined;
  let releasing: Promise<void> | undefined;
  let certificateWork: Promise<unknown> | undefined;
  let lastOutcome: NoteSaveOutcome | undefined;
  let boundTicket:
    ReturnType<ReturnType<typeof createNoteResourceOwner>['reservation']> | undefined;
  let boundOwner: string | undefined, boundResource: string | undefined;
  let boundEpoch = 0,
    boundLost = false;
  let stopBound: (() => void) | undefined;
  let boundAllocation: NoteResourceLedger['resources'][string] | undefined;
  const boundProof = (): (() => boolean) | undefined => {
    if (!boundTicket) return () => !boundLost;
    try {
      if (!boundOwner || !boundResource || !boundAllocation) fail();
      const pins: Array<{ object: object; key: string; value: unknown }> = [];
      const own = (object: unknown, key: string): unknown => {
        if (!object || typeof object !== 'object') return fail();
        const d = Object.getOwnPropertyDescriptor(object, key);
        if (!d || !('value' in d)) return fail();
        pins.push({ object, key, value: d.value });
        return d.value;
      };
      const root = port!.read(),
        ledger = resources!.read();
      if (own(root, 'resourceLedger') !== ledger) fail();
      const entries = own(ledger, 'resources'),
        owners = own(ledger, 'owners');
      if (own(entries, boundResource!) !== boundAllocation) fail();
      const ids = own(owners, boundOwner!);
      if (own(ids, 'length') !== 1 || own(ids, '0') !== boundResource) fail();
      const heldBy = own(boundAllocation, 'owners');
      if (own(heldBy, 'length') !== 1 || own(heldBy, '0') !== boundOwner) fail();
      const cost = own(boundAllocation, 'cost');
      for (const k of Object.keys(noteSaveConnectionCost) as Array<
        keyof typeof noteSaveConnectionCost
      >)
        if (own(cost, k) !== noteSaveConnectionCost[k]) fail();
      const epoch = boundEpoch;
      return () => {
        const valid =
          !boundLost &&
          epoch === boundEpoch &&
          pins.every((p) => {
            const d = Object.getOwnPropertyDescriptor(p.object, p.key);
            return !!d && 'value' in d && d.value === p.value;
          });
        if (!valid) boundLost = true;
        return valid;
      };
    } catch {
      boundLost = true;
      return undefined;
    }
  };
  const boundHeld = () => boundProof()?.() === true;
  const check = () => !cancelled && !!access && access.current() && boundHeld() && !cancelled;
  const finalCheck = () => {
    const a = access,
      proof = a?.finalCheck(),
      expected = record;
    const held = boundProof();
    return (time: number) =>
      !cancelled &&
      access === a &&
      record === expected &&
      !!proof?.(time) &&
      (!!dispatch?.entered() || !!a?.nativeCurrent()) &&
      !!held?.();
  };
  const makeRecord = (phase: NoteLocalPointSaveRecord['phase'], result?: NoteSaveOutcome) => {
    const sealed = record?.sealed ?? (phase === 'sealed' ? stage?.sealedSave() : undefined);
    return Object.freeze({
      kind: 'local-point' as const,
      phase,
      input,
      ...(sealed ? { sealed } : {}),
      group,
      documentGeneration,
      cursor,
      throughSequence: through!,
      controlOwner: captured!.controlOwner,
      controlResource: captured!.controlResource,
      ...(result?.kind === 'noteCommitReceipt' ? { receipt: result } : {}),
    });
  };
  const publish = (next: NoteLocalPointSaveRecord | undefined, recovery = false) => {
    const note = read() ?? fail();
    if (
      !note ||
      note.document !== document ||
      note.localPointSave !== record ||
      note.pending ||
      (!recovery && !check())
    )
      fail();
    const resource = resources!.read().resources[captured!.controlResource];
    if (!resource) fail();
    const key = Object.freeze({});
    intents.set(key, {
      before: note,
      after: next,
      controlOwner: captured!.controlOwner,
      controlResource: captured!.controlResource,
      resource,
    });
    const proof = (preparePublication ?? fail())(key);
    const finish = access?.current() ? access.transition(next) : undefined;
    let primary: unknown;
    try {
      port!.dispatch(pageLocalPointSavePublished(scope.workspaceId, scope.noteId, proof));
    } catch (error) {
      primary = error;
    }
    let installed = false;
    try {
      const actual = read();
      installed =
        !!actual &&
        actual.document === document &&
        actual.localPointSave === next &&
        actual.drafts === note.drafts &&
        actual.history === note.history &&
        actual.pending === note.pending &&
        actual.generation === note.generation &&
        actual.state === note.state;
    } catch (error) {
      cleanupUnknown = true;
      primary ??= error;
    }
    finish?.(installed);
    if (installed) record = next; // Subscriber throw is not evidence of failed installation.
    if (!installed || primary) {
      if (!installed) cleanupUnknown = true;
      throw primary ?? new Error('Local point save publication refused');
    }
  };
  const run = (bound = false): Promise<NoteSaveOutcome> => {
    if (consumed || busy || cancelled)
      return Promise.reject(new Error('Local point upload consumed'));
    consumed = true;
    busy = true;
    let resolve!: (v: NoteSaveOutcome) => void, reject!: (error: unknown) => void;
    const promise = new Promise<NoteSaveOutcome>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    pending = promise;
    void (async () => {
      let primary: unknown;
      try {
        // The whole run already owns completion before lazy feature loading. Do not
        // hold a publication snapshot or acquire commit authority across this await.
        const [publication, dispatchFactory] = await Promise.allSettled([
          loadLocalPointSavePublication(),
          loadLiveNoteSaveDispatch(),
        ]);
        if (publication.status === 'rejected') throw publication.reason;
        if (dispatchFactory.status === 'rejected') throw dispatchFactory.reason;
        preparePublication = publication.value;
        createDispatch = dispatchFactory.value;
        if (!check() || !access) fail();
        if (bound) {
          // Reserve the independent IPC slot before capture or its callbacks.
          boundOwner = `local-point-connection:${uuid()}`;
          const ticket = createNoteResourceOwner({
            read: resources!.read,
            dispatch(action) {
              if (action.type === pageResourcesRequested.type) {
                const [owner, requests] = (action as ReturnType<typeof pageResourcesRequested>)
                  .payload;
                if (owner !== boundOwner || requests.length !== 1 || boundResource) fail();
                boundResource = requests[0].id; // Generated by our own reservation, before dispatch.
              }
              return resources!.dispatch(action);
            },
          }).reservation(boundOwner, noteSaveConnectionCost);
          boundTicket = ticket; // Own admission before Redux subscribers run.
          let allocation: object | undefined;
          try {
            allocation = ticket.construct(
              () => Object.freeze({}),
              () => {},
            );
          } catch (primary) {
            // Before any IPC/listener construction, this ticket owns only empty DATA.
            try {
              const ledger = resources!.read(),
                ids = ledger.owners[boundOwner];
              if (
                ids &&
                (ids.length !== 1 ||
                  ids[0] !== boundResource ||
                  !ledger.resources[ids[0]] ||
                  !Object.entries(noteSaveConnectionCost).every(
                    ([k, v]) =>
                      ledger.resources[ids[0]].cost[k as keyof typeof noteSaveConnectionCost] === v,
                  ))
              )
                throw primary;
              boundTicket = undefined; // one cleanup attempt, including subscriber throw
              ticket.release();
            } catch {
              cleanupUnknown = true;
            }
            throw primary;
          }
          if (!allocation) fail();
          const ledger = resources!.read();
          const ids = ledger.owners[boundOwner];
          if (!ids || ids.length !== 1 || ids[0] !== boundResource) fail();
          boundAllocation = ledger.resources[boundResource!];
          try {
            stopBound = port!.subscribe(() => {
              boundEpoch++;
              boundHeld();
            });
          } catch (e) {
            cleanupUnknown = true;
            throw e;
          }
          if (!check()) fail();
        }
        publish(makeRecord('preparing'));
        const a = access ?? fail();
        stage = new LiveNotePagesClient().createGuardedSaveOperation(
          input,
          check,
          a.now,
          finalCheck,
        );
        await stage.begin();
        if (!check()) fail();
        const text = a.text,
          textId = `group:${group}:0`;
        const sha256 = await stageTextDigest(text);
        if (!check() || text.length !== 57 || new TextEncoder().encode(text).length !== 57) fail();
        await stage.append('text', [{ kind: 'text', id: textId, offset: 0, text }]);
        if (!check()) fail();
        await stage.append('dirty', [
          {
            kind: 'splice',
            localSequence: group,
            ordinal: 0,
            start: 1,
            end: 1,
            replacement: { textId, length: 57, utf8Bytes: 57, sha256 },
          },
        ]);
        if (!check()) fail();
        if ((await stage.seal()) !== 59 || !check()) fail();
        await captured!.sponsor.bindSealed(stage);
        if (!check()) fail();
        publish(makeRecord('sealed'));
        const arm = Object.freeze({});
        arms.set(arm, { observer: a.observer(), current: check, finalCheck, now: a.now, bound });
        dispatch = createDispatch(arm);
        if (bound) {
          await dispatch.prepareBinding();
          if (!check()) fail();
        }
        captured!.sponsor.handoffForOutcomeObservation();
        if (!check()) fail();
        const reply = dispatch.invoke();
        // Always join the owned reply even if publication installed then threw.
        let publicationError: unknown;
        try {
          if (dispatch.entered()) publish(makeRecord('invoked'), true);
        } catch (error) {
          publicationError = error;
        }
        const result = await reply;
        lastOutcome = liveNoteDispatchOutcome(dispatch);
        if (lastOutcome !== result) fail();
        a.receive(dispatch);
        publish(
          makeRecord(
            result.outcome === 'committed'
              ? 'committed'
              : result.outcome === 'pending'
                ? 'pending'
                : result.outcome === 'unknown'
                  ? 'unknown'
                  : 'refused',
            result,
          ),
          true,
        );
        if (publicationError) throw publicationError;
        resolve(result);
      } catch (error) {
        primary = error;
        if (dispatch?.entered()) {
          try {
            const outcome = liveNoteDispatchOutcome(dispatch);
            if (outcome) {
              lastOutcome = outcome;
              access?.receive(dispatch);
            }
            if (record?.phase !== 'committed')
              publish(
                makeRecord(outcome?.outcome === 'committed' ? 'committed' : 'unknown', outcome),
                true,
              );
          } catch {
            cleanupUnknown = true;
          }
        } else {
          try {
            await stage?.cancel();
            if (stage && !guardedNoteSaveCleanupKnown(stage)) {
              cleanupUnknown = true;
              if (record) publish(makeRecord('unknown'), true);
            } else if (record) publish(undefined, true);
          } catch {
            cleanupUnknown = true;
            try {
              if (record) publish(makeRecord('unknown'), true);
            } catch {
              /* Preserve exact existing recovery record. */
            }
          }
        }
        reject(primary);
      } finally {
        busy = false;
        if (pending === promise) pending = undefined;
      }
    })();
    return promise;
  };
  return Object.freeze({
    input,
    run: () => run(false),
    runBound: () => run(true),
    outcome: () => lastOutcome,
    observe(): Promise<NoteSaveOutcome> {
      if (busy || cancelled || !dispatch?.entered() || !access)
        return Promise.reject(new Error('Status unavailable'));
      busy = true;
      const d = dispatch,
        a = access;
      let resolve!: (result: NoteSaveOutcome) => void, reject!: (error: unknown) => void;
      const work = new Promise<NoteSaveOutcome>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      pending = work;
      void (async () => {
        try {
          const result = await d.status();
          lastOutcome = liveNoteDispatchOutcome(d);
          a.receive(d);
          publish(
            makeRecord(
              result.outcome === 'committed'
                ? 'committed'
                : result.outcome === 'pending'
                  ? 'pending'
                  : result.outcome === 'unknown'
                    ? 'unknown'
                    : 'refused',
              result,
            ),
            true,
          );
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          busy = false;
          if (pending === work) pending = undefined;
        }
      })();
      return work;
    },
    certificate() {
      if (busy || cancelled || !access || record?.phase !== 'committed')
        return Promise.reject(new Error('Certificate unavailable'));
      busy = true;
      let yes!: (
          v: Awaited<
            ReturnType<ReturnType<typeof takeNoteLocalPointUploadOwner>['sponsor']['certificate']>
          >,
        ) => void,
        no!: (e: unknown) => void;
      const work = new Promise<
        Awaited<
          ReturnType<ReturnType<typeof takeNoteLocalPointUploadOwner>['sponsor']['certificate']>
        >
      >((resolve, reject) => {
        yes = resolve;
        no = reject;
      });
      certificateWork = work;
      void (async () => {
        try {
          yes(await captured!.sponsor.certificate());
        } catch (error) {
          no(error);
        } finally {
          busy = false;
          if (certificateWork === work) certificateWork = undefined;
        }
      })();
      return work;
    },
    cancel() {
      cancelled = true;
      access?.retire();
    },
    release() {
      if (releasing) return releasing;
      cancelled = true;
      access?.retire();
      releasing = (async () => {
        try {
          await pending;
          await certificateWork;
        } catch {
          /* Preserve primary and inspect independent debt. */
        }
        const errors: unknown[] = [];
        try {
          await dispatch?.release();
        } catch (e) {
          errors.push(e);
        }
        try {
          if (stage) await releaseGuardedNoteSave(stage);
        } catch (e) {
          errors.push(e);
        }
        try {
          await captured!.sponsor.release();
        } catch (e) {
          errors.push(e);
        }
        access = undefined;
        preparePublication = undefined;
        createDispatch = undefined;
        const stop = stopBound;
        stopBound = undefined;
        try {
          stop?.();
        } catch (e) {
          errors.push(e);
        }
        if (cleanupUnknown || errors.length)
          throw new AggregateError(errors, 'Local point upload cleanup unknown');
        boundTicket?.release();
        boundTicket = undefined;
        boundAllocation = undefined;
        captured!.upload.release();
        // Pending DATA survives runtime retirement. Only known preinvoke cancellation removes it.
        if (!record && !dispatch?.entered()) {
          captured!.control.release();
          captured!.releaseFence();
        }
        // Successful retirement retains only bounded serializable recovery DATA.
        // The original owner/Editor/context graph must not be pinned by this API.
        captured = undefined;
        document = undefined;
        port = undefined;
        resources = undefined;
        stage = undefined;
        dispatch = undefined;
      })();
      return releasing;
    },
  });
}
