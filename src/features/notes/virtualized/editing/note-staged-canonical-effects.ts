import type { NoteCommitReceipt, NotePagesClient } from '$lib/client/note-pages';
import { stageTextDigest, validStageText } from '$lib/client/note-source-operation';
import type { reserveNoteReceiptTranscript } from './note-receipt-transcript';

type Transcript = Awaited<ReturnType<typeof reserveNoteReceiptTranscript>['ready']>;
const uint = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const token = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.length <= 256 &&
  validStageText(v) &&
  new TextEncoder().encode(v).length <= 256;
const digest = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const invalid = () => new Error('Unsupported canonical receipt detail');
const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw invalid();
  return v as Record<string, unknown>;
};
const exact = (v: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(v).length !== keys.length || keys.some((k) => !Object.hasOwn(v, k)))
    throw invalid();
};

/** Validate one bounded source-effect phase, not a native adoption proof.
 * Caller owns a receipt transcript with 262144 semantic units admitted BEFORE
 * entry, and awaits this function before releasing it. Nested detail IO stays
 * inside its awaited effects consumer. At most 65536 text units, 16 effects,
 * 64 rows and 512 detail reads are admitted; unsupported transcripts remain unreconciled.
 * This establishes row/detail consistency, not native or historical authority. */
export async function validateNoteStagedCanonicalEffects(
  client: Pick<NotePagesClient, 'readReceipt'>,
  originalReceipt: NoteCommitReceipt,
  baseLength: number,
  inputLength: number,
  transcript: Transcript,
  checkOwner: () => void,
) {
  const receipt = Object.freeze({
    ...originalReceipt,
    scope: Object.freeze({ ...originalReceipt.scope }),
  });
  if (!receipt.headerDigest || !receipt.viewId || !uint(baseLength) || !uint(inputLength))
    throw invalid();
  const check = () => {
    checkOwner();
    if (!transcript.current()) throw new Error('Canonical receipt owner lost');
  };
  let rows = 0,
    reads = 0,
    units = 0,
    effects = 0,
    delta = 0,
    createdTasks = 0;
  let phase: { input: string; output: string; reason: string } | undefined;
  let end = -1,
    start = -1,
    convertedCount = 0;
  let annotation: string | undefined;
  const detailRoots = new Set<string>(),
    cursors = new Set<string>();
  const read = async (ref: string, cursor?: string) => {
    if (!token(ref) || ++reads > 512) throw invalid();
    check();
    const page = await client.readReceipt(receipt, {
      kind: 'detail',
      ref,
      baseLength,
      maxItems: 16,
      maxWireBytes: 8192,
      ...(cursor === undefined ? {} : { cursor }),
    });
    check();
    if (page.outputKind !== 'detail') throw invalid();
    return page;
  };
  const detail = async (
    root: string,
    expected: {
      input: string;
      output: string;
      start: number;
      end: number;
      inserted: number;
      before: string;
      after: string;
    },
  ) => {
    const ids = new Set<string>(),
      refs = new Set<string>([root]);
    const claim = (ref: unknown): string => {
      if (!token(ref) || refs.has(ref) || refs.size >= 256) throw invalid();
      refs.add(ref);
      return ref;
    };
    const scalar = async (entry: Record<string, unknown>, key: string, length: number) => {
      if (!uint(length) || length > 32768 || units + length > 65536) throw invalid();
      units += length; // Admit the entire value before the first valueRef read/join/hash.
      if ('value' in entry) {
        if (
          typeof entry.value !== 'string' ||
          entry.value.length !== length ||
          !validStageText(entry.value) ||
          new TextEncoder().encode(entry.value).length > 1024
        )
          throw invalid();
        return entry.value;
      }
      let ref: string | null = claim(entry.valueRef),
        text = '';
      while (ref !== null) {
        const page = await read(ref);
        if (page.nextCursor !== null || page.items.length !== 1) throw invalid();
        const fragment = record(page.items[0]);
        exact(fragment, ['kind', 'id', 'field', 'offset', 'text', 'nextRef']);
        if (
          fragment.kind !== 'fragment' ||
          fragment.id !== entry.id ||
          fragment.field !== key ||
          fragment.offset !== text.length ||
          typeof fragment.text !== 'string' ||
          !validStageText(fragment.text) ||
          text.length + fragment.text.length > length ||
          (!fragment.text.length && (length !== 0 || fragment.nextRef !== null))
        )
          throw invalid();
        text += fragment.text;
        ref = fragment.nextRef === null ? null : claim(fragment.nextRef);
      }
      if (text.length !== length) throw invalid();
      return text;
    };
    // The expected tree is fixed: root + five fields + two range fields.
    const visit = async (
      value: unknown,
      parent: string | null,
      key: string | undefined,
      expectedValue: unknown,
    ): Promise<unknown> => {
      const entry = { ...record(value) };
      if (
        !token(entry.id) ||
        ids.has(entry.id) ||
        ids.size >= 8 ||
        entry.parentId !== parent ||
        entry.key !== key
      )
        throw invalid();
      ids.add(entry.id);
      const prefix =
        key === undefined ? ['id', 'parentId', 'type'] : ['id', 'parentId', 'key', 'type'];
      if (typeof expectedValue === 'number') {
        exact(entry, [...prefix, 'value']);
        if (entry.type !== 'number' || entry.value !== expectedValue) throw invalid();
        return entry.value;
      }
      if (typeof expectedValue === 'string') {
        exact(entry, [...prefix, 'value' in entry ? 'value' : 'valueRef']);
        if (entry.type !== 'string') throw invalid();
        const value = await scalar(entry, key!, expectedValue.length);
        if (value !== expectedValue) throw invalid();
        return value;
      }
      if (key === 'inserted' || key === 'removed') {
        exact(entry, [...prefix, 'value' in entry ? 'value' : 'valueRef']);
        if (entry.type !== 'string') throw invalid();
        return scalar(
          entry,
          key,
          key === 'inserted' ? expected.inserted : expected.end - expected.start,
        );
      }
      exact(entry, [...prefix, 'childrenRef']);
      if (entry.type !== 'object') throw invalid();
      const ref = claim(entry.childrenRef),
        fields = Object.entries(record(expectedValue));
      const result: Record<string, unknown> = {};
      let index = 0,
        cursor: string | undefined;
      const seen = new Set<string>();
      do {
        const page = await read(ref, cursor);
        if (!page.items.length) throw invalid();
        for (const item of page.items) {
          const field = fields[index++];
          if (!field) throw invalid();
          result[field[0]] = await visit(item, entry.id, field[0], field[1]);
        }
        if (page.nextCursor !== null) {
          if (!token(page.nextCursor) || seen.has(page.nextCursor) || seen.size >= 8)
            throw invalid();
          seen.add(page.nextCursor);
        }
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);
      if (index !== fields.length) throw invalid();
      return result;
    };
    const first = await read(root);
    if (first.nextCursor !== null || first.items.length !== 1) throw invalid();
    const result = record(
      await visit(first.items[0], null, undefined, {
        inputState: expected.input,
        inserted: null,
        outputState: expected.output,
        range: { end: expected.end, start: expected.start },
        removed: null,
      }),
    );
    check();
    if ((await stageTextDigest(result.removed as string)) !== expected.before) throw invalid();
    check();
    if ((await stageTextDigest(result.inserted as string)) !== expected.after) throw invalid();
    check();
  };
  check();
  while (
    !(await transcript.consumeNext('effects', async (page) => {
      if (page.outputKind !== 'effects' || !uint(page.convertedCount)) throw invalid();
      convertedCount = page.convertedCount;
      if (page.nextCursor !== null) {
        if (!token(page.nextCursor) || cursors.has(page.nextCursor) || cursors.size >= 64)
          throw invalid();
        cursors.add(page.nextCursor);
      }
      for (const value of page.items) {
        if (++rows > 64) throw invalid();
        const item = record(value);
        if (item.kind === 'annotationInvalidation') {
          exact(item, ['kind', 'sourceRevision', 'attributionGeneration', 'commentRevision']);
          if (
            item.sourceRevision !== receipt.afterRevision ||
            !token(item.attributionGeneration) ||
            !token(item.commentRevision)
          )
            throw invalid();
          const key = JSON.stringify([item.attributionGeneration, item.commentRevision]);
          if (annotation !== undefined && annotation !== key) throw invalid();
          annotation = key;
          continue;
        }
        if (item.kind === 'createdTask') {
          exact(item, ['kind', 'taskNoteId']);
          if (!token(item.taskNoteId)) throw invalid();
          createdTasks++;
          continue;
        }
        exact(item, [
          'kind',
          'reason',
          'inputState',
          'outputState',
          'range',
          'insertedLength',
          'beforeDigest',
          'afterDigest',
          'detailRef',
        ]);
        const range = record(item.range);
        exact(range, ['start', 'end']);
        if (
          item.kind !== 'sourceEffect' ||
          ++effects > 16 ||
          typeof item.reason !== 'string' ||
          !['anchor-repair', 'phantom-scrub', 'task-conversion', 'task-marker-projection'].includes(
            item.reason,
          ) ||
          !token(item.inputState) ||
          !token(item.outputState) ||
          item.inputState === item.outputState ||
          !uint(range.start) ||
          !uint(range.end) ||
          range.end < range.start ||
          range.end > inputLength ||
          range.start < end ||
          range.start <= start ||
          !uint(item.insertedLength) ||
          !digest(item.beforeDigest) ||
          !digest(item.afterDigest) ||
          !token(item.detailRef) ||
          detailRoots.has(item.detailRef)
        )
          throw invalid();
        const identity = { input: item.inputState, output: item.outputState, reason: item.reason };
        if (
          phase &&
          (phase.input !== identity.input ||
            phase.output !== identity.output ||
            phase.reason !== identity.reason)
        )
          throw invalid();
        phase = identity;
        start = range.start;
        end = range.end;
        detailRoots.add(item.detailRef);
        const expected = {
          ...identity,
          start,
          end,
          inserted: item.insertedLength,
          before: item.beforeDigest,
          after: item.afterDigest,
        };
        delta += expected.inserted - (end - start);
        if (!Number.isSafeInteger(delta)) throw invalid();
        await detail(item.detailRef, expected);
        check();
      }
    }))
  ) {
    /* Bounded complete phase; no partial result escapes. */
  }
  check();
  const outputLength = inputLength + delta;
  if (!uint(outputLength) || outputLength !== receipt.sourceLength) throw invalid();
  return Object.freeze({
    kind: 'validatedCanonicalEffects' as const,
    sourceEffects: effects,
    convertedCount,
    createdTasks,
    inputLength,
    outputLength,
  });
}
