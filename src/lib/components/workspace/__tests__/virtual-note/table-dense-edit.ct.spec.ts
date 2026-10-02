import { test, expect } from '../../../../../test/ct-test';
import Harness from './DocumentProofHarness.svelte';
import { settled, type Host } from './paragraph-browser';

test('dense table typing and destroyed-view history preserve native text, marks and exact source', async ({
  mount,
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const source =
    '| H |\n| --- |\n| CELL_START ' +
    '**bold** _italic_ `code` \\| \\\\ '.repeat(1500) +
    ' CELL_END |';
  let component = await mount(Harness, { props: { sourceOverride: source } });
  const root = page.getByTestId('proof');
  await expect(root.locator('.tiptap')).toHaveCount(1);
  const scrollMiddle = async () => {
    await root.evaluate((el) => {
      const scroller = el.querySelector('[data-testid="editor-host"]')!.parentElement!;
      scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) / 2;
    });
    await settled(page);
  };
  await scrollMiddle();
  const target = await root.evaluate((el) => {
    const p = (el as Host).proof,
      editor = p.editor!;
    const scroller = el.querySelector('[data-testid="editor-host"]')!.parentElement!;
    const viewport = scroller.getBoundingClientRect();
    const strong = Array.from(editor.view.dom.querySelectorAll('strong')).find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.top > viewport.top + 150 && rect.bottom < viewport.top + 350;
    });
    if (!strong) throw new Error('No visible dense marked target');
    const text = document.createTreeWalker(strong, NodeFilter.SHOW_TEXT).nextNode();
    if (text?.textContent !== 'bold') throw new Error('Native bold text leaf missing');
    const pm = editor.view.posAtDOM(text, 2);
    return { source: p.projection!.sourceAt(pm), point: p.projection!.table!.pointAt(pm)! };
  });
  await component.unmount();
  // Independent full native editor is an explicitly unbounded oracle only.
  component = await mount(Harness, { props: { sourceOverride: source, oracle: true } });
  await expect(root.locator('.tiptap')).toHaveCount(1);
  await root.evaluate((el, offset) => {
    const editor = (el as Host).native;
    let paragraph = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.textContent.startsWith('CELL_START'))
        paragraph = pos;
    });
    if (paragraph < 0) throw new Error('Native body cell missing');
    editor.view.focus();
    editor.commands.setTextSelection(paragraph + 1 + offset);
  }, target.point.offset);
  await settled(page);
  await page.keyboard.type('Z');
  const native = await root.evaluate((el) => {
    const editor = (el as Host).native;
    return {
      doc: editor.getJSON(),
      offset: editor.state.selection.$head.parentOffset,
      marks: editor.state.selection.$head.marks().map((m) => m.toJSON()),
    };
  });
  expect(native.offset).toBe(target.point.offset + 1);
  expect(native.marks).toEqual([{ type: 'bold' }]);
  await component.unmount();
  component = await mount(Harness, { props: { sourceOverride: source } });
  await expect(root.locator('.tiptap')).toHaveCount(1);
  await scrollMiddle();
  const selected = await root.evaluate((el, target) => {
    const p = (el as Host).proof,
      editor = p.editor!;
    editor.view.focus();
    const pm = p.projection!.table!.pointPM(target.point)!;
    editor.commands.setTextSelection(pm);
    return p.projection!.table!.pointAt(pm);
  }, target);
  expect(selected).toEqual(target.point);
  await settled(page);
  await page.keyboard.type('Z');
  await settled(page);
  const edited = await root.evaluate(async (el) => {
    const h = el as Host,
      p = h.proof;
    p.save();
    return {
      source: p.service.region(0),
      parsed: (await h.parseSource(p.service.region(0))).doc,
      point: p.selection.table!.head,
      error: p.error,
      stats: p.snapshot(),
      marks: p.editor!.state.selection.$head.marks().map((m) => m.toJSON()),
    };
  });
  await info.attach('dense-native-edit.json', {
    body: JSON.stringify({ target, native, edited }),
    contentType: 'application/json',
  });
  expect(edited.error).toBe('');
  expect(edited.source).toBe(source.slice(0, target.source) + 'Z' + source.slice(target.source));
  expect(edited.parsed).toEqual(native.doc);
  expect(edited.point.offset).toBe(native.offset);
  expect(edited.marks).toEqual(native.marks);
  const destroyed = await root.evaluate(async (el) => {
    const p = (el as Host).proof,
      old = p.editor!;
    const scroller = el.querySelector('[data-testid="editor-host"]')!.parentElement!;
    Object.assign(el, { oldDenseView: old });
    scroller.scrollTop = 0;
    return p.destroyed;
  });
  await settled(page);
  expect(await root.evaluate((el) => (el as Host).proof.destroyed)).toBeGreaterThan(destroyed);
  expect(
    await root.evaluate(
      (el) =>
        (el as HTMLElement & { oldDenseView: { isDestroyed: boolean } }).oldDenseView.isDestroyed,
    ),
  ).toBe(true);
  await root.evaluate((el) => (el as Host).proof.editor!.view.focus());
  await page.keyboard.press('Control+z');
  await settled(page);
  expect(await root.evaluate((el) => (el as Host).proof.service.region(0))).toBe(source);
  await page.keyboard.press('Control+Shift+z');
  await settled(page);
  const restored = await root.evaluate(async (el) => {
    const h = el as Host,
      p = h.proof;
    return {
      source: p.service.region(0),
      parsed: (await h.parseSource(p.service.region(0))).doc,
      point: p.selection.table!.head,
      error: p.error,
      stats: p.snapshot(),
    };
  });
  expect(restored.error).toBe('');
  expect(restored.source).toBe(edited.source);
  expect(restored.parsed).toEqual(native.doc);
  expect(restored.point).toEqual(edited.point);
  for (const snapshot of [edited.stats, restored.stats]) {
    expect(snapshot.maxSourceContextBytes).toBeLessThanOrEqual(16384);
    expect(snapshot.maxTableTransferPageBytes).toBeLessThanOrEqual(4096);
    expect(snapshot.cachePages).toBeLessThanOrEqual(4);
    expect(snapshot.cacheBytes).toBeLessThanOrEqual(16384);
    expect(snapshot.pmNodes).toBeLessThanOrEqual(4096);
  }
  await info.attach('dense-native-history.json', {
    body: JSON.stringify(restored),
    contentType: 'application/json',
  });
});
