import { test, expect } from '../../../../../test/ct-test';
import Harness from './DocumentProofHarness.svelte';
import { settled, type Host } from './paragraph-browser';

const cases = [
  { name: 'ASCII', text: 'abcdefghij '.repeat(4000) },
  {
    name: 'CJK',
    text: Array.from({ length: 20000 }, (_, i) => String.fromCodePoint(0x4e00 + (i % 5000))).join(
      '',
    ),
  },
  { name: 'emoji', text: '🌍🚀✨'.repeat(8000) },
  { name: 'marks and escapes', text: '**bold** _italic_ `code` \\| \\\\ '.repeat(1500) },
];
for (const fixture of cases)
  test(`oversized ${fixture.name} cell covers middle, end and return viewports with paged source`, async ({
    mount,
    page,
  }, info) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const source = `| H |\n| --- |\n| CELL_START ${fixture.text} CELL_END |`;
    await mount(Harness, { props: { sourceOverride: source } });
    const root = page.getByTestId('proof');
    await expect(root.locator('.tiptap')).toHaveCount(1);
    const frames = [];
    for (const fraction of [0.5, 1, 0]) {
      await root.evaluate((el, fraction) => {
        const scroller = el.querySelector('[data-testid="editor-host"]')!.parentElement!;
        scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * fraction;
      }, fraction);
      await settled(page);
      const frame = await root.evaluate((el) => {
        const p = (el as Host).proof,
          editor = p.editor!,
          scroller = el.querySelector('[data-testid="editor-host"]')!.parentElement!,
          rect = scroller.getBoundingClientRect();
        const cells = p.projection!.table!.window.cells;
        const text = editor.state.doc.textContent;
        const glyphs = [];
        const doc = document as Document & {
          caretRangeFromPoint(x: number, y: number): Range | null;
        };
        for (const y of [rect.top + 80, rect.top + 260, rect.top + 440]) {
          const x = rect.left + scroller.clientWidth / 2;
          const range = doc.caretRangeFromPoint(x, y);
          let distance = Infinity;
          if (
            range &&
            range.startContainer.nodeType === Node.TEXT_NODE &&
            editor.view.dom.contains(range.startContainer)
          ) {
            const node = range.startContainer,
              offset = Math.min(range.startOffset, (node.textContent?.length ?? 1) - 1);
            range.setStart(node, Math.max(0, offset));
            range.setEnd(node, Math.max(0, offset) + 1);
            const glyph = range.getBoundingClientRect();
            distance = Math.max(glyph.top - y, y - glyph.bottom, 0);
          }
          glyphs.push({ x, y, distance });
        }
        let endVisible = false;
        const walker = document.createTreeWalker(editor.view.dom, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const at = node.textContent!.indexOf('CELL_END');
          if (at < 0) continue;
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + 8);
          const glyph = range.getBoundingClientRect();
          endVisible =
            glyph.top >= rect.top && glyph.bottom <= rect.top + scroller.clientHeight + 1;
        }
        return {
          textStart: text.slice(0, 40),
          textEnd: text.slice(-40),
          endVisible,
          glyphs,
          first: cells.find((c) => c.row === 1)?.first,
          last: cells.find((c) => c.row === 1)?.last,
          body: cells.find((c) => c.row === 1)?.body,
          end: cells.find((c) => c.row === 1)?.end,
          stats: p.snapshot(),
          error: p.error,
          height: scroller.scrollHeight,
          scroll: scroller.scrollTop,
        };
      });
      frames.push({ fraction, ...frame });
      await info.attach(`table-${fixture.name}-${fraction}.json`, {
        body: JSON.stringify(frame),
        contentType: 'application/json',
      });
      expect(frame.error).toBe('');
      expect(frame.stats.maxSourceContextBytes).toBeLessThanOrEqual(16384);
      expect(frame.stats.maxTableTransferPageBytes).toBeLessThanOrEqual(4096);
      expect(frame.stats.cachePages).toBeLessThanOrEqual(4);
      expect(frame.stats.cacheBytes).toBeLessThanOrEqual(16384);
      expect(frame.stats.pmNodes).toBeLessThanOrEqual(256);
      if (fraction === 0.5) {
        expect(frame.first).toBeGreaterThan(frame.body!);
        expect(frame.last).toBeLessThan(frame.end!);
        for (const glyph of frame.glyphs) expect(glyph.distance).toBeLessThanOrEqual(24);
      }
      if (fraction === 1) expect(frame.endVisible).toBe(true);
      if (fraction === 0) expect(frame.textStart).toContain('CELL_START');
    }
    expect(await root.evaluate((el) => (el as Host).proof.service.region(0))).toBe(source);
    expect(frames[1].last).toBe(frames[1].end);
  });
