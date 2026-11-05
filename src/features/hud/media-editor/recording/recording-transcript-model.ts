/**
 * How the recording editor lays out its transcript (Capture and recording editor
 * spec, "Transcript and marks"): batches start at each Clear, marks sit inline at the
 * word spoken when they happened, and only genuinely timed words can be jumped to.
 */
import type {
  DockMediaBatch,
  DockMediaEditMark,
  DockMediaTranscript,
} from '$shared/dock-media-edit';

type Word = DockMediaTranscript['words'][number];

export type TranscriptPiece =
  { kind: 'word'; word: Word; timed: boolean } | { kind: 'mark'; mark: DockMediaEditMark };

export interface TranscriptBatch {
  id: string;
  /** 1-based, in recording order. */
  n: number;
  atMs: number;
  markCount: number;
  pieces: TranscriptPiece[];
}

/** The batch a time falls in: the last one starting at or before it (else the first). */
function batchIndexAt(batches: readonly DockMediaBatch[], ms: number): number {
  let index = 0;
  for (let i = 0; i < batches.length; i += 1) if (batches[i].atMs <= ms) index = i;
  return index;
}

/**
 * Batches with their words and inline marks. Timed words go to the batch their start
 * falls in; untimed text keeps its place after the last timed word before it. A mark
 * sits before the first word of its batch that starts at or after it, else at the
 * batch's end. Without batches, everything is one batch from 0.
 */
export function layoutTranscript(
  words: readonly Word[],
  batches: readonly DockMediaBatch[],
  marks: readonly DockMediaEditMark[],
): TranscriptBatch[] {
  const list: readonly DockMediaBatch[] = batches.length
    ? [...batches].sort((a, b) => a.atMs - b.atMs)
    : [{ id: 'all', atMs: 0, clearAtMs: null }];
  const out: TranscriptBatch[] = list.map((batch, index) => ({
    id: batch.id,
    n: index + 1,
    atMs: batch.atMs,
    markCount: 0,
    pieces: [],
  }));
  let current = 0;
  for (const word of words) {
    const timed = word.alignment !== 'untimed' && word.startMs !== null;
    if (timed) current = batchIndexAt(list, word.startMs!);
    out[current].pieces.push({ kind: 'word', word, timed });
  }
  for (const mark of [...marks].sort((a, b) => a.atMs - b.atMs)) {
    const batch = out[batchIndexAt(list, mark.atMs)];
    batch.markCount += 1;
    const at = batch.pieces.findIndex(
      (piece) =>
        piece.kind === 'word' &&
        piece.timed &&
        piece.word.startMs !== null &&
        piece.word.startMs >= mark.atMs,
    );
    const entry: TranscriptPiece = { kind: 'mark', mark };
    if (at < 0) batch.pieces.push(entry);
    else batch.pieces.splice(at, 0, entry);
  }
  return out;
}

/** The timed word under the playhead, if any. */
export function currentWordId(words: readonly Word[], ms: number): string | null {
  for (const word of words)
    if (
      word.alignment !== 'untimed' &&
      word.startMs !== null &&
      word.endMs !== null &&
      word.startMs <= ms &&
      ms < word.endMs
    )
      return word.id;
  return null;
}

const FILLER = new Set(['um', 'umm', 'uh', 'uhh', 'er', 'erm', 'ah', 'hmm', 'mm']);
/** A pause this long between words is offered as cut, keeping a little either side. */
const LONG_PAUSE_MS = 2000;
const PAUSE_MARGIN_MS = 300;

export interface FillerCuts {
  ranges: { startMs: number; endMs: number }[];
  fillerCount: number;
  pauseCount: number;
  totalMs: number;
}

/**
 * "Cut filler" (Capture and recording editor spec): timed filler words ("um", "uh")
 * and long silences between timed words, inside `kept` (what is not already trimmed
 * or cut). Only genuinely timed recognition units count; nothing is guessed.
 */
export function findFillerCuts(
  words: readonly Word[],
  kept: readonly { startMs: number; endMs: number }[],
): FillerCuts {
  const inside = (start: number, end: number) =>
    kept.some((range) => start >= range.startMs && end <= range.endMs);
  const timed = words.filter(
    (word): word is Word & { startMs: number; endMs: number } =>
      word.alignment !== 'untimed' && word.startMs !== null && word.endMs !== null,
  );
  const ranges: FillerCuts['ranges'] = [];
  let fillerCount = 0;
  let pauseCount = 0;
  for (const word of timed) {
    const bare = word.text.toLowerCase().replace(/[^\p{L}]/gu, '');
    if (FILLER.has(bare) && inside(word.startMs, word.endMs)) {
      ranges.push({ startMs: word.startMs, endMs: word.endMs });
      fillerCount += 1;
    }
  }
  for (let i = 1; i < timed.length; i += 1) {
    const start = timed[i - 1].endMs + PAUSE_MARGIN_MS;
    const end = timed[i].startMs - PAUSE_MARGIN_MS;
    if (
      timed[i].startMs - timed[i - 1].endMs >= LONG_PAUSE_MS &&
      end > start &&
      inside(start, end)
    ) {
      ranges.push({ startMs: start, endMs: end });
      pauseCount += 1;
    }
  }
  return {
    ranges,
    fillerCount,
    pauseCount,
    totalMs: ranges.reduce((sum, range) => sum + range.endMs - range.startMs, 0),
  };
}
