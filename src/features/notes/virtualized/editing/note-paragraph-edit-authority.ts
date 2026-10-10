import type { Node as PMNode } from '@tiptap/pm/model';
import {
  sameNoteScope,
  type NotePageRequest,
  type NoteReadPage,
  type NoteSourcePage,
} from '$lib/client/note-pages';
import { NOTE_WINDOW_LIMITS, type NoteWindow } from '../note-window-reader';
import type { SourceProjection } from '../projection/source-projection';
import { NoteEditAuthority } from './note-edit-authority';

/** A valid readable construct outside this editor's deliberately narrow serializer. */
export class UnsupportedParagraphEdit extends Error {}

type Identity = Pick<NoteSourcePage, 'scope' | 'sourceRevision' | 'snapshotId' | 'expiresAt'>;
type Owner = Extract<NoteWindow['context'][number], { kind: 'boundary' }>;
type Page = Extract<NoteReadPage, { kind: 'noteContextPage' }>;
type Fragment = Extract<Page['items'][number], { kind: 'fragment' }>;
type Steps<T> = Generator<NotePageRequest, T, NoteReadPage>;
type ResolvedOwner = { owner: Owner; opening: string; closing: string };

/** Issued by DATA only after reserving the existing assembly owner. The exact
 * source header and window bind the allowance; current checks that its resource
 * lease remains held. DATA retains/releases that lease through IO settlement. */
export interface NoteParagraphEditGrant {
  readonly window: NoteWindow;
  readonly identity: Identity;
  readonly allowance: Readonly<{
    retainedBytes: number;
    requests: number;
    descriptors: number;
    wireBytes: number;
  }>;
  /** DATA atomically consumes this grant once; failure and cancellation do not refund it. */
  claim(): boolean;
  current(): boolean;
}

/** Runtime-only receipt minted by the DATA-driven resolver below. */
export interface NoteParagraphEditContext {
  readonly cost: Readonly<{ requests: number; wireBytes: number; retainedBytes: number }>;
}
const receipts = new WeakMap<
  NoteParagraphEditContext,
  {
    window: NoteWindow;
    source: string;
    start: number;
    end: number;
    sourceLength: number;
    identity: Identity;
    owners: ResolvedOwner[];
    current: () => boolean;
    now: () => number;
  }
>();
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

function assertIdentity(
  window: NoteWindow,
  identity: Identity,
  current: () => boolean,
  now: () => number,
) {
  if (!current()) throw new Error('Paragraph edit context superseded');
  if (
    !sameNoteScope(window.scope, identity.scope) ||
    window.sourceRevision !== identity.sourceRevision ||
    window.snapshotId !== identity.snapshotId ||
    !Number.isFinite(Date.parse(identity.expiresAt)) ||
    now() >= Date.parse(identity.expiresAt)
  )
    throw new Error('Stale paragraph edit context');
}

/** The caller drives requests through DATA and supplies the original source-page
 * identity, including its original expiry. Before driving this iterator DATA
 * must reserve the remaining context allowance and one wire-frame allowance
 * and supply their exact-window grant;
 * receipt.cost is final accounting, not permission to allocate retroactively.
 * DATA also owns the complete escaped RPC frame bound. No transport, prefix read or metadata
 * interpretation is owned here. Ordinary lexical paragraphs have no ownerRef;
 * their returned detailRef is used verbatim, never reconstructed from an ID. */
export function* noteParagraphEditContextSteps(
  window: NoteWindow,
  original: Identity,
  current: () => boolean,
  grant: NoteParagraphEditGrant,
  now: () => number = Date.now,
): Steps<NoteParagraphEditContext> {
  // No owner copies or read requests precede admission. The grant belongs to
  // the caller's existing DATA ledger, never to a second resource registry.
  const admitted = () => {
    const required = {
      retainedBytes: NOTE_WINDOW_LIMITS.contextBytes - window.cost.contextBytes,
      requests: NOTE_WINDOW_LIMITS.requests - window.cost.requests,
      descriptors: NOTE_WINDOW_LIMITS.descriptors - window.context.length,
      wireBytes: NOTE_WINDOW_LIMITS.wireBytes,
    };
    if (
      !grant ||
      grant.window !== window ||
      grant.identity !== original ||
      !grant.current() ||
      Object.entries(required).some(([key, value]) => {
        const allowance = grant.allowance[key as keyof typeof required];
        return !Number.isSafeInteger(allowance) || allowance < value || allowance < 0;
      })
    )
      throw new Error('Paragraph edit resource grant unavailable');
    return current();
  };
  assertIdentity(window, original, admitted, now);
  if (!grant.claim()) throw new Error('Paragraph edit resource grant already claimed');
  const identity = { ...original, scope: { ...original.scope } };
  const source = window.text,
    start = window.range.start,
    end = window.range.end,
    sourceLength = window.sourceLength;
  const check = () => {
    assertIdentity(window, identity, admitted, now);
    if (
      window.text !== source ||
      window.range.start !== start ||
      window.range.end !== end ||
      window.sourceLength !== sourceLength
    )
      throw new Error('Paragraph source window changed');
  };
  check();
  if (window.native || window.canonicalOwners?.length)
    throw new UnsupportedParagraphEdit('Unsupported canonical paragraph edit context');
  const owners = window.context
    .filter((item): item is Owner => item.kind === 'boundary')
    .map((owner) => ({ ...owner, sourceRange: { ...owner.sourceRange } }));
  if (
    !owners.length ||
    owners.some(
      (owner) =>
        owner.construct !== 'paragraph' ||
        owner.entryPath !== 'markdown' ||
        owner.parentRef ||
        !owner.detailRef ||
        owner.sourceRange.start < window.range.start ||
        owner.sourceRange.end > window.range.end ||
        owner.sourceRange.start >= owner.sourceRange.end,
    )
  )
    throw new UnsupportedParagraphEdit('Unsupported ordinary paragraph edit context');
  let requests = 0,
    wireBytes = 0,
    retainedBytes = 0,
    descriptors = window.context.length;
  const charge = (value: unknown) => {
    retainedBytes += bytes(value);
    if (window.cost.contextBytes + retainedBytes > NOTE_WINDOW_LIMITS.contextBytes)
      throw new Error('Paragraph edit context byte budget exceeded');
  };
  charge(owners);
  function* collection(ref: string): Steps<Page['items']> {
    const items: Page['items'] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      check();
      if (window.cost.requests + ++requests > NOTE_WINDOW_LIMITS.requests)
        throw new Error('Paragraph edit request budget exceeded');
      const page = yield {
        kind: 'context',
        contextRef: ref,
        ...(cursor ? { cursor } : {}),
        maxWireBytes: NOTE_WINDOW_LIMITS.wireBytes,
        maxItems: 64,
      };
      check();
      if (
        page.kind !== 'noteContextPage' ||
        !sameNoteScope(page.scope, identity.scope) ||
        page.sourceRevision !== identity.sourceRevision ||
        page.snapshotId !== identity.snapshotId ||
        page.expiresAt !== identity.expiresAt
      )
        throw new Error('Paragraph edit response identity mismatch');
      const size = bytes(page);
      if (size > NOTE_WINDOW_LIMITS.wireBytes || page.items.length > 64)
        throw new Error('Paragraph edit response budget exceeded');
      wireBytes += size;
      descriptors += page.items.length;
      if (descriptors > NOTE_WINDOW_LIMITS.descriptors)
        throw new Error('Paragraph edit descriptor budget exceeded');
      // Charge decoded descriptors and retained field joins, including transient
      // duplicates, rather than hiding them behind the page cache reservation.
      charge(page.items);
      items.push(...page.items);
      if (page.nextCursor && (!page.items.length || cursors.has(page.nextCursor)))
        throw new Error('Paragraph edit cursor made no progress');
      cursor = page.nextCursor ?? undefined;
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return items;
  }
  function* field(entry: Fragment): Steps<string> {
    if (entry.offset !== 0 || entry.text !== '' || !entry.nextRef)
      throw new Error('Invalid paragraph detail directory');
    const seen = new Set<string>();
    let ref: string | null = entry.nextRef,
      text = '';
    while (ref) {
      if (seen.has(ref)) throw new Error('Paragraph detail reference cycle');
      seen.add(ref);
      const items: Page['items'] = yield* collection(ref);
      if (!items.length) throw new Error('Missing paragraph detail fragment');
      ref = null;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (
          item.kind !== 'fragment' ||
          item.field !== entry.field ||
          item.offset !== text.length ||
          (!item.text && item.nextRef) ||
          (i && ref === null)
        )
          throw new Error('Noncontiguous paragraph detail fragment');
        charge(item.text);
        text += item.text;
        ref = item.nextRef;
      }
    }
    return text;
  }
  const resolved: ResolvedOwner[] = [];
  for (const owner of owners) {
    if (!owner.detailRef) throw new Error('Missing paragraph detail reference');
    const directory = yield* collection(owner.detailRef);
    if (
      directory.length !== 2 ||
      directory[0].kind !== 'fragment' ||
      directory[0].field !== 'openingSource' ||
      directory[1].kind !== 'fragment' ||
      directory[1].field !== 'closingSource'
    )
      throw new Error('Unsupported paragraph detail directory');
    const opening = yield* field(directory[0]);
    const closing = yield* field(directory[1]);
    const resolvedOwner = {
      owner: { ...owner, sourceRange: { ...owner.sourceRange } },
      opening,
      closing,
    };
    charge(resolvedOwner);
    resolved.push(resolvedOwner);
  }
  check();
  const receipt = Object.freeze({ cost: Object.freeze({ requests, wireBytes, retainedBytes }) });
  receipts.set(receipt, {
    window,
    source: window.text,
    start: window.range.start,
    end: window.range.end,
    sourceLength: window.sourceLength,
    identity,
    owners: resolved,
    current: admitted,
    now,
  });
  return receipt;
}

/** Admit only complete, top-level, unmarked, transparent ordinary paragraphs.
 * SourceProjection contributes navigation; exact source/PM scalar equality and
 * real lexical delimiters establish editable authority separately. */
export function createNoteParagraphEditAuthority(
  window: NoteWindow,
  projection: SourceProjection,
  context: NoteParagraphEditContext,
  doc: PMNode,
): NoteEditAuthority {
  const receipt = receipts.get(context);
  if (!receipt || receipt.window !== window) throw new Error('Unresolved paragraph edit context');
  assertIdentity(window, receipt.identity, receipt.current, receipt.now);
  if (
    window.native ||
    window.text !== receipt.source ||
    window.range.start !== receipt.start ||
    window.range.end !== receipt.end ||
    window.sourceLength !== receipt.sourceLength ||
    projection.source !== window.text ||
    projection.start !== window.range.start ||
    window.text.length !== window.range.end - window.range.start ||
    window.text.length > 32768 ||
    doc.content.size > 32768 ||
    !doc.eq(doc.type.schema.nodeFromJSON(projection.content))
  )
    throw new Error('Mismatched paragraph edit projection');
  const lexical: ConstructorParameters<typeof NoteEditAuthority>[7][number][] = [];
  const ordered = [...receipt.owners].sort(
    (a, b) => a.owner.sourceRange.start - b.owner.sourceRange.start,
  );
  if (doc.childCount !== ordered.length)
    throw new UnsupportedParagraphEdit('Unsupported paragraph projection structure');
  let pm = 1;
  for (let index = 0; index < ordered.length; index++) {
    const { owner, opening, closing } = ordered[index];
    if (
      owner.entryPath !== 'markdown' ||
      owner.construct !== 'paragraph' ||
      (index && ordered[index - 1].owner.sourceRange.end > owner.sourceRange.start)
    )
      throw new Error('Invalid paragraph owner evidence');
    const raw = window.text.slice(
      owner.sourceRange.start - window.range.start,
      owner.sourceRange.end - window.range.start,
    );
    if (
      opening.length + closing.length > raw.length ||
      !raw.startsWith(opening) ||
      !raw.endsWith(closing) ||
      opening !== '' ||
      !/^(?:\r?\n)?$/.test(closing)
    )
      throw new UnsupportedParagraphEdit('Unsupported paragraph lexical delimiters');
    const start = owner.sourceRange.start + opening.length;
    const body = raw.slice(opening.length, raw.length - closing.length);
    const paragraph = doc.child(index);
    if (
      !body ||
      /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(body) ||
      /[^\S ]/.test(body) ||
      body.trim() !== body ||
      /  /.test(body) ||
      paragraph.type.name !== 'paragraph' ||
      paragraph.textContent !== body ||
      paragraph.content.size !== body.length
    )
      throw new UnsupportedParagraphEdit('Unsupported nontransparent paragraph body');
    paragraph.forEach((node) => {
      if (!node.isText || node.marks.length)
        throw new UnsupportedParagraphEdit('Unsupported paragraph marks');
    });
    let offset = 0;
    for (const text of body) {
      if (text.length === 1 && text.charCodeAt(0) >= 0xd800 && text.charCodeAt(0) <= 0xdfff)
        throw new Error('Invalid paragraph scalar');
      const from = start + offset,
        to = from + text.length;
      if (
        projection.sourceAt(pm + offset, 1) !== from ||
        projection.sourceAt(pm + offset + text.length, -1) !== to
      )
        throw new Error('Paragraph navigation differs from lexical source');
      lexical.push({
        pm: pm + offset,
        start: from,
        end: to,
        text,
        owner: owner.id,
        encoding: 'markdown',
        construct: 'paragraph',
      });
      offset += text.length;
    }
    pm += paragraph.nodeSize;
  }
  const forward = new Map<number, number>(),
    backward = new Map<number, number>();
  for (let at = 0; at <= doc.content.size; at++) {
    try {
      forward.set(at, projection.sourceAt(at, 1));
    } catch {
      /* Uncovered navigation stays unavailable. */
    }
    try {
      backward.set(at, projection.sourceAt(at, -1));
    } catch {
      /* Uncovered navigation stays unavailable. */
    }
  }
  return new NoteEditAuthority(
    { ...window.scope },
    window.sourceRevision,
    window.snapshotId,
    0,
    window.text,
    window.range.start,
    doc,
    lexical,
    { original: projection, changes: [], forward, backward },
    window.sourceLength,
  );
}
