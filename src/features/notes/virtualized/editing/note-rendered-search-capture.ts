import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { sameNoteScope } from '$lib/client/note-pages';
import type { NoteEditAuthority } from './note-edit-authority';
import type { NoteSelectionMarkdownIdentity } from './note-selection-markdown-capture';

export class UnsupportedNoteRenderedSearch extends Error {}
type NoteRenderedSearchIdentity = NoteSelectionMarkdownIdentity;
export interface NoteRenderedSearchInput {
  readonly authority: NoteEditAuthority;
  readonly identity: NoteRenderedSearchIdentity;
  readonly query: {
    readonly text: string;
    readonly caseSensitive: false;
    readonly mode: 'renderedText';
  };
  readonly selection: {
    readonly anchor: number;
    readonly head: number;
    readonly anchorAffinity: -1 | 1;
    readonly headAffinity: -1 | 1;
  };
  /** Caller admits native/capture DATA before entry and permanently observes loss
   * of the actual query, domain, original expiry and native/context ownership. */
  readonly current: () => boolean;
  readonly now?: () => number;
}
const noteRenderedSearchCaptureLimits = Object.freeze({
  windowUnits: 32768,
  paragraphUnits: 4096,
  textBytes: 16384,
  queryBytes: 1024,
});
const uint = (n: number) => Number.isSafeInteger(n) && n >= 0;
const unsupported = () =>
  // i18n-ignore (internal typed refusal diagnostic; not rendered UI text)
  new UnsupportedNoteRenderedSearch('Unsupported native rendered search context');
const encoder = new TextEncoder();
const scalarText = (s: string) => {
  for (const c of s)
    if (c.length === 1 && c.charCodeAt(0) >= 0xd800 && c.charCodeAt(0) <= 0xdfff) return false;
  return true;
};
/** Configured, already admitted native graphs only; Reflect.ownKeys does not
 * establish a memory bound for arbitrary caller-created objects or proxies. */
function emptyAttributes(value: object) {
  const prototype = Object.getPrototypeOf(value);
  if ((prototype !== Object.prototype && prototype !== null) || Reflect.ownKeys(value).length)
    throw unsupported();
}
function emptyDeclaredAttributes(spec: object) {
  const attrs = Object.getOwnPropertyDescriptor(spec, 'attrs');
  if (attrs) {
    if (!('value' in attrs) || !attrs.value || typeof attrs.value !== 'object') throw unsupported();
    emptyAttributes(attrs.value);
  }
}

/** Capture independently from the actual native leaf and its configured DOM,
 * then prove correspondence to a genuinely acquired authority. Never uses the
 * source as rendered fallback, Markdown copy/trim, a synthetic native tree, or
 * a reconstructed selection. Only one actual range/complete paragraph/leaf is
 * supported. This local DTO is not authenticated upload or search execution. */
function capture(view: EditorView, input: NoteRenderedSearchInput) {
  const state = view.state,
    authority = input.authority,
    doc = state.doc,
    schema = state.schema;
  const sourceAt = authority.sourceAt,
    pmAt = authority.pmAt,
    posAtDOM = view.posAtDOM;
  const operationCurrent = input.current,
    now = input.now ?? Date.now;
  const originalNow = input.now;
  const i = input.identity;
  const scope = Object.freeze({ ...i.scope });
  for (const value of [
    scope.backendId,
    scope.workspaceId,
    scope.noteId,
    scope.noteInstanceId,
    i.sourceRevision,
    i.snapshotId,
    i.expiresAt,
  ]) {
    if (typeof value !== 'string' || !value || value.length > 1024)
      throw new Error('Invalid rendered search identity');
  }
  const identity = Object.freeze({ ...i, scope });
  const query = Object.freeze({ ...input.query });
  const selection = Object.freeze({ ...input.selection });
  if (
    !query.text ||
    query.text.length > noteRenderedSearchCaptureLimits.queryBytes ||
    query.caseSensitive !== false ||
    query.mode !== 'renderedText' ||
    query.text.includes('\0') ||
    !scalarText(query.text) ||
    encoder.encode(query.text).length > noteRenderedSearchCaptureLimits.queryBytes
  )
    throw new Error('Invalid rendered search query');
  const pinned = (time: number) => {
    const current = input.identity;
    if (
      authority.sourceAt !== sourceAt ||
      authority.pmAt !== pmAt ||
      view.posAtDOM !== posAtDOM ||
      input.current !== operationCurrent ||
      input.now !== originalNow ||
      view.isDestroyed ||
      view.state !== state ||
      input.authority !== authority ||
      authority.doc !== doc ||
      state.doc !== doc ||
      state.schema !== schema ||
      doc.type.schema !== schema ||
      !sameNoteScope(authority.scope, scope) ||
      authority.snapshotId !== identity.snapshotId ||
      authority.sourceRevision !== identity.sourceRevision ||
      authority.generation !== identity.documentGeneration ||
      ![identity.documentGeneration, identity.liveGeneration, identity.selectionGeneration].every(
        uint,
      ) ||
      !Number.isFinite(time) ||
      !Number.isFinite(Date.parse(identity.expiresAt)) ||
      time >= Date.parse(identity.expiresAt) ||
      !sameNoteScope(current.scope, scope) ||
      current.sourceRevision !== identity.sourceRevision ||
      current.snapshotId !== identity.snapshotId ||
      current.documentGeneration !== identity.documentGeneration ||
      current.liveGeneration !== identity.liveGeneration ||
      current.selectionGeneration !== identity.selectionGeneration ||
      current.expiresAt !== identity.expiresAt ||
      input.query.text !== query.text ||
      input.query.mode !== query.mode ||
      input.query.caseSensitive !== query.caseSensitive ||
      input.selection.anchor !== selection.anchor ||
      input.selection.head !== selection.head ||
      input.selection.anchorAffinity !== selection.anchorAffinity ||
      input.selection.headAffinity !== selection.headAffinity
    )
      throw new Error('Stale native rendered search capture');
  };
  if (!operationCurrent()) throw new Error('Stale native rendered search capture');
  pinned(now());
  if (
    doc.content.size > noteRenderedSearchCaptureLimits.windowUnits ||
    authority.source.length > noteRenderedSearchCaptureLimits.windowUnits
  )
    throw new Error('Rendered search capture budget exceeded');
  const selected = state.selection;
  if (
    !(selected instanceof TextSelection) ||
    selected.ranges.length !== 1 ||
    selected.$from.depth !== 1 ||
    !selected.$from.sameParent(selected.$to)
  )
    throw unsupported();
  const paragraph = selected.$from.parent;
  if (
    paragraph.type !== schema.nodes.paragraph ||
    paragraph.marks.length ||
    paragraph.childCount !== 1 ||
    paragraph.content.size > noteRenderedSearchCaptureLimits.paragraphUnits
  )
    throw unsupported();
  const leaf = paragraph.firstChild!;
  const checkShape = () => {
    if (
      state.selection !== selected ||
      selected.$from.parent !== paragraph ||
      paragraph.firstChild !== leaf ||
      paragraph.childCount !== 1 ||
      paragraph.marks.length ||
      leaf.type !== schema.nodes.text ||
      !leaf.isText ||
      leaf.marks.length
    )
      throw unsupported();
    emptyDeclaredAttributes(paragraph.type.spec);
    emptyDeclaredAttributes(leaf.type.spec);
    emptyAttributes(paragraph.attrs);
    emptyAttributes(leaf.attrs);
  };
  checkShape();
  // Native text is obtained first; authority source can only validate it below.
  const text = leaf.text;
  if (!text || text.length !== paragraph.content.size || !scalarText(text) || text.includes('\0'))
    throw unsupported();
  const utf8Bytes = encoder.encode(text).length;
  if (utf8Bytes > noteRenderedSearchCaptureLimits.textBytes) throw unsupported();
  const nativeStart = selected.$from.start(),
    nativeEnd = nativeStart + text.length;
  const sourceStart = authority.sourceAt(nativeStart, 1),
    sourceEnd = authority.sourceAt(nativeEnd, -1);
  if (
    !uint(sourceStart) ||
    !uint(sourceEnd) ||
    sourceEnd - sourceStart !== text.length ||
    sourceStart < authority.start ||
    sourceEnd > authority.start + authority.source.length ||
    authority.source.slice(sourceStart - authority.start, sourceEnd - authority.start) !== text
  )
    throw unsupported();
  const parentDOM = view.nodeDOM(nativeStart - 1);
  if (
    !parentDOM ||
    parentDOM.nodeType !== 1 ||
    (parentDOM as Element).tagName !== 'P' ||
    parentDOM.parentNode !== view.dom ||
    (parentDOM as Element).attributes.length ||
    parentDOM.childNodes.length !== 1
  )
    throw unsupported();
  const textDOM = parentDOM.firstChild;
  if (!textDOM || textDOM.nodeType !== 3 || (textDOM as Text).data !== text) throw unsupported();
  const boundaries = new Set([nativeStart]);
  const verifyMapping = () => {
    boundaries.clear();
    boundaries.add(nativeStart);
    let offset = 0;
    for (const scalar of text) {
      const next = offset + scalar.length;
      if (
        authority.sourceAt(nativeStart + offset, 1) !== sourceStart + offset ||
        authority.sourceAt(nativeStart + next, -1) !== sourceStart + next ||
        authority.pmAt(sourceStart + offset, 1) !== nativeStart + offset ||
        authority.pmAt(sourceStart + next, -1) !== nativeStart + next ||
        view.posAtDOM(textDOM, offset, 1) !== nativeStart + offset ||
        view.posAtDOM(textDOM, next, -1) !== nativeStart + next
      )
        throw unsupported();
      boundaries.add(nativeStart + next);
      offset = next;
    }
    if (!boundaries.has(selected.anchor) || !boundaries.has(selected.head)) throw unsupported();
    for (const key of ['anchor', 'head'] as const) {
      const affinity = selection[key === 'anchor' ? 'anchorAffinity' : 'headAffinity'];
      if (
        (affinity !== -1 && affinity !== 1) ||
        !uint(selection[key]) ||
        selection[key] !== sourceStart + selected[key] - nativeStart ||
        authority.sourceAt(selected[key], affinity) !== selection[key] ||
        authority.pmAt(selection[key], affinity) !== selected[key]
      )
        throw unsupported();
    }
  };
  verifyMapping();
  if (!operationCurrent()) throw new Error('Stale native rendered search capture');
  const finalTime = now();
  pinned(finalTime);
  // Revalidate mutable maps after the last executable ownership/clock callback.
  // Final identity checks below must not execute either callback again.
  verifyMapping();
  pinned(finalTime);
  checkShape();
  if (
    leaf.text !== text ||
    paragraph.content.size !== text.length ||
    parentDOM.parentNode !== view.dom ||
    (parentDOM as Element).attributes.length ||
    parentDOM.childNodes.length !== 1 ||
    parentDOM.firstChild !== textDOM ||
    (textDOM as Text).data !== text ||
    authority.source.slice(sourceStart - authority.start, sourceEnd - authority.start) !== text
  )
    throw unsupported();
  return Object.freeze({
    identity,
    query,
    selectionMode: 'ranges' as const,
    selection,
    direction: selected.anchor > selected.head ? ('backward' as const) : ('forward' as const),
    sourceRange: Object.freeze({
      start: Math.min(selection.anchor, selection.head),
      end: Math.max(selection.anchor, selection.head),
    }),
    paragraph: Object.freeze({
      version: 1 as const,
      nodeType: 'paragraph' as const,
      parentOrdinal: null,
      sourceRange: Object.freeze({ start: sourceStart, end: sourceEnd }),
      nativeRange: Object.freeze({ from: nativeStart - 1, to: nativeEnd + 1 }),
      attributes: Object.freeze({}),
    }),
    inline: Object.freeze({
      version: 2 as const,
      nodeType: 'text' as const,
      parentOrdinal: 0 as const,
      sourceRange: Object.freeze({ start: sourceStart, end: sourceEnd }),
      nativeRange: Object.freeze({ from: nativeStart, to: nativeEnd }),
      attributes: Object.freeze({}),
    }),
    // Upload owner assigns textId/SHA-256 to exactly these UTF-8 bytes and binds
    // that renderedText reference to the v2 inline descriptor. No IDs invented here.
    rendered: Object.freeze({ text, length: text.length, utf8Bytes }),
  });
}

declare const brand: unique symbol;
export type NoteRenderedSearchCapture = ReturnType<typeof capture> & { readonly [brand]: true };
const captures = new WeakSet<object>();
export const isNoteRenderedSearchCapture = (value: object): value is NoteRenderedSearchCapture =>
  captures.has(value);
export function captureNoteRenderedSearch(
  view: EditorView,
  input: NoteRenderedSearchInput,
): NoteRenderedSearchCapture {
  const result = capture(view, input);
  captures.add(result);
  return result as NoteRenderedSearchCapture;
}
