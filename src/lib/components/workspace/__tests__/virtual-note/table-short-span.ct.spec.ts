import { test, expect } from '../../../../../test/ct-test';
import Harness from './DocumentProofHarness.svelte';
import { settled, type Host } from './paragraph-browser';

const cases = [
  {
    name: 'calibrated CJK short-span',
    text: Array.from({ length: 20000 }, (_, i) => String.fromCodePoint(0x4e00 + (i % 5000))).join(
      '',
    ),
  },
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
    const calibration = await root.evaluate((el) => {
      const proof = (el as Host).proof;
      const cell = proof.editor!.view.dom.querySelector('td')!;
      const paragraph = cell.querySelector('p')!;
      const style = getComputedStyle(paragraph);
      const width = paragraph.getBoundingClientRect().width;
      const reference = document.createElement('p');
      reference.textContent = Array.from({ length: 2146 }, (_, i) =>
        String.fromCodePoint(0x4e00 + ((8326 + i) % 5000)),
      ).join('');
      reference.style.cssText = `position:absolute;left:0;top:0;width:${width}px;margin:0;font:${style.font};letter-spacing:${style.letterSpacing};word-break:${style.wordBreak};overflow-wrap:${style.overflowWrap};line-height:${style.lineHeight}`;
      cell.append(reference);
      const range = document.createRange();
      range.selectNodeContents(reference);
      const lines = new Set(Array.from(range.getClientRects(), (r) => r.top)).size;
      const lineHeight = 456 / lines;
      reference.style.lineHeight = `${lineHeight}px`;
      const actual = reference.getBoundingClientRect().height;
      const css = document.createElement('style');
      css.textContent = `[data-testid="proof"] .tiptap td p, [data-testid="proof"] .tiptap th p {line-height:${lineHeight}px !important}`;
      document.head.append(css);
      reference.remove();
      // One calibration only. Real layout is measured after the reference is gone.
      proof.resizeTable(1280, false);
      return {
        width,
        lines,
        lineHeight,
        actual,
        font: style.font,
        kind: 'controlled density stress, not hosted font reproduction',
      };
    });
    await info.attach('one-shot-calibration.json', {
      body: JSON.stringify(calibration),
      contentType: 'application/json',
    });
    expect(Math.abs(calibration.actual - 456)).toBeLessThanOrEqual(1);
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
        const sourceRects = p.projection!.table!.entries.map((entry) => {
          const dom = editor.view.nodeDOM(entry.pm) as HTMLElement;
          const paragraphs = Array.from(dom.querySelectorAll('p'));
          const first = paragraphs[0]?.getBoundingClientRect();
          const last = paragraphs.at(-1)?.getBoundingClientRect();
          return {
            first: entry.cell.first,
            last: entry.cell.last,
            body: entry.cell.body,
            end: entry.cell.end,
            top: first?.top,
            bottom: last?.bottom,
          };
        });
        return {
          sourceRects,
          viewport: { top: rect.top, bottom: rect.top + scroller.clientHeight },
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
      expect(frame.stats.pmNodes).toBeLessThanOrEqual(4096);
      if (fraction === 0.5) {
        const interior = frame.sourceRects.filter((r) => r.first > r.body && r.last < r.end);
        expect(interior).toHaveLength(1);
        expect(interior[0].top!).toBeLessThanOrEqual(frame.viewport.top + 1);
        expect(interior[0].bottom!).toBeGreaterThanOrEqual(frame.viewport.bottom - 1);
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
