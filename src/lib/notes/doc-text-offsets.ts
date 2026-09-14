/**
 * Plain-text projection of a ProseMirror document with a bidirectional map
 * between UTF-16 offsets in that text and document positions.
 *
 * The projection is the document's text nodes in order, textblocks separated
 * by one `\n`, and each inline leaf (image, mention, …) rendered as one object
 * replacement character. Diffing this text against the note's markdown aligns
 * their shared characters, so a caret in the daemon text maps onto the
 * rendered document through `mapOffsetThroughDiff` and this table, and back.
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

const INLINE_LEAF_PLACEHOLDER = '\ufffc';

/** A run of `length` text characters starting at text offset `offset` and doc position `pos`. */
interface Segment {
  offset: number;
  pos: number;
  length: number;
}

export interface DocTextOffsets {
  /** The plain-text projection. */
  readonly text: string;
  /** Document position for a text offset; separators resolve to the preceding block's end. */
  posOfOffset(offset: number): number;
  /** Text offset for a document position; positions between blocks resolve to the separator. */
  offsetOfPos(pos: number): number;
}

export function docTextOffsets(doc: ProseMirrorNode): DocTextOffsets {
  const segments: Segment[] = [];
  const parts: string[] = [];
  let offset = 0;
  let sawTextblock = false;

  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (sawTextblock) {
        parts.push('\n');
        offset += 1;
      }
      sawTextblock = true;
      // An empty block contributes no characters but is still a caret
      // target: anchor its content position so a caret on that line does not
      // resolve into the preceding block.
      if (node.content.size === 0) segments.push({ offset, pos: pos + 1, length: 0 });
      return true;
    }
    if (node.isText) {
      const text = node.text ?? '';
      segments.push({ offset, pos, length: text.length });
      parts.push(text);
      offset += text.length;
      return false;
    }
    if (node.isInline && node.isLeaf) {
      segments.push({ offset, pos, length: 1 });
      parts.push(INLINE_LEAF_PLACEHOLDER);
      offset += 1;
      return false;
    }
    return true;
  });

  const text = parts.join('');
  const docEnd = doc.content.size;

  const posOfOffset = (target: number): number => {
    const clamped = Math.max(0, Math.min(target, text.length));
    if (segments.length === 0) return Math.min(1, docEnd);
    let lo = 0;
    let hi = segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segments[mid].offset <= clamped) lo = mid;
      else hi = mid - 1;
    }
    const seg = segments[lo];
    if (clamped < seg.offset) return seg.pos;
    return seg.pos + Math.min(clamped - seg.offset, seg.length);
  };

  const offsetOfPos = (target: number): number => {
    const clamped = Math.max(0, Math.min(target, docEnd));
    if (segments.length === 0) return 0;
    let lo = 0;
    let hi = segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segments[mid].pos <= clamped) lo = mid;
      else hi = mid - 1;
    }
    const seg = segments[lo];
    if (clamped < seg.pos) return seg.offset;
    return seg.offset + Math.min(clamped - seg.pos, seg.length);
  };

  return { text, posOfOffset, offsetOfPos };
}
