import { v4 as uuid } from 'uuid';
import {
  sameNoteScope,
  type NotePagesClient,
  type NoteSplice,
  type NoteStagedSaveOperation,
} from '$lib/client/note-pages';
import { stageTextDigest, validStageText } from '$lib/client/note-source-operation';
import type {
  NotePageSession,
  NotePagesState,
} from '$store/renderer/slices/note-pages/note-pages-types';
import * as a from '$store/renderer/slices/note-pages/note-pages-slice';
import { composeNoteEdits } from './note-edit-plan';

const records = 512,
  units = 262144;
const uint = (n: number) => Number.isSafeInteger(n) && n >= 0;
const same = (a: readonly NoteSplice[], b: readonly NoteSplice[]) =>
  a.length === b.length &&
  a.every((s, i) => s.start === b[i].start && s.end === b[i].end && s.text === b[i].text);
const compact = (s: NoteSplice[]) => s.filter((s) => s.start !== s.end || s.text.length > 0);

/** Called only after DATA admission. The core's immutable replay/forwardReplay
 * alias establishes original native group provenance; a restored/nonaliasing
 * history needs a separately validated producer. Composition proves content,
 * never supplies replacement group identities. */
function capture(note: NotePageSession) {
  const doc = note.document;
  if (
    !doc ||
    ![doc.baseLength, doc.length, doc.generation, doc.cursor].every(uint) ||
    doc.cursor > doc.history.length ||
    doc.history.length > 256 ||
    !doc.replay.length ||
    doc.replay.length > doc.cursor ||
    !doc.dirty.length ||
    doc.dirty.length > records ||
    !note.drafts.length ||
    note.drafts.length > records
  )
    throw new Error('Unsupported staged native history');
  let count = 0,
    textUnits = 0;
  const validate = (splices: readonly NoteSplice[], length: number) => {
    if (!splices.length || (count += splices.length) > records)
      throw new Error('Staged journal record admission exceeded');
    let end = -1,
      start = -1,
      delta = 0;
    for (const s of splices) {
      if (
        !uint(s.start) ||
        !uint(s.end) ||
        s.start < end ||
        s.start === start ||
        s.end < s.start ||
        s.end > length ||
        typeof s.text !== 'string' ||
        (textUnits += s.text.length) > units ||
        !validStageText(s.text)
      )
        throw new Error('Invalid staged native source batch');
      end = s.end;
      start = s.start;
      delta += s.text.length - s.end + s.start;
    }
    if (!uint(length + delta)) throw new Error('Invalid staged source length');
    return length + delta;
  };
  let length = doc.baseLength,
    lastId = -1;
  const first = doc.cursor - doc.replay.length;
  for (let i = 0; i < doc.replay.length; i++) {
    const r = doc.replay[i],
      g = doc.history[first + i];
    if (
      !uint(g.id) ||
      g.id <= lastId ||
      r.id !== g.id ||
      r.direction !== 'redo' ||
      r.edits !== g.forwardReplay ||
      g.beforeLength !== length
    )
      throw new Error('Unsupported staged native group provenance');
    length = validate(g.forward, length);
    lastId = g.id;
  }
  if (length !== doc.length) throw new Error('Staged native history length mismatch');
  length = doc.baseLength;
  let through = -1;
  for (const d of note.drafts) {
    if (
      !uint(d.sequence) ||
      d.sequence <= through ||
      d.baseRevision !== doc.baseRevision ||
      !sameNoteScope(d.scope, doc.scope)
    )
      throw new Error('Staged journal identity mismatch');
    length = validate(d.splices, length);
    through = d.sequence;
  }
  if (length !== doc.length || through !== note.history.at(-1)?.sequence)
    throw new Error('Staged journal fence mismatch');
  const groups = doc.history.slice(first, doc.cursor).map((g) => ({
    id: g.id,
    splices: g.forward.map((s) => ({ start: s.start, end: s.end, text: s.text })),
  }));
  const composed = compact(composeNoteEdits(doc.baseLength, groups));
  if (
    !same(composed, doc.dirty) ||
    !same(compact(composeNoteEdits(doc.baseLength, note.drafts)), doc.dirty)
  )
    throw new Error('Staged native history does not compose to current dirty source');
  return { groups, composed, through, nativeFence: lastId };
}
interface Port {
  read(): NotePagesState;
  dispatch(action: Parameters<typeof a.notePagesReducer>[1]): void;
  subscribe(listener: () => void): () => void;
}
/** Explicit saga integration only. Normal save callers never select this path.
 * Staged effects/inverse adoption is unsupported: committed receipt + unchanged
 * document/history remain gated for reconciliation. No source flattening upload. */
export async function stageNoteDocumentSave(
  port: Port,
  client: NotePagesClient,
  workspaceId: string,
  noteId: string,
  options: { editorSessionId: string; selectionGeneration: number; panelId: string },
) {
  if (!client.createSaveOperation || !client.commitStaged)
    throw new Error('Staged save Unsupported');
  const read = () => port.read().byWorkspaceId[workspaceId]?.notes[noteId];
  const initial = read(),
    doc = initial?.document;
  if (
    !initial ||
    !doc ||
    !initial.state ||
    initial.status !== 'ready' ||
    initial.state.deleted ||
    initial.pending ||
    initial.needsReconcile ||
    !(options.panelId in initial.panels) ||
    initial.state.sourceRevision !== doc.baseRevision ||
    !sameNoteScope(initial.state.scope, doc.scope)
  )
    throw new Error('Staged save unavailable');
  const operationId = uuid(),
    owner = `staged-save:${operationId}`;
  const expiresAt = new Date(Date.now() + 600000).toISOString();
  const deadline = Date.parse(expiresAt);
  let lost = false,
    handedOff = false;
  let admittedOperation: NoteStagedSaveOperation | undefined;
  let stage: ReturnType<NonNullable<NotePagesClient['createSaveOperation']>> | undefined;
  const current = () => {
    const n = read(),
      d = n?.document;
    lost ||=
      Date.now() >= deadline ||
      !n ||
      n.status !== 'ready' ||
      !n.state ||
      n.state.deleted ||
      !(options.panelId in n.panels) ||
      n.generation !== initial.generation ||
      n.needsReconcile ||
      n.state.sourceRevision !== doc.baseRevision ||
      !sameNoteScope(n.state.scope, doc.scope) ||
      (n.pending !== null && n.pending.operation !== admittedOperation) ||
      n.drafts !== initial.drafts ||
      n.history !== initial.history ||
      !d ||
      d.generation !== doc.generation ||
      d.baseRevision !== doc.baseRevision ||
      d.baseLength !== doc.baseLength ||
      d.length !== doc.length ||
      d.cursor !== doc.cursor ||
      d.dirty !== doc.dirty ||
      d.replay !== doc.replay ||
      !sameNoteScope(d.scope, doc.scope);
    return !lost;
  };
  const check = () => {
    if (!current() || !Object.hasOwn(port.read().resourceLedger.owners, owner))
      throw new Error('Staged save owner superseded or unadmitted');
  };
  const unsubscribe = port.subscribe(current);
  let primary: unknown;
  try {
    port.dispatch(
      a.pageResourcesRequested(
        owner,
        [
          {
            id: `${owner}:data`,
            cost: {
              payloadBytes: 8 * (units + 65536),
              stringUnits: 8 * (units + 65536),
              objectNodes: 8 * records,
              physicalReads: 1,
              assemblies: 1,
              domNodes: 0,
            },
          },
        ],
        1,
      ),
    );
    check();
    const captured = capture(initial);
    check();
    stage = client.createSaveOperation(
      {
        scope: doc.scope,
        operationId,
        expiresAt,
        header: {
          baseRevision: doc.baseRevision,
          editorSessionId: options.editorSessionId,
          localEditSequence: captured.nativeFence,
          liveGeneration: doc.generation,
          selectionGeneration: options.selectionGeneration,
          action: 'mutate',
          output: 'source',
          selection: 'all',
        },
      },
      current,
    );
    await stage.begin();
    check();
    for (const group of captured.groups) {
      for (let ordinal = 0; ordinal < group.splices.length; ordinal++) {
        const s = group.splices[ordinal],
          textId = `group:${group.id}:${ordinal}`;
        const sha256 = await stageTextDigest(s.text);
        check();
        let offset = 0;
        // 2048 UTF16 units keeps UTF8 and worst-case escaped request below the
        // existing frame budgets; never split a supplementary scalar.
        do {
          let end = Math.min(offset + 2048, s.text.length);
          if (end < s.text.length && /[\uD800-\uDBFF]/u.test(s.text[end - 1])) end--;
          await stage.append('text', [
            { kind: 'text', id: textId, offset, text: s.text.slice(offset, end) },
          ]);
          check();
          offset = end;
        } while (offset < s.text.length);
        await stage.append('dirty', [
          {
            kind: 'splice',
            localSequence: group.id,
            ordinal,
            start: s.start,
            end: s.end,
            replacement: {
              textId,
              length: s.text.length,
              utf8Bytes: new TextEncoder().encode(s.text).length,
              sha256,
            },
          },
        ]);
        check();
      }
    }
    if ((await stage.seal()) !== doc.length) throw new Error('Sealed save source length mismatch');
    check();
    admittedOperation = {
      ...stage.sealedSave(),
      splices: doc.dirty,
      documentGeneration: doc.generation,
      documentCursor: doc.cursor,
      baseLength: doc.baseLength,
      nativeFence: captured.nativeFence,
    };
    Object.freeze(admittedOperation.scope);
    for (const s of admittedOperation.splices) Object.freeze(s);
    Object.freeze(admittedOperation.splices);
    Object.freeze(admittedOperation);
    port.dispatch(a.pageSaveStarted(workspaceId, noteId, admittedOperation, captured.through));
    check();
    if (read()?.pending?.operation !== admittedOperation)
      throw new Error('Staged save admission changed');
    // Commit dispatch may mutate the daemon even if its acknowledgement is lost.
    // Keep this exact identity in Redux and recover via status, never a new ID.
    handedOff = true;
    try {
      const outcome = await client.commitStaged(admittedOperation);
      port.dispatch(a.pageSaveSettled(workspaceId, noteId, outcome));
      if (
        outcome.outcome === 'committed' &&
        read()?.state?.sourceRevision !== outcome.afterRevision
      )
        port.dispatch(a.pageRefreshRequested(workspaceId, noteId));
    } catch {
      port.dispatch(a.pageSaveUnknown(workspaceId, noteId, operationId));
    }
  } catch (error) {
    primary = error;
    if (admittedOperation) port.dispatch(a.pageSaveUnknown(workspaceId, noteId, operationId));
  } finally {
    try {
      if (stage && !handedOff) await stage.cancel();
    } catch (error) {
      primary ??= error;
    } finally {
      unsubscribe();
      port.dispatch(a.pageResourcesReleased(owner));
    }
  }
  if (primary) throw primary;
}

/** Recover the original pending identity. A sealed status proves no commit was
 * admitted; only that exact unexpired/current capture may be recommitted. */
export async function retryStagedDocumentSave(
  port: Port,
  client: NotePagesClient,
  workspaceId: string,
  noteId: string,
) {
  const read = () => port.read().byWorkspaceId[workspaceId]?.notes[noteId];
  const pending = read()?.pending;
  if (
    !pending ||
    pending.status === 'saving' ||
    !('headerDigest' in pending.operation) ||
    !client.stagedStatus ||
    !client.commitStaged
  )
    return;
  const operation = pending.operation;
  const owner = `staged-retry:${uuid()}`;
  port.dispatch(a.pageStagedSaveRetryStarted(workspaceId, noteId, operation));
  const reservation = read()?.pending;
  if (reservation?.operation !== operation || reservation.status !== 'saving') return;
  let lost = false;
  const panels = Object.keys(read()!.panels);
  const eligible = () => {
    const n = read();
    lost ||=
      !n ||
      !panels.length ||
      panels.some((panel) => !(panel in n.panels)) ||
      n.status !== 'ready' ||
      !n.state ||
      n.state.deleted ||
      !sameNoteScope(n.state.scope, operation.scope) ||
      n.pending !== reservation;
    return !lost;
  };
  const unsubscribe = port.subscribe(eligible);
  try {
    port.dispatch(
      a.pageResourcesRequested(
        owner,
        [
          {
            id: owner,
            cost: {
              payloadBytes: 8 * (units + 65536),
              stringUnits: 8 * (units + 65536),
              objectNodes: 8 * records,
              domNodes: 0,
              physicalReads: 1,
              assemblies: 1,
            },
          },
        ],
        1,
      ),
    );
    const check = () => {
      if (!eligible() || !Object.hasOwn(port.read().resourceLedger.owners, owner))
        throw new Error('Staged retry unadmitted or superseded');
    };
    check();
    const status = await client.stagedStatus(operation);
    check();
    if (status.kind !== 'noteStageState') {
      port.dispatch(a.pageSaveSettled(workspaceId, noteId, status));
      if (status.outcome === 'committed' && read()?.state?.sourceRevision !== status.afterRevision)
        port.dispatch(a.pageRefreshRequested(workspaceId, noteId));
    } else if (status.phase === 'cancelled' || status.phase === 'expired') {
      port.dispatch(a.pageStagedSaveStopped(workspaceId, noteId, operation, status.phase));
    } else {
      const n = read()!,
        d = n.document;
      if (
        status.phase !== 'sealed' ||
        Date.now() >= Date.parse(operation.expiresAt) ||
        n.needsReconcile ||
        n.state?.sourceRevision !== operation.baseRevision ||
        !d ||
        d.generation !== operation.documentGeneration ||
        d.cursor !== operation.documentCursor ||
        d.baseLength !== operation.baseLength ||
        d.length !== operation.viewLength ||
        d.baseRevision !== operation.baseRevision ||
        !sameNoteScope(d.scope, operation.scope) ||
        d.dirty !== operation.splices
      )
        throw new Error('Unsupported changed staged save capture');
      const captured = capture(n);
      if (
        captured.through !== pending.throughSequence ||
        captured.nativeFence !== operation.nativeFence ||
        !same(captured.composed, operation.splices)
      )
        throw new Error('Staged retry capture changed');
      check();
      const outcome = await client.commitStaged(operation);
      // Once commit is invoked, its authoritative result survives local retirement.
      port.dispatch(a.pageSaveSettled(workspaceId, noteId, outcome));
      if (
        outcome.outcome === 'committed' &&
        read()?.state?.sourceRevision !== outcome.afterRevision
      )
        port.dispatch(a.pageRefreshRequested(workspaceId, noteId));
    }
  } catch {
    port.dispatch(a.pageSaveUnknown(workspaceId, noteId, operation.operationId));
  } finally {
    unsubscribe();
    port.dispatch(a.pageResourcesReleased(owner));
  }
}
