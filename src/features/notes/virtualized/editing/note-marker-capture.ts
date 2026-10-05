import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { sameNoteScope } from '$lib/client/note-pages';
import type { SourceProjection } from '../projection/source-projection';
import type { NoteSelectionMarkdownIdentity } from './note-selection-markdown-capture';

export class UnsupportedNoteMarkerCapture extends Error {}
export interface NoteMarkerCaptureInput {
  /** The actual mounted projection, borrowed with its original source owner.
   * This interface does not turn a caller-created projection into authority. */
  readonly projection: SourceProjection;
  readonly identity: NoteSelectionMarkdownIdentity;
  /** Position BEFORE one actual atom; commentAnchor is not node-selectable. */
  readonly position: number;
  /** Admit DATA before entry. Bind the original projection/doc/window/header,
   * generations and expiry, and permanently observe loss across later awaits.
   * Original complete-parent coverage belongs to this owner: raw tokens alone
   * cannot distinguish a clipped source window from a complete native parent. */
  readonly current: () => boolean;
  readonly now?: () => number;
}
export const noteMarkerCaptureLimits = Object.freeze({
  windowUnits: 32768,
  parentUnits: 4096,
  sourceBytes: 16384,
  tokens: 32768,
});
const uint = (value: number) => Number.isSafeInteger(value) && value >= 0;
// i18n-ignore (internal typed refusal diagnostic; not displayed as UI text)
const unsupported = () => new UnsupportedNoteMarkerCapture('Unsupported native marker context');
const scalarText = (value: string) => {
  for (const scalar of value)
    if (scalar.length === 1 && scalar.charCodeAt(0) >= 0xd800 && scalar.charCodeAt(0) <= 0xdfff)
      return false;
  return true;
};
// Trusted configured/admitted native graphs only. Reflection here is not a
// bounded allocator for arbitrary objects/proxies supplied by an untrusted peer.
function fields(value: object, keys: readonly string[]) {
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) throw unsupported();
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.length ||
    own.some((key) => typeof key !== 'string' || !keys.includes(key))
  )
    throw unsupported();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) throw unsupported();
  }
}
function emptyAttributes(node: PMNode) {
  fields(node.attrs, []);
  const attrs = Object.getOwnPropertyDescriptor(node.type.spec, 'attrs');
  if (attrs) {
    if (!('value' in attrs) || !attrs.value || typeof attrs.value !== 'object') throw unsupported();
    fields(attrs.value, []);
  }
}
function markerAttributes(node: PMNode) {
  fields(node.attrs, ['id', 'type', 'commentId']);
  const { id, type, commentId } = node.attrs;
  if (
    typeof commentId !== 'string' ||
    !commentId ||
    commentId.length > noteMarkerCaptureLimits.parentUnits ||
    !scalarText(commentId) ||
    commentId.includes('\0') ||
    !['start', 'end', 'point'].includes(type) ||
    id !== `${commentId}:${type}`
  )
    throw unsupported();
  return Object.freeze({ id: id as string, type: type as 'start' | 'end' | 'point', commentId });
}

/** Capture one occurrence from actual native state, with whole-parent token
 * correspondence. No renderer default, DOM filler, annotation body range or
 * current comment row is used. Server-retained original occurrence provenance
 * remains a separate obligation; this DTO cannot authorize repair or aliases. */
function capture(view: EditorView, input: NoteMarkerCaptureInput) {
  const state = view.state,
    doc = state.doc,
    schema = state.schema,
    projection = input.projection,
    source = projection.source,
    start = projection.start,
    tokens = projection.tokens,
    sourceAt = projection.sourceAt,
    pmAt = projection.pmAt,
    current = input.current,
    originalNow = input.now,
    now = originalNow ?? Date.now,
    position = input.position;
  if (
    typeof source !== 'string' ||
    source.length > noteMarkerCaptureLimits.windowUnits ||
    doc.content.size > noteMarkerCaptureLimits.windowUnits ||
    tokens.length > noteMarkerCaptureLimits.tokens ||
    !uint(start) ||
    !uint(start + source.length) ||
    !uint(position) ||
    position >= doc.content.size
  )
    throw unsupported();
  const identity = Object.freeze({
    ...input.identity,
    scope: Object.freeze({ ...input.identity.scope }),
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
  const expiry = Date.parse(identity.expiresAt);
  const pinned = (time: number) => {
    const live = input.identity;
    if (
      view.isDestroyed ||
      view.state !== state ||
      state.doc !== doc ||
      state.schema !== schema ||
      doc.type.schema !== schema ||
      input.projection !== projection ||
      projection.source !== source ||
      projection.start !== start ||
      projection.tokens !== tokens ||
      projection.sourceAt !== sourceAt ||
      projection.pmAt !== pmAt ||
      input.position !== position ||
      input.current !== current ||
      input.now !== originalNow ||
      !sameNoteScope(live.scope, identity.scope) ||
      live.sourceRevision !== identity.sourceRevision ||
      live.snapshotId !== identity.snapshotId ||
      live.documentGeneration !== identity.documentGeneration ||
      live.liveGeneration !== identity.liveGeneration ||
      live.selectionGeneration !== identity.selectionGeneration ||
      live.expiresAt !== identity.expiresAt ||
      !Number.isFinite(time) ||
      !Number.isFinite(expiry) ||
      time >= expiry
    )
      throw new Error('Stale native marker capture');
  };
  if (!current()) throw new Error('Stale native marker capture');
  pinned(now());
  const resolved = doc.resolve(position),
    parent = resolved.parent,
    parentStart = resolved.start(),
    parentEnd = resolved.end();
  if (
    resolved.depth !== 1 ||
    parent.type !== schema.nodes.paragraph ||
    parent.marks.length ||
    parent.content.size > noteMarkerCaptureLimits.parentUnits
  )
    throw unsupported();
  const marker = doc.nodeAt(position);
  if (
    !marker ||
    marker.type !== schema.nodes.commentAnchor ||
    marker.nodeSize !== 1 ||
    !marker.isAtom ||
    !marker.isInline ||
    marker.marks.length
  )
    throw unsupported();
  const attributes = markerAttributes(marker);
  const literal = `<!--anchor:${attributes.commentId}:${attributes.type}-->`;
  let markerStart = -1,
    markerEnd = -1,
    parentSourceStart = -1,
    parentSourceEnd = -1;
  const verify = () => {
    if (
      tokens.length > noteMarkerCaptureLimits.tokens ||
      doc.resolve(position).parent !== parent ||
      doc.nodeAt(position) !== marker ||
      parent.type !== schema.nodes.paragraph ||
      parent.marks.length ||
      parent.content.size !== parentEnd - parentStart ||
      parent.content.size > noteMarkerCaptureLimits.parentUnits
    )
      throw unsupported();
    emptyAttributes(parent);
    const indexed = new Map<number, (typeof tokens)[number]>();
    for (const token of tokens) {
      if (token.pm < parentStart || token.pm >= parentEnd) continue;
      if (indexed.has(token.pm)) throw unsupported();
      indexed.set(token.pm, token);
    }
    let nextSource = -1,
      firstSource = -1,
      consumed = 0,
      selectedStart = -1,
      selectedEnd = -1;
    const take = (pm: number, text: string, raw: string, width: number) => {
      const token = indexed.get(pm);
      if (
        !token ||
        token.marks.length ||
        token.text !== text ||
        token.raw !== raw ||
        !uint(token.from) ||
        !uint(token.to) ||
        token.to - token.from !== raw.length ||
        token.from < start ||
        token.to > start + source.length ||
        (nextSource !== -1 && token.from !== nextSource) ||
        source.slice(token.from - start, token.to - start) !== raw
      )
        throw unsupported();
      if (firstSource === -1) firstSource = token.from;
      nextSource = token.to;
      consumed++;
      if (pm === position && width === 1) {
        selectedStart = token.from;
        selectedEnd = token.to;
      }
      return token;
    };
    const boundary = (pm: number, sourcePosition: number, affinity: -1 | 1) => {
      if (
        projection.sourceAt(pm, affinity) !== sourcePosition ||
        projection.pmAt(sourcePosition, affinity) !== pm
      )
        throw unsupported();
    };
    parent.forEach((node, offset) => {
      const pm = parentStart + offset;
      if (node.marks.length) throw unsupported();
      if (
        node.type === schema.nodes.commentAnchor &&
        node.isInline &&
        node.isAtom &&
        node.nodeSize === 1
      ) {
        const attrs = markerAttributes(node);
        const raw = `<!--anchor:${attrs.commentId}:${attrs.type}-->`;
        const token = take(pm, '\ufffc', raw, 1);
        boundary(pm, token.from, 1);
        boundary(pm + 1, token.to, -1);
      } else if (
        node.type === schema.nodes.text &&
        node.isText &&
        node.text &&
        scalarText(node.text)
      ) {
        emptyAttributes(node);
        let offset = 0;
        for (const scalar of node.text) {
          const first = take(pm + offset, scalar[0], scalar[0], 1);
          let end = first.to;
          if (scalar.length === 2) end = take(pm + offset + 1, scalar[1], scalar[1], 1).to;
          boundary(pm + offset, first.from, 1);
          boundary(pm + offset + scalar.length, end, -1);
          offset += scalar.length;
        }
      } else throw unsupported();
    });
    if (
      consumed !== indexed.size ||
      firstSource < 0 ||
      selectedStart < 0 ||
      nextSource - firstSource > noteMarkerCaptureLimits.parentUnits ||
      new TextEncoder().encode(source.slice(firstSource - start, nextSource - start)).length >
        noteMarkerCaptureLimits.sourceBytes
    )
      throw unsupported();
    const actual = markerAttributes(marker);
    if (
      actual.id !== attributes.id ||
      actual.type !== attributes.type ||
      actual.commentId !== attributes.commentId ||
      source.slice(selectedStart - start, selectedEnd - start) !== literal
    )
      throw unsupported();
    if (
      markerStart !== -1 &&
      (markerStart !== selectedStart ||
        markerEnd !== selectedEnd ||
        parentSourceStart !== firstSource ||
        parentSourceEnd !== nextSource)
    )
      throw unsupported();
    markerStart = selectedStart;
    markerEnd = selectedEnd;
    parentSourceStart = firstSource;
    parentSourceEnd = nextSource;
  };
  verify();
  if (!current()) throw new Error('Stale native marker capture');
  const finalTime = now();
  pinned(finalTime);
  verify();
  pinned(finalTime);
  return Object.freeze({
    provenance: 'native-correspondence-only' as const,
    identity,
    canonicalId: attributes.commentId,
    literal,
    attributes,
    role: 'marker-occurrence' as const,
    version: 1 as const,
    nodeType: 'commentAnchor' as const,
    sourceRange: Object.freeze({ start: markerStart, end: markerEnd }),
    nativeRange: Object.freeze({ from: position, to: position + 1 }),
    parent: Object.freeze({
      version: 1 as const,
      nodeType: 'paragraph' as const,
      sourceRange: Object.freeze({ start: parentSourceStart, end: parentSourceEnd }),
      nativeRange: Object.freeze({ from: parentStart - 1, to: parentEnd + 1 }),
      attributes: Object.freeze({}),
    }),
  });
}
declare const brand: unique symbol;
export type NoteMarkerCapture = ReturnType<typeof capture> & { readonly [brand]: true };
const captures = new WeakSet<object>();
export const isNoteMarkerCapture = (value: object): value is NoteMarkerCapture =>
  captures.has(value);
export function captureNoteMarker(
  view: EditorView,
  input: NoteMarkerCaptureInput,
): NoteMarkerCapture {
  const result = capture(view, input);
  captures.add(result);
  return result as NoteMarkerCapture;
}
