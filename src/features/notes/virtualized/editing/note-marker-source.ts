import { v4 as uuid } from 'uuid';
import { sameNoteScope } from '$lib/client/note-pages';
import {
  createNoteMarkerSourceOperation,
  stageTextDigest,
  type NoteSourceOperationInput,
} from '$lib/client/note-source-operation';
import type { NotePagesState } from '$store/renderer/slices/note-pages/note-pages-types';
import * as a from '$store/renderer/slices/note-pages/note-pages-slice';
import type { NoteReadingSurface, NoteWindowView } from '../note-window-view';
import { isNoteMarkerCapture, UnsupportedNoteMarkerCapture } from './note-marker-capture';

interface Options {
  port: {
    read(): NotePagesState;
    dispatch(
      action: ReturnType<typeof a.pageResourcesRequested | typeof a.pageResourcesReleased>,
    ): void;
    subscribe(changed: () => void): () => void;
  };
  client: {
    createMarkerSourceOperation(
      input: NoteSourceOperationInput,
      current: () => boolean,
    ): ReturnType<typeof createNoteMarkerSourceOperation>;
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

/** Clean read-only marker upload and bounded source consumer. Native capture is
 * local correspondence only; backend seal must prove original marker ownership.
 * Callback strings are borrowed through settlement; retention requires separate
 * caller admission. No clipboard, staged mutation or normal route activation. */
export function createNoteMarkerSourceOwner(
  options: Options,
): Required<Pick<NoteReadingSurface, 'readMarkerSource' | 'cancelMarkerSource'>> {
  let cancelActive: (() => void) | undefined;
  return {
    cancelMarkerSource() {
      cancelActive?.();
    },
    async readMarkerSource(position, consume): Promise<void> {
      if (cancelActive) throw new Error('Marker source already in progress');
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
        throw new UnsupportedNoteMarkerCapture(
          // i18n-ignore (internal refusal diagnostic; internal search refusal, not UI text)
          'Marker source requires a clean current document',
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
        throw new Error('Invalid marker capture identity');
      const expiresAt = new Date(deadline).toISOString(),
        id = uuid(),
        owner = `marker-source:${id}`;
      let revoked = false,
        admissionRequired = false;
      let lease: ReturnType<NoteWindowView['borrowMarkerOccurrence']> | undefined;
      let operation: ReturnType<typeof createNoteMarkerSourceOperation> | undefined;
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
        if (!current()) throw new Error('Marker source owner lost');
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
                // Bounded raw projection/native proof, fixed descriptor/attrs
                // resources and one source page plus callback overlap. Logical
                // DATA allowance, not a measured JS heap/GC bound. The original
                // mounted source/window lease is separately retained.
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
        lease = view.borrowMarkerOccurrence(
          {
            scope: capturedScope,
            sourceRevision: baseRevision,
            snapshotId: window.snapshotId,
            documentGeneration,
            liveGeneration,
            selectionGeneration,
            expiresAt,
          },
          position,
          () => current(false),
        );
        check();
        unsubscribeNative = lease.subscribe(() => current());
        check();
        const capture = lease.capture;
        if (!isNoteMarkerCapture(capture)) throw new Error('Unverified native marker capture');
        if (Object.keys(capture.parent.attributes).length)
          throw new UnsupportedNoteMarkerCapture('Marker parent attributes are unsupported');
        operation = options.client.createMarkerSourceOperation(
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
              output: 'source',
              selection: 'all',
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
        // Canonical JSON for freshly built fixed-size metadata only.
        const encode = (value: unknown): string => {
          if (Array.isArray(value)) return `[${value.map(encode).join(',')}]`;
          if (value && typeof value === 'object')
            return `{${Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, v]) => `${JSON.stringify(k)}:${encode(v)}`)
              .join(',')}}`;
          return JSON.stringify(value);
        };
        await upload(
          'paragraph-children',
          canonical({ kind: 'metadataChildren', items: [], nextRef: null }),
        );
        await upload(
          'paragraph-attrs',
          canonical({
            id: 'paragraph-attributes',
            parentId: null,
            type: 'object',
            childrenRef: 'paragraph-children',
          }),
        );
        const entries = [];
        for (const key of ['commentId', 'id', 'type'] as const) {
          await upload(`marker-${key}-value`, capture.attributes[key]);
          const textId = `marker-${key}-entry`;
          await upload(
            textId,
            encode({
              id: `marker-${key}`,
              parentId: 'marker-attributes',
              key,
              type: 'string',
              valueRef: `marker-${key}-value`,
            }),
          );
          entries.push(textId);
        }
        await upload(
          'marker-children',
          encode({ kind: 'metadataChildren', items: entries, nextRef: null }),
        );
        await upload(
          'marker-attrs',
          canonical({
            id: 'marker-attributes',
            parentId: null,
            type: 'object',
            childrenRef: 'marker-children',
          }),
        );
        const paragraph = await upload(
          'paragraph-descriptor',
          encode({
            version: 1,
            nodeType: 'paragraph',
            parentOrdinal: null,
            nativeRange: capture.parent.nativeRange,
            attributesRef: 'paragraph-attrs',
          }),
        );
        const marker = await upload(
          'marker-descriptor',
          encode({
            version: 1,
            nodeType: 'commentAnchor',
            parentOrdinal: 0,
            nativeRange: capture.nativeRange,
            attributesRef: 'marker-attrs',
          }),
        );
        await operation.append('live', [
          {
            kind: 'projection',
            ordinal: 0,
            role: 'selection-owner',
            sourceRange: capture.parent.sourceRange,
            detail: paragraph,
          },
          {
            kind: 'projection',
            ordinal: 1,
            role: 'marker-occurrence',
            canonicalId: capture.canonicalId,
            sourceRange: capture.sourceRange,
            detail: marker,
          },
        ]);
        if ((await operation.seal()) !== documentLength)
          throw new Error('Marker frozen extent differs');
        while (
          !(await transport.read(async (text) => {
            check();
            await consume(text);
            check();
          }))
        )
          check();
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
