import { TextSelection, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { sameNoteScope, type NoteScope } from '$lib/client/note-pages';
import { serializeSelectionToMarkdown } from '$lib/utils/selected-note-markdown-copy';
import type { NoteEditAuthority } from './note-edit-authority';

export class UnsupportedNoteSelectionMarkdown extends Error {}

export interface NoteSelectionMarkdownIdentity {
  readonly scope: NoteScope;
  readonly sourceRevision: string;
  readonly snapshotId: string;
  readonly documentGeneration: number;
  readonly liveGeneration: number;
  readonly selectionGeneration: number;
  /** Original operation expiry supplied by its owner; never refreshed here. */
  readonly expiresAt: string;
}
interface SourceSelection {
  readonly anchor: number;
  readonly head: number;
  readonly anchorAffinity: -1 | 1;
  readonly headAffinity: -1 | 1;
}
export interface NoteSelectionMarkdownInput {
  readonly authority: NoteEditAuthority;
  readonly identity: NoteSelectionMarkdownIdentity;
  readonly selection: SourceSelection;
  /** Owner must admit the bounded capture before entry and bind these identities
   * to the actual panel, native view and document/selection generations. */
  readonly current: () => boolean;
  readonly now?: () => number;
}
const uint = (n: number) => Number.isSafeInteger(n) && n >= 0;
const unsupported = () =>
  // i18n-ignore (internal refusal diagnostic; the copy handler logs this error)
  new UnsupportedNoteSelectionMarkdown('Unsupported native selection context');
const encoder = new TextEncoder();
const limits = Object.freeze({ windowUnits: 32768, paragraphUnits: 4096, outputBytes: 16384 });

function live(input: NoteSelectionMarkdownInput) {
  const { authority: a, identity: i } = input;
  const expiry = Date.parse(i.expiresAt);
  const now = (input.now ?? Date.now)();
  if (
    !input.current() ||
    !Number.isFinite(expiry) ||
    !Number.isFinite(now) ||
    expiry <= now ||
    a.snapshotId !== i.snapshotId ||
    !sameNoteScope(a.scope, i.scope) ||
    a.sourceRevision !== i.sourceRevision ||
    a.generation !== i.documentGeneration ||
    ![i.documentGeneration, i.liveGeneration, i.selectionGeneration].every(uint)
  )
    throw new Error('Stale native selection capture');
}

function identity(input: NoteSelectionMarkdownInput) {
  const i = input.identity,
    scope = i.scope;
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
      throw new Error('Invalid native selection identity');
  }
  return Object.freeze({
    scope: Object.freeze({
      backendId: scope.backendId,
      workspaceId: scope.workspaceId,
      noteId: scope.noteId,
      noteInstanceId: scope.noteInstanceId,
    }),
    sourceRevision: i.sourceRevision,
    snapshotId: i.snapshotId,
    documentGeneration: i.documentGeneration,
    liveGeneration: i.liveGeneration,
    selectionGeneration: i.selectionGeneration,
    expiresAt: i.expiresAt,
  });
}
function unchanged(
  input: NoteSelectionMarkdownInput,
  capturedIdentity: NoteSelectionMarkdownIdentity,
  selected: SourceSelection,
) {
  live(input);
  const i = input.identity;
  if (
    !sameNoteScope(i.scope, capturedIdentity.scope) ||
    i.sourceRevision !== capturedIdentity.sourceRevision ||
    i.snapshotId !== capturedIdentity.snapshotId ||
    i.documentGeneration !== capturedIdentity.documentGeneration ||
    i.liveGeneration !== capturedIdentity.liveGeneration ||
    i.selectionGeneration !== capturedIdentity.selectionGeneration ||
    i.expiresAt !== capturedIdentity.expiresAt ||
    input.selection.anchor !== selected.anchor ||
    input.selection.head !== selected.head ||
    input.selection.anchorAffinity !== selected.anchorAffinity ||
    input.selection.headAffinity !== selected.headAffinity
  )
    throw new Error('Native selection identity changed during capture');
}
function attributes(state: EditorState, attrs: Record<string, unknown>) {
  const result: Record<string, string | number | boolean | null> = {};
  const declarations = state.schema.nodes.paragraph.spec.attrs ?? {};
  let count = 0,
    bytes = 0;
  for (const key in declarations) {
    if (!Object.hasOwn(declarations, key)) throw unsupported();
    if (++count > 32 || key.length > 128) throw unsupported();
    const field = Object.getOwnPropertyDescriptor(attrs, key);
    if (!field || !field.enumerable || !('value' in field)) throw unsupported();
    const value: unknown = field.value;
    if (
      (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) ||
      (typeof value === 'number' && !Number.isFinite(value)) ||
      (typeof value === 'string' && value.length > 1024)
    )
      throw unsupported();
    bytes += encoder.encode(JSON.stringify([key, value])).length;
    if (bytes > 4096) throw unsupported();
    Object.defineProperty(result, key, { value, enumerable: true });
  }
  let actual = 0;
  for (const key in attrs) {
    if (++actual > 32 || !Object.hasOwn(declarations, key) || !Object.hasOwn(attrs, key))
      throw unsupported();
  }
  if (actual !== count) throw unsupported();
  return Object.freeze(result);
}

/** Text attributes have no representation in the supported plain-text subset.
 * Inspect actual own keys (including hidden/symbol keys), never property values.
 * The owner supplies the configured native schema/graph under its DATA admission;
 * this does not establish a heap bound for arbitrary caller-created objects. */
function emptyTextAttributes(state: EditorState) {
  const empty = (value: object) => {
    const prototype = Object.getPrototypeOf(value);
    if ((prototype !== null && prototype !== Object.prototype) || Reflect.ownKeys(value).length)
      throw unsupported();
  };
  const declaration = Object.getOwnPropertyDescriptor(state.schema.nodes.text.spec, 'attrs');
  if (declaration) {
    if (!('value' in declaration) || !declaration.value || typeof declaration.value !== 'object')
      throw unsupported();
    empty(declaration.value);
  }
  const paragraph = state.selection.$from.parent;
  if (paragraph.content.size > limits.paragraphUnits) throw unsupported();
  paragraph.forEach((child) => {
    if (!child.isText || child.type !== state.schema.nodes.text || child.marks.length)
      throw unsupported();
    const attrs = Object.getOwnPropertyDescriptor(child, 'attrs');
    if (!attrs || !('value' in attrs) || !attrs.value || typeof attrs.value !== 'object')
      throw unsupported();
    empty(attrs.value);
  });
  return Object.freeze({});
}

/** Pure validation of actual native context. This candidate is NOT a staged
 * serializer receipt: captureNoteSelectionMarkdown also checks the configured
 * schema's real serializer. No source parser, source fallback or native tree is
 * synthesized. Only one complete current native paragraph is supported; this
 * read capture does not independently certify a canonical lexical/edit owner. */
export function prepareNoteSelectionMarkdownCapture(
  state: EditorState,
  input: NoteSelectionMarkdownInput,
) {
  live(input);
  const { authority: a } = input;
  const capturedIdentity = identity(input);
  const sourceSelection = Object.freeze({
    anchor: input.selection.anchor,
    head: input.selection.head,
    anchorAffinity: input.selection.anchorAffinity,
    headAffinity: input.selection.headAffinity,
  });
  if (state.doc !== a.doc || state.schema !== a.doc.type.schema)
    throw new Error('Stale native selection document');
  if (state.doc.content.size > limits.windowUnits || a.source.length > limits.windowUnits)
    throw new Error('Native selection capture budget exceeded');
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || selection.ranges.length !== 1) throw unsupported();
  const { $from, $to } = selection;
  if ($from.depth !== 1 || !$from.sameParent($to) || $from.parent.type.name !== 'paragraph')
    throw unsupported();
  const paragraph = $from.parent;
  if (paragraph.content.size > limits.paragraphUnits || paragraph.marks.length) throw unsupported();
  const attrs = attributes(state, paragraph.attrs),
    inlineAttrs = emptyTextAttributes(state);
  let text = '';
  paragraph.forEach((child) => {
    if (!child.isText || child.marks.length) throw unsupported();
    text += child.text ?? '';
  });
  if (!text || text.length !== paragraph.content.size) throw unsupported();
  const nativeStart = $from.start(),
    nativeEnd = nativeStart + text.length;
  const sourceStart = a.sourceAt(nativeStart, 1),
    sourceEnd = a.sourceAt(nativeEnd, -1);
  if (
    !uint(sourceStart) ||
    !uint(sourceEnd) ||
    sourceStart < a.start ||
    sourceEnd > a.start + a.source.length ||
    sourceEnd - sourceStart !== text.length ||
    a.source.slice(sourceStart - a.start, sourceEnd - a.start) !== text
  )
    throw unsupported();
  let offset = 0;
  const boundaries = new Set([nativeStart]);
  for (const scalar of text) {
    if (scalar.length === 1 && scalar.charCodeAt(0) >= 0xd800 && scalar.charCodeAt(0) <= 0xdfff)
      throw unsupported();
    const next = offset + scalar.length;
    if (
      a.sourceAt(nativeStart + offset, 1) !== sourceStart + offset ||
      a.sourceAt(nativeStart + next, -1) !== sourceStart + next ||
      a.pmAt(sourceStart + offset, 1) !== nativeStart + offset ||
      a.pmAt(sourceStart + next, -1) !== nativeStart + next
    )
      throw unsupported();
    boundaries.add(nativeStart + next);
    offset = next;
  }
  if (!boundaries.has(selection.anchor) || !boundaries.has(selection.head)) throw unsupported();
  for (const key of ['anchor', 'head'] as const) {
    const affinity = sourceSelection[key === 'anchor' ? 'anchorAffinity' : 'headAffinity'];
    if (
      (affinity !== -1 && affinity !== 1) ||
      !uint(sourceSelection[key]) ||
      sourceSelection[key] !== sourceStart + selection[key] - nativeStart ||
      a.sourceAt(selection[key], affinity) !== sourceSelection[key] ||
      a.pmAt(sourceSelection[key], affinity) !== selection[key]
    )
      throw new Error('Native and source selections differ');
  }
  const slice = selection.content();
  if (
    !selection.empty &&
    (slice.openStart !== 1 ||
      slice.openEnd !== 1 ||
      slice.content.childCount !== 1 ||
      slice.content.firstChild?.type !== paragraph.type ||
      slice.content.firstChild.textContent !==
        text.slice(selection.from - nativeStart, selection.to - nativeStart))
  )
    throw unsupported();
  const selected = text.slice(selection.from - nativeStart, selection.to - nativeStart);
  const markdown = selection.empty ? null : selected.trim() || null;
  if (markdown !== null && encoder.encode(markdown).length > limits.outputBytes)
    throw unsupported();
  unchanged(input, capturedIdentity, sourceSelection);
  return Object.freeze({
    identity: capturedIdentity,
    selection: sourceSelection,
    direction: selection.anchor > selection.head ? ('backward' as const) : ('forward' as const),
    sourceRange: Object.freeze({
      start: Math.min(sourceSelection.anchor, sourceSelection.head),
      end: Math.max(sourceSelection.anchor, sourceSelection.head),
    }),
    paragraph: Object.freeze({
      nodeType: 'paragraph' as const,
      sourceRange: Object.freeze({ start: sourceStart, end: sourceEnd }),
      nativeRange: Object.freeze({ from: nativeStart - 1, to: nativeEnd + 1 }),
      attributes: Object.freeze(attrs),
    }),
    inline: Object.freeze({
      nodeType: 'text' as const,
      attributes: inlineAttrs,
      nativeRange: Object.freeze({ from: selection.from, to: selection.to }),
    }),
    slice: Object.freeze({ openStart: slice.openStart, openEnd: slice.openEnd }),
    markdown,
    empty: selection.empty
      ? ('collapsed' as const)
      : markdown === null
        ? ('whitespace' as const)
        : null,
  });
}

type Candidate = ReturnType<typeof prepareNoteSelectionMarkdownCapture>;
declare const captured: unique symbol;
export type NoteSelectionMarkdownCapture = Candidate & { readonly [captured]: true };
const receipts = new WeakSet<object>();
export const isNoteSelectionMarkdownCapture = (
  value: object,
): value is NoteSelectionMarkdownCapture => receipts.has(value);

/** Read-only native adapter: validates before bounded DOM serialization, checks
 * the existing configured-schema copy implementation, then rechecks ownership.
 * The returned immutable DTO retains no EditorState/Slice/PM graph. The staging
 * owner must bind it to its original header, DATA admission and operation lease;
 * this local receipt is not backend authentication or upload support. */
export function captureNoteSelectionMarkdown(
  view: EditorView,
  input: NoteSelectionMarkdownInput,
): NoteSelectionMarkdownCapture {
  const state = view.state,
    authority = input.authority,
    doc = state.doc,
    schema = state.schema;
  const candidate = prepareNoteSelectionMarkdownCapture(state, input);
  const actual = serializeSelectionToMarkdown(view, input.identity.scope.workspaceId);
  unchanged(input, candidate.identity, candidate.selection);
  if (
    input.authority !== authority ||
    view.state !== state ||
    state.doc !== doc ||
    authority.doc !== doc ||
    state.schema !== schema ||
    doc.type.schema !== schema
  )
    throw new Error('Native selection changed during serialization');
  emptyTextAttributes(state);
  const currentAttrs = attributes(state, state.selection.$from.parent.attrs),
    capturedAttrs = candidate.paragraph.attributes;
  if (
    Object.keys(currentAttrs).length !== Object.keys(capturedAttrs).length ||
    Object.keys(capturedAttrs).some((key) => !Object.is(currentAttrs[key], capturedAttrs[key]))
  )
    throw unsupported();
  if (actual !== candidate.markdown) throw unsupported();
  receipts.add(candidate);
  return candidate as NoteSelectionMarkdownCapture;
}
