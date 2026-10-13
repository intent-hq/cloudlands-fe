import { mapPoint, type Splice } from './source-types';
/** Test-only live topology; text stays in the paged canonical source, never this record. */
export type ListCode = {
  item: number;
  from: number;
  bodyFrom: number;
  bodyTo: number;
  to: number;
  language: string | null;
};
export const touchesListCode = (code: ListCode, splice: Splice) =>
  (splice.from < code.to && splice.to > code.from) ||
  (splice.from === splice.to && splice.from > code.from && splice.from < code.to);
export const mapListCode = (code: ListCode, splice: Splice): ListCode => ({
  ...code,
  item: mapPoint(code.item, splice, 1),
  from: mapPoint(code.from, splice, 1),
  bodyFrom: mapPoint(code.bodyFrom, splice, 1),
  bodyTo: mapPoint(code.bodyTo, splice, -1),
  to: mapPoint(code.to, splice, -1),
});
export const validListCode = (code: ListCode, length: number) =>
  [code.item, code.from, code.bodyFrom, code.bodyTo, code.to].every(Number.isSafeInteger) &&
  code.item >= 0 &&
  code.item <= code.from &&
  code.bodyFrom === code.from + 1 &&
  code.bodyTo >= code.bodyFrom &&
  code.to === code.bodyTo + 1 &&
  code.to <= length &&
  (code.language === null || typeof code.language === 'string');
