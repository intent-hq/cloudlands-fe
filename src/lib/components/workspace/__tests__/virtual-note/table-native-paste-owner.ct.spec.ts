import { test, expect } from '../../../../../test/ct-test';
import Harness from './DocumentProofHarness.svelte';
import { type Host } from './paragraph-browser';

for (const [span, width, height] of [
  ['ordinary', 1, 1],
  ['rowspan', 1, 2],
  ['colspan', 2, 1],
  ['combined', 2, 2],
] as const)
  for (const backward of [false, true]) {
    test(`native browser paste owns ${span} corners with ${backward ? 'backward' : 'forward'} selection`, async ({
      mount,
      page,
    }, info) => {
      // Full native document oracle. This does not measure a bounded renderer or the OS clipboard.
      const source =
        '| A | B | C | D |\n| --- | --- | --- | --- |\n' +
        Array.from({ length: 6 }, (_, r) => `| a${r} | b${r} | c${r} | d${r} |`).join('\n') +
        '\n\nUntouched tail';
      const component = await mount(Harness, { props: { sourceOverride: source, oracle: true } });
      const root = page.getByTestId('proof');
      await expect(root.locator('.tiptap')).toHaveCount(1);
      const result = await root.evaluate(
        (el, { width, height, backward }) => {
          const e = (el as Host).native;
          const top = 1,
            bottom = 5,
            left = backward ? 0 : 2,
            right = 4;
          // Independent row/column owner map, including cells with spans. No TableMap oracle reuse.
          const owners = () => {
            const grid: number[][] = [];
            e.state.doc.firstChild!.forEach((row, rowOffset, r) => {
              grid[r] ??= [];
              let c = 0;
              row.forEach((cell, offset) => {
                while (grid[r][c] !== undefined) c++;
                for (let dr = 0; dr < cell.attrs.rowspan; dr++) {
                  grid[r + dr] ??= [];
                  for (let dc = 0; dc < cell.attrs.colspan; dc++)
                    grid[r + dr][c + dc] = rowOffset + offset + 2;
                }
                c += cell.attrs.colspan;
              });
            });
            return grid;
          };
          const grid = owners();
          const a = grid[top][left],
            h = grid[bottom - 1][right - 1];
          e.commands.setCellSelection({ anchorCell: backward ? h : a, headCell: backward ? a : h });
          const before = e.getJSON(),
            beforeSelection = e.state.selection.toJSON();
          const expected = structuredClone(before);
          const replacement = e.schema.nodes.tableCell
            .create({ colspan: width, rowspan: height }, [
              e.schema.nodes.paragraph.create(null, [
                e.schema.text('P', [e.schema.marks.bold.create()]),
                e.schema.text('a|b\\c', [e.schema.marks.code.create()]),
              ]),
              e.schema.nodes.paragraph.create(),
            ])
            .toJSON();
          for (let r = top; r < bottom; r++) {
            const row = expected.content![0].content![r];
            const cells = row.content!.flatMap((cell, c) => {
              if (c < left || c >= right) return [cell];
              return (r - top) % height === 0 && (c - left) % width === 0 ? [replacement] : [];
            });
            expected.content![0].content![r] = e.schema.nodes.tableRow
              .create(
                row.attrs,
                cells.map((cell) => e.schema.nodeFromJSON(cell)),
              )
              .toJSON();
          }
          const data = new DataTransfer();
          data.setData(
            'text/html',
            `<table><tr><td colspan="${width}" rowspan="${height}"><p><strong>P</strong><code>a|b\\c</code></p><p></p></td></tr>${height === 2 ? '<tr></tr>' : ''}</table>`,
          );
          const event = new ClipboardEvent('paste', {
            clipboardData: data,
            bubbles: true,
            cancelable: true,
          });
          e.view.dom.dispatchEvent(event);
          const after = e.getJSON(),
            selection = e.state.selection.toJSON(),
            afterGrid = owners();
          const expectedSelection = {
            type: 'cell',
            anchor: afterGrid[top][left],
            head: afterGrid[bottom - 1][right - 1],
          };
          const undone = e.commands.undo();
          const undoDoc = e.getJSON(),
            undoSelection = e.state.selection.toJSON();
          const redone = e.commands.redo();
          return {
            prevented: event.defaultPrevented,
            before,
            beforeSelection,
            expected,
            after,
            selection,
            expectedSelection,
            undone,
            undoDoc,
            undoSelection,
            redone,
            redoDoc: e.getJSON(),
            redoSelection: e.state.selection.toJSON(),
          };
        },
        { width, height, backward },
      );
      await info.attach('native-paste-owner-evidence', {
        body: JSON.stringify(result),
        contentType: 'application/json',
      });
      expect(result.prevented).toBe(true);
      expect(result.after).toEqual(result.expected);
      expect(result.selection).toEqual(result.expectedSelection);
      expect(result.undone).toBe(true);
      expect(result.undoDoc).toEqual(result.before);
      expect(result.undoSelection).toEqual(result.beforeSelection);
      expect(result.redone).toBe(true);
      expect(result.redoDoc).toEqual(result.expected);
      expect(result.redoSelection).toEqual(result.selection);
      await component.unmount();
    });
  }
