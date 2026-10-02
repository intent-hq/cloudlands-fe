import type { Editor } from '@tiptap/core';
import type { TableWindow } from './table-source';

/** Test-only stable sizing: viewport / up to three columns, with a 160px floor. */
export function layoutTable(editor: Editor, window: TableWindow, viewport: number) {
  const width = Math.max(160, Math.floor(viewport / Math.min(3, window.columns)));
  const table = editor.view.dom.querySelector('table');
  if (!table) throw new Error('Native table DOM missing');
  const firstColumn = Math.min(...window.cells.map((c) => c.column));
  const columns = Math.max(...window.cells.map((c) => c.column + (c.span ?? 1))) - firstColumn;
  editor.view.dom.style.width = `${window.columns * width}px`;
  editor.view.dom.style.minHeight = `${window.rows * 64}px`;
  editor.view.dom.style.boxSizing = 'border-box';
  editor.view.dom.style.paddingTop = `${window.cells[0].row * 64}px`;
  table.style.marginLeft = `${firstColumn * width}px`;
  table.style.tableLayout = 'fixed';
  table.style.width = `${width * columns}px`;
  table.style.minWidth = '0';
  table.style.maxWidth = 'none';
  table.style.borderCollapse = 'collapse';
  for (const cell of table.querySelectorAll<HTMLElement>('th,td')) {
    cell.style.width = `${width * Number(cell.getAttribute('colspan') ?? 1)}px`;
    cell.style.minWidth = '0';
    cell.style.maxWidth = 'none';
    cell.style.whiteSpace = 'normal';
    cell.style.overflowWrap = 'anywhere';
    cell.style.boxSizing = 'border-box';
  }
  return { width, columns, cells: table.querySelectorAll('th,td').length };
}
