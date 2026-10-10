import { take } from 'redux-saga/effects';
import type { NoteSourceSink } from './editing/note-source-copy';
import { createCanonicalSelection } from './note-canonical-selection';
import { v4 as uuid } from 'uuid';
import { appClient } from '$lib/client';
import { store } from '$store/renderer/store';
import {
  pageResourcesRequested,
  pageResourcesReleased,
} from '$store/renderer/slices/note-pages/note-pages-slice';
import { sameNoteScope, type NotePageRequest } from '$lib/client/note-pages';
import {
  openNoteSourceClipboardSink,
  SourceClipboardCleanupError,
} from '$lib/utils/source-clipboard';
import { streamNoteSource, type NoteSourceSnapshot } from './note-source-stream';
import { createCanonicalNoteMatcher } from './note-canonical-search';
import { readNoteWindow, NOTE_WINDOW_LIMITS, type NoteWindow } from './note-window-reader';
import { noteAssemblyResources } from './note-assembly-reservation';
import type { NoteReadingSurface, NoteWindowView } from './note-window-view';

/** Reuse the viewer's cumulative bounded-reader allowance. The reader may keep
 * response graphs, fragmented JSON, decoded canonical values and the final window
 * simultaneously: a fixed per-frame copy budget cannot cover that lifetime.
 * Scratch is additional to DATA: <=10240 text units plus two source-position arrays,
 * <=2048-unit old/new tails, lowercase text, <=128 map/node references and selection
 * joins. Numeric slots cost eight payload bytes; each slot also counts as one node.
 * This conservative logical reservation is not a measurement of JavaScript heap.
 */
const assemblyData = noteAssemblyResources({ owner: 'budget', data: 'data', control: 'io' })[0]
  .cost;
const scratch = { payloadBytes: 393216, stringUnits: 393216, objectNodes: 393216 };
const results = { payloadBytes: 262144, stringUnits: 32768, objectNodes: 16384 };
const sinkCost = { payloadBytes: 131072, stringUnits: 131072, objectNodes: 256 };
// One retained viewer window, its replacement, and one command assembly. Results
// and native clipboard cleanup have independent lifetimes. Other panels/commands
// share these credits and refuse/queue when occupied, rather than growing the cap.
// Native view construction still has its separate NOTE_VIEW_LIMITS/DOM guards.
const limits = {
  payloadBytes:
    3 * assemblyData.payloadBytes +
    scratch.payloadBytes +
    results.payloadBytes +
    sinkCost.payloadBytes,
  stringUnits:
    3 * assemblyData.stringUnits + scratch.stringUnits + results.stringUnits + sinkCost.stringUnits,
  objectNodes:
    3 * assemblyData.objectNodes + scratch.objectNodes + results.objectNodes + sinkCost.objectNodes,
  domNodes: 8192,
  physicalReads: 3,
  assemblies: 3,
};
export function createNoteReadingSurface(
  workspaceId: string,
  noteId: string,
  panelId: string,
  onSearch: () => void,
  onClearResults: () => void = () => {},
): NoteReadingSurface & { dispose(): void } {
  let live = true,
    copyGeneration = 0,
    searchGeneration = 0;
  let view: NoteWindowView | undefined;
  let cancelActiveCopy: (() => void) | undefined;
  let cancelSelectedCopy: (() => void) | undefined;
  let cleanupDebt = false;
  type ResultLease = { owner: string; producing: boolean; displayed: boolean; released: boolean };
  let resultLease: ResultLease | undefined;
  function releaseResults(lease: ResultLease) {
    if (lease.producing || lease.displayed || lease.released) return;
    lease.released = true;
    store.dispatch(pageResourcesReleased(lease.owner));
  }
  function clearResults() {
    onClearResults();
    const lease = resultLease;
    resultLease = undefined;
    if (lease) {
      lease.displayed = false;
      releaseResults(lease);
    }
  }
  function reserve(owner: string, payloadBytes: number, stringUnits: number, objectNodes: number) {
    store.dispatch(
      pageResourcesRequested(owner, [
        {
          id: owner,
          cost: {
            payloadBytes,
            stringUnits,
            objectNodes,
            domNodes: 0,
            physicalReads: 0,
            assemblies: 0,
          },
        },
      ]),
    );
    if (!store.state.notePages.resourceLedger.owners[owner]) {
      store.dispatch(pageResourcesReleased(owner));
      throw new Error('Note read resources are busy');
    }
  }
  const session = () => store.state.notePages.byWorkspaceId[workspaceId]?.notes[noteId];
  function capture(kind: 'copy' | 'search', selectionSensitive = false) {
    const generation = kind === 'copy' ? ++copyGeneration : ++searchGeneration;
    const capturedView = view,
      selectionGeneration = view?.selectionCaptureGeneration;
    const state = session(),
      window = view?.window,
      client = appClient.notes.pages;
    if (
      !live ||
      !client ||
      state?.status !== 'ready' ||
      !state.state ||
      !window?.expiresAt ||
      !state.panels[panelId]
    )
      throw new Error('Note reading is not ready');
    const sessionGeneration = state.generation;
    const snapshot: NoteSourceSnapshot = {
      scope: { ...window.scope },
      sourceRevision: window.sourceRevision,
      snapshotId: window.snapshotId,
      sourceLength: window.sourceLength,
      expiresAt: window.expiresAt,
    };
    const current = () => {
      const next = session();
      return (
        live &&
        (!selectionSensitive ||
          (view === capturedView && view?.selectionCaptureGeneration === selectionGeneration)) &&
        (kind === 'copy' ? copyGeneration : searchGeneration) === generation &&
        next?.generation === sessionGeneration &&
        next.status === 'ready' &&
        !!next.panels[panelId] &&
        !!next.state &&
        sameNoteScope(next.state.scope, snapshot.scope) &&
        next.state.sourceRevision === snapshot.sourceRevision &&
        Date.now() < Date.parse(snapshot.expiresAt)
      );
    };
    const owner = `note-read-operation:${uuid()}`;
    store.dispatch(
      pageResourcesRequested(owner, [
        {
          id: owner,
          cost: {
            payloadBytes: assemblyData.payloadBytes + scratch.payloadBytes,
            stringUnits: assemblyData.stringUnits + scratch.stringUnits,
            objectNodes: assemblyData.objectNodes + scratch.objectNodes,
            domNodes: 0,
            physicalReads: 1,
            assemblies: 1,
          },
        },
      ]),
    );
    const held = () => !!store.state.notePages.resourceLedger.owners[owner];
    if (!held()) {
      store.dispatch(pageResourcesReleased(owner));
      throw new Error('Note read resources are busy');
    }
    const check = () => {
      if (!current() || !held()) throw new Error('Note read operation cancelled');
    };
    return {
      snapshot,
      current: () => current() && held(),
      check,
      read: async (request: NotePageRequest) => {
        check();
        const p = await client.read(workspaceId, noteId, request);
        check();
        return p;
      },
      release: () => store.dispatch(pageResourcesReleased(owner)),
    };
  }
  async function commandWindow(
    operation: ReturnType<typeof capture>,
    at: number,
  ): Promise<NoteWindow> {
    let wireBytes = 0;
    return readNoteWindow(
      async (request) => {
        const page = await operation.read(request);
        wireBytes += new TextEncoder().encode(JSON.stringify(page)).length;
        // Match the same cumulative bound as the viewer, including adaptive retries.
        if (wireBytes > NOTE_WINDOW_LIMITS.requests * NOTE_WINDOW_LIMITS.wireBytes)
          throw new Error('Note command window exceeds its assembly budget');
        return page;
      },
      {
        at,
        scope: operation.snapshot.scope,
        sourceRevision: operation.snapshot.sourceRevision,
        snapshotId: operation.snapshot.snapshotId,
      },
      operation.current,
    );
  }
  async function copy<T>(
    selectionSensitive: boolean,
    run: (
      operation: ReturnType<typeof capture>,
      open: (length: number) => Promise<NoteSourceSink>,
    ) => Promise<T>,
  ): Promise<T> {
    if (cancelActiveCopy || cleanupDebt) throw new Error('Clipboard cleanup is still pending');
    const operation = capture('copy', selectionSensitive);
    const controller = new AbortController();
    const sinkOwner = `note-copy-sink:${uuid()}`;
    let sink: NoteSourceSink | undefined,
      committed = false,
      sinkHeld = false;
    let aborting: Promise<void> | undefined, abortFailure: unknown;
    let failure: unknown, result: T | undefined;
    const abort = () => {
      if (!sink || aborting) return;
      try {
        aborting = sink.abort().catch((error: unknown) => {
          abortFailure = error;
        });
      } catch (error) {
        abortFailure = error;
        aborting = Promise.resolve();
      }
    };
    controller.signal.addEventListener('abort', abort);
    cancelActiveCopy = () => controller.abort();
    cancelSelectedCopy = selectionSensitive ? cancelActiveCopy : undefined;
    const revoke = () => {
      if (!operation.current()) controller.abort();
    };
    const stop = store.runSaga(function* () {
      try {
        while (true) {
          yield take('*');
          revoke();
        }
      } finally {
        controller.abort();
      }
    });
    const timer = setTimeout(
      () => controller.abort(),
      Math.min(2147483647, Math.max(0, Date.parse(operation.snapshot.expiresAt) - Date.now())),
    );
    try {
      result = await run(operation, async (length) => {
        operation.check();
        reserve(sinkOwner, sinkCost.payloadBytes, sinkCost.stringUnits, sinkCost.objectNodes);
        sinkHeld = true;
        sink = await openNoteSourceClipboardSink(
          {
            id: uuid(),
            length,
            expiresAt: Math.min(Date.parse(operation.snapshot.expiresAt), Date.now() + 600000),
          },
          controller.signal,
        );
        if (controller.signal.aborted) {
          abort();
          throw new Error('Note copy cancelled');
        }
        const opened = sink;
        return {
          write: (text) => {
            operation.check();
            return opened.write(text);
          },
          commit: async () => {
            operation.check();
            await opened.commit();
            committed = true;
          },
          abort: async () => {
            abort();
            await aborting;
            if (abortFailure) throw abortFailure;
          },
        };
      });
    } catch (error) {
      failure = error;
      cleanupDebt ||= error instanceof SourceClipboardCleanupError;
    } finally {
      if (!committed) abort();
      await aborting;
      cleanupDebt ||= !committed && abortFailure !== undefined;
      failure ??= abortFailure;
      controller.signal.removeEventListener('abort', abort);
      clearTimeout(timer);
      stop();
      cancelActiveCopy = undefined;
      cancelSelectedCopy = undefined;
      operation.release();
      // Read/assembly lifetime has settled. Unknown sink cleanup retains its
      // independent credit and refuses subsequent copy admission on this owner.
      if (sinkHeld && !cleanupDebt) store.dispatch(pageResourcesReleased(sinkOwner));
    }
    if (failure !== undefined) throw failure;
    return result as T;
  }
  return {
    resourceLimits: limits,
    ready(native) {
      view = native;
    },
    selectionChanged() {
      cancelSelectedCopy?.();
    },
    fullOperation(kind) {
      if (kind === 'search') onSearch();
    },
    cancelCopy() {
      cancelActiveCopy?.();
      copyGeneration++;
    },
    cancelSelectionCopy() {
      cancelActiveCopy?.();
      copyGeneration++;
    },
    cancelRenderedSearch() {
      clearResults();
      searchGeneration++;
    },
    dispose() {
      clearResults();
      live = false;
      cancelActiveCopy?.();
      copyGeneration++;
      searchGeneration++;
      view = undefined;
    },
    async copyDocument() {
      await copy(false, async (operation, open) => {
        const sink = await open(operation.snapshot.sourceLength);
        await streamNoteSource(operation.snapshot, operation.read, sink, operation.current);
      });
    },
    async copySelection() {
      const selection = view?.getSelection();
      if (!selection || selection.anchor === selection.head) return 'noCopy';
      return copy(true, async (operation, open) => {
        const range = {
          start: Math.min(selection.anchor, selection.head),
          end: Math.max(selection.anchor, selection.head),
        };
        const walk = async (consume: (text: string) => Promise<void>) => {
          const take = createCanonicalSelection(range);
          let at = range.start;
          while (at < range.end) {
            operation.check();
            const window = await commandWindow(operation, at);
            operation.check();
            if (
              window.snapshotId !== operation.snapshot.snapshotId ||
              window.sourceLength !== operation.snapshot.sourceLength ||
              window.range.start > at ||
              window.range.end <= at
            )
              throw new Error('Canonical selection lost its snapshot or made no progress');
            await consume(take(window));
            operation.check();
            at = window.range.end;
          }
        };

        if (range.start < 0 || range.end > operation.snapshot.sourceLength)
          throw new Error('Invalid note selection');
        let length = 0;
        await walk(async (text) => {
          length += text.length;
        });
        if (!length) return 'noCopy';
        operation.check();
        const sink = await open(length);
        await walk(async (text) => {
          for (let at = 0; at < text.length;) {
            let end = Math.min(at + 4096, text.length);
            if (
              end < text.length &&
              text.charCodeAt(end) >= 0xdc00 &&
              text.charCodeAt(end) <= 0xdfff
            )
              end--;
            operation.check();
            await sink.write(text.slice(at, end));
            at = end;
          }
        });
        operation.check();
        await sink.commit();
        return 'copied';
      });
    },
    async searchRendered(query, consume) {
      clearResults();
      const operation = capture('search');
      let lease: ResultLease | undefined;
      try {
        const owner = `note-search-results:${uuid()}`;
        reserve(owner, results.payloadBytes, results.stringUnits, results.objectNodes);
        lease = { owner, producing: true, displayed: true, released: false };
        resultLease = lease;
        const match = createCanonicalNoteMatcher(query);
        let at = 0,
          count = 0;
        do {
          operation.check();
          const window = await commandWindow(operation, at);
          operation.check();
          if (
            window.snapshotId !== operation.snapshot.snapshotId ||
            window.sourceLength !== operation.snapshot.sourceLength ||
            window.range.start > at ||
            (window.range.end <= at && at < window.sourceLength)
          )
            throw new Error('Canonical search lost its snapshot or made no progress');
          const hits = match(window, 1000 - count)
            .slice(0, 1000 - count)
            .map((hit, i) => ({ ...hit, hitId: `${count + i}` }));
          count += hits.length;
          const exact = window.documentEnd && count < 1000;
          await consume({ hits, scannedThrough: window.range.end, count: { value: count, exact } });
          operation.check();
          at = window.range.end;
          if (window.documentEnd || count === 1000) break;
        } while (at <= operation.snapshot.sourceLength);
      } finally {
        operation.release();
        if (lease) {
          lease.producing = false;
          releaseResults(lease);
        }
      }
    },
  };
}
