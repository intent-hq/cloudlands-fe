import { v4 as uuid } from 'uuid';
import { sameNoteScope, type NotePageRequest, type NoteReadPage } from '$lib/client/note-pages';
import type { NotePagesState } from '$store/renderer/slices/note-pages/note-pages-types';
import * as a from '$store/renderer/slices/note-pages/note-pages-slice';
import { NOTE_WINDOW_LIMITS, type NoteWindow } from '../note-window-reader';
import {
  noteAssemblyResources,
  notePageRequestKey,
  NOTE_ASSEMBLY_OWNER_SLOTS,
} from '../note-assembly-reservation';

type Action = ReturnType<
  | typeof a.pageResourcesRequested
  | typeof a.pageResourcesReleased
  | typeof a.pageWindowRetained
  | typeof a.pageAssemblyDataRetained
  | typeof a.pageRequested
>;
interface Port {
  read(): NotePagesState;
  dispatch(action: Action): void;
  subscribe(changed: () => void): () => void;
}

/** Runtime ownership only. All admission and physical IO debt live in the existing
 * Redux ledger/read saga. The returned context must be released after its final
 * borrower, independently of cancellation and remote read settlement. */
export function reserveNoteEditContext(
  port: Port,
  window: NoteWindow,
  panel: string,
  signal?: AbortSignal,
  now: () => number = Date.now,
) {
  const { workspaceId: ws, noteId: id } = window.scope;
  const captured = port.read().byWorkspaceId[ws]?.notes[id];
  const generation = captured?.generation;
  const request = captured?.windows[panel]?.request;
  const token = uuid();
  const assembly = {
    owner: `edit-assembly:${token}`,
    data: `edit-data:${token}`,
    control: `edit-control:${token}`,
  };
  const windowOwner = `edit-window:${token}`,
    dataOwner = `edit-context:${token}`;
  const identity = Object.freeze({
    scope: Object.freeze({ ...window.scope }),
    sourceRevision: window.sourceRevision,
    snapshotId: window.snapshotId,
    expiresAt: window.expiresAt ?? '',
  });
  const deadline = Date.parse(identity.expiresAt);
  let revoked = false,
    released = false,
    sealed = false,
    reading = false;
  let claimed = false;
  let remainingRequests = NOTE_WINDOW_LIMITS.requests - window.cost.requests;
  let releasePromise: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const cancel = () => {
    revoked = true;
    notify();
  };
  const held = (owner: string) => Object.hasOwn(port.read().resourceLedger.owners, owner);
  const busy = () =>
    Object.values(port.read().physicalReads).some((r) => r.assembly?.owner === assembly.owner);
  const eligible = () => {
    const n = port.read().byWorkspaceId[ws]?.notes[id];
    const allowed =
      !revoked &&
      !released &&
      !signal?.aborted &&
      Number.isFinite(deadline) &&
      now() < deadline &&
      generation !== undefined &&
      n?.generation === generation &&
      n.status === 'ready' &&
      !n.needsReconcile &&
      panel in n.panels &&
      (sealed || (n.windows[panel]?.request === request && n.windows[panel]?.value === window)) &&
      n.state?.sourceRevision === identity.sourceRevision &&
      sameNoteScope(n.state.scope, identity.scope) &&
      window.expiresAt === identity.expiresAt;
    revoked ||= !allowed;
    return allowed;
  };
  const current = () =>
    eligible() && held(windowOwner) && held(sealed ? dataOwner : assembly.owner);
  const assertCurrent = () => {
    if (!current()) throw new Error('Note edit context superseded or expired');
  };
  // Subscribe before dispatch/wait, so synchronous Redux publication cannot lose a wake.
  const unsubscribe = port.subscribe(() => {
    // Observe every identity transition, even while no consumer is polling.
    // Reopening a panel cannot revive a context retired by its earlier closure.
    eligible();
    notify();
  });
  signal?.addEventListener('abort', cancel, { once: true });
  const wait = (predicate: () => boolean, check = true) =>
    new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: unknown) => {
        listeners.delete(poll);
        if (timer !== undefined) clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      const poll = () => {
        try {
          if (check && !eligible()) throw new Error('Note edit context superseded or expired');
          if (predicate()) finish();
        } catch (error) {
          finish(error);
        }
      };
      listeners.add(poll);
      if (check) timer = setTimeout(poll, Math.max(0, Math.min(2147483647, deadline - now())));
      poll();
    });
  const release = (): Promise<void> => {
    if (releasePromise) return releasePromise;
    cancel();
    releasePromise = (async () => {
      // A dispatched read has an independent DATA/CONTROL lease until its finally.
      // Keep the original window borrowed until the pending consumer read unwinds.
      await wait(() => !reading && !busy(), false);
      released = true;
      port.dispatch(a.pageResourcesReleased(assembly.owner));
      port.dispatch(a.pageResourcesReleased(dataOwner));
      port.dispatch(a.pageResourcesReleased(windowOwner));
      signal?.removeEventListener('abort', cancel);
      unsubscribe();
    })();
    return releasePromise;
  };
  const ready = (async () => {
    try {
      if (
        !eligible() ||
        generation === undefined ||
        !Number.isSafeInteger(remainingRequests) ||
        remainingRequests < 0
      )
        throw new Error('Note edit window unavailable');
      port.dispatch(a.pageWindowRetained(ws, id, panel, generation, window, windowOwner));
      if (!held(windowOwner)) throw new Error('Note edit window data unavailable');
      port.dispatch(
        a.pageResourcesRequested(
          assembly.owner,
          noteAssemblyResources(assembly),
          NOTE_ASSEMBLY_OWNER_SLOTS,
        ),
      );
      await wait(() => {
        if (held(assembly.owner)) return true;
        if (!port.read().resourceLedger.pending.some((p) => p.owner === assembly.owner))
          throw new Error('Note edit context admission denied');
        return false;
      });
      assertCurrent();
      const grant = Object.freeze({
        window,
        identity,
        current,
        claim() {
          if (claimed || !current()) return false;
          claimed = true;
          return true;
        },
        allowance: Object.freeze({
          retainedBytes: NOTE_WINDOW_LIMITS.contextBytes - window.cost.contextBytes,
          descriptors: NOTE_WINDOW_LIMITS.descriptors - window.context.length,
          requests: NOTE_WINDOW_LIMITS.requests - window.cost.requests,
          wireBytes: NOTE_WINDOW_LIMITS.wireBytes,
        }),
      });
      return {
        grant,
        current,
        cancel,
        release,
        async read(q: NotePageRequest): Promise<NoteReadPage> {
          assertCurrent();
          if (
            !claimed ||
            remainingRequests <= 0 ||
            sealed ||
            reading ||
            busy() ||
            q.kind !== 'context' ||
            q.maxWireBytes !== NOTE_WINDOW_LIMITS.wireBytes ||
            !Number.isSafeInteger(q.maxItems) ||
            (q.maxItems ?? 0) < 1 ||
            (q.maxItems ?? 0) > 64
          )
            throw new Error('Invalid note edit context read');
          remainingRequests--;
          reading = true;
          const key = notePageRequestKey(q, assembly);
          try {
            port.dispatch(a.pageRequested(ws, id, q, assembly));
            await wait(() => {
              const n = port.read().byWorkspaceId[ws]?.notes[id];
              if (n?.error && !n.requests[key]) throw new Error(n.error);
              return !!n?.pages[key] && !busy();
            });
            assertCurrent();
            const n = port.read().byWorkspaceId[ws]?.notes[id],
              page = n?.pages[key];
            if (
              !page ||
              n.pageAllocations[key]?.resource !== assembly.data ||
              !('expiresAt' in page) ||
              page.expiresAt !== identity.expiresAt ||
              !('snapshotId' in page) ||
              page.snapshotId !== identity.snapshotId ||
              !('sourceRevision' in page) ||
              page.sourceRevision !== identity.sourceRevision ||
              !sameNoteScope(page.scope, identity.scope)
            )
              throw new Error('Note edit context identity mismatch');
            return page;
          } catch (error) {
            cancel();
            throw error;
          } finally {
            await wait(() => !busy(), false);
            reading = false;
            notify();
          }
        },
        seal() {
          assertCurrent();
          if (sealed || reading || busy())
            throw new Error('Note edit context read has not settled');
          port.dispatch(a.pageAssemblyDataRetained(assembly, dataOwner));
          if (!held(dataOwner)) throw new Error('Note edit context retention denied');
          sealed = true;
          port.dispatch(a.pageResourcesReleased(assembly.owner));
          assertCurrent();
        },
      };
    } catch (error) {
      await release();
      throw error;
    }
  })();
  return { ready, cancel, release };
}
