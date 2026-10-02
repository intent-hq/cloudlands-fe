import { test, expect } from '../../../../../test/ct-test';
import type { Page } from '@playwright/test';
import Pair from './ParagraphProofHarness.svelte';
import { settled, type Host } from './paragraph-browser';

async function frame(page: Page, side: string) {
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
  return page
    .getByTestId(side)
    .getByTestId('proof')
    .evaluate((el) => {
      const h = el as Host,
        p = h.proof,
        e = p?.editor ?? h.native;
      const scroll = el.querySelector('[data-testid="editor-host"]')!.parentElement!;
      const rect = scroll.getBoundingClientRect(),
        dom = document.getSelection();
      const caret = e!.view.coordsAtPos(e!.state.selection.head);
      const visible: string[] = [];
      const walker = document.createTreeWalker(e!.view.dom, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        if (
          [...range.getClientRects()].some(
            (r) => r.bottom > rect.top && r.top < rect.top + scroll.clientHeight,
          )
        )
          visible.push(walker.currentNode.textContent!.slice(0, 30));
      }
      return {
        caret: { top: caret.top, bottom: caret.bottom },
        viewport: { top: rect.top, bottom: rect.top + scroll.clientHeight },
        visible,
        scroll: scroll.scrollTop,
        destroyed: p?.destroyed,
        source: p?.service.region(0),
        selection: p?.selection,
        actual: p?.projection?.table?.pointAt(e!.state.selection.head),
        pm: e!.state.selection.head,
        domPM:
          dom?.focusNode && e!.view.dom.contains(dom.focusNode)
            ? e!.view.posAtDOM(dom.focusNode, dom.focusOffset)
            : undefined,
        offset: e!.state.selection.$head.parentOffset,
        text: e!.state.selection.$head.parent.textContent,
        error: p?.error ?? '',
        stats: p?.snapshot(),
      };
    });
}

for (const tail of [true, false])
  for (const reconstruct of [false, true])
    test(`oversized cell ${reconstruct ? 'destroyed view and' : 'real keyboard'} history retains visible caret ${tail ? 'with tail' : 'at end'}`, async ({
      mount,
      page,
    }, info) => {
      const source =
        '| H | R |\n| --- | --- |\n| ' +
        'abcdefghij '.repeat(6000) +
        ' | neighbor |' +
        (tail ? '\n| tail | end |' : '');
      await mount(Pair, { props: { sourceOverride: source } });
      for (const side of ['native', 'bounded'])
        await expect(page.getByTestId(side).locator('.tiptap')).toHaveCount(1);
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
        await frame(page, side);
        await root.evaluate((el) => {
          const s = el.querySelector('[data-testid="editor-host"]')!.parentElement!;
          s.scrollTop = (s.scrollHeight - s.clientHeight) * 0.5;
        });
        await frame(page, side);
        const target = await root.evaluate((el) => {
          const s = el.querySelector('[data-testid="editor-host"]')!.parentElement!,
            r = s.getBoundingClientRect();
          return { x: r.left + 60, y: r.top + s.clientHeight / 2 };
        });
        await page.mouse.click(target.x, target.y);
        const clicked = await frame(page, side);
        expect(clicked.text).toContain('abcdefghij');
        await page.keyboard.press('X');
        const typed = await frame(page, side);
        const phases = [
          { name: 'clicked', ...clicked },
          { name: 'typed', ...typed },
        ];
        if (side === 'bounded' && reconstruct) {
          await root.evaluate(async (el) => {
            const p = (el as Host).proof;
            p.save();
            await p.seek(p.selection.head);
          });
          const restored = await frame(page, side);
          expect(restored.destroyed).toBeGreaterThan(typed.destroyed!);
          expect(restored.source).toBe(typed.source);
          expect(restored.selection).toEqual(typed.selection);
          phases.push({ name: 'destroyed', ...restored });
        }
        for (let cycle = 0; cycle < 2; cycle++) {
          for (const key of ['Control+z', 'Control+Shift+z']) {
            await page.keyboard.press(key);
            const current = await frame(page, side);
            phases.push({ name: `${cycle}:${key}`, ...current });
            if (side === 'bounded') {
              expect(current.source).toBe(key === 'Control+z' ? source : typed.source);
              expect(current.actual).toEqual(key === 'Control+z' ? clicked.actual : typed.actual);
              expect(current.destroyed).toBeGreaterThan(typed.destroyed!);
            } else expect(current.offset).toBe(key === 'Control+z' ? clicked.offset : typed.offset);
          }
        }
        await info.attach(`${side}-history-viewport.json`, {
          body: JSON.stringify(phases),
          contentType: 'application/json',
        });
        for (const current of phases) {
          expect(current.error).toBe('');
          expect(current.pm).toBe(current.domPM);
          expect(current.caret.top, current.name).toBeGreaterThanOrEqual(current.viewport.top);
          expect(current.caret.bottom, current.name).toBeLessThanOrEqual(current.viewport.bottom);
          expect(
            current.visible.some((s) => s.includes('abcdefghij')),
            current.name,
          ).toBe(true);
          // Native line wrapping may move the caret by one line; reconstruction must
          // not discard its encountered viewport position.
          expect(Math.abs(current.caret.top - typed.caret.top), current.name).toBeLessThanOrEqual(
            24,
          );
          if (current.stats) {
            expect(current.actual).toEqual(current.selection!.table!.head);
            expect(current.stats.maxSourceContextBytes).toBeLessThanOrEqual(16384);
            expect(current.stats.maxTableTransferPageBytes).toBeLessThanOrEqual(4096);
            expect(current.stats.cachePages).toBeLessThanOrEqual(4);
            expect(current.stats.cacheBytes).toBeLessThanOrEqual(16384);
            expect(current.stats.pmNodes).toBeLessThanOrEqual(4096);
          }
        }
        if (side === 'bounded')
          expect(typed.source).toBe(
            source.slice(0, clicked.selection!.head) + 'X' + source.slice(clicked.selection!.head),
          );
      }
    });
