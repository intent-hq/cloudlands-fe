import { retainCanonicalRegion, type NoteCanonicalOwner } from './note-canonical-retention';
import { canonicalResources, type NoteCanonicalResources } from './note-canonical-resources';
import { sameNoteScope } from '$lib/client/note-pages';
import type { NotePageRequest, NoteReadPage, NoteScope, SourceRange } from '$lib/client/note-pages';

type ContextItem = Extract<NoteReadPage, { kind: 'noteContextPage' }>['items'][number];
type Descriptor = Exclude<ContextItem, { kind: 'fragment' }>;
export const NOTE_WINDOW_LIMITS = {
  sourceBytes: 8192,
  contextBytes: 8192,
  // Native ancestry, ordered marks and paged attributes carry opaque scoped refs.
  // Bound this independent graph separately from lexical markup/source payloads.
  canonicalBytes: 8192,
  sourcePages: 16,
  descriptors: 128,
  requests: 96,
  wireBytes: 8192,
  requestSourceBytes: 4096,
} as const;
const size = (value: string) => new TextEncoder().encode(value).length;
const encoded = (value: unknown) => size(JSON.stringify(value));
export interface NoteWindowAddress {
  at: number;
  scope: NoteScope;
  sourceRevision: string;
  snapshotId?: string;
}
export interface NoteWindow {
  scope: NoteScope;
  sourceRevision: string;
  snapshotId: string;
  /** Exact original page deadline; absent only on legacy manually constructed windows. */
  expiresAt?: string;
  sourceLength: number;
  range: SourceRange;
  text: string;
  context: Descriptor[];
  details: Record<string, Record<string, string>>;
  /** Window bindings are distinct from snapshot-stable owner descriptors. */
  mapBindings: Array<{
    ownerId: string;
    range: SourceRange;
    contextRef: string;
    sourceMapRef: string;
  }>;
  documentEnd: boolean;
  native?: NoteCanonicalResources;
  /** Validated source owners, not complete lexical descriptors. Resolve lexical
   * fields through a matching scoped mapBinding before dependent source edits. */
  canonicalOwners?: NoteCanonicalOwner[];
  /** Encoded payload/work counters, never a JS heap measurement. */
  cost: {
    requests: number;
    wireBytes: number;
    sourceBytes: number;
    contextBytes: number;
    canonicalBytes?: number;
    canonicalWorkBytes?: number;
    canonicalTextBytes?: number;
    assemblyPeakBytes: number;
  };
}

/** Assemble one bounded native view from real source/context pages. The caller owns
 * generation, admission and the clean-page cache; this reader retains no document store.
 * Every await checks ownership before decoding or requesting any further page.
 */
class WindowAdmissionError extends Error {}
/** A complete required canonical closure failed its control budget. Only a truly
 * smaller source extent may be retried; required maps are never dropped. */
class NoteWindowControlBudgetError extends Error {
  constructor(
    readonly requiredBytes: number,
    readonly sourceBytes = 0,
    readonly sourceRange?: SourceRange,
  ) {
    // i18n-ignore (internal admission diagnostic; NoteReadingView displays a localized load error)
    super(`Canonical retained context exceeds active window budget (${requiredBytes} bytes)`);
    this.name = 'NoteWindowControlBudgetError';
  }
}

function* assembleWindowSteps(
  address: NoteWindowAddress,
  current: () => boolean,
  pageBytes: number,
  work: {
    requests: number;
    wireBytes: number;
    peak: number;
    canonicalWorkBytes: number;
    snapshotId?: string;
    expiresAt?: string;
  },
): Generator<NotePageRequest, NoteWindow, NoteReadPage> {
  let snapshotId = work.snapshotId ?? address.snapshotId;
  const cost = {
    requests: 0,
    wireBytes: 0,
    sourceBytes: 0,
    contextBytes: 0,
    canonicalBytes: 0,
    canonicalWorkBytes: 0,
    canonicalTextBytes: 0,
    assemblyPeakBytes: 0,
  };
  const assertCurrent = () => {
    if (!current()) throw new Error('Note window superseded');
  };
  function* request(q: NotePageRequest): Generator<NotePageRequest, NoteReadPage, NoteReadPage> {
    assertCurrent();
    if (work.requests >= NOTE_WINDOW_LIMITS.requests)
      throw new Error('Note context request budget exceeded');
    work.requests++;
    const page = yield { ...q, maxWireBytes: NOTE_WINDOW_LIMITS.wireBytes, maxItems: 64 };
    assertCurrent();
    if (
      !('sourceRevision' in page) ||
      !('snapshotId' in page) ||
      !('expiresAt' in page) ||
      (work.expiresAt !== undefined && page.expiresAt !== work.expiresAt) ||
      !sameNoteScope(page.scope, address.scope) ||
      page.sourceRevision !== address.sourceRevision ||
      (snapshotId !== undefined && page.snapshotId !== snapshotId)
    )
      throw new Error('Note window snapshot mismatch');
    snapshotId = work.snapshotId = page.snapshotId;
    work.expiresAt = page.expiresAt;
    const responseBytes = encoded(page);
    work.wireBytes += responseBytes;
    work.peak = Math.max(work.peak, responseBytes + 2 * cost.sourceBytes + 2 * cost.contextBytes);
    return page;
  }
  const context = new Map<string, Descriptor>();
  const refs = new Set<string>();
  const details: NoteWindow['details'] = {};
  const mapBindings: NoteWindow['mapBindings'] = [];
  let native: NoteCanonicalResources | undefined;
  let boundMaps = 0;
  let lexicalBytes = 0,
    canonicalBytes = 0;
  const chargeContext = (amount: number, canonical = false) => {
    work.peak = Math.max(work.peak, 2 * cost.sourceBytes + 2 * cost.contextBytes + amount);
    cost.contextBytes += amount;
    if (canonical) {
      cost.canonicalWorkBytes += amount;
      work.canonicalWorkBytes += amount;
    }
    if (canonical) canonicalBytes += amount;
    else lexicalBytes += amount;
    // Canonical assembly has pre-reserved DATA and a fixed cumulative wire/work
    // budget. Admit the finalized retained closure below, without treating raw
    // metadata pages and their materialized values as simultaneous retained copies.
    if (lexicalBytes > NOTE_WINDOW_LIMITS.contextBytes)
      throw new WindowAdmissionError('Note context exceeds active window budget');
  };
  function* collection(
    ref: string,
    consume: (item: ContextItem) => Generator<NotePageRequest, void, NoteReadPage>,
  ): Generator<NotePageRequest, void, NoteReadPage> {
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const page = yield* request({
        kind: 'context',
        contextRef: ref,
        ...(cursor ? { cursor } : {}),
      });
      if (page.kind !== 'noteContextPage') throw new Error('Expected lexical context page');
      for (const item of page.items) yield* consume(item);
      if (page.nextCursor && (seen.has(page.nextCursor) || !page.items.length))
        throw new Error('Note context cursor made no progress');
      cursor = page.nextCursor ?? undefined;
      if (cursor) seen.add(cursor);
    } while (cursor);
  }
  function* field(
    entry: Extract<ContextItem, { kind: 'fragment' }>,
  ): Generator<NotePageRequest, string, NoteReadPage> {
    if (entry.offset !== 0 || entry.text !== '' || entry.nextRef === null)
      throw new Error('Invalid note detail directory');
    let ref: string | null = entry.nextRef,
      offset = 0,
      text = '';
    const seen = new Set<string>();
    while (ref) {
      if (seen.has(ref)) throw new Error('Note detail reference cycle');
      seen.add(ref);
      let next: string | null = null,
        count = 0;
      yield* collection(ref, function* (item) {
        if (item.kind !== 'fragment' || item.field !== entry.field || item.offset !== offset)
          throw new Error('Noncontiguous note field fragment');
        if (count && next === null) throw new Error('Note field continued after exhaustion');
        if (!item.text && item.nextRef !== null) throw new Error('Note field made no progress');
        chargeContext(size(item.text));
        text += item.text;
        offset += item.text.length;
        next = item.nextRef;
        count++;
      });
      if (!count) throw new Error('Missing note detail field');
      ref = next;
    }
    return text;
  }
  function* descriptor(
    item: ContextItem,
    occurrence?: { range: SourceRange; contextRef: string },
  ): Generator<NotePageRequest, void, NoteReadPage> {
    if (item.kind === 'fragment') throw new Error('Unexpected field in source context');
    if (item.kind === 'boundary' && ['htmlDocument', 'markdownDocument'].includes(item.construct)) {
      if (item.sourceRange.start !== 0 || item.sourceRange.end !== sourceLength)
        throw new Error('Canonical document range mismatch');
      if (occurrence && !item.sourceMapRef)
        throw new Error('Canonical document window mapping missing');
      if (
        item.construct === 'markdownDocument' &&
        occurrence &&
        occurrence.range.start === occurrence.range.end &&
        (sourceLength !== 0 || occurrence.range.start !== 0)
      )
        throw new Error('Canonical Markdown document empty window mismatch');
    }
    if (item.kind === 'boundary' && item.construct === 'markdownBlock') {
      if (item.sourceRange.start >= item.sourceRange.end || item.sourceRange.end > sourceLength)
        throw new Error('Canonical Markdown paragraph range mismatch');
      if (occurrence && !item.sourceMapRef)
        throw new Error('Canonical Markdown paragraph window mapping missing');
    }
    // Context can include a predecessor used to locate the window. Its native
    // subtree is not visible and must not acquire attributes/maps or mounted cells.
    if (
      occurrence &&
      'sourceRange' in item &&
      item.sourceRange.start !== item.sourceRange.end &&
      !('htmlSource' in item && item.htmlSource?.provenance !== 'explicit') &&
      (item.sourceRange.end <= occurrence.range.start ||
        item.sourceRange.start >= occurrence.range.end)
    )
      return;
    const canonical =
      ('nativeRef' in item && !!item.nativeRef) || (item.kind === 'span' && !!item.codeSource);

    if ('sourceMapRef' in item && item.sourceMapRef) {
      if (!occurrence) throw new Error('Direct note owner cannot acquire a window mapping');
      const binding = { ownerId: item.id, ...occurrence, sourceMapRef: item.sourceMapRef };
      if (
        !mapBindings.some(
          (b) => b.ownerId === binding.ownerId && b.contextRef === binding.contextRef,
        )
      ) {
        chargeContext(encoded(binding), true);
        mapBindings.push(binding);
      } else if (!mapBindings.some((b) => JSON.stringify(b) === JSON.stringify(binding))) {
        throw new Error('Conflicting note window map binding');
      }
      if (item.kind === 'boundary') {
        const {
          sourceMapRef: _map,
          continuationBefore: _before,
          continuationAfter: _after,
          ...owner
        } = item;
        item = owner;
      } else if (item.kind === 'span') {
        const { sourceMapRef: _map, ...owner } = item;
        item = owner;
      }
    }
    const prior = context.get(item.id);
    if (prior) {
      // Continuation flags describe the issuing page, not a changed source identity.
      const comparable = (d: Descriptor) =>
        d.kind === 'boundary'
          ? { ...d, continuationBefore: undefined, continuationAfter: undefined }
          : d;
      if (JSON.stringify(comparable(prior)) !== JSON.stringify(comparable(item)))
        throw new Error('Conflicting note context identity');
      return;
    }
    if (context.size >= NOTE_WINDOW_LIMITS.descriptors)
      throw new WindowAdmissionError('Note descriptor budget exceeded');
    chargeContext(encoded(item), canonical);
    context.set(item.id, item);
    // Table alignment directories can contain millions of columns. Each admitted
    // cell carries its own bounded address/alignment; never enumerate that directory.
    if (
      'detailRef' in item &&
      item.detailRef &&
      !(
        item.kind === 'boundary' &&
        [
          'paragraph',
          'table',
          'tableHead',
          'tableRow',
          'htmlBlock',
          'htmlTable',
          'htmlTableRow',
          'htmlTableCell',
        ].includes(item.construct)
      )
    ) {
      const fields: Record<string, string> = {};
      details[item.id] = fields;
      yield* collection(item.detailRef, function* (entry) {
        if (entry.kind !== 'fragment' || entry.field in fields)
          throw new Error('Invalid note detail directory entry');
        chargeContext(size(entry.field));
        fields[entry.field] = yield* field(entry);
      });
    }
    if (item.kind === 'boundary' && item.tablePosition && !refs.has(item.tablePosition.tableRef)) {
      refs.add(item.tablePosition.tableRef);
      yield* collection(item.tablePosition.tableRef, descriptor);
    }
    if ('parentRef' in item && item.parentRef && !refs.has(item.parentRef)) {
      refs.add(item.parentRef);
      yield* collection(item.parentRef, descriptor);
    }
  }
  let text = '',
    start = address.at,
    end = address.at,
    sourceLength = address.at;
  let cursor: string | undefined;
  for (let pages = 0; pages < NOTE_WINDOW_LIMITS.sourcePages; pages++) {
    const remaining = NOTE_WINDOW_LIMITS.sourceBytes - cost.sourceBytes;
    if (remaining < 4) break;
    const page = yield* request({
      kind: 'source',
      maxSourceBytes: Math.min(remaining, pageBytes),
      ...(cursor
        ? { cursor }
        : {
            at: address.at,
            sourceRevision: address.sourceRevision,
            noteInstanceId: address.scope.noteInstanceId,
            ...(snapshotId ? { snapshotId } : {}),
          }),
    });
    if (page.kind !== 'noteSourcePage') throw new Error('Expected note source page');
    if (pages === 0) start = end = page.range.start;
    if (page.range.start !== end || (pages && page.sourceLength !== sourceLength))
      throw new Error('Noncontiguous note source pages');
    if (!page.text.length && page.nextCursor) throw new Error('Note source made no progress');
    const bytes = size(page.text);
    if (bytes > remaining) throw new Error('Note source exceeds active window budget');
    cost.sourceBytes += bytes;
    // Joining creates transient old/new strings; account for both encoded payloads.
    cost.assemblyPeakBytes = Math.max(
      cost.assemblyPeakBytes,
      2 * cost.sourceBytes + cost.contextBytes,
    );
    text += page.text;
    end = page.range.end;
    sourceLength = page.sourceLength;
    if (!refs.has(page.contextRef)) {
      refs.add(page.contextRef);
      yield* collection(page.contextRef, (item) =>
        descriptor(item, { range: page.range, contextRef: page.contextRef }),
      );
    }
    if (mapBindings.length > boundMaps) {
      native = yield* canonicalResources(
        context,
        mapBindings.slice(boundMaps),
        request,
        (item) => {
          if (context.size > NOTE_WINDOW_LIMITS.descriptors)
            throw new WindowAdmissionError('Note descriptor budget exceeded');
          if (item && typeof item === 'object' && 'text' in item && typeof item.text === 'string') {
            cost.canonicalTextBytes += size(item.text);
            // Raw source and materialized text fragments/joins share one payload
            // allowance. Large reference names cannot relax the old text bound.
            if (cost.sourceBytes + cost.canonicalTextBytes > NOTE_WINDOW_LIMITS.sourceBytes)
              throw new WindowAdmissionError(
                // i18n-ignore (internal admission diagnostic; NoteReadingView displays a localized load error)
                'Note source and rendered text exceed active window budget',
              );
          }
          chargeContext(encoded(item), true);
        },
        native,
      );
      boundMaps = mapBindings.length;
    }
    cursor = page.nextCursor ?? undefined;
    if (
      !cursor ||
      (native !== undefined && Object.keys(native.texts).length > 0) ||
      lexicalBytes >= NOTE_WINDOW_LIMITS.contextBytes / 2 ||
      canonicalBytes >= NOTE_WINDOW_LIMITS.canonicalBytes / 2 ||
      context.size >= NOTE_WINDOW_LIMITS.descriptors / 2
    )
      break;
  }
  let retainedContext = [...context.values()];
  let canonicalOwners: NoteCanonicalOwner[] | undefined;
  if (native) {
    const retained = retainCanonicalRegion(retainedContext, mapBindings, native, { start, end });
    retainedContext = retained.context;
    native = retained.native;
    canonicalOwners = retained.owners;
    // Exact serialized FINAL graph including reference keys, source handles,
    // attrs, all occurrences and rendered text. This is not a heap measurement.
    const bytes = encoded({
      context: retainedContext,
      details,
      mapBindings,
      native,
      canonicalOwners,
    });
    if (bytes > NOTE_WINDOW_LIMITS.canonicalBytes) {
      throw new NoteWindowControlBudgetError(bytes, cost.sourceBytes, { start, end });
    }
    cost.canonicalBytes = bytes;
    cost.contextBytes = bytes;
  }
  return {
    native,
    canonicalOwners,
    scope: address.scope,
    sourceRevision: address.sourceRevision,
    snapshotId: snapshotId!,
    expiresAt: work.expiresAt,
    range: { start, end },
    sourceLength,
    text,
    context: retainedContext,
    details,
    mapBindings,
    documentEnd: end === sourceLength,
    cost: {
      ...cost,
      canonicalWorkBytes: work.canonicalWorkBytes,
      requests: work.requests,
      wireBytes: work.wireBytes,
      assemblyPeakBytes: Math.max(work.peak, cost.assemblyPeakBytes),
    },
  };
}

/** Dense markup admits a smaller source slice, with one shared request budget
 * across attempts. Failed generators unwind before retry; cache/reservation
 * lifetimes remain with the caller. Snapshot identity and cumulative work survive
 * so retries cannot hide stale data or turn admission into an unbounded scan. */
export function* noteWindowSteps(
  address: NoteWindowAddress,
  current: () => boolean = () => true,
): Generator<NotePageRequest, NoteWindow, NoteReadPage> {
  const work = {
    requests: 0,
    wireBytes: 0,
    peak: 0,
    canonicalWorkBytes: 0,
    snapshotId: address.snapshotId,
  };
  const failedRanges = new Set<string>();
  let pageBytes: number = NOTE_WINDOW_LIMITS.requestSourceBytes;
  while (pageBytes >= 4) {
    try {
      return yield* assembleWindowSteps(address, current, pageBytes, work);
    } catch (error) {
      if (error instanceof NoteWindowControlBudgetError) {
        // A 36-byte tail returned to a 4096-byte request must shrink from 36,
        // rather than repeatedly fetching it at 2048/1024/etc. The failed
        // generator retains no graph in this error; only scalar diagnostics.
        if (!error.sourceRange || error.sourceBytes <= 4 || pageBytes === 4) throw error;
        const key = `${error.sourceRange.start}:${error.sourceRange.end}`;
        if (failedRanges.has(key)) throw error;
        failedRanges.add(key);
        const smaller = Math.min(pageBytes / 2, error.sourceBytes / 2);
        pageBytes = Math.max(4, 2 ** Math.floor(Math.log2(smaller)));
      } else {
        if (!(error instanceof WindowAdmissionError) || pageBytes === 4) throw error;
        pageBytes = Math.max(4, Math.floor(pageBytes / 2));
      }
    }
  }
  throw new Error('Note source cannot fit an active window');
}

/** Async driver for transport-level consumers; sagas drive the same iterator through
 * their existing cache/admission owner instead of creating another read registry. */
export async function readNoteWindow(
  read: (request: NotePageRequest) => Promise<NoteReadPage>,
  address: NoteWindowAddress,
  current: () => boolean = () => true,
): Promise<NoteWindow> {
  const steps = noteWindowSteps(address, current);
  let next = steps.next();
  try {
    while (!next.done) next = steps.next(await read(next.value));
    return next.value;
  } finally {
    steps.return(undefined as never);
  }
}
