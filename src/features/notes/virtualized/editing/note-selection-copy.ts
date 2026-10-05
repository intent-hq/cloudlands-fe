import { v4 as uuid } from 'uuid';
import { sameNoteScope } from '$lib/client/note-pages';
import {
  createNoteSelectionOperation,
  stageTextDigest,
  type NoteSelectionOperationInput,
} from '$lib/client/note-source-operation';
import { openNoteSourceClipboardSink } from '$lib/utils/source-clipboard';
import type { SourceClipboardBegin } from '$shared/ipc/source-clipboard';
import type { NotePagesState } from '$store/renderer/slices/note-pages/note-pages-types';
import * as a from '$store/renderer/slices/note-pages/note-pages-slice';
import type { NoteReadingSurface, NoteWindowView } from '../note-window-view';
import type { NoteSourceSink } from './note-source-copy';
import {
  isNoteSelectionMarkdownCapture,
  UnsupportedNoteSelectionMarkdown,
} from './note-selection-markdown-capture';

interface Options {
  port: {
    read(): NotePagesState;
    dispatch(
      action: ReturnType<typeof a.pageResourcesRequested | typeof a.pageResourcesReleased>,
    ): void;
    subscribe(changed: () => void): () => void;
  };
  client: {
    createSelectionOperation(
      input: NoteSelectionOperationInput,
      current: () => boolean,
    ): ReturnType<typeof createNoteSelectionOperation>;
  };
  workspaceId: string;
  noteId: string;
  editorSessionId: string;
  view(): NoteWindowView | undefined;
  selectionGeneration(): number;
  current(): boolean;
  openSink?(capture: SourceClipboardBegin): Promise<NoteSourceSink>;
  now?: () => number;
}
const encoder = new TextEncoder();
const uint = (v: number) => Number.isSafeInteger(v) && v >= 0;
// Fresh fixed-shape descriptor resources only; never an arbitrary native graph.
const canonical = (value: Record<string, unknown>) =>
  JSON.stringify(value, Object.keys(value).sort());

/** Explicit staged selection-copy consumer. Only a clean current document and
 * the configured native paragraph capture are supported. Normal rollout remains
 * separately gated; unavailable backend output never falls back to source text. */
export function createNoteSelectionCopyOwner(
  options: Options,
): Required<Pick<NoteReadingSurface, 'copySelection' | 'cancelSelectionCopy'>> {
  let cancelActive: (() => void) | undefined;
  return {
    cancelSelectionCopy() {
      cancelActive?.();
    },
    async copySelection(): Promise<'copied' | 'noCopy'> {
      if (cancelActive) throw new Error('Selection copy already in progress');
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
        throw new UnsupportedNoteSelectionMarkdown(
          'Selection copy requires a clean current document',
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
        owner = `selection-copy:${id}`;
      let revoked = false,
        admissionRequired = false,
        committing = false,
        committed = false;
      let lease: ReturnType<NoteWindowView['borrowSelectionMarkdown']> | undefined;
      let operation: ReturnType<typeof createNoteSelectionOperation> | undefined;
      let sink: NoteSourceSink | undefined, aborting: Promise<void> | undefined;
      let abortStarted = false,
        failure: unknown,
        abortFailure: unknown;
      const abort = () => {
        if (!sink || abortStarted) return;
        abortStarted = true;
        try {
          aborting = sink.abort().catch((error: unknown) => {
            abortFailure = error;
          });
        } catch (error) {
          abortFailure = error;
          aborting = Promise.resolve();
        }
      };
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
        if (revoked && committing) abort();
        return !revoked;
      };
      const check = () => {
        if (!current()) throw new Error('Selection copy owner lost');
      };
      cancelActive = () => {
        revoked = true;
        if (committing) abort();
      };
      let unsubscribe: (() => void) | undefined, unsubscribeNative: (() => void) | undefined;
      let result: 'copied' | 'noCopy' = 'noCopy';
      try {
        unsubscribe = port.subscribe(() => current());
        admissionRequired = true;
        port.dispatch(
          a.pageResourcesRequested(
            owner,
            [
              {
                id: owner,
                cost: {
                  payloadBytes: 8 * (32768 + 65536),
                  stringUnits: 8 * (32768 + 65536),
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
        lease = view.borrowSelectionMarkdown(
          {
            scope: capturedScope,
            sourceRevision: baseRevision,
            snapshotId: window.snapshotId,
            documentGeneration,
            liveGeneration,
            selectionGeneration,
            expiresAt,
          },
          () => current(false),
        );
        check();
        unsubscribeNative = lease.subscribe(() => current());
        check();
        const capture = lease.capture;
        if (!isNoteSelectionMarkdownCapture(capture))
          throw new Error('Unverified native selection capture');
        if (capture.markdown === null) return 'noCopy';
        // The current backend subset requires explicit empty attributes on both
        // nodes. Retain the configured serializer proof; do not discard attrs.
        if (
          Object.keys(capture.paragraph.attributes).length ||
          Object.keys(capture.inline.attributes).length
        )
          throw new UnsupportedNoteSelectionMarkdown('Selection attributes are unsupported');
        operation = options.client.createSelectionOperation(
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
              output: 'selectionMarkdown',
              selection: 'ranges',
            },
            expectedOutput: capture.markdown,
          },
          current,
        );
        sink = await (options.openSink ?? openNoteSourceClipboardSink)({
          id,
          length: capture.markdown.length,
          expiresAt: deadline,
        });
        check();
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
        // Explicit sorted fixed keys, including nativeRange's own sorted fields.
        const descriptor = (
          nodeType: string,
          parentOrdinal: number | null,
          nativeRange: { from: number; to: number },
          attributesRef: string,
        ) =>
          JSON.stringify({
            attributesRef,
            nativeRange: { from: nativeRange.from, to: nativeRange.to },
            nodeType,
            parentOrdinal,
            version: 1,
          });
        const paragraph = await upload(
          'paragraph-descriptor',
          descriptor('paragraph', null, capture.paragraph.nativeRange, 'paragraph-attrs'),
        );
        const inline = await upload(
          'text-descriptor',
          descriptor('text', 0, capture.inline.nativeRange, 'text-attrs'),
        );
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
            sourceRange: capture.sourceRange,
            detail: inline,
          },
        ]);
        if ((await operation.seal()) !== documentLength)
          throw new Error('Selection frozen extent differs');
        const target = sink;
        while (!(await operation.read((text) => target.write(text)))) check();
        await operation.cancel();
        check();
        committing = true;
        await sink.commit();
        committed = true;
        result = 'copied';
      } catch (error) {
        failure = error;
      } finally {
        try {
          try {
            await operation?.cancel();
          } finally {
            committing = false;
            if (!committed) abort();
            await aborting;
            if (abortFailure !== undefined) throw abortFailure;
          }
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
      return result;
    },
  };
}
