import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';

const require = createRequire(import.meta.url);
const adapter = require.resolve('@tiptap/pm/tables');
const cjs = require.resolve('prosemirror-tables', { paths: [dirname(adapter)] });
const esm = join(dirname(cjs), 'index.js');
// Exercise the actual locked dependency in both forms consumed by Tiptap/Electron.
for (const format of ['esm', 'cjs']) {
  const load = (name) => (format === 'esm' ? import(name) : require(name));
  const { Schema, Fragment } = await load('@tiptap/pm/model');
  const { EditorState } = await load('@tiptap/pm/state');
  const { history, undo, redo } = await load('@tiptap/pm/history');
  const { tableNodes, TableMap, CellSelection, __insertCells, __clipCells } =
    format === 'esm' ? await import(pathToFileURL(esm).href) : require(cjs);
  const schema = new Schema({
    nodes: {
      doc: { content: 'table' },
      paragraph: { content: 'text*' },
      text: {},
      ...tableNodes({ cellContent: 'paragraph+' }),
    },
  });
  const paragraph = (text) => schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
  const cell = (text, attrs) => schema.nodes.table_cell.create(attrs, paragraph(text));
  for (const [width, height] of [
    [1, 1],
    [1, 2],
    [2, 1],
    [2, 2],
  ]) {
    for (const [left, right] of [
      [0, 2],
      [2, 4],
      [0, 4],
    ]) {
      for (const backward of [false, true]) {
        test(`${format} ${width}x${height} corners ${left}:${right} ${backward}`, () => {
          const rows = Array.from({ length: 6 }, (_, r) =>
            schema.nodes.table_row.create(
              null,
              Array.from({ length: 4 }, (_, c) => cell(`${r}/${c}`)),
            ),
          );
          const doc = schema.nodes.doc.create(null, schema.nodes.table.create(null, rows));
          const map = TableMap.get(doc.firstChild);
          const a = 1 + map.map[4 + left],
            h = 1 + map.map[4 * 4 + right - 1];
          let state = EditorState.create({
            doc,
            plugins: [history()],
            selection: CellSelection.create(doc, backward ? h : a, backward ? a : h),
          });
          const beforeSelection = state.selection.toJSON();
          const replacement = cell('pasted', { colspan: width, rowspan: height });
          const clipped = __clipCells(
            {
              width,
              height,
              rows: Array.from({ length: height }, (_, r) =>
                r ? Fragment.empty : Fragment.from(replacement),
              ),
            },
            right - left,
            4,
          );
          const dispatch = (tr) => {
            state = state.apply(tr);
          };
          __insertCells(state, dispatch, 1, { top: 1, bottom: 5, left, right }, clipped);
          const expectedRows = rows.map((row, r) => {
            if (r < 1 || r >= 5) return row;
            const children = [];
            row.forEach((node, _offset, c) => {
              if (c < left || c >= right) children.push(node);
              else if ((r - 1) % height === 0 && (c - left) % width === 0)
                children.push(replacement);
            });
            return row.copy(Fragment.from(children));
          });
          const expected = schema.nodes.doc.create(
            null,
            schema.nodes.table.create(null, expectedRows),
          );
          assert.deepEqual(state.doc.toJSON(), expected.toJSON());
          const afterMap = TableMap.get(state.doc.firstChild);
          assert.equal(afterMap.problems, null);
          const selection = {
            type: 'cell',
            anchor: 1 + afterMap.map[4 + left],
            head: 1 + afterMap.map[16 + right - 1],
          };
          assert.deepEqual(state.selection.toJSON(), selection);
          assert.equal(undo(state, dispatch), true);
          assert.deepEqual(state.doc.toJSON(), doc.toJSON());
          assert.deepEqual(state.selection.toJSON(), beforeSelection);
          assert.equal(redo(state, dispatch), true);
          assert.deepEqual(state.doc.toJSON(), expected.toJSON());
          assert.deepEqual(state.selection.toJSON(), selection);
        });
      }
    }
  }
  for (const mergedInput of [false, true]) {
    for (const backward of [false, true]) {
      test(`${format} crosses an existing owner with ${mergedInput ? 'merged' : 'plain'} cells ${backward}`, () => {
        const owner = cell('OWNER', { colspan: 2, rowspan: 4 });
        const rows = Array.from({ length: 6 }, (_, r) =>
          schema.nodes.table_row.create(
            null,
            r === 1
              ? [cell(`${r}/0`), owner, cell(`${r}/3`)]
              : r > 1 && r < 5
                ? [cell(`${r}/0`), cell(`${r}/3`)]
                : Array.from({ length: 4 }, (_, c) => cell(`${r}/${c}`)),
          ),
        );
        const doc = schema.nodes.doc.create(null, schema.nodes.table.create(null, rows));
        const map = TableMap.get(doc.firstChild),
          a = 1 + map.map[8],
          h = 1 + map.map[15];
        let state = EditorState.create({
          doc,
          plugins: [history()],
          selection: CellSelection.create(doc, backward ? h : a, backward ? a : h),
        });
        const beforeSelection = state.selection.toJSON();
        const size = mergedInput ? 2 : 1;
        const replacement = cell('pasted', { colspan: size, rowspan: size });
        const clipped = __clipCells(
          {
            width: size,
            height: size,
            rows: Array.from({ length: size }, (_, r) =>
              r ? Fragment.empty : Fragment.from(replacement),
            ),
          },
          4,
          2,
        );
        const dispatch = (tr) => {
          state = state.apply(tr);
        };
        __insertCells(state, dispatch, 1, { top: 2, bottom: 4, left: 0, right: 4 }, clipped);
        const expected = schema.nodes.doc.create(
          null,
          schema.nodes.table.create(null, [
            rows[0],
            schema.nodes.table_row.create(null, [
              rows[1].firstChild,
              cell('OWNER', { colspan: 2 }),
              rows[1].lastChild,
            ]),
            schema.nodes.table_row.create(
              null,
              Array.from({ length: 4 / size }, () => replacement),
            ),
            schema.nodes.table_row.create(
              null,
              mergedInput ? [] : Array.from({ length: 4 }, () => replacement),
            ),
            schema.nodes.table_row.create(null, [
              rows[4].firstChild,
              cell('', { colspan: 2 }),
              rows[4].lastChild,
            ]),
            rows[5],
          ]),
        );
        assert.deepEqual(state.doc.toJSON(), expected.toJSON());
        const afterMap = TableMap.get(state.doc.firstChild);
        assert.equal(afterMap.problems, null);
        const selection = { type: 'cell', anchor: 1 + afterMap.map[8], head: 1 + afterMap.map[15] };
        assert.deepEqual(state.selection.toJSON(), selection);
        assert.equal(undo(state, dispatch), true);
        assert.deepEqual(state.doc.toJSON(), doc.toJSON());
        assert.deepEqual(state.selection.toJSON(), beforeSelection);
        assert.equal(redo(state, dispatch), true);
        assert.deepEqual(state.doc.toJSON(), expected.toJSON());
        assert.deepEqual(state.selection.toJSON(), selection);
      });
    }
  }
  console.info(
    JSON.stringify({
      format,
      path: format === 'esm' ? esm : cjs,
      sha256: createHash('sha256')
        .update(readFileSync(format === 'esm' ? esm : cjs))
        .digest('hex'),
    }),
  );
}
