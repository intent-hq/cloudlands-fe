import { mapPoint, type Splice } from './source-journal';
/** Session-only suppression of one boundary newline introduced by native table deletion.
 * Source remains byte-exact; a fresh session has no record and parses canonically. */
export type ParagraphSeam = {
  from: number;
  to: number;
  kind?: 'leading' | 'terminal' | 'split' | 'list-text' | 'space';
  item?: number;
};
export const validParagraphSeam = (seam: ParagraphSeam, length: number, raw: string) =>
  Number.isSafeInteger(seam.from) &&
  seam.from >= 0 &&
  seam.to <= length &&
  seam.to - seam.from === raw.length &&
  (seam.kind === 'space'
    ? /^[ \t]$/.test(raw)
    : seam.kind === 'list-text'
      ? Number.isSafeInteger(seam.item) &&
        seam.item! >= 0 &&
        seam.item! <= seam.from &&
        raw.includes('\n')
      : /^(?:\r?\n)$/.test(raw));
export const touchesParagraphSeam = (seam: ParagraphSeam, splice: Splice) =>
  splice.from < seam.to &&
  splice.to >= seam.from &&
  (splice.to > splice.from || splice.insert.length > 0);
export function mapParagraphSeam(seam: ParagraphSeam, splice: Splice): ParagraphSeam {
  if (seam.kind === 'list-text')
    return {
      ...seam,
      item: mapPoint(seam.item!, splice, 1),
      from: mapPoint(seam.from, splice, 1),
      to: mapPoint(seam.to, splice, -1),
    };
  const delta = splice.insert.length - (splice.to - splice.from);
  return splice.to <= seam.from ? { ...seam, from: seam.from + delta, to: seam.to + delta } : seam;
}
