import type { JSONContent } from '@tiptap/core';
/** Source-coordinate identities shared by disposable bounded native views.
 * Storage, document history and operation ownership live outside the projection. */
export const LIMITS = {
  request: 4096,
  active: 16384,
  cachePages: 4,
  nodes: 256,
  journalPage: 4096,
  journalResident: 16384,
  log: 32,
  receipts: 32,
};
const encoder = new TextEncoder();
export const bytes = (text: string) =>
  text.length === 0 || (text.length === 1 && text.charCodeAt(0) < 128)
    ? text.length
    : encoder.encode(text).length;
export type Splice = { from: number; to: number; insert: string };
export const mapPoint = (p: number, s: Splice, affinity = 1) =>
  p < s.from || (p === s.from && affinity < 0)
    ? p
    : p > s.to || (p === s.to && affinity > 0)
      ? p + s.insert.length - (s.to - s.from)
      : s.from + (affinity < 0 ? 0 : s.insert.length);
export type TableGeometry = {
  revision: number;
  table: number;
  width: number;
  font: string;
  row: number;
  rows: number;
  top: number;
  total: number;
  heights: number[];
};
export type TablePoint = { cell: number; block: number; offset: number; path?: number[] };
export type Selection = {
  anchor: number;
  head: number;
  affinity: -1 | 1;
  revision: number;
  node?: { from: number; type: string };
  table?: { anchor: TablePoint; head: TablePoint; kind: 'text' | 'cell' };
};
export type TableCodeEdit = {
  from: number;
  to: number;
  insert: string;
  code: { from: number; to: number };
};
export type TableInlineWrite = {
  revision: number;
  cell: number;
  body: number;
  end: number;
  nodeType: string;
  attrs: JSONContent['attrs'];
  block: number;
  path?: number[];
  from: number;
  to: number;
  content: JSONContent[];
};

export type TableParagraphWrite = Omit<TableInlineWrite, 'content'> & {
  lastBlock: number;
  paragraphs: JSONContent[];
};
