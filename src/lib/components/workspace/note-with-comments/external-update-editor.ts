import { TextSelection } from '@tiptap/pm/state';

import { mapOffsetThroughDiff } from '$lib/notes/text-rebase';

import type { LoggerLike } from './logger.types';

export type ExternalUpdateDocLike = {
  content: { size: number };
  resolve: (pos: number) => { pos: number; parent: { inlineContent: boolean } };
  textBetween: (from: number, to: number, blockSeparator?: string, leafText?: string) => string;
};

export type ExternalUpdateEditorLike = {
  getHTML: () => string;
  state: {
    doc?: ExternalUpdateDocLike;
    selection?: { anchor?: number; head?: number };
  };
  chain: () => {
    command: (fn: any) => any;
    setContent: (html: string) => any;
    run: () => void;
  };
};

export type CreateTextSelectionLike = (doc: any, anchor: number, head?: number) => any;

/**
 * `TextSelection.create` bound to its class. prosemirror-state's `create` uses
 * `new this(...)`, so passing the static method around unbound throws
 * "this is not a constructor" inside the apply and the caret falls to the end
 * of the document.
 */
export const createTextSelectionForDoc: CreateTextSelectionLike = (doc, anchor, head) =>
  TextSelection.create(doc, anchor, head);

const BLOCK_SEPARATOR = '\n';
// Placeholder for non-text leaf nodes (hard breaks, images, anchors). Without
// it `textBetween` omits them, so the positions before and after a `<br>`
// share an offset and the inverse mapping lands before the break.
const LEAF_TEXT = '\uFFFC';

/**
 * The document's plain text, one `\n` between textblocks and one placeholder
 * per leaf node (`doc.textBetween`).
 */
function docPlainText(doc: ExternalUpdateDocLike): string {
  return doc.textBetween(0, doc.content.size, BLOCK_SEPARATOR, LEAF_TEXT);
}

/** UTF-16 offset into `docPlainText(doc)` of the document position `pos`. */
export function textOffsetOfDocPos(doc: ExternalUpdateDocLike, pos: number): number {
  const clamped = Math.max(0, Math.min(pos, doc.content.size));
  return doc.textBetween(0, clamped, BLOCK_SEPARATOR, LEAF_TEXT).length;
}

/**
 * Inverse of `textOffsetOfDocPos`: the first document position whose prefix
 * text reaches `offset`, advanced past container-block boundaries onto the
 * first inline position at that same offset so the result can host a text
 * selection.
 */
export function docPosOfTextOffset(doc: ExternalUpdateDocLike, offset: number): number {
  const size = doc.content.size;
  let lo = 0;
  let hi = size;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (textOffsetOfDocPos(doc, mid) >= offset) hi = mid;
    else lo = mid + 1;
  }
  let pos = lo;
  while (
    pos < size &&
    !doc.resolve(pos).parent.inlineContent &&
    textOffsetOfDocPos(doc, pos + 1) === textOffsetOfDocPos(doc, pos)
  ) {
    pos += 1;
  }
  return pos;
}

/**
 * Map a selection from `oldDoc` into `newDoc` through the character diff of
 * their plain texts: positions before a change stay put, positions inside a
 * replaced/deleted span clamp to the span's end in `newDoc`, positions after
 * shift by the net length delta.
 */
export function mapDocSelectionThroughDiff({
  oldDoc,
  newDoc,
  anchor,
  head,
}: {
  oldDoc: ExternalUpdateDocLike;
  newDoc: ExternalUpdateDocLike;
  anchor: number;
  head: number;
}): { anchor: number; head: number } {
  const oursText = docPlainText(oldDoc);
  const mergedText = docPlainText(newDoc);
  const map = (pos: number) =>
    docPosOfTextOffset(
      newDoc,
      mapOffsetThroughDiff(oursText, mergedText, textOffsetOfDocPos(oldDoc, pos)),
    );
  const mappedAnchor = map(anchor);
  return { anchor: mappedAnchor, head: head === anchor ? mappedAnchor : map(head) };
}

export function applyExternalUpdateHtmlToEditorPreservingCursor({
  editor,
  html,
  cursorPos,
  mapSelectionThroughDiff = false,
  createTextSelection = createTextSelectionForDoc,
  logger,
}: {
  editor: ExternalUpdateEditorLike;
  html: string;
  cursorPos?: number | null;
  /**
   * Restore the selection by mapping it through the old→new plain-text diff
   * instead of clamping the numeric position. Ignored when `cursorPos` is
   * given or the editor exposes no document.
   */
  mapSelectionThroughDiff?: boolean;
  /** Test seam; production uses the bound `createTextSelectionForDoc`. */
  createTextSelection?: CreateTextSelectionLike;
  logger: LoggerLike;
}): boolean {
  const currentHtmlSnapshot = editor.getHTML();
  if (currentHtmlSnapshot === html) return false;

  const selection = editor.state.selection;
  const resolvedCursorPos =
    typeof cursorPos === 'number'
      ? cursorPos
      : typeof selection?.anchor === 'number'
        ? (selection.anchor as number)
        : null;

  const oldDoc = editor.state.doc;
  const diffSelection =
    mapSelectionThroughDiff &&
    typeof cursorPos !== 'number' &&
    oldDoc &&
    typeof selection?.anchor === 'number'
      ? {
          oldDoc,
          anchor: selection.anchor,
          head: typeof selection.head === 'number' ? selection.head : selection.anchor,
        }
      : null;

  editor
    .chain()
    .command((ctx: any) => {
      ctx.tr.setMeta('external-update', true);
      return true;
    })
    .setContent(html)
    .command((ctx: any) => {
      if (diffSelection) {
        try {
          const newDoc = ctx.state.doc as ExternalUpdateDocLike;
          const mapped = mapDocSelectionThroughDiff({ ...diffSelection, newDoc });
          ctx.tr.setSelection(createTextSelection(newDoc, mapped.anchor, mapped.head));
        } catch (e) {
          logger.debug('[NoteWithComments] Could not restore cursor position', e);
        }
      } else if (resolvedCursorPos !== null) {
        try {
          const maxPos = ctx.state.doc.content.size;
          const newPos = Math.min(resolvedCursorPos, maxPos);
          const resolvedPos = ctx.state.doc.resolve(newPos);
          ctx.tr.setSelection(createTextSelection(ctx.state.doc, resolvedPos.pos, resolvedPos.pos));
        } catch (e) {
          // Keep message stable: this same log line existed in NoteWithComments.svelte.
          logger.debug('[NoteWithComments] Could not restore cursor position', e);
        }
      }
      return true;
    })
    .run();

  return true;
}
