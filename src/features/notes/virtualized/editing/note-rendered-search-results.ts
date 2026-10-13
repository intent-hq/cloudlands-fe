import { validStageText, type NoteRenderedOperationPage } from '$lib/client/note-source-operation';
import type { NoteRenderedSearchCapture } from './note-rendered-search-capture';

export interface NoteRenderedSearchPage {
  readonly hits: readonly {
    readonly hitId: string;
    readonly sourceRange: { readonly start: number; readonly end: number };
    readonly renderedRange: { readonly start: number; readonly end: number };
  }[];
  readonly scannedThrough: number;
  readonly count: { readonly value: number; readonly exact: boolean };
}
const encoder = new TextEncoder();
const uint = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const token = (v: unknown): v is string =>
  validStageText(v) && v.length > 0 && encoder.encode(v).length <= 256;
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid rendered result');
  return v as Record<string, unknown>;
}
function keys(v: Record<string, unknown>, fields: string[]) {
  if (Object.keys(v).length !== fields.length || fields.some((k) => !Object.hasOwn(v, k)))
    throw new Error('Unexpected rendered result fields');
}
const scalar = (text: string, offset: number) =>
  offset === 0 ||
  offset === text.length ||
  !(text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff);

/** One page plus a bounded expected metadata shape. Server results never create
 * native authority: exact retained descriptors and whole native text must agree.
 * Callback pages are borrowed until its Promise settles. A caller retaining
 * results afterward must separately admit/copy that state; this owner does not
 * account for escaped references.
 * Match semantics remain the pinned backend matcher, not host locale/lowercase. */
export async function consumeNoteRenderedSearch(
  capture: NoteRenderedSearchCapture,
  descriptors: { parent: Record<string, unknown>; leaf: Record<string, unknown> },
  sourceLength: number,
  read: (request: {
    kind: 'search' | 'detail';
    ref?: string;
    cursor?: string;
  }) => Promise<NoteRenderedOperationPage>,
  current: () => void,
  consume: (page: NoteRenderedSearchPage) => Promise<void>,
) {
  const text = capture.rendered.text,
    start = capture.inline.sourceRange.start;
  const cursors = new Set<string>(),
    hitIds = new Set<string>(),
    spans = new Set<string>();
  let requests = 0,
    scanned = 0,
    count = 0,
    observed = 0;
  let previous: { start: number; hitId: string } | undefined;
  const call = async (request: Parameters<typeof read>[0]) => {
    current();
    // Explicit refusal budget for this 4096-unit native subset. No unbounded
    // visited graph or malicious zero-progress chain retained in the renderer.
    if (++requests > 4096) throw new Error('Rendered search traversal budget exceeded');
    const page = await read(request);
    current();
    return page;
  };
  const detail = async (root: string, sourceRange: { start: number; end: number }) => {
    const ids = new Set<string>(),
      refs = new Set<string>(),
      continuations = new Set<string>();
    const renderedRange = { start: sourceRange.start - start, end: sourceRange.end - start };
    const expected = {
      kind: 'stagedRenderedHit',
      mapping: 'identity',
      sourceRange,
      renderedRange,
      parent: {
        ordinal: 0,
        sourceRange: capture.paragraph.sourceRange,
        descriptor: descriptors.parent,
        attributes: {},
      },
      leaf: {
        ordinal: 1,
        sourceRange: capture.inline.sourceRange,
        descriptor: descriptors.leaf,
        attributes: {},
        renderedText: text,
      },
    };
    const claim = (ref: unknown) => {
      if (!token(ref) || refs.has(ref) || refs.size >= 256)
        throw new Error('Invalid rendered detail reference');
      refs.add(ref);
      return ref;
    };
    const walk = async (
      value: unknown,
      expected: unknown,
      parentId: string | null,
      key?: string,
      wholeLeaf = false,
    ): Promise<void> => {
      const item = object(value);
      if (
        !token(item.id) ||
        ids.has(item.id) ||
        ids.size >= 128 ||
        item.parentId !== parentId ||
        item.key !== key
      )
        throw new Error('Invalid rendered metadata identity');
      ids.add(item.id);
      const common = ['id', 'parentId', ...(key === undefined ? [] : ['key']), 'type'];
      if (expected !== null && typeof expected === 'object') {
        keys(item, [...common, 'childrenRef']);
        if (item.type !== 'object') throw new Error('Invalid rendered metadata object');
        const ref = claim(item.childrenRef),
          fields = Object.entries(expected).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        let index = 0,
          cursor: string | undefined;
        do {
          const page = await call({
            kind: 'detail',
            ref,
            ...(cursor === undefined ? {} : { cursor }),
          });
          if (
            !page.items.length &&
            (fields.length !== 0 || cursor !== undefined || page.nextCursor !== null)
          )
            throw new Error('Empty rendered metadata continuation');
          for (const child of page.items) {
            const field = fields[index++];
            if (!field) throw new Error('Extra rendered metadata field');
            await walk(
              child,
              field[1],
              item.id as string,
              field[0],
              key === 'leaf' && field[0] === 'renderedText',
            );
          }
          if (page.nextCursor !== null) {
            if (continuations.has(page.nextCursor) || continuations.size >= 256)
              throw new Error('Cyclic rendered metadata cursor');
            continuations.add(page.nextCursor);
          }
          cursor = page.nextCursor ?? undefined;
        } while (cursor !== undefined);
        if (index !== fields.length) throw new Error('Missing rendered metadata field');
      } else if (wholeLeaf) {
        keys(item, [...common, 'valueRef']);
        if (item.type !== 'string' || expected !== text)
          throw new Error('Invalid rendered native text');
        let ref: string | null = claim(item.valueRef),
          offset = 0;
        let fragmentId: string | undefined;
        while (ref !== null) {
          const page = await call({ kind: 'detail', ref });
          if (page.nextCursor !== null || page.items.length !== 1)
            throw new Error('Invalid rendered text page');
          const fragment = object(page.items[0]);
          keys(fragment, ['kind', 'id', 'field', 'offset', 'text', 'nextRef']);
          if (
            fragment.kind !== 'fragment' ||
            !token(fragment.id) ||
            (fragmentId !== undefined && fragment.id !== fragmentId) ||
            fragment.field !== 'renderedText' ||
            fragment.offset !== offset ||
            !validStageText(fragment.text) ||
            !fragment.text.length ||
            encoder.encode(fragment.text).length > 1024 ||
            fragment.text !== text.slice(offset, offset + fragment.text.length)
          )
            throw new Error('Rendered text differs from native capture');
          fragmentId = fragment.id as string;
          offset += fragment.text.length;
          if (
            offset > text.length ||
            !scalar(text, offset) ||
            (fragment.nextRef === null && offset !== text.length) ||
            (fragment.nextRef !== null && offset === text.length)
          )
            throw new Error('Incomplete rendered native text');
          ref = fragment.nextRef === null ? null : claim(fragment.nextRef);
        }
      } else {
        keys(item, [...common, 'value']);
        if (item.type !== (expected === null ? 'null' : typeof expected) || item.value !== expected)
          throw new Error('Rendered metadata differs from capture');
      }
    };
    const page = await call({ kind: 'detail', ref: claim(root) });
    if (page.nextCursor !== null || page.items.length !== 1)
      throw new Error('Invalid rendered detail root');
    await walk(page.items[0], expected, null);
    return Object.freeze(renderedRange);
  };
  let cursor: string | undefined;
  do {
    const page = await call({ kind: 'search', ...(cursor === undefined ? {} : { cursor }) });
    const c = object(page.count);
    keys(c, ['value', 'exact']);
    if (
      !uint(page.scannedThrough) ||
      page.scannedThrough < scanned ||
      page.scannedThrough > sourceLength ||
      !uint(c.value) ||
      c.value < count ||
      c.value > capture.sourceRange.end - capture.sourceRange.start ||
      typeof c.exact !== 'boolean' ||
      c.exact !== (page.nextCursor === null)
    )
      throw new Error('Invalid rendered search progress');
    const frontier = page.scannedThrough;
    if (frontier >= start && frontier <= start + text.length && !scalar(text, frontier - start))
      throw new Error('Non-scalar rendered frontier');
    if (page.nextCursor === null && frontier < capture.sourceRange.end)
      throw new Error('Incomplete rendered domain');
    if (page.nextCursor !== null && (cursors.has(page.nextCursor) || cursors.size >= 4096))
      throw new Error('Repeated rendered search cursor');
    const hits: Array<NoteRenderedSearchPage['hits'][number]> = [];
    const roots = new Set<string>();
    for (const value of page.items) {
      const item = object(value),
        range = object(item.sourceRange);
      keys(item, ['hitId', 'sourceRange', 'detailRef']);
      keys(range, ['start', 'end']);
      if (
        !token(item.hitId) ||
        hitIds.has(item.hitId) ||
        hitIds.size >= 4096 ||
        !token(item.detailRef) ||
        !uint(range.start) ||
        !uint(range.end) ||
        range.start < capture.sourceRange.start ||
        range.end > capture.sourceRange.end ||
        range.end <= range.start ||
        range.end > frontier ||
        !scalar(text, range.start - start) ||
        !scalar(text, range.end - start) ||
        roots.has(item.detailRef) ||
        spans.has(`${range.start}:${range.end}`) ||
        (previous &&
          (range.start < previous.start ||
            (range.start === previous.start && item.hitId <= previous.hitId)))
      )
        throw new Error('Invalid rendered search hit');
      roots.add(item.detailRef);
      hitIds.add(item.hitId);
      spans.add(`${range.start}:${range.end}`);
      const sourceRange = Object.freeze({ start: range.start, end: range.end });
      const renderedRange = await detail(item.detailRef, sourceRange);
      hits.push(Object.freeze({ hitId: item.hitId, sourceRange, renderedRange }));
      previous = { start: range.start, hitId: item.hitId };
    }
    observed += hits.length;
    if (c.value < observed || (c.exact && c.value !== observed))
      throw new Error('Rendered hit count mismatch');
    current();
    await consume(
      Object.freeze({
        hits: Object.freeze(hits),
        scannedThrough: frontier,
        count: Object.freeze({ value: c.value, exact: c.exact }),
      }),
    );
    current();
    count = c.value;
    scanned = frontier;
    cursor = page.nextCursor ?? undefined;
    if (cursor !== undefined) cursors.add(cursor);
  } while (cursor !== undefined);
}
