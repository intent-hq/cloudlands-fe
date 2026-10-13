import type { SourceProjection } from '../projection/source-projection';
import type { NoteViewCoordinates } from '../note-view-coordinates';
import type { NoteDocumentSession } from './note-document-edit-session';

/** Reuse the already admitted immutable dirty batch: no source reads, joins,
 * copied history or additional document-sized index. Work is bounded by the
 * document session splice limit. */
export function noteDocumentCoordinates(
  state: NoteDocumentSession,
  projection: SourceProjection,
): NoteViewCoordinates {
  const { dirty, length, baseLength } = state;
  const start = projection.start,
    end = start + projection.source.length;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end > length
  )
    throw new Error('Invalid current note window coordinates');
  return Object.freeze({
    start,
    end,
    length,
    toBase(position: number, affinity: -1 | 1 = 1) {
      if (!Number.isSafeInteger(position) || position < 0 || position > length)
        throw new Error('Invalid current note seek');
      let delta = 0;
      for (const splice of dirty) {
        const from = splice.start + delta,
          to = from + splice.text.length;
        if (position < from) break;
        if (position <= to) {
          if (from !== to && position === from) return splice.start;
          if (from !== to && position === to) return splice.end;
          return affinity < 0 ? splice.start : splice.end;
        }
        delta += splice.text.length - (splice.end - splice.start);
      }
      return Math.max(0, Math.min(baseLength, position - delta));
    },
  });
}
