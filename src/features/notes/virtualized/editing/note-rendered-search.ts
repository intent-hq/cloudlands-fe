import { v4 as uuid } from 'uuid';
import { sameNoteScope } from '$lib/client/note-pages';
import {
  createNoteRenderedSearchOperation,
  stageTextDigest,
  type NoteRenderedSearchOperationInput,
} from '$lib/client/note-source-operation';
import type { NotePagesState } from '$store/renderer/slices/note-pages/note-pages-types';
import * as a from '$store/renderer/slices/note-pages/note-pages-slice';
import type { NoteReadingSurface, NoteWindowView } from '../note-window-view';
import {
  isNoteRenderedSearchCapture,
  UnsupportedNoteRenderedSearch,
} from './note-rendered-search-capture';

import { consumeNoteRenderedSearch } from './note-rendered-search-results';

interface Options {
  port: {
    read(): NotePagesState;
    dispatch(
      action: ReturnType<typeof a.pageResourcesRequested | typeof a.pageResourcesReleased>,
    ): void;
    subscribe(changed: () => void): () => void;
  };
  client: {
    createRenderedSearchOperation(
      input: NoteRenderedSearchOperationInput,
      current: () => boolean,
    ): ReturnType<typeof createNoteRenderedSearchOperation>;
  };
  workspaceId: string;
  noteId: string;
  editorSessionId: string;
  view(): NoteWindowView | undefined;
  selectionGeneration(): number;
  current(): boolean;
  now?: () => number;
}
const encoder = new TextEncoder();
const uint = (v: number) => Number.isSafeInteger(v) && v >= 0;
// Fresh fixed-shape descriptor resources only; never an arbitrary native graph.
const canonical = (value: Record<string, unknown>) =>
  JSON.stringify(value, Object.keys(value).sort());

/** Explicit clean native rendered-search owner. Each validated page is delivered
 * while the original native/context and logical DATA leases remain held. No
 * fallback to source search, Markdown, rich/dirty contexts or normal activation. */
export function createNoteRenderedSearchOwner(
  options: Options,
): Required<Pick<NoteReadingSurface, 'searchRendered' | 'cancelRenderedSearch'>> {
  let cancelActive: (() => void) | undefined;
  return {
    cancelRenderedSearch() {
      cancelActive?.();
    },
    async searchRendered(text, consume): Promise<void> {
      if (cancelActive) throw new Error('Rendered search already in progress');
      const { port } = options,
        now = options.now ?? Date.now;
      const read = () => port.read().byWorkspaceId[options.workspaceId]?.notes[options.noteId];
      const note = read(),
        document = note?.document,
        view = options.view(),
        window = view?.window;
      if (
        !note ||
        !document ||
        !view ||
        !window ||
        !note.state ||
        note.status !== 'ready' ||
        note.pending ||
        note.needsReconcile ||
        note.drafts.length ||
        document.dirty.length ||
        document.replay.length ||
        document.baseRevision !== note.state.sourceRevision ||
        document.length !== document.baseLength ||
        !sameNoteScope(document.scope, note.state.scope) ||
        !sameNoteScope(document.scope, window.scope) ||
        window.sourceRevision !== document.baseRevision
      )
        throw new UnsupportedNoteRenderedSearch(
          // i18n-ignore (internal refusal diagnostic; internal search refusal, not UI text)
          'Rendered search requires a clean current document',
        );
      const capturedScope = Object.freeze({ ...document.scope });
      const baseRevision = document.baseRevision,
        documentGeneration = document.generation,
        documentLength = document.length,
        noteGeneration = note.generation,
        cursor = document.cursor,
        dirty = document.dirty,
        replay = document.replay,
        history = document.history,
        drafts = note.drafts,
        checkpoint = note.history;
      const checkpointLength = checkpoint.length,
        checkpointTail = checkpoint.at(-1),
        historyLength = history.length;
      const localEditSequence = checkpointTail?.sequence ?? 0;
      const selectionGeneration = options.selectionGeneration(),
        liveGeneration = view.selectionCaptureGeneration;
      const deadline = Math.min(Date.parse(window.expiresAt ?? ''), now() + 600_000);
      if (
        ![localEditSequence, selectionGeneration, liveGeneration, document.generation].every(
          uint,
        ) ||
        !Number.isFinite(deadline) ||
        deadline <= now()
      )
        throw new Error('Invalid selection capture identity');
      const expiresAt = new Date(deadline).toISOString(),
        id = uuid(),
        owner = `rendered-search:${id}`;
      const query = Object.freeze({
        text,
        caseSensitive: false as const,
        mode: 'renderedText' as const,
      });
      let revoked = false,
        admissionRequired = false;
      let lease: ReturnType<NoteWindowView['borrowRenderedSearch']> | undefined;
      let operation: ReturnType<typeof createNoteRenderedSearchOperation> | undefined;
      let failure: unknown;
      const current = (checkNative = true) => {
        try {
          // Re-read captured state after executable predicates, including the
          // native borrow's owner check. Their callbacks may retire this owner.
          const valid =
            options.current() &&
            options.view() === view &&
            options.selectionGeneration() === selectionGeneration &&
            view.selectionCaptureGeneration === liveGeneration &&
            (!checkNative || lease === undefined || lease.current());
          const n = read();
          revoked ||=
            !valid ||
            now() >= deadline ||
            n?.document !== document ||
            document.generation !== documentGeneration ||
            document.baseRevision !== baseRevision ||
            document.baseLength !== documentLength ||
            document.length !== documentLength ||
            document.cursor !== cursor ||
            !sameNoteScope(document.scope, capturedScope) ||
            document.dirty !== dirty ||
            dirty.length !== 0 ||
            document.replay !== replay ||
            replay.length !== 0 ||
            document.history !== history ||
            history.length !== historyLength ||
            n?.generation !== noteGeneration ||
            n?.status !== 'ready' ||
            !!n.pending ||
            !!n.needsReconcile ||
            n.drafts !== drafts ||
            drafts.length !== 0 ||
            n.history !== checkpoint ||
            checkpoint.length !== checkpointLength ||
            checkpoint.at(-1) !== checkpointTail ||
            (checkpointTail?.sequence ?? 0) !== localEditSequence ||
            !n.state ||
            n.state.deleted ||
            n.state.sourceRevision !== baseRevision ||
            !sameNoteScope(n.state.scope, capturedScope) ||
            (admissionRequired && !Object.hasOwn(port.read().resourceLedger.owners, owner));
        } catch {
          revoked = true;
        }
        return !revoked && (!checkNative || lease === undefined || lease.current());
      };
      const check = () => {
        if (!current()) throw new Error('Rendered search owner lost');
      };
      cancelActive = () => {
        revoked = true;
      };
      let unsubscribe: (() => void) | undefined, unsubscribeNative: (() => void) | undefined;
      try {
        unsubscribe = port.subscribe(() => current());
        admissionRequired = true;
        port.dispatch(
          a.pageResourcesRequested(
            owner,
            [
              {
                id: owner,
                // Two <=4096 token sets (<=256 UTF-8 bytes/token), <=4096
                // numeric span keys, bounded per-hit metadata traversal, page
                // snapshots and repeated <=4096-unit native proof. Original
                // window/context debt stays separately borrowed. This is logical
                // DATA admission, not a measured JS heap/GC bound; deny if absent.
                cost: {
                  payloadBytes: 32 * (32768 + 65536),
                  stringUnits: 32 * (32768 + 65536),
                  objectNodes: 16 * 32768,
                  domNodes: 0,
                  physicalReads: 1,
                  assemblies: 1,
                },
              },
            ],
            1,
          ),
        );
        check();
        lease = view.borrowRenderedSearch(
          {
            scope: capturedScope,
            sourceRevision: baseRevision,
            snapshotId: window.snapshotId,
            documentGeneration,
            liveGeneration,
            selectionGeneration,
            expiresAt,
          },
          query,
          () => current(false),
        );
        check();
        unsubscribeNative = lease.subscribe(() => current());
        check();
        const capture = lease.capture;
        if (!isNoteRenderedSearchCapture(capture))
          throw new Error('Unverified native selection capture');
        // The current backend subset requires explicit empty attributes on both
        // nodes. Retain the actual raw native capture; do not discard attrs.
        if (
          Object.keys(capture.paragraph.attributes).length ||
          Object.keys(capture.inline.attributes).length
        )
          throw new UnsupportedNoteRenderedSearch('Selection attributes are unsupported');
        operation = options.client.createRenderedSearchOperation(
          {
            scope: capturedScope,
            operationId: uuid(),
            expiresAt,
            header: {
              baseRevision,
              editorSessionId: options.editorSessionId,
              localEditSequence,
              liveGeneration,
              selectionGeneration,
              action: 'read',
              output: 'search',
              query,
              selection: 'ranges',
            },
          },
          current,
        );
        await operation.begin();
        const transport = operation;
        const upload = async (textId: string, text: string) => {
          check();
          const sha256 = await stageTextDigest(text);
          check();
          await transport.append('text', [{ kind: 'text', id: textId, offset: 0, text }]);
          return { textId, length: text.length, utf8Bytes: encoder.encode(text).length, sha256 };
        };
        for (const name of ['paragraph', 'text']) {
          await upload(
            `${name}-children`,
            canonical({ kind: 'metadataChildren', items: [], nextRef: null }),
          );
          await upload(
            `${name}-attrs`,
            canonical({
              childrenRef: `${name}-children`,
              id: `${name}-attributes`,
              parentId: null,
              type: 'object',
            }),
          );
        }
        const renderedText = await upload('rendered-leaf', capture.rendered.text);
        const parentDescriptor = Object.freeze({
          attributesRef: 'paragraph-attrs',
          nativeRange: Object.freeze({ ...capture.paragraph.nativeRange }),
          nodeType: 'paragraph',
          parentOrdinal: null,
          version: 1,
        });
        const leafDescriptor = Object.freeze({
          attributesRef: 'text-attrs',
          nativeRange: Object.freeze({ ...capture.inline.nativeRange }),
          nodeType: 'text',
          parentOrdinal: 0,
          renderedText: Object.freeze(renderedText),
          version: 2,
        });
        // Descriptors and nested tuple fields must use the same recursive
        // canonical JSON as the immutable upload hash, never normalize on read.
        const encode = (value: unknown): string => {
          if (value && typeof value === 'object')
            return `{${Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, v]) => `${JSON.stringify(k)}:${encode(v)}`)
              .join(',')}}`;
          return JSON.stringify(value);
        };
        const paragraph = await upload('paragraph-descriptor', encode(parentDescriptor));
        const inline = await upload('text-descriptor', encode(leafDescriptor));
        await operation.append('selection', [
          {
            kind: 'range',
            ordinal: 0,
            ...capture.sourceRange,
            anchorAffinity: capture.selection.anchorAffinity < 0 ? 'before' : 'after',
            headAffinity: capture.selection.headAffinity < 0 ? 'before' : 'after',
            direction: capture.direction,
          },
        ]);
        await operation.append('live', [
          {
            kind: 'projection',
            ordinal: 0,
            role: 'selection-owner',
            sourceRange: capture.paragraph.sourceRange,
            detail: paragraph,
          },
          {
            kind: 'projection',
            ordinal: 1,
            role: 'inline-span',
            sourceRange: capture.inline.sourceRange,
            detail: inline,
          },
        ]);
        if ((await operation.seal()) !== documentLength)
          throw new Error('Selection frozen extent differs');
        await consumeNoteRenderedSearch(
          capture,
          { parent: parentDescriptor, leaf: leafDescriptor },
          documentLength,
          (request) => transport.readRendered(request),
          check,
          consume,
        );
        await operation.cancel();
        check();
      } catch (error) {
        failure = error;
      } finally {
        try {
          await operation?.cancel();
        } catch (error) {
          failure ??= error;
        } finally {
          try {
            unsubscribeNative?.();
            lease?.release();
          } finally {
            port.dispatch(a.pageResourcesReleased(owner));
            unsubscribe?.();
            cancelActive = undefined;
          }
        }
      }
      if (failure !== undefined) throw failure;
    },
  };
}
