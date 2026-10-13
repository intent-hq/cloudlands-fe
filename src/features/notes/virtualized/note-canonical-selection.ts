import type { NoteWindow } from './note-window-reader';
import type { SourceRange } from '$lib/client/note-pages';
/** Emit only canonical rendered text intersecting a source selection. Adjacent
 * text leaves in a block remain adjacent; distinct text blocks get a newline. */
export function createCanonicalSelection(range: SourceRange) {
  let seen = new Map<string, number>(),
    lastBlock: string | undefined,
    emitted = false;
  return (window: NoteWindow): string => {
    if (!window.native) throw new Error('Canonical selection requires text maps');
    const native = window.native;
    const nodes = window.context.filter((n) => n.kind === 'nativeNode');
    const byId = new Map(nodes.map((n) => [n.id, n]));
    function block(id: string): string {
      const visited = new Set<string>();
      let node = byId.get(id);
      while (node) {
        if (visited.has(node.id)) throw new Error('Cyclic canonical selection ancestry');
        visited.add(node.id);
        if (['paragraph', 'heading', 'codeBlock'].includes(node.nodeType)) return node.id;
        const parent = node.parentRef ? native.references[node.parentRef]?.[0] : undefined;
        node = parent ? byId.get(parent) : undefined;
      }
      return id;
    }
    const pieces: Array<{
      id: string;
      block: string;
      from: number;
      to: number;
      text: string;
      start: number;
      end: number;
      identity: boolean;
    }> = [];
    for (const item of window.context) {
      if (
        item.kind === 'sourceMap' &&
        item.mapping !== 'omitted' &&
        item.textNodeId &&
        item.textRef
      ) {
        const text = native.texts[item.textRef];
        if (
          typeof text !== 'string' ||
          text.length !== item.renderedRange.end - item.renderedRange.start
        )
          throw new Error('Incomplete canonical selected text');
        pieces.push({
          id: item.textNodeId,
          block: block(item.textNodeId),
          from: item.sourceRange.start,
          to: item.sourceRange.end,
          text,
          start: item.renderedRange.start,
          end: item.renderedRange.end,
          identity: item.mapping === 'identity',
        });
      } else if (item.kind === 'nativeNode' && item.nodeType === 'hardBreak') {
        pieces.push({
          id: item.id,
          block: block(item.id),
          from: item.sourceRange.start,
          to: item.sourceRange.end,
          text: '\n',
          start: 0,
          end: 1,
          identity: false,
        });
      }
    }
    pieces.sort((a, b) => a.from - b.from || a.start - b.start);
    const nextSeen = new Map<string, number>();
    let output = '';
    for (const piece of pieces) {
      const frontier = Math.max(seen.get(piece.id) ?? 0, nextSeen.get(piece.id) ?? 0);
      nextSeen.set(piece.id, Math.max(frontier, piece.end));
      if (piece.end <= frontier || piece.to <= range.start || piece.from >= range.end) continue;
      let start = Math.max(0, frontier - piece.start),
        end = piece.text.length;
      if (piece.identity) {
        start = Math.max(start, range.start - piece.from);
        end = Math.min(end, range.end - piece.from);
      }
      if (start >= end) continue;
      if (output.length + end - start + 1 > 8320)
        throw new Error('Canonical selected text exceeds the command window budget');
      if (emitted && lastBlock !== piece.block) output += '\n';
      output += piece.text.slice(start, end);
      lastBlock = piece.block;
      emitted = true;
    }
    seen = nextSeen;
    return output;
  };
}
