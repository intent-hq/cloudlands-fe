import { v4 as uuid } from 'uuid';
import type { NoteCommitReceipt, NotePagesClient } from '$lib/client/note-pages';
import type { NoteReceiptPage } from '$lib/client/note-receipt-reader';
import type { NotePagesState } from '$store/renderer/slices/note-pages/note-pages-types';
import * as a from '$store/renderer/slices/note-pages/note-pages-slice';
import { beforeSourceDeadline, parseSourceDeadline } from '$shared/source-session-expiry';
import type { NoteResourceReservation } from '../note-resource-ledger';

interface Port {
  read(): NotePagesState;
  dispatch(
    action: ReturnType<typeof a.pageResourcesRequested | typeof a.pageResourcesReleased>,
  ): void;
  subscribe(changed: () => void): () => void;
}
type Kind = 'mapping' | 'effects';
const frameBytes = 8192;
// One decoded frame, its JSON sizing scratch, receipt metadata and two cursors.
// Accounting allowances are separate units, not a measured JavaScript heap bound.
const residentAllowance = 8 * (frameBytes + 4096 + 2 * 256);

/** Own one bounded receipt transcript through actual transport and consumer
 * settlement. The caller's identity guard is observed on every Redux transition.
 * Pages are borrowed only during consume; this driver establishes no map/rebase
 * semantics and never exposes an item-prefix as complete reconciliation proof.
 * The consumer must drain/spool each page and retain only bounded semantic state;
 * it must not keep page objects after its callback settles. */
export function reserveNoteReceiptTranscript(
  port: Port,
  client: Pick<NotePagesClient, 'readReceipt'>,
  original: NoteCommitReceipt,
  baseLength: number,
  ownerCurrent: () => boolean,
  signal?: AbortSignal,
  now: () => number = Date.now,
) {
  const receipt = Object.freeze({ ...original, scope: Object.freeze({ ...original.scope }) });
  const deadline = parseSourceDeadline(receipt.receiptExpiresAt);
  const id = uuid();
  const assembly = {
    owner: `receipt:${id}`,
    data: `receipt-data:${id}`,
    control: `receipt-io:${id}`,
  };
  // Resident workspace is reused only after the prior transport and sink settle.
  // No receipt-size ceiling or growing cursor history is retained by the driver.
  const resources: NoteResourceReservation[] = [
    {
      id: assembly.data,
      cost: {
        payloadBytes: residentAllowance,
        stringUnits: residentAllowance,
        objectNodes: residentAllowance,
        domNodes: 0,
        physicalReads: 0,
        assemblies: 0,
      },
    },
    {
      id: assembly.control,
      cost: {
        payloadBytes: 0,
        stringUnits: 0,
        objectNodes: 0,
        domNodes: 0,
        physicalReads: 1,
        assemblies: 1,
      },
    },
  ];
  let invokingConsumer = false;
  let revoked = false,
    released = false,
    busy = false;
  let releasePromise: Promise<void> | undefined;
  let convertedCount: number | undefined;
  const changed = new Set<() => void>();
  const states: Record<Kind, { cursor?: string; done: boolean }> = {
    mapping: { done: false },
    effects: { done: false },
  };
  const notify = () => {
    for (const listener of [...changed]) listener();
  };
  const cancel = () => {
    revoked = true;
    notify();
  };
  const held = () => Object.hasOwn(port.read().resourceLedger.owners, assembly.owner);
  const eligible = () => {
    let current = false;
    try {
      current = ownerCurrent();
    } catch {
      /* A failed ownership check revokes delivery. */
    }
    revoked ||=
      released || signal?.aborted === true || !current || !beforeSourceDeadline(now(), deadline);
    return !revoked;
  };
  const current = () => eligible() && held();
  const assertCurrent = () => {
    if (!current()) throw new Error('Receipt transcript superseded or expired');
  };
  const unsubscribe = port.subscribe(() => {
    eligible();
    notify();
  });
  signal?.addEventListener('abort', cancel, { once: true });
  const wait = (predicate: () => boolean, check: boolean) =>
    new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: unknown) => {
        changed.delete(poll);
        if (timer !== undefined) clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      const poll = () => {
        try {
          if (check && !eligible()) throw new Error('Receipt transcript superseded or expired');
          if (predicate()) {
            finish();
            return;
          }
          if (check) {
            if (timer !== undefined) clearTimeout(timer);
            timer = setTimeout(
              poll,
              Math.max(1, Math.min(2147483647, Number(deadline / 1000000n) + 1 - now())),
            );
          }
        } catch (error) {
          finish(error);
        }
      };
      changed.add(poll);
      poll();
    });
  // Await release in the orchestration's outer finally, never inside consume.
  // A consumer waiting for its own retirement would deadlock after any await.
  const release = (): Promise<void> => {
    if (invokingConsumer)
      return Promise.reject(new Error('Release receipt ownership outside consume'));
    if (releasePromise) return releasePromise;
    cancel();
    releasePromise = (async () => {
      await wait(() => !busy, false);
      released = true;
      port.dispatch(a.pageResourcesReleased(assembly.owner));
      signal?.removeEventListener('abort', cancel);
      unsubscribe();
    })();
    return releasePromise;
  };
  const ready = (async () => {
    try {
      if (!eligible() || !Number.isSafeInteger(baseLength) || baseLength < 0)
        throw new Error('Receipt transcript unavailable');
      port.dispatch(a.pageResourcesRequested(assembly.owner, resources, 1));
      await wait(() => {
        if (held()) return true;
        if (!port.read().resourceLedger.pending.some((p) => p.owner === assembly.owner))
          throw new Error('Receipt transcript admission denied');
        return false;
      }, true);
      assertCurrent();
      return {
        current,
        /** Each callback exclusively borrows one page. No next dispatch is allowed
         * until its asynchronous consumer has drained, even after cancellation.
         * Never await lease.release() here (including after an await); use outer
         * finally. cancel() is safe here and revokes without awaiting retirement. */
        async consumeNext(kind: Kind, consume: (page: NoteReceiptPage) => void | Promise<void>) {
          assertCurrent();
          const state = states[kind];
          if (!state || state.done || busy) throw new Error('Receipt transcript read unavailable');
          busy = true;
          try {
            const page = await client.readReceipt(receipt, {
              kind,
              baseLength,
              ...(state.cursor === undefined ? {} : { cursor: state.cursor }),
              maxItems: 64,
              maxWireBytes: frameBytes,
            });
            assertCurrent();
            if (
              page.outputKind !== kind ||
              (page.nextCursor !== null && page.nextCursor === state.cursor)
            )
              throw new Error('Receipt transcript cursor did not advance');
            const nextCursor = page.nextCursor;
            if (page.outputKind === 'effects') {
              if (convertedCount !== undefined && page.convertedCount !== convertedCount)
                throw new Error('Receipt aggregate changed during traversal');
              convertedCount = page.convertedCount;
            }
            let consumed: void | Promise<void>;
            invokingConsumer = true;
            try {
              consumed = consume(page);
            } finally {
              invokingConsumer = false;
            }
            await consumed;
            assertCurrent();
            if (nextCursor === null) state.done = true;
            else {
              state.cursor = nextCursor;
            }
            return state.done;
          } catch (error) {
            cancel();
            throw error;
          } finally {
            busy = false;
            notify();
          }
        },
      };
    } catch (error) {
      await release();
      throw error;
    }
  })();
  return { ready, current, cancel, release };
}
