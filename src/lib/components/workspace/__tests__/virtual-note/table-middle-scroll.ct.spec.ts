import { test, expect } from '../../../../../test/ct-test';
import Pair from './ParagraphProofHarness.svelte';
import { settled, type Host } from './paragraph-browser';

for (const tail of [true, false])
  test(`ordinary oversized cell scrolling covers middle and revisit ${tail ? 'with a following row' : 'at table end'}`, async ({
    mount,
    page,
  }, info) => {
    const source =
      '| H | R |\n| --- | --- |\n| ' +
      'abcdefghij '.repeat(6000) +
      ' | neighbor |' +
      (tail ? '\n| tail | end |' : '');
    await mount(Pair, { props: { sourceOverride: source } });
    const observations = [];
    for (const side of ['native', 'bounded']) {
      const root = page.getByTestId(side).getByTestId('proof');
      if (side === 'native')
        await root.evaluate((el) => {
          const dom = (el as Host).native.view.dom;
          dom.classList.add('proof-table-projection');
          dom.style.setProperty('--proof-column-width', '275px');
          dom.style.setProperty('--proof-table-width', '550px');
          dom.style.width = '550px';
          Object.assign(dom.querySelector('table')!.parentElement!.style, {
            position: 'static',
            left: 'auto',
            transform: 'none',
            width: '100%',
            minWidth: '0',
            maxWidth: 'none',
            overflow: 'visible',
          });
        });
      await settled(page);
      await expect
        .poll(() =>
          page
            .getByTestId('bounded')
            .getByTestId('proof')
            .evaluate((el) => {
              const p = (el as Host).proof;
              return !p.pendingFetch && !p.navigating && !p.service.pendingInputs;
            }),
        )
        .toBe(true);
      for (const fraction of [0.5, 1, 0.5, 0]) {
        await root.evaluate((el, fraction) => {
          const scroll = el.querySelector('[data-testid="editor-host"]')!.parentElement!;
          scroll.scrollLeft = 0;
          scroll.scrollTop = (scroll.scrollHeight - scroll.clientHeight) * fraction;
        }, fraction);
        await settled(page);
        await expect
          .poll(() =>
            root.evaluate((el) => {
              const p = (el as Host).proof;
              return !p || (!p.pendingFetch && !p.navigating && !p.service.pendingInputs);
            }),
          )
          .toBe(true);
        const frame = await root.evaluate((el) => {
          const h = el as Host,
            p = h.proof,
            editor = p?.editor ?? h.native;
          const scroll = el.querySelector('[data-testid="editor-host"]')!.parentElement!;
          const rect = scroll.getBoundingClientRect();
          const visible = [];
          const walker = document.createTreeWalker(editor!.view.dom, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const node = walker.currentNode,
              range = document.createRange();
            range.selectNodeContents(node);
            for (const box of range.getClientRects()) {
              if (
                box.bottom > rect.top &&
                box.top < rect.top + scroll.clientHeight &&
                box.right > rect.left &&
                box.left < rect.left + scroll.clientWidth
              ) {
                visible.push({
                  sample: node.textContent!.slice(0, 30),
                  top: box.top,
                  bottom: box.bottom,
                });
              }
            }
          }
          return {
            visible,
            scroll: scroll.scrollTop,
            height: scroll.scrollHeight,
            click: { x: rect.left + 60, y: rect.top + scroll.clientHeight / 2 },
            viewport: { top: rect.top, bottom: rect.top + scroll.clientHeight },
            cells: p?.projection?.table?.window.cells.map((c) => ({
              from: c.from,
              body: c.body,
              first: c.first,
              last: c.last,
              end: c.end,
            })),
            error: p?.error ?? '',
            stats: p?.snapshot(),
          };
        });
        observations.push({ side, fraction, frame });
        await info.attach(`scroll-${side}-${observations.length}.json`, {
          body: JSON.stringify(observations),
          contentType: 'application/json',
        });
        expect(frame.error).toBe('');
        if (fraction === 0.5) {
          expect(frame.visible.some((r) => r.sample.includes('abcdefghij'))).toBe(true);
          for (const y of [frame.viewport.top + 80, frame.click.y, frame.viewport.bottom - 80])
            expect(
              frame.visible.some(
                (r) => r.sample.includes('abcdefghij') && r.top <= y + 24 && r.bottom >= y - 24,
              ),
            ).toBe(true);
          await page.mouse.click(frame.click.x, frame.click.y);
          await settled(page);
          const selected = await root.evaluate((el) => {
            const h = el as Host,
              p = h.proof,
              editor = p?.editor ?? h.native;
            return {
              text: editor!.state.selection.$head.parent.textContent,
              logical: p?.selection.table?.head,
              actual: p?.projection?.table?.pointAt(editor!.state.selection.head),
              source: p?.service.region(0),
            };
          });
          expect(selected.text).toContain('abcdefghij');
          if (side === 'bounded') {
            expect(selected.logical?.cell).toBe(source.indexOf('abcdefghij') - 1);
            expect(selected.actual).toEqual(selected.logical);
            expect(selected.source).toBe(source);
          }
        }
        if (fraction === 1)
          expect(frame.visible.some((r) => r.sample.includes(tail ? 'tail' : 'abcdefghij'))).toBe(
            true,
          );
        if (frame.stats) {
          expect(frame.stats.maxSourceContextBytes).toBeLessThanOrEqual(16384);
          expect(frame.stats.maxTableTransferPageBytes).toBeLessThanOrEqual(4096);
          expect(frame.stats.cachePages).toBeLessThanOrEqual(4);
          expect(frame.stats.cacheBytes).toBeLessThanOrEqual(16384);
          expect(frame.stats.pmNodes).toBeLessThanOrEqual(4096);
        }
      }
    }
  });
