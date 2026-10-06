import {
  isLiveNoteSaveObserver,
  readLiveNoteSaveReceipt,
  type LiveNoteSaveObserver,
} from '$lib/client/live/live-note-pages-client';
import { stageTextDigest } from '$lib/client/note-source-operation';
import type { NoteCommitReceipt } from '$lib/client/note-pages';

function fail(): never {
  throw new Error('Unsupported local point canonical receipt');
}
function record(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return fail();
  return value as Record<string, unknown>;
}
function get(value: object, key: string): unknown {
  const d = Object.getOwnPropertyDescriptor(value, key);
  if (!d || !('value' in d)) return fail();
  return d.value;
}
function equal(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (!actual || !expected || typeof actual !== 'object' || typeof expected !== 'object')
    return false;
  const keys = Reflect.ownKeys(expected);
  return (
    keys.length === Reflect.ownKeys(actual).length &&
    keys.every((key) => typeof key === 'string' && equal(get(actual, key), get(expected, key)))
  );
}
const token = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 256 &&
  new TextEncoder().encode(value).length <= 256;

/** Fixed, bounded correspondence DATA parser. A private live observer supplies
 * all envelopes; this result alone is not a certificate or editing authority.
 * Caller owns the admitted receipt workspace through every actual IO settlement. */
export async function readLocalPointCanonicalReceipt(
  observer: LiveNoteSaveObserver,
  expected: { group: number; literal: string },
  current: () => boolean,
) {
  const check = () => {
    if (!current() || !isLiveNoteSaveObserver(observer) || !observer.current()) fail();
  };
  check();
  const receipt = readLiveNoteSaveReceipt(observer);
  const result = await parseLocalPointCanonicalReceiptData(
    receipt,
    observer.readReceipt,
    expected,
    () => {
      check();
      return true;
    },
  );
  check();
  if (readLiveNoteSaveReceipt(observer) !== receipt) fail();
  return result;
}

/** Non-authorizing DATA parser, also used by immutable historical transcript
 * tests. Its caller-supplied reader can NEVER mint a private certificate. */
export async function parseLocalPointCanonicalReceiptData(
  receipt: NoteCommitReceipt,
  reader: LiveNoteSaveObserver['readReceipt'],
  expected: { group: number; literal: string },
  current: () => boolean,
) {
  const check = () => {
    if (!current()) fail();
  };
  check();
  if (
    !Number.isSafeInteger(expected.group) ||
    expected.group < 1 ||
    expected.literal.length !== 56 ||
    receipt.sourceLength !== 3 ||
    receipt.beforeRevision === receipt.afterRevision
  )
    fail();
  const emptyDigest = await stageTextDigest('');
  check();
  const literalDigest = await stageTextDigest(expected.literal);
  check();
  let requests = 0,
    fields = 0,
    units = 0,
    bytes = 0;
  const ids = new Set<string>(),
    refs = new Set<string>();
  const copy = (value: unknown, depth = 0): unknown => {
    if (depth > 8) return fail();
    if (typeof value === 'string') {
      units += value.length;
      if (units > 65536) return fail();
      bytes += new TextEncoder().encode(value).length;
      if (bytes > 65536) return fail();
      return value;
    }
    if (
      value === null ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    )
      return value;
    const object = record(value),
      result: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(object)) {
      if (++fields > 8192 || typeof key !== 'string') return fail();
      units += key.length;
      bytes += new TextEncoder().encode(key).length;
      if (units > 65536 || bytes > 65536) return fail();
      Object.defineProperty(result, key, {
        value: copy(get(object, key), depth + 1),
        enumerable: true,
      });
    }
    return Object.freeze(result);
  };
  const read: LiveNoteSaveObserver['readReceipt'] = async (request) => {
    if (++requests > 64) fail();
    check();
    const result = await reader(request);
    check();
    return result;
  };
  const detail = async (ref: string, parent: string | null, depth: number): Promise<unknown> => {
    if (refs.has(ref) || refs.size >= 16 || depth > 4) return fail();
    refs.add(ref);
    const entries: Array<{ key: unknown; value: unknown }> = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await read({
        kind: 'detail',
        ref,
        baseLength: 2,
        maxItems: 16,
        maxWireBytes: 8192,
        ...(cursor ? { cursor } : {}),
      });
      for (const raw of page.items) {
        const node = record(copy(raw));
        if (
          !token(node.id) ||
          ids.has(node.id) ||
          ids.size >= 32 ||
          node.parentId !== parent ||
          'valueRef' in node ||
          entries.length >= 16
        )
          fail();
        ids.add(node.id);
        let value: unknown;
        if (node.type === 'object') {
          if (!token(node.childrenRef)) fail();
          value = await detail(node.childrenRef, node.id, depth + 1);
        } else {
          if (!['string', 'number'].includes(String(node.type)) || typeof node.value !== node.type)
            fail();
          value = node.value;
        }
        entries.push({ key: node.key ?? null, value });
      }
      if (page.nextCursor !== null && (cursors.has(page.nextCursor) || cursors.size >= 16)) fail();
      if (page.nextCursor !== null) cursors.add(page.nextCursor);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    if (parent === null) {
      if (entries.length !== 1 || entries[0].key !== null) return fail();
      return entries[0].value;
    }
    const result: Record<string, unknown> = {};
    for (const entry of entries) {
      if (typeof entry.key !== 'string' || Object.hasOwn(result, entry.key)) return fail();
      Object.defineProperty(result, entry.key, { value: entry.value, enumerable: true });
    }
    return Object.freeze(result);
  };
  const roots = { mapping: [] as unknown[], effects: [] as unknown[], inverse: [] as unknown[] };
  for (const kind of ['mapping', 'effects', 'inverse'] as const) {
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await read({
        kind,
        baseLength: 2,
        maxItems: 64,
        maxWireBytes: 8192,
        ...(cursor ? { cursor } : {}),
      });
      if (page.outputKind === 'effects' && page.convertedCount !== 0) fail();
      if (roots[kind].length + page.items.length > (kind === 'effects' ? 2 : 1)) fail();
      for (const item of page.items) roots[kind].push(copy(item));
      if (page.nextCursor !== null && (cursors.has(page.nextCursor) || cursors.size >= 4)) fail();
      if (page.nextCursor !== null) cursors.add(page.nextCursor);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  if (
    !equal(roots.mapping, [{ start: 1, end: 1, insertedLength: 1 }]) ||
    roots.effects.length !== 2 ||
    roots.inverse.length !== 1
  )
    fail();
  const effect = record(roots.effects[0]),
    annotation = record(roots.effects[1]),
    inverse = record(roots.inverse[0]),
    replacement = record(inverse.replacement);
  if (
    !token(effect.inputState) ||
    !token(effect.outputState) ||
    effect.inputState === effect.outputState ||
    !token(effect.detailRef) ||
    !equal(effect, {
      kind: 'sourceEffect',
      reason: 'phantom-scrub',
      inputState: effect.inputState,
      outputState: effect.outputState,
      range: { start: 2, end: 58 },
      insertedLength: 0,
      beforeDigest: literalDigest,
      afterDigest: emptyDigest,
      detailRef: effect.detailRef,
    }) ||
    !token(annotation.attributionGeneration) ||
    !token(annotation.commentRevision) ||
    !equal(annotation, {
      kind: 'annotationInvalidation',
      sourceRevision: receipt.afterRevision,
      attributionGeneration: annotation.attributionGeneration,
      commentRevision: annotation.commentRevision,
    }) ||
    !token(replacement.textId) ||
    !token(inverse.provenanceRef) ||
    !equal(replacement, {
      textId: replacement.textId,
      length: 0,
      utf8Bytes: 0,
      sha256: emptyDigest,
    }) ||
    !equal(inverse, {
      ordinal: 0,
      historyGroup: String(expected.group),
      inputState: receipt.afterRevision,
      outputState: receipt.beforeRevision,
      start: 1,
      end: 2,
      replacement,
      provenanceRef: inverse.provenanceRef,
    })
  )
    fail();
  if (
    !equal(await detail(effect.detailRef, null, 0), {
      inputState: effect.inputState,
      outputState: effect.outputState,
      range: { start: 2, end: 58 },
      removed: expected.literal,
      inserted: '',
    }) ||
    !equal(await detail(inverse.provenanceRef, null, 0), {
      kind: 'sourceProvenance',
      inputState: inverse.inputState,
      outputState: inverse.outputState,
      baseRange: { start: 1, end: 1 },
      finalRange: { start: 1, end: 2 },
      replacement,
    })
  )
    fail();
  const empty = await read({
    kind: 'inverseText',
    textId: replacement.textId,
    offset: 0,
    baseLength: 2,
    maxItems: 1,
    maxWireBytes: 8192,
    maxSourceBytes: 4096,
  });
  if (
    empty.nextCursor !== null ||
    empty.sourceLength !== 3 ||
    !equal(empty.items, [{ textId: replacement.textId, offset: 0, text: '' }])
  )
    fail();
  check();
  return Object.freeze({
    group: expected.group,
    operationId: receipt.operationId,
    beforeRevision: receipt.beforeRevision,
    afterRevision: receipt.afterRevision,
    headerDigest: receipt.headerDigest!,
    payloadDigest: receipt.payloadDigest,
    viewId: receipt.viewId!,
    receiptExpiresAt: receipt.receiptExpiresAt,
    before: 'ab' as const,
    callerLength: 59 as const,
    final: 'aXb' as const,
    inverse: Object.freeze({ start: 1 as const, end: 2 as const, text: '' as const }),
  });
}
