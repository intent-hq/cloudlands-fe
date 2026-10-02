import { test, expect } from '../../../../../test/ct-test';
import Harness from './DocumentProofHarness.svelte';
import { settled, type Host } from './paragraph-browser';

// A full native oracle, not a bounded-renderer acceptance or performance claim.
test('native viewport glyph density measures the source budget needed for a wrapped cell', async ({
  mount,
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const text = Array.from({ length: 20000 }, (_, i) =>
    String.fromCodePoint(0x4e00 + (i % 5000)),
  ).join('');
  const source = `| H |\n| --- |\n| ${text} |`;
  await mount(Harness, { props: { oracle: true, sourceOverride: source } });
  const root = page.getByTestId('proof');
  await expect(root.locator('.tiptap')).toHaveCount(1);
  await root.evaluate((el) => {
    const editor = (el as Host).native,
      dom = editor.view.dom,
      scroller = el.querySelector('[data-testid="editor-host"]')!.parentElement!;
    dom.classList.add('proof-table-projection');
    dom.style.setProperty('--proof-column-width', `${scroller.clientWidth}px`);
    dom.style.setProperty('--proof-table-width', `${scroller.clientWidth}px`);
    dom.style.width = `${scroller.clientWidth}px`;
    Object.assign(dom.querySelector('table')!.parentElement!.style, {
      position: 'static',
      left: 'auto',
      transform: 'none',
      width: '100%',
      minWidth: '0',
      maxWidth: 'none',
      overflow: 'visible',
    });
    scroller.scrollTop = 2000;
  });
  await settled(page);
  const result = await root.evaluate((el) => {
    const editor = (el as Host).native,
      scroller = el.querySelector('[data-testid="editor-host"]')!.parentElement!,
      rect = scroller.getBoundingClientRect(),
      cell = editor.view.dom.querySelector('td')!,
      node = cell.querySelector('p')!.firstChild!,
      range = document.createRange(),
      style = getComputedStyle(cell.querySelector('p')!);
    let visible = '';
    for (let n = 0; n < node.textContent!.length; n++) {
      range.setStart(node, n);
      range.setEnd(node, n + 1);
      const glyph = range.getBoundingClientRect();
      if (
        glyph.left >= rect.left &&
        glyph.right <= rect.left + scroller.clientWidth &&
        glyph.top >= rect.top &&
        glyph.bottom <= rect.top + scroller.clientHeight
      )
        visible += node.textContent![n];
    }
    return {
      visibleGlyphs: visible.length,
      visibleSourceBytes: new TextEncoder().encode(visible).length,
      viewport: { width: scroller.clientWidth, height: scroller.clientHeight },
      font: { size: style.fontSize, family: style.fontFamily, lineHeight: style.lineHeight },
      nativeDocumentTextBytes: new TextEncoder().encode(editor.state.doc.textContent).length,
      nativeNodes: (() => {
        let n = 0;
        editor.state.doc.descendants(() => {
          n++;
        });
        return n;
      })(),
      oracle: true,
    };
  });
  await info.attach('native-table-viewport-density.json', {
    body: JSON.stringify(result),
    contentType: 'application/json',
  });
  await info.attach('native-table-viewport-density.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  expect(result.visibleGlyphs).toBeGreaterThan(0);
  expect(result.visibleSourceBytes).toBeGreaterThan(4096);
});
