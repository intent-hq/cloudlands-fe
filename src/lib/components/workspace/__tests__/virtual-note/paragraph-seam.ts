import type { Splice } from './source-journal';
/** Session-only suppression of one boundary newline introduced by native table deletion.
 * Source remains byte-exact; a fresh session has no record and parses canonically. */
export type ParagraphSeam = { from: number; to: number; kind?: 'leading' | 'terminal' | 'split' };
export const validParagraphSeam = (seam: ParagraphSeam, length: number, raw: string) =>
  Number.isSafeInteger(seam.from) &&
  seam.from >= 0 &&
  seam.to <= length &&
  seam.to - seam.from === raw.length &&
  /^(?:\r?\n)$/.test(raw);
export const touchesParagraphSeam = (seam: ParagraphSeam, splice: Splice) =>
  splice.from < seam.to &&
  splice.to >= seam.from &&
  (splice.to > splice.from || splice.insert.length > 0);
export function mapParagraphSeam(seam: ParagraphSeam, splice: Splice): ParagraphSeam {
  const delta = splice.insert.length - (splice.to - splice.from);
  return splice.to <= seam.from ? { ...seam, from: seam.from + delta, to: seam.to + delta } : seam;
}
