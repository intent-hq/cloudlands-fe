import { validateNoteStagedCanonicalEffects } from './note-staged-canonical-effects';
import { v4 as uuid } from 'uuid';
import {
  pageResourcesRequested,
  pageResourcesReleased,
} from '$store/renderer/slices/note-pages/note-pages-slice';
import { currentNoteNativeHistoryWitness } from './note-native-history-witness';
import {
  sameNoteScope,
  type NoteCommitReceipt,
  type NotePagesClient,
  type NoteStagedSaveOperation,
} from '$lib/client/note-pages';
import { stageTextDigest, validStageText } from '$lib/client/note-source-operation';
import { beforeSourceDeadline, parseSourceDeadline } from '$shared/source-session-expiry';
import {
  assertNoteTextDocumentSession,
  type NoteDocumentSession,
} from './note-document-edit-session';
import { composeNoteEdits } from './note-edit-plan';
import { reserveNoteReceiptTranscript } from './note-receipt-transcript';

const uint = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const token = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && new TextEncoder().encode(v).length <= 256;
const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid inverse record');
  return v as Record<string, unknown>;
};

function progress() {
  let checkpoint: string | undefined,
    distance = 0,
    power = 1;
  return (cursor: string | null) => {
    if (cursor === null) return;
    if (cursor === checkpoint) throw new Error('Cyclic staged receipt');
    if (checkpoint === undefined) checkpoint = cursor;
    else if (++distance === power) {
      checkpoint = cursor;
      distance = 0;
      power = Math.min(Number.MAX_SAFE_INTEGER, power * 2);
    }
  };
}

/** Preserve already-owned native history only when the complete receipt proves
 * the exact captured local result. Inverse source records validate that history;
 * they never construct native replay tokens or marker/alias authority. Canonical
 * source changes, alternate inverse decompositions and later edits are refused. */
export async function readNoteStagedReceiptResult(
  port: Parameters<typeof reserveNoteReceiptTranscript>[0],
  client: Pick<NotePagesClient, 'readReceipt'>,
  originalReceipt: NoteCommitReceipt,
  operation: NoteStagedSaveOperation,
  document: NoteDocumentSession,
  ownerCurrent: () => boolean,
  signal?: AbortSignal,
) {
  assertNoteTextDocumentSession(document);
  const receipt = Object.freeze({
    ...originalReceipt,
    scope: Object.freeze({ ...originalReceipt.scope }),
  });
  const deadline = parseSourceDeadline(receipt.receiptExpiresAt);
  let lost = false;
  let borrowing = false;
  const borrower = `${operation.witnessOwner}:receipt:${uuid()}`;
  const current = () => {
    let owned = false;
    try {
      owned = ownerCurrent();
    } catch {
      /* Permanent loss. */
    }
    lost ||=
      !owned ||
      !Object.hasOwn(
        port.read().resourceLedger.owners,
        borrowing ? borrower : operation.witnessOwner,
      ) ||
      !currentNoteNativeHistoryWitness(document, operation.nativeWitness) ||
      signal?.aborted === true ||
      !beforeSourceDeadline(Date.now(), deadline);
    return !lost;
  };
  const check = () => {
    if (!current()) throw new Error('Staged receipt owner lost');
  };
  let observeIO = false;
  let lease: ReturnType<typeof reserveNoteReceiptTranscript> | undefined;
  const checkIO = () => {
    check();
    if (!lease?.current()) {
      lost = true;
      throw new Error('Staged receipt DATA lost');
    }
  };
  const unsubscribe = port.subscribe(() => {
    current();
    if (observeIO && !lease?.current()) lost = true;
  });
  try {
    if (
      !receipt.headerDigest ||
      !receipt.viewId ||
      receipt.headerDigest !== operation.headerDigest ||
      receipt.payloadDigest !== operation.payloadDigest ||
      receipt.operationId !== operation.operationId ||
      receipt.beforeRevision !== operation.baseRevision ||
      !sameNoteScope(receipt.scope, operation.scope) ||
      !sameNoteScope(document.scope, operation.scope) ||
      document.baseRevision !== operation.baseRevision ||
      document.generation !== operation.documentGeneration ||
      document.cursor !== operation.documentCursor ||
      document.baseLength !== operation.baseLength ||
      document.length !== operation.viewLength ||
      document.length !== receipt.sourceLength ||
      document.dirty !== operation.splices ||
      !document.replay.length ||
      document.replay.length > document.cursor ||
      document.history.length > 256
    )
      throw new Error('Unsupported staged receipt capture');
    check();
    const resource = port.read().resourceLedger.resources[operation.witnessOwner];
    if (!resource) throw new Error('Native witness reservation lost');
    // Share the actual retained witness allocation before yielding. Discard may
    // retire its Redux owner, but this borrower keeps it charged through all IO.
    port.dispatch(
      pageResourcesRequested(borrower, [{ id: operation.witnessOwner, cost: resource.cost }], 1),
    );
    if (!Object.hasOwn(port.read().resourceLedger.owners, borrower))
      throw new Error('Native witness borrow denied');
    borrowing = true;
    check();
    lease = reserveNoteReceiptTranscript(
      port,
      client,
      receipt,
      document.baseLength,
      current,
      signal,
      Date.now,
      262144,
    );
    const ready = await lease.ready;
    observeIO = true;
    checkIO();

    // Bound native semantic scratch before copying/hashing. Original replay aliases
    // establish native group provenance; opaque receipt IDs are never parsed as IDs.
    let units = 0,
      count = 0,
      length = document.baseLength,
      lastId = -1;
    const first = document.cursor - document.replay.length;
    for (let i = first; i < document.cursor; i++) {
      const g = document.history[i],
        r = document.replay[i - first];
      if (
        !uint(g.id) ||
        g.id <= lastId ||
        g.id !== r.id ||
        r.direction !== 'redo' ||
        r.edits !== g.forwardReplay ||
        g.beforeLength !== length ||
        !g.inverse.length
      )
        throw new Error('Unsupported native inverse provenance');
      for (const batch of [g.forward, g.inverse]) {
        count += batch.length;
        for (const s of batch) {
          units += s.text.length;
          if (
            units > 262144 ||
            count > 512 ||
            !uint(s.start) ||
            !uint(s.end) ||
            s.end < s.start ||
            !validStageText(s.text)
          )
            throw new Error('Native inverse admission exceeded');
        }
      }
      length += g.forward.reduce((n, s) => n + s.text.length - s.end + s.start, 0);
      lastId = g.id;
    }
    if (length !== document.length || lastId !== operation.nativeFence)
      throw new Error('Native inverse fence mismatch');
    const groups = document.history.slice(first, document.cursor).map((g) => ({
      beforeLength: g.beforeLength,
      forward: g.forward.map((s) => ({ ...s })),
      inverse: g.inverse.map((s) => ({ ...s })),
    }));
    const composed = composeNoteEdits(
      document.baseLength,
      groups.map((g) => ({ splices: g.forward })),
    ).filter((s) => s.start !== s.end || s.text.length);
    if (
      composed.length !== operation.splices.length ||
      composed.some(
        (s, i) =>
          s.start !== operation.splices[i].start ||
          s.end !== operation.splices[i].end ||
          s.text !== operation.splices[i].text,
      )
    )
      throw new Error('Native capture differs from staged write');
    const mappingProgress = progress(),
      inverseProgress = progress();
    let mapping = 0;
    while (
      !(await ready.consumeNext('mapping', (page) => {
        mappingProgress(page.nextCursor);
        for (const v of page.items) {
          const item = record(v),
            expected = composed[mapping++];
          if (
            !expected ||
            item.start !== expected.start ||
            item.end !== expected.end ||
            item.insertedLength !== expected.text.length
          )
            throw new Error('Staged mapping differs from native result');
        }
      }))
    ) {
      /* finite exact expected prefix; repeats exceed expected records */
    }
    if (mapping !== composed.length) throw new Error('Incomplete staged mapping');
    const effects = await validateNoteStagedCanonicalEffects(
      client,
      receipt,
      document.baseLength,
      document.length,
      ready,
      checkIO,
    );
    if (effects.sourceEffects || effects.convertedCount || effects.createdTasks)
      throw new Error('Canonical staged effects unsupported');
    const verifyProvenance = async (root: string, expected: Record<string, unknown>) => {
      const ids = new Set<string>(),
        refs = new Set<string>();
      const read = async (ref: string, cursor?: string) => {
        checkIO();
        const page = await client.readReceipt(receipt, {
          kind: 'detail',
          ref,
          baseLength: document.baseLength,
          ...(cursor === undefined ? {} : { cursor }),
          maxItems: 16,
          maxWireBytes: 8192,
        });
        checkIO();
        if (page.outputKind !== 'detail') throw new Error('Invalid provenance envelope');
        return page;
      };
      const entry = async (
        value: unknown,
        expected: unknown,
        parent: string | null,
        key?: string,
      ): Promise<void> => {
        const item = record(value);
        if (
          !token(item.id) ||
          ids.has(item.id) ||
          ids.size >= 32 ||
          item.parentId !== parent ||
          item.key !== key ||
          'keyRef' in item ||
          'index' in item
        )
          throw new Error('Invalid provenance tree identity');
        ids.add(item.id);
        const baseKeys = key === undefined ? 2 : 3;
        if (typeof expected === 'string' || typeof expected === 'number') {
          if (
            Object.keys(item).length !== baseKeys + 2 ||
            item.type !== typeof expected ||
            item.value !== expected
          )
            throw new Error('Inverse provenance value mismatch');
          return;
        }
        if (
          item.type !== 'object' ||
          !token(item.childrenRef) ||
          Object.keys(item).length !== baseKeys + 2 ||
          refs.has(item.childrenRef)
        )
          throw new Error('Unsupported inverse provenance');
        refs.add(item.childrenRef);
        const fields = Object.entries(expected as Record<string, unknown>).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        );
        let index = 0,
          cursor: string | undefined;
        const advance = progress();
        do {
          const page = await read(item.childrenRef, cursor);
          advance(page.nextCursor);
          if (!page.items.length) throw new Error('Empty provenance continuation');
          for (const child of page.items) {
            const field = fields[index++];
            if (!field) throw new Error('Unexpected provenance field');
            await entry(child, field[1], item.id, field[0]);
          }
          cursor = page.nextCursor ?? undefined;
        } while (cursor !== undefined);
        if (index !== fields.length) throw new Error('Incomplete provenance fields');
      };
      refs.add(root);
      const page = await read(root);
      if (page.items.length !== 1 || page.nextCursor !== null)
        throw new Error('Invalid provenance root');
      await entry(page.items[0], expected, null);
    };
    let groupIndex = groups.length - 1,
      ordinal = 0,
      inverseLength = document.length,
      groupDelta = 0,
      previousEnd = -1;
    let input: unknown = receipt.afterRevision,
      output: unknown,
      groupId: unknown;
    const seenGroups = new Set<string>(); // bounded by the admitted native group count
    while (
      !(await ready.consumeNext('inverse', async (page) => {
        inverseProgress(page.nextCursor);
        for (const v of page.items) {
          const item = record(v),
            expected = groups[groupIndex]?.inverse[ordinal];
          if (
            !expected ||
            Object.keys(item).length !== 8 ||
            !token(item.historyGroup) ||
            !token(item.provenanceRef) ||
            !token(item.inputState) ||
            !token(item.outputState) ||
            item.ordinal !== ordinal ||
            item.start !== expected.start ||
            item.end !== expected.end ||
            item.inputState !== input ||
            expected.end > inverseLength ||
            expected.start < previousEnd
          )
            throw new Error('Inverse does not match native history');
          if (ordinal === 0) {
            if (seenGroups.has(item.historyGroup)) throw new Error('Repeated inverse group');
            seenGroups.add(item.historyGroup);
            groupId = item.historyGroup;
            output = item.outputState;
          } else if (item.historyGroup !== groupId || item.outputState !== output)
            throw new Error('Inverse group identity changed');
          const replacement = record(item.replacement);
          if (
            Object.keys(replacement).length !== 4 ||
            !token(replacement.textId) ||
            replacement.length !== expected.text.length ||
            replacement.utf8Bytes !== new TextEncoder().encode(expected.text).length ||
            replacement.sha256 !== (await stageTextDigest(expected.text))
          )
            throw new Error('Inverse replacement digest mismatch');
          checkIO();
          const forward = groups[groupIndex].forward[ordinal];
          if (
            !forward ||
            groups[groupIndex].forward.length !== groups[groupIndex].inverse.length ||
            expected.text.length !== forward.end - forward.start
          )
            throw new Error('Unsupported inverse provenance decomposition');
          await verifyProvenance(item.provenanceRef, {
            kind: 'sourceProvenance',
            inputState: item.inputState,
            outputState: item.outputState,
            baseRange: { start: forward.start, end: forward.end },
            finalRange: { start: expected.start, end: expected.end },
            replacement: {
              textId: replacement.textId,
              length: replacement.length,
              utf8Bytes: replacement.utf8Bytes,
              sha256: replacement.sha256,
            },
          });
          let offset = 0,
            cursor: string | undefined;
          do {
            // The outer awaited sink owns DATA/physical IO throughout these serial
            // reads. Only one inverse frame and one text frame are resident.
            checkIO();
            const textPage = await client.readReceipt(receipt, {
              kind: 'inverseText',
              baseLength: document.baseLength,
              textId: replacement.textId,
              ...(cursor === undefined ? { offset: 0 } : { cursor }),
              maxItems: 1,
              maxSourceBytes: 4096,
              maxWireBytes: 8192,
            });
            checkIO();
            if (textPage.outputKind !== 'inverseText' || textPage.items.length !== 1)
              throw new Error('Invalid inverse text page');
            const fragment = record(textPage.items[0]);
            if (
              fragment.textId !== replacement.textId ||
              fragment.offset !== offset ||
              typeof fragment.text !== 'string' ||
              !validStageText(fragment.text) ||
              (!fragment.text.length && expected.text.length !== 0) ||
              fragment.text !== expected.text.slice(offset, offset + fragment.text.length)
            )
              throw new Error('Inverse text differs from retained native text');
            offset += fragment.text.length;
            if (
              offset > expected.text.length ||
              (textPage.nextCursor === null) !== (offset === expected.text.length)
            )
              throw new Error('Incomplete inverse text');
            cursor = textPage.nextCursor ?? undefined;
          } while (cursor !== undefined);
          groupDelta += expected.text.length - expected.end + expected.start;
          previousEnd = expected.end;
          ordinal++;
          if (ordinal === groups[groupIndex].inverse.length) {
            inverseLength += groupDelta;
            if (!uint(inverseLength) || inverseLength !== groups[groupIndex].beforeLength)
              throw new Error('Inverse group extent mismatch');
            groupDelta = 0;
            previousEnd = -1;
            groupIndex--;
            ordinal = 0;
            input = output;
          }
        }
      }))
    ) {
      /* exact monotonic group/ordinal prefix */
    }
    if (
      groupIndex !== -1 ||
      input !== receipt.beforeRevision ||
      inverseLength !== document.baseLength
    )
      throw new Error('Incomplete native inverse chain');
    check();
  } finally {
    observeIO = false;
    try {
      await lease?.release();
    } finally {
      // Own retirement is expected; keep observing local ownership until the
      // final borrower-release dispatch (including reentrant subscribers) ends.
      borrowing = false;
      try {
        port.dispatch(pageResourcesReleased(borrower));
        current();
      } finally {
        unsubscribe();
      }
    }
  }
  check();
  return Object.freeze({
    receipt,
    baseLength: document.baseLength,
    sourceLength: document.length,
    exactLocalResult: true as const,
  });
}
