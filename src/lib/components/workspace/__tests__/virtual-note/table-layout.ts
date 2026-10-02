import type { Editor } from '@tiptap/core';
import type { TableWindow } from './table-source';

/** Test-only stable sizing: viewport / up to three columns, with a 160px floor. */
export function layoutTable(editor: Editor, window: TableWindow, viewport: number) {
  const width = Math.max(160, Math.floor(viewport / Math.min(3, window.columns)));
  const table = editor.view.dom.querySelector('table');
  if (!table) throw new Error('Native table DOM missing');
  const firstColumn = Math.min(...window.cells.map((c) => c.column));
  const columns = Math.max(...window.cells.map((c) => c.column + (c.span ?? 1))) - firstColumn;
  // Native TableView updates overwrite its inline table width after transactions.
  // Keep the test-only sizing policy on the stable editor root instead.
  editor.view.dom.classList.add('proof-table-projection');
  editor.view.dom.style.setProperty('--proof-table-width', `${width * columns}px`);
  editor.view.dom.style.setProperty('--proof-column-width', `${width}px`);
  editor.view.dom.style.width = `${window.columns * width}px`;
  editor.view.dom.style.minHeight = `${window.geometry?.total ?? window.rows * 41}px`;
  editor.view.dom.style.boxSizing = 'border-box';
  editor.view.dom.style.paddingTop = `${window.geometry?.top ?? window.cells[0].row * 41}px`;
  // The projection canvas owns scrolling and logical column offsets. Native
  // prose breakout centering changes by half a collapsed border after updates.
  // Keep its wrapper in the same coordinate system as the admitted cells.
  Object.assign(table.parentElement!.style, {
    position: 'static',
    left: 'auto',
    transform: 'none',
    width: '100%',
    minWidth: '0',
    maxWidth: 'none',
    overflow: 'visible',
  });
  table.style.marginLeft = `${firstColumn * width}px`;
  table.style.tableLayout = 'fixed';
  table.style.width = `${width * columns}px`;
  table.style.minWidth = '0';
  table.style.maxWidth = 'none';
  table.style.borderCollapse = 'collapse';
  for (const cell of table.querySelectorAll<HTMLElement>('th,td')) {
    cell.style.minWidth = '0';
    cell.style.maxWidth = 'none';
    cell.style.whiteSpace = 'normal';
    cell.style.overflowWrap = 'anywhere';
    cell.style.boxSizing = 'border-box';
  }
  const rows = table.querySelectorAll<HTMLElement>('tr');
  rows.forEach((row, i) => {
    row.style.height = window.geometry ? `${window.geometry.heights[i]}px` : '';
  });
  return { width, columns, cells: table.querySelectorAll('th,td').length };
}
