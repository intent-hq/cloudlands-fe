import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { sameNoteScope } from '$lib/client/note-pages';
import { serializeSelectionToMarkdown } from '$lib/utils/selected-note-markdown-copy';
import type { SourceProjection } from '../projection/source-projection';
import {
  canBatchExactSourceMappings,
  verifyExactSourceMappings,
  type ExactSourceMapping,
} from '../projection/exact-source-mappings';
import { captureNoteMarker } from './note-marker-capture';
import type { NoteSelectionMarkdownIdentity } from './note-selection-markdown-capture';

class UnsupportedNoteMarkerSelection extends Error {}
export interface NoteMarkerSelectionInput {
  readonly projection: SourceProjection;
  readonly identity: NoteSelectionMarkdownIdentity;
  readonly selection: {
    readonly anchor: number;
    readonly head: number;
    readonly anchorAffinity: -1 | 1;
    readonly headAffinity: -1 | 1;
  };
  /** Actual complete original paragraph/window and DATA must be borrowed before
   * entry. Bind native/projection/header identity, permanently observe loss,
   * and retain all borrowed resources through downstream IO settlement. */
  readonly current: () => boolean;
  readonly now?: () => number;
}
const unsupported = () =>
  // i18n-ignore (internal typed refusal, not rendered UI text)
  new UnsupportedNoteMarkerSelection('Unsupported native marker selection');
const stale = () =>
  // i18n-ignore (internal capture lifetime diagnostic)
  new Error('Stale native marker selection');
const uint = (value: number) => Number.isSafeInteger(value) && value >= 0;

// Native graph is configured and admitted by the owner. Reflection is not an
// untrusted-object allocator. No omitted schema attribute becomes a default.
function emptyAttributes(node: PMNode) {
  if (Reflect.ownKeys(node.attrs).length) throw unsupported();
  const attrs = Object.getOwnPropertyDescriptor(node.type.spec, 'attrs');
  if (
    attrs &&
    (!('value' in attrs) ||
      !attrs.value ||
      typeof attrs.value !== 'object' ||
      Reflect.ownKeys(attrs.value).length)
  )
    throw unsupported();
}

/** Narrow copy adapter: one complete plain paragraph containing exactly text,
 * point marker, text. The actual copy serializer determines Markdown. Marker
 * branding proves only local native correspondence, never original server
 * ownership or permission to remove/restore source. Rendered search mapping is
 * deliberately not inferred from this copy result. */
function capture(view: EditorView, input: NoteMarkerSelectionInput) {
  const state = view.state,
    doc = state.doc,
    schema = state.schema;
  const projection = input.projection,
    source = projection.source,
    start = projection.start;
  const sourceAt = projection.sourceAt,
    pmAt = projection.pmAt;
  const current = input.current,
    originalNow = input.now,
    now = originalNow ?? Date.now;
  const originalIdentity = input.identity;
  const identity = Object.freeze({
    ...originalIdentity,
    scope: Object.freeze({ ...originalIdentity.scope }),
  });
  for (const value of [
    identity.scope.backendId,
    identity.scope.workspaceId,
    identity.scope.noteId,
    identity.scope.noteInstanceId,
    identity.sourceRevision,
    identity.snapshotId,
    identity.expiresAt,
  ])
    if (typeof value !== 'string' || !value || value.length > 1024) throw unsupported();
  if (
    ![identity.documentGeneration, identity.liveGeneration, identity.selectionGeneration].every(
      uint,
    )
  )
    throw unsupported();
  const selection = Object.freeze({ ...input.selection });
  const selected = state.selection;
  const pinned = () => {
    const actual = input.identity;
    if (
      view.isDestroyed ||
      view.state !== state ||
      state.doc !== doc ||
      state.schema !== schema ||
      doc.type.schema !== schema ||
      state.selection !== selected ||
      input.projection !== projection ||
      projection.source !== source ||
      projection.start !== start ||
      projection.sourceAt !== sourceAt ||
      projection.pmAt !== pmAt ||
      input.current !== current ||
      input.now !== originalNow ||
      input.identity !== originalIdentity ||
      !sameNoteScope(actual.scope, identity.scope) ||
      actual.sourceRevision !== identity.sourceRevision ||
      actual.snapshotId !== identity.snapshotId ||
      actual.documentGeneration !== identity.documentGeneration ||
      actual.liveGeneration !== identity.liveGeneration ||
      actual.selectionGeneration !== identity.selectionGeneration ||
      actual.expiresAt !== identity.expiresAt ||
      input.selection.anchor !== selection.anchor ||
      input.selection.head !== selection.head ||
      input.selection.anchorAffinity !== selection.anchorAffinity ||
      input.selection.headAffinity !== selection.headAffinity
    )
      throw stale();
  };
  if (!current()) throw stale();
  const time = now(),
    expiry = Date.parse(identity.expiresAt);
  pinned();
  if (!Number.isFinite(time) || !Number.isFinite(expiry) || time >= expiry) throw stale();
  // Admission precedes parent traversal, Slice creation, or DOM serialization.
  if (
    typeof source !== 'string' ||
    source.length > 32768 ||
    doc.content.size > 32768 ||
    projection.tokens.length > 32768 ||
    !uint(start) ||
    !uint(start + source.length) ||
    doc.childCount !== 1 ||
    !(selected instanceof TextSelection) ||
    selected.ranges.length !== 1 ||
    selected.$from.depth !== 1 ||
    !selected.$from.sameParent(selected.$to)
  )
    throw unsupported();
  const parent = doc.firstChild!;
  if (
    selected.$from.parent !== parent ||
    parent.type !== schema.nodes.paragraph ||
    parent.childCount !== 3 ||
    parent.content.size > 4096
  )
    throw unsupported();
  const left = parent.child(0),
    atom = parent.child(1),
    right = parent.child(2);
  const leftText = left.text,
    rightText = right.text;
  // Each leaf retains the established single-space ASCII subset. Two spaces
  // formed ACROSS the omitted marker are preserved by the real copy serializer.
  const plain = (text: string | undefined) =>
    !!text && /^[A-Za-z0-9 ]+$/.test(text) && !text.includes('  ');
  if (!plain(leftText) || !plain(rightText)) throw unsupported();
  const leftFrom = 1,
    markerFrom = left.nodeSize + 1,
    rightFrom = markerFrom + 1;
  const rightTo = rightFrom + right.nodeSize;
  const leftSource = projection.sourceAt(leftFrom, 1),
    leftEnd = projection.sourceAt(markerFrom, -1);
  const rightSource = projection.sourceAt(rightFrom, 1),
    rightEnd = projection.sourceAt(rightTo, -1);
  const shape = () => {
    if (
      doc.childCount !== 1 ||
      doc.firstChild !== parent ||
      parent.childCount !== 3 ||
      parent.child(0) !== left ||
      parent.child(1) !== atom ||
      parent.child(2) !== right ||
      parent.type !== schema.nodes.paragraph ||
      parent.marks.length ||
      left.type !== schema.nodes.text ||
      right.type !== schema.nodes.text ||
      !left.isText ||
      !right.isText ||
      left.marks.length ||
      right.marks.length ||
      left.text !== leftText ||
      right.text !== rightText ||
      left.nodeSize !== markerFrom - 1 ||
      right.nodeSize !== rightTo - rightFrom ||
      parent.content.size !== rightTo - 1 ||
      atom.type !== schema.nodes.commentAnchor ||
      !atom.isInline ||
      !atom.isAtom ||
      atom.nodeSize !== 1 ||
      atom.marks.length ||
      atom.attrs.type !== 'point'
    )
      throw unsupported();
    emptyAttributes(parent);
    emptyAttributes(left);
    emptyAttributes(right);
  };
  const mapping = () => {
    const mappings: ExactSourceMapping[] = [];
    const batch = canBatchExactSourceMappings(projection);
    const boundary = (pm: number, source: number, affinity: -1 | 1) => {
      if (batch) mappings.push({ pm, source, affinity });
      else if (
        projection.sourceAt(pm, affinity) !== source ||
        projection.pmAt(source, affinity) !== pm
      )
        throw unsupported();
    };
    for (const [node, from, to, sourceFrom, sourceTo] of [
      [left, leftFrom, markerFrom, leftSource, leftEnd],
      [right, rightFrom, rightTo, rightSource, rightEnd],
    ] as const) {
      if (
        !uint(sourceFrom) ||
        !uint(sourceTo) ||
        sourceFrom < start ||
        sourceTo > start + source.length ||
        sourceTo - sourceFrom !== node.nodeSize ||
        source.slice(sourceFrom - start, sourceTo - start) !== node.text
      )
        throw unsupported();
      for (let pm = from; pm <= to; pm++) {
        for (const affinity of [-1, 1]) {
          boundary(pm, sourceFrom + pm - from, affinity as -1 | 1);
        }
      }
    }
    for (const key of ['anchor', 'head'] as const) {
      const affinity = selection[key === 'anchor' ? 'anchorAffinity' : 'headAffinity'];
      if (!uint(selection[key]) || (affinity !== -1 && affinity !== 1)) throw unsupported();
      boundary(selected[key], selection[key], affinity);
    }
    if (batch && !verifyExactSourceMappings(projection, mappings, 32768)) throw unsupported();
  };
  shape();
  mapping();
  // The atom hides its literal's source width in native space. Admit the raw
  // complete parent and explicit marker attributes before creating any Slice,
  // selected text or serialization DOM, even when native content is small.
  captureNoteMarker(view, {
    projection,
    identity: input.identity,
    position: markerFrom,
    current,
    now: originalNow,
  });
  pinned();
  shape();
  mapping();
  // Expected plain text comes independently from the ACTUAL selected native
  // slice, never from deleting substrings in the original source.
  const nativeText = doc.textBetween(selected.from, selected.to, '');
  const markdown = serializeSelectionToMarkdown(view, identity.scope.workspaceId);
  if (markdown !== (nativeText.trim() || null) || (markdown?.length ?? 0) > 4096)
    throw unsupported();
  pinned();
  // This helper executes the final owner/clock callbacks and then revalidates
  // full-parent raw tokens and marker boundaries. Do not call owner/clock again
  // after the renewed selection/leaf proof below.
  const marker = captureNoteMarker(view, {
    projection,
    identity: input.identity,
    position: markerFrom,
    current,
    now: originalNow,
  });
  pinned();
  shape();
  mapping();
  pinned();
  if (
    marker.attributes.type !== 'point' ||
    marker.sourceRange.start !== leftEnd ||
    marker.sourceRange.end !== rightSource ||
    marker.parent.sourceRange.start !== leftSource ||
    marker.parent.sourceRange.end !== rightEnd
  )
    throw unsupported();
  const leaf = (from: number, to: number, sourceFrom: number, sourceTo: number) =>
    Object.freeze({
      version: 1 as const,
      nodeType: 'text' as const,
      nativeRange: Object.freeze({ from, to }),
      sourceRange: Object.freeze({ start: sourceFrom, end: sourceTo }),
      attributes: Object.freeze({}),
    });
  return Object.freeze({
    identity: marker.identity,
    marker,
    paragraph: marker.parent,
    left: leaf(leftFrom, markerFrom, leftSource, leftEnd),
    right: leaf(rightFrom, rightTo, rightSource, rightEnd),
    selection,
    sourceRange: Object.freeze({
      start: Math.min(selection.anchor, selection.head),
      end: Math.max(selection.anchor, selection.head),
    }),
    direction: selected.anchor > selected.head ? ('backward' as const) : ('forward' as const),
    markdown,
  });
}
declare const brand: unique symbol;
export type NoteMarkerSelectionCapture = ReturnType<typeof capture> & { readonly [brand]: true };
const captures = new WeakSet<object>();
export const isNoteMarkerSelectionCapture = (value: object): value is NoteMarkerSelectionCapture =>
  captures.has(value);
export function captureNoteMarkerSelection(
  view: EditorView,
  input: NoteMarkerSelectionInput,
): NoteMarkerSelectionCapture {
  const result = capture(view, input);
  captures.add(result);
  return result as NoteMarkerSelectionCapture;
}
