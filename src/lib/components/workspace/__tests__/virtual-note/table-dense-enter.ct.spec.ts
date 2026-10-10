import type { JSONContent } from '@tiptap/core';
import { test, expect } from '../../../../../test/ct-test';
import Harness from './DocumentProofHarness.svelte';
import { settled, type Host } from './paragraph-browser';

test('dense native Enter, empty paragraphs and typing retain exact live structure through delayed eviction and chronological history', async ({
  mount,
  page,
}, info) => {
  // Two sequential editors, three native gestures and six history operations.
  // The full native document is an unbounded comparison oracle, never a renderer claim.
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const source =
    '| H |\n| --- |\n| CELL_START ' +
    '**bold** _italic_ `code` \\| \\\\ '.repeat(1500) +
    ' CELL_END |';
  const root = page.getByTestId('proof');
  let component = await mount(Harness, { props: { sourceOverride: source } });
  await expect(root.locator('.tiptap')).toHaveCount(1);
  const middle = async () => {
    await root.evaluate((el) => {
      const scroller = el.querySelector('[data-testid="editor-host"]')!.parentElement!;
      scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) / 2;
    });
    await settled(page);
  };
  await middle();
  const target = await root.evaluate((el) => {
    const p = (el as Host).proof,
      e = p.editor!;
    const viewport = el
      .querySelector('[data-testid="editor-host"]')!
      .parentElement!.getBoundingClientRect();
    const strong = Array.from(e.view.dom.querySelectorAll('strong')).find((node) => {
      const r = node.getBoundingClientRect();
      return r.top > viewport.top + 150 && r.bottom < viewport.top + 350;
    });
    if (!strong) throw new Error('No visible marked target');
    const leaf = document.createTreeWalker(strong, NodeFilter.SHOW_TEXT).nextNode()!;
    if (leaf.textContent !== 'bold') throw new Error('Wrong native text target');
    const pm = e.view.posAtDOM(leaf, 2);
    return { source: p.projection!.sourceAt(pm), point: p.projection!.table!.pointAt(pm)! };
  });
  const edit = async (index: number) => {
    await page.clock.setFixedTime(new Date(`2026-10-02T12:00:0${index}Z`));
    await page.keyboard.press(index < 2 ? 'Enter' : 'Z');
    await settled(page);
  };
  await component.unmount();
  component = await mount(Harness, { props: { sourceOverride: source, oracle: true } });
  await expect(root.locator('.tiptap')).toHaveCount(1);
  await root.evaluate((el, offset) => {
    const e = (el as Host).native;
    let pos = -1;
    e.state.doc.descendants((n, p) => {
      if (n.type.name === 'paragraph' && n.textContent.startsWith('CELL_START'))
        pos = p + 1 + offset;
    });
    if (pos < 0) throw new Error('Missing native cell');
    e.view.focus();
    e.commands.setTextSelection(pos);
  }, target.point.offset);
  await settled(page);
  const nativeSnapshot = () =>
    root.evaluate((el) => {
      const e = (el as Host).native,
        s = e.state.selection.$head;
      return {
        cell: e.state.doc.firstChild!.child(1).child(0).toJSON(),
        block: s.index(3),
        offset: s.parentOffset,
        marks: s.marks().map((m) => m.toJSON()),
      };
    });
  const initial = await nativeSnapshot();
  const forward = [];
  for (let i = 0; i < 3; i++) {
    await edit(i);
    forward.push(await nativeSnapshot());
  }
  expect(forward[1].cell.content).toHaveLength(3);
  expect(forward[1].cell.content![1]).toEqual({ type: 'paragraph' });
  const undo = [],
    redo = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Control+z');
    await settled(page);
    undo.push(await nativeSnapshot());
  }
  expect(undo[2].cell).toEqual(initial.cell);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Control+Shift+z');
    await settled(page);
    redo.push(await nativeSnapshot());
  }
  expect(redo[2].cell).toEqual(forward[2].cell);
  await component.unmount();
  component = await mount(Harness, { props: { sourceOverride: source } });
  await expect(root.locator('.tiptap')).toHaveCount(1);
  await middle();
  await root.evaluate((el, point) => {
    const p = (el as Host).proof;
    p.editor!.view.focus();
    p.editor!.commands.setTextSelection(p.projection!.table!.pointPM(point)!);
  }, target.point);
  await settled(page);
  const evidence: unknown[] = [];
  const compare = async (
    expected: { cell: JSONContent; block: number; offset: number; marks: JSONContent[] },
    expectedSource: string,
  ) => {
    const actual = await root.evaluate((el, expected) => {
      const p = (el as Host).proof,
        e = p.editor!;
      p.save();
      const nativeCell = e.schema.nodeFromJSON(expected.cell);
      const slices = p
        .projection!.table!.paragraphs.filter((x) => x.cell.row === 1)
        .map((x) => {
          const n = e.state.doc.resolve(x.pm).parent;
          const oracle = nativeCell.child(x.block).cut(x.offset, x.offset + n.content.size);
          return {
            block: x.block,
            offset: x.offset,
            actual: n.toJSON(),
            expected: oracle.toJSON(),
          };
        });
      return {
        source: p.service.region(0),
        point: p.selection.table!.head,
        marks: e.state.selection.$head.marks().map((m) => m.toJSON()),
        slices,
        error: p.error,
        stats: p.snapshot(),
        journal: p.service.stats,
      };
    }, expected);
    evidence.push(actual);
    expect(actual.error).toBe('');
    expect(actual.source).toBe(expectedSource);
    expect(actual.point).toEqual({
      ...target.point,
      block: expected.block,
      offset: expected.offset,
    });
    expect(actual.marks).toEqual(expected.marks);
    expect(actual.slices.length).toBeGreaterThan(0);
    for (const slice of actual.slices) expect(slice.actual).toEqual(slice.expected);
    expect(actual.stats.maxSourceContextBytes).toBeLessThanOrEqual(16384);
    expect(actual.stats.maxTableTransferPageBytes).toBeLessThanOrEqual(4096);
    expect(actual.journal.maxTableWriteBytes).toBeLessThanOrEqual(4096);
    expect(actual.stats.cachePages).toBeLessThanOrEqual(4);
    expect(actual.stats.cacheBytes).toBeLessThanOrEqual(16384);
    expect(actual.stats.pmNodes).toBeLessThanOrEqual(4096);
  };
  const editedSource = source.slice(0, target.source) + 'Z' + source.slice(target.source);
  for (let i = 0; i < 3; i++) {
    await edit(i);
    await compare(forward[i], i === 2 ? editedSource : source);
  }
  await root.evaluate((el) => {
    const h = el as Host & { releaseParagraph: () => void; oldParagraphView: unknown };
    h.oldParagraphView = h.proof.editor;
    h.proof.delayFetch = () =>
      new Promise<void>((resolve) => {
        h.releaseParagraph = resolve;
      });
    el.querySelector('[data-testid="editor-host"]')!.parentElement!.scrollTop = 0;
  });
  await expect
    .poll(() =>
      root.evaluate(
        (el) => typeof (el as Host & { releaseParagraph?: () => void }).releaseParagraph,
      ),
    )
    .toBe('function');
  expect(
    await root.evaluate(
      (el) =>
        (el as HTMLElement & { oldParagraphView: { isDestroyed: boolean } }).oldParagraphView
          .isDestroyed,
    ),
  ).toBe(false);
  await root.evaluate((el) => {
    const h = el as Host & { releaseParagraph: () => void };
    h.proof.delayFetch = undefined;
    h.releaseParagraph();
  });
  await settled(page);
  expect(
    await root.evaluate(
      (el) =>
        (el as HTMLElement & { oldParagraphView: { isDestroyed: boolean } }).oldParagraphView
          .isDestroyed,
    ),
  ).toBe(true);
  await root.evaluate((el) => (el as Host).proof.editor!.view.focus());
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Control+z');
    await settled(page);
    await compare(undo[i], source);
  }
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Control+Shift+z');
    await settled(page);
    await compare(redo[i], i === 2 ? editedSource : source);
  }
  await info.attach('dense-paragraph-history.json', {
    body: JSON.stringify({ target, initial, forward, undo, redo, evidence }),
    contentType: 'application/json',
  });
  await component.unmount();
  await mount(Harness, { props: { sourceOverride: editedSource, oracle: true } });
  await expect(root.locator('.tiptap')).toHaveCount(1);
  const fresh = await root.evaluate((el, cell) => {
    const e = (el as Host).native,
      live = e.schema.nodeFromJSON(cell);
    let inline = live.firstChild!.content;
    for (let i = 1; i < live.childCount; i++) inline = inline.append(live.child(i).content);
    const canonical = e.state.doc.firstChild!.child(1).child(0);
    return {
      paragraphs: canonical.childCount,
      actual: canonical.firstChild!.content.toJSON(),
      expected: inline.toJSON(),
    };
  }, forward[2].cell);
  expect(fresh.paragraphs).toBe(1);
  expect(fresh.actual).toEqual(fresh.expected);
});
