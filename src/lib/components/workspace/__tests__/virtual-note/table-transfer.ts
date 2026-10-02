import { bytes } from './bounded-note-service';
import { unpackTableWindow } from './table-payload';
import type { TableWindow } from './table-source';

export const TABLE_ACTIVE_BYTES = 16384;
export const TABLE_NODE_LIMIT = 4096;
export type TablePage = { revision: number; index: number; count: number; payload: string };
/** Mock backing encoder. Only these independently bounded pages cross to the renderer. */
export function encodeTablePages(window: TableWindow): TablePage[] {
  const encoded = JSON.stringify(window);
  if (bytes(encoded) + window.cells.reduce((n, c) => n + bytes(c.raw), 0) > TABLE_ACTIVE_BYTES)
    throw new Error('Table viewport exceeds active budget');
  const pages: TablePage[] = [];
  let payload = '';
  for (const char of encoded) {
    const candidate = {
      revision: window.revision,
      index: pages.length,
      count: 4,
      payload: payload + char,
    };
    if (bytes(JSON.stringify(candidate)) > 4096) {
      pages.push({ ...candidate, payload });
      payload = char;
    } else payload += char;
  }
  if (payload) pages.push({ revision: window.revision, index: pages.length, count: 4, payload });
  if (pages.length > 4) throw new Error('Table transfer exceeds four pages');
  return pages.map((page) => ({ ...page, count: pages.length }));
}
export function decodeTablePages(pages: TablePage[], revision: number): TableWindow {
  if (!pages.length || pages.length > 4) throw new Error('Invalid table page count');
  for (const [index, page] of pages.entries()) {
    if (page.revision !== revision) throw new Error('Stale table transfer');
    if (page.index !== index || page.count !== pages.length || bytes(JSON.stringify(page)) > 4096)
      throw new Error('Invalid table page assembly');
  }
  const window = unpackTableWindow(JSON.parse(pages.map((p) => p.payload).join('')));
  if (window.revision !== revision) throw new Error('Stale table assembly');
  if (
    bytes(JSON.stringify(window)) + window.cells.reduce((n, c) => n + bytes(c.raw), 0) >
    TABLE_ACTIVE_BYTES
  )
    throw new Error('Table assembly exceeds active budget');
  return window;
}
