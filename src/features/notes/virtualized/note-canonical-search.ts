import type { NoteWindow } from './note-window-reader';
export interface CanonicalNoteHit {
  sourceRange: { start: number; end: number };
  renderedRange: { start: number; end: number };
}
/** Search each canonical text node independently, as the rich editor searches
 * DOM text nodes. A bounded tail permits matches across page cuts in the same
 * node; formatting/node boundaries are not concatenated. Dynamic node-view
 * labels are deliberately outside this canonical text domain. */
export function createCanonicalNoteMatcher(query: string) {
  if (!query.trim() || query.length > 1024) throw new Error('Invalid note search query');
  const needle = query.toLowerCase();
  let nodeId: string | null = null,
    frontier = 0,
    tail = '',
    starts: number[] = [],
    ends: number[] = [];
  let seen = new Map<string, number>();
  return (window: NoteWindow, limit = 1000): CanonicalNoteHit[] => {
    if (!window.native) throw new Error('Canonical note search requires native text maps');
    const hits: CanonicalNoteHit[] = [];
    const nextSeen = new Map<string, number>();
    const maps = window.context
      .filter((m) => m.kind === 'sourceMap' && m.mapping !== 'omitted')
      .sort((a, b) => a.sourceRange.start - b.sourceRange.start);
    for (const map of maps) {
      if (map.kind !== 'sourceMap' || !map.textNodeId || !map.textRef) continue;
      const text = window.native.texts[map.textRef];
      if (
        typeof text !== 'string' ||
        text.length !== map.renderedRange.end - map.renderedRange.start
      )
        throw new Error('Incomplete canonical note search text');
      nextSeen.set(map.textNodeId, Math.max(seen.get(map.textNodeId) ?? 0, map.renderedRange.end));
      if (map.renderedRange.end <= (seen.get(map.textNodeId) ?? -1)) continue;
      if (nodeId !== map.textNodeId) {
        nodeId = map.textNodeId;
        frontier = seen.get(map.textNodeId) ?? map.renderedRange.start;
        tail = '';
        starts = [];
        ends = [];
      }
      if (map.renderedRange.end <= frontier) continue;
      if (map.renderedRange.start > frontier) {
        tail = '';
        starts = [];
        ends = [];
      }
      const skip = Math.max(0, frontier - map.renderedRange.start),
        fresh = text.slice(skip),
        oldLength = tail.length;
      const value = tail + fresh;
      const from = [...starts],
        to = [...ends];
      for (let i = skip; i < text.length; i++) {
        from.push(map.mapping === 'identity' ? map.sourceRange.start + i : map.sourceRange.start);
        to.push(map.mapping === 'identity' ? map.sourceRange.start + i + 1 : map.sourceRange.end);
      }
      const lower = value.toLowerCase();
      for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + 1)) {
        const end = at + query.length;
        // Match the rich editor's original UTF16 range behavior for case folds.
        if (end > oldLength && end <= value.length)
          hits.push({
            sourceRange: { start: from[at], end: to[end - 1] },
            renderedRange: {
              start: map.renderedRange.start + skip - oldLength + at,
              end: map.renderedRange.start + skip - oldLength + end,
            },
          });
        if (hits.length >= limit) return hits;
      }
      const keep = Math.min(2 * query.length, value.length);
      tail = value.slice(-keep);
      starts = from.slice(-keep);
      ends = to.slice(-keep);
      frontier = map.renderedRange.end;
    }
    seen = nextSeen;
    return hits;
  };
}
