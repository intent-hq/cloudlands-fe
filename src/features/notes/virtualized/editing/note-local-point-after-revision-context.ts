import { v4 as uuid } from 'uuid';
import { beforeSourceDeadline, parseSourceDeadline } from '$shared/source-session-expiry';
import { openLiveAfterRevisionIO } from '$lib/client/live/live-note-pages-client';
import { sameNoteScope, type NoteReadPage, type NoteSourcePage } from '$lib/client/note-pages';
import { createNoteResourceOwner } from '../note-resource-owner';
import { noteWindowSteps, type NoteWindow } from '../note-window-reader';
import {
  noteParagraphEditContextSteps,
  type NoteParagraphEditContext,
} from './note-paragraph-edit-authority';
import { takePointAfterRevisionCapture } from './note-local-point-save-sponsor';

// Logical cumulative ownership, NOT transitive heap or transport buffer accounting.
const costs = [
  {
    payloadBytes: 6291456,
    stringUnits: 6291456,
    objectNodes: 6291456,
    physicalReads: 1,
    assemblies: 1,
    domNodes: 0,
  },
  {
    payloadBytes: 8192,
    stringUnits: 8192,
    objectNodes: 8192,
    physicalReads: 0,
    assemblies: 0,
    domNodes: 0,
  },
] as const;
const brand = Symbol('after revision DATA');
interface Candidate {
  readonly [brand]: true;
  current(): boolean;
}
/** This constructor accepts only a consumed runtime issuer, never a receipt DTO. */
export function createAfterRevisionContext(key: unknown, ioKey: unknown) {
  let capture: ReturnType<typeof takePointAfterRevisionCapture> | undefined =
    takePointAfterRevisionCapture(key);
  let io: Awaited<ReturnType<typeof openLiveAfterRevisionIO>> | undefined;
  let window: NoteWindow | undefined, context: NoteParagraphEditContext | undefined;
  let original: NoteSourcePage | undefined;
  let retired = false,
    epoch = 0,
    requestCount = 0;
  let cleanup: Promise<void> | undefined;
  const tickets: Array<ReturnType<ReturnType<typeof createNoteResourceOwner>['reservation']>> = [];
  const retire = () => {
    if (!retired) epoch++;
    retired = true;
    capture?.retire(); // Append-only sponsor pins become unusable BEFORE returning child credit.
    window = undefined;
    context = undefined;
    original = undefined;
  };
  const current = () => {
    const c = capture,
      expected = epoch,
      source = original;
    if (!c || retired) return false;
    try {
      const transportCheck = io?.captureCurrent();
      // Live's own check consumes a sponsor finalizer. Capture a fresh exact
      // sponsor proof AFTER that callbackful check, then run the transport pin last.
      if (!c.current()) throw new Error('After revision sponsor lost');
      const proof = c.finalCheck();
      const time = c.now();
      if (
        retired ||
        capture !== c ||
        epoch !== expected ||
        original !== source ||
        !proof?.(time) ||
        (io && !transportCheck?.()) ||
        !beforeSourceDeadline(time, parseSourceDeadline(c.receiptExpiry)) ||
        (source && !beforeSourceDeadline(time, parseSourceDeadline(source.expiresAt)))
      )
        throw new Error('After revision final proof lost');
      return true;
    } catch {
      retire();
      return false;
    }
  };
  let resolve!: (v: Candidate) => void, reject!: (e: unknown) => void;
  const ready = new Promise<Candidate>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // Own outer work before allocation/clock/subscriber/import/transport callbacks.
  void (async () => {
    try {
      if (!current()) throw new Error('After revision admission lost');
      const c = capture!,
        owner = createNoteResourceOwner(c.resources);
      for (const cost of costs) {
        if (!current()) throw new Error('After revision reservation lost');
        const id = `point-after-revision:${uuid()}`;
        const ticket = owner.reservation(id, cost);
        tickets.push(ticket); // Includes installed-then-throw admission debt.
        if (
          !ticket.construct(
            () => Object.freeze({}),
            () => {},
          )
        )
          throw new Error('After revision budget unavailable');
        c.register(id, cost);
      }
      if (!current()) throw new Error('After revision admission lost');
      io = await openLiveAfterRevisionIO(ioKey); // Own even a product returned after revocation.
      if (!current()) throw new Error('After revision IO retired');
      const read = async (
        q: Parameters<NonNullable<typeof io>['read']>[0],
      ): Promise<NoteReadPage> => {
        if (++requestCount > 96 || !current() || (q.kind === 'source' && original))
          throw new Error('After revision request unavailable');
        const page = await io!.read(q);
        if (!current()) throw new Error('After revision page retired');
        if (page.kind === 'noteSourcePage') {
          if (
            original ||
            !sameNoteScope(page.scope, c.scope) ||
            page.sourceRevision !== c.revision ||
            page.sourceLength !== 3 ||
            page.range.start !== 0 ||
            page.range.end !== 3 ||
            page.text !== 'aXb' ||
            page.nextCursor !== null
          )
            throw new Error('After revision source mismatch');
          original = page;
        } else if (
          page.kind !== 'noteContextPage' ||
          !original ||
          !sameNoteScope(page.scope, original.scope) ||
          page.sourceRevision !== original.sourceRevision ||
          page.snapshotId !== original.snapshotId ||
          page.expiresAt !== original.expiresAt ||
          page.items.some(
            (item) =>
              [
                'profile',
                'profileVersion',
                'nativeRef',
                'sourceMapRef',
                'attributesRef',
                'htmlPosition',
                'htmlSource',
                'tablePosition',
                'codeSource',
              ].some((key) => Object.hasOwn(item, key)) ||
              (item.kind === 'boundary'
                ? item.construct !== 'paragraph' ||
                  item.entryPath !== 'markdown' ||
                  !!item.parentRef
                : item.kind === 'span'
                  ? item.role !== 'text'
                  : item.kind !== 'fragment'),
          )
        )
          throw new Error('After revision context mismatch');
        if (!current()) throw new Error('After revision snapshot retired');
        return page;
      };
      const steps = noteWindowSteps({ at: 0, scope: c.scope, sourceRevision: c.revision }, current);
      try {
        let step = steps.next();
        while (!step.done) step = steps.next(await read(step.value));
        window = step.value;
      } finally {
        steps.return(undefined as never);
      }
      if (!original || !window || window.native || window.canonicalOwners?.length || !current())
        throw new Error('After revision window unavailable');
      let claimed = false;
      const grant = {
        window,
        identity: original,
        allowance: {
          retainedBytes: 8192 - window.cost.contextBytes,
          requests: 96 - window.cost.requests,
          descriptors: 128 - window.context.length,
          wireBytes: 8192,
        },
        current,
        claim: () => {
          if (claimed) return false;
          claimed = true;
          return true;
        },
      };
      const details = noteParagraphEditContextSteps(window, original, current, grant, c.now);
      try {
        let step = details.next();
        while (!step.done) step = details.next(await read(step.value));
        context = step.value;
      } finally {
        details.return(undefined as never);
      }
      if (!current() || !window || !context) throw new Error('After revision context retired');
      resolve(Object.freeze({ [brand]: true as const, current }));
    } catch (error) {
      retire();
      reject(error);
    }
  })();
  return Object.freeze({
    ready,
    cancel: retire,
    release() {
      if (cleanup) return cleanup;
      retire();
      cleanup = (async () => {
        try {
          await ready;
        } catch {
          /* Keep original failure while joining owned IO. */
        }
        await io?.release(); // Never call the parent: parent owns this join and bound release.
        const errors: unknown[] = [];
        for (const ticket of tickets)
          try {
            ticket.release();
          } catch (e) {
            errors.push(e);
          }
        if (errors.length)
          throw new AggregateError(errors, 'After revision credit cleanup unknown');
        tickets.length = 0;
        io = undefined;
        capture = undefined;
      })();
      return cleanup;
    },
  });
}
