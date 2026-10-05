import { v4 as uuid } from 'uuid';
import { sameNoteScope } from '$lib/client/note-pages';
import {
  stageTextDigest,
  validStageText,
  type NoteSourceOperation,
  type NoteSourceOperationInput,
} from '$lib/client/note-source-operation';
import type { NotePagesState } from '$store/renderer/slices/note-pages/note-pages-types';
import * as a from '$store/renderer/slices/note-pages/note-pages-slice';
import type { NoteReadingSurface } from '../note-window-view';
import { composeNoteEdits } from './note-edit-plan';

/** Output is externally staged, with one bounded write in flight. Invoking commit
 * transfers the complete output to the sink for publication; its completion must
 * acknowledge actual publication. After that invocation cancellation cannot retract
 * output or restore an earlier clipboard. abort only discards private staging,
 * including after an uncertain commit failure; it must never undo public output.
 * A renderer string accumulator is not an implementation of this interface. */
export interface NoteSourceSink {
  write(text: string): Promise<void>;
  commit(): void | Promise<void>;
  abort(): Promise<void>;
}
interface Options {
  port: {
    read(): NotePagesState;
    dispatch(
      action: ReturnType<typeof a.pageResourcesRequested | typeof a.pageResourcesReleased>,
    ): void;
    subscribe(changed: () => void): () => void;
  };
  client: {
    createSourceOperation(
      input: NoteSourceOperationInput,
      current: () => boolean,
    ): NoteSourceOperation;
  };
  workspaceId: string;
  noteId: string;
  editorSessionId: string;
  /** Read the actual selection-owner counter at capture. Source/all does not
   * upload selection descriptors or invent a native selection generation. */
  selectionGeneration(): number;
  /** Captured panel incarnation; the subscribed latch makes loss irreversible. */
  current(): boolean;
  /** Admission for an external atomic sink, before any staging RPC. Unsupported
   * platforms reject here; they never fall back to copying the visible window. */
  openSink(): Promise<NoteSourceSink>;
  now?: () => number;
}
const journalUnits = 262144;
const journalRecords = 512;
const frame = 65536;
const uint = (v: number) => Number.isSafeInteger(v) && v >= 0;
const encoder = new TextEncoder();

/** Supplies the reading surface's actual whole-document copy callback. The
 * rollout owner still supplies its normal capability gate and platform sink.
 * Only the admitted Redux journal is supported; source size is never capped. */
export function createNoteSourceCopyOwner(
  options: Options,
): Required<Pick<NoteReadingSurface, 'copyDocument' | 'cancelCopy'>> {
  let cancelActive: (() => void) | undefined;
  return {
    cancelCopy() {
      cancelActive?.();
    },
    async copyDocument() {
      if (cancelActive) throw new Error('Document copy already in progress');
      const { port } = options,
        now = options.now ?? Date.now;
      const owner = `source-copy:${uuid()}`;
      let revoked = false,
        committed = false,
        sealed = false;
      let failure: unknown;
      let sink: NoteSourceSink | undefined, operation: NoteSourceOperation | undefined;
      const expiresAt = new Date(now() + 600_000).toISOString();
      const deadline = Date.parse(expiresAt);
      const read = () => port.read().byWorkspaceId[options.workspaceId]?.notes[options.noteId];
      const initial = read(),
        document = initial?.document;
      if (
        !initial ||
        !document ||
        !initial.state ||
        initial.status !== 'ready' ||
        initial.pending ||
        initial.needsReconcile ||
        initial.state.sourceRevision !== document.baseRevision ||
        !sameNoteScope(initial.state.scope, document.scope)
      )
        throw new Error('Document source copy unavailable');
      const drafts = initial.drafts;
      const checkpoint = initial.history;
      const initiallyPristine =
        drafts.length === 0 &&
        checkpoint.length === 0 &&
        document.history.length === 0 &&
        document.dirty.length === 0 &&
        document.replay.length === 0 &&
        document.length === document.baseLength;
      const localEditSequence = initial.history.at(-1)?.sequence ?? 0;
      const selectionGeneration = options.selectionGeneration();
      if (!uint(localEditSequence) || !uint(selectionGeneration))
        throw new Error('Invalid staged capture generation');
      const eligible = () => {
        const n = read();
        let external = false;
        try {
          external = options.current();
        } catch {
          /* Ownership errors revoke. */
        }
        const remoteRevision =
          sealed &&
          n?.state &&
          n.state.sourceRevision !== document.baseRevision &&
          sameNoteScope(n.state.scope, document.scope);
        const d = n?.document;
        const sameLocalContent =
          d &&
          d.generation === document.generation &&
          d.baseRevision === document.baseRevision &&
          d.baseLength === document.baseLength &&
          d.length === document.length &&
          d.cursor === document.cursor &&
          d.dirty === document.dirty &&
          d.replay === document.replay &&
          sameNoteScope(d.scope, document.scope);
        // The reducer drops/recreates only pristine documents on a remote source
        // revision. That is not a local edit of our already sealed frozen source.
        // Draft/checkpoint identity and the external panel/auth latch still apply.
        const pristineRemoteReplacement =
          remoteRevision &&
          initiallyPristine &&
          (!d ||
            (d.baseRevision === n.state?.sourceRevision &&
              sameNoteScope(d.scope, document.scope) &&
              d.generation === 0 &&
              d.cursor === 0 &&
              d.history.length === 0 &&
              d.dirty.length === 0 &&
              d.replay.length === 0 &&
              d.length === d.baseLength));
        revoked ||=
          !external ||
          now() >= deadline ||
          !n ||
          n.status !== 'ready' ||
          n.pending !== null ||
          n.drafts !== drafts ||
          n.history !== checkpoint ||
          (!sameLocalContent && !pristineRemoteReplacement) ||
          (!sealed &&
            (n.generation !== initial.generation ||
              n.needsReconcile ||
              n.state?.sourceRevision !== document.baseRevision)) ||
          (n.needsReconcile && !remoteRevision) ||
          !n.state ||
          n.state.deleted ||
          !sameNoteScope(n.state.scope, document.scope);
        return !revoked;
      };
      const check = () => {
        if (!eligible() || !Object.hasOwn(port.read().resourceLedger.owners, owner))
          throw new Error('Document source copy superseded or unadmitted');
      };
      cancelActive = () => {
        revoked = true;
      };
      const unsubscribe = port.subscribe(eligible);
      try {
        // Before copies, hashing, transport or sink allocation. Logical accounting
        // includes captured journal, UTF-8/hash scratch and escaped request/frame.
        port.dispatch(
          a.pageResourcesRequested(
            owner,
            [
              {
                id: `${owner}:data`,
                cost: {
                  payloadBytes: 8 * (journalUnits + frame),
                  stringUnits: 8 * (journalUnits + frame),
                  objectNodes: 8 * journalRecords,
                  domNodes: 0,
                  physicalReads: 1,
                  assemblies: 1,
                },
              },
            ],
            1,
          ),
        );
        check(); // Queued/denied admission refuses without retaining another copy.
        if (drafts.length > journalRecords)
          throw new Error('Document journal exceeds copy admission');
        let units = 0,
          count = 0,
          sequence = -1,
          length = document.baseLength;
        if (!uint(length)) throw new Error('Invalid document base length');
        // Bound before copying any variable-sized string/record collection.
        for (const draft of drafts) {
          if (
            !uint(draft.sequence) ||
            draft.sequence <= sequence ||
            draft.baseRevision !== document.baseRevision ||
            !sameNoteScope(draft.scope, document.scope) ||
            draft.splices.length === 0 ||
            (count += draft.splices.length) > journalRecords
          )
            throw new Error('Invalid captured dirty journal');
          sequence = draft.sequence;
          let previous = -1,
            previousStart = -1,
            delta = 0;
          for (const splice of draft.splices) {
            if (
              !uint(splice.start) ||
              !uint(splice.end) ||
              splice.start < previous ||
              splice.start === previousStart ||
              splice.end < splice.start ||
              splice.end > length ||
              (units += splice.text.length) > journalUnits ||
              !validStageText(splice.text)
            )
              throw new Error('Invalid captured dirty splice');
            previous = splice.end;
            previousStart = splice.start;
            delta += splice.text.length - splice.end + splice.start;
          }
          length += delta;
          if (!uint(length)) throw new Error('Invalid captured dirty extent');
        }
        if (length !== document.length)
          throw new Error('Captured dirty extent disagrees with document');
        if (drafts.length > 0 && sequence !== localEditSequence)
          throw new Error('Captured dirty fence disagrees with journal checkpoint');
        const batches = drafts.map((d) => ({
          sequence: d.sequence,
          splices: d.splices.map((s) => ({ start: s.start, end: s.end, text: s.text })),
        }));
        const composed = composeNoteEdits(document.baseLength, batches).filter(
          (s) => s.start !== s.end || s.text.length > 0,
        );
        if (
          composed.length !== document.dirty.length ||
          composed.some((s, i) => {
            const d = document.dirty[i];
            return s.start !== d.start || s.end !== d.end || s.text !== d.text;
          })
        )
          throw new Error('Captured journal does not describe current document');
        check();
        operation = options.client.createSourceOperation(
          {
            scope: document.scope,
            operationId: uuid(),
            expiresAt,
            header: {
              baseRevision: document.baseRevision,
              editorSessionId: options.editorSessionId,
              localEditSequence,
              liveGeneration: document.generation,
              selectionGeneration,
              action: 'read',
              output: 'source',
              selection: 'all',
            },
          },
          eligible,
        );
        sink = await options.openSink();
        check();
        await operation.begin();
        let textId = 0;
        for (const batch of batches) {
          for (let ordinal = 0; ordinal < batch.splices.length; ordinal++) {
            const splice = batch.splices[ordinal],
              id = `text-${textId++}`;
            check();
            const sha256 = await stageTextDigest(splice.text);
            check();
            // <=4096 UTF-16 units => <=12288 UTF-8 bytes; never split a scalar.
            // The empty text ID is explicitly uploaded and still has its raw hash.
            let at = 0;
            do {
              let end = Math.min(splice.text.length, at + 4096);
              if (end < splice.text.length && /[\uD800-\uDBFF]/u.test(splice.text[end - 1])) end--;
              await operation.append('text', [
                { kind: 'text', id, offset: at, text: splice.text.slice(at, end) },
              ]);
              at = end;
            } while (at < splice.text.length);
            await operation.append('dirty', [
              {
                kind: 'splice',
                localSequence: batch.sequence,
                ordinal,
                start: splice.start,
                end: splice.end,
                replacement: {
                  textId: id,
                  length: splice.text.length,
                  utf8Bytes: encoder.encode(splice.text).length,
                  sha256,
                },
              },
            ]);
          }
        }
        if ((await operation.seal()) !== document.length)
          throw new Error('Sealed source extent differs');
        sealed = true;
        const target = sink;
        while (!(await operation.read((text) => target.write(text)))) check();
        // No output is published until remote cleanup and ownership recheck. DATA
        // and the subscription remain live across cleanup, preventing revival.
        await operation.cancel();
        check();
        // This invocation is the one-way publication handoff. Ownership was
        // checked above without an intervening await. Hold DATA and observe the
        // real acknowledgement, even if the panel closes while it is pending.
        // A post-handoff ownership check cannot turn published output into an
        // unperformed operation or justify restoring an older clipboard.
        await sink.commit();
        committed = true;
      } catch (error) {
        failure = error;
      } finally {
        try {
          try {
            await operation?.cancel();
          } finally {
            if (!committed) await sink?.abort();
          }
        } catch (error) {
          failure ??= error;
        } finally {
          port.dispatch(a.pageResourcesReleased(owner));
          unsubscribe();
          cancelActive = undefined;
        }
      }
      if (failure !== undefined) throw failure;
    },
  };
}
