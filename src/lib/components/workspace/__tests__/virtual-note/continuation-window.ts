import type { SourceJournal } from './source-journal';

// Fixed UTF-16 work budget; even four-byte code points fit the 16KiB byte ceiling.
export const CONTINUATION = { units: 4096, margin: 512 };

/** Mock index returns scalar revision/source bounds, never all paragraph offsets. */
export function continuationWindow(service: SourceJournal, id: number, position?: number) {
  const start = service.start(id);
  const end = service.start(Math.min(id + 2, service.count));
  if (end - start <= CONTINUATION.units) return { from: start, to: end, continuation: false };
  const paragraphEnd = service.start(id + 1);
  let from = Math.max(start, Math.min(position ?? start, paragraphEnd) - CONTINUATION.units / 2);
  let to = Math.min(paragraphEnd, from + CONTINUATION.units);
  // The fake backing index inspects at most four source units, not the paragraph.
  if (from > start && service.splitsSurrogate(from)) from++;
  if (to < paragraphEnd && service.splitsSurrogate(to)) to--;
  return { from, to, continuation: true };
}
