/** Current-document coordinates for one exact prepared native candidate.
 * Page reads still address the saved revision; toBase is navigation only and
 * never grants an edit or source slice inside inserted/replaced text. */
export interface NoteViewCoordinates {
  readonly start: number;
  readonly end: number;
  readonly length: number;
  toBase(position: number, affinity?: -1 | 1): number;
}
