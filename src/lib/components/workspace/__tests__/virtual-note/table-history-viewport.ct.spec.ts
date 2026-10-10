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
        caret: { top: caret.top, bottom: caret.bottom, left: caret.left, right: caret.right },
        viewport: {
          top: rect.top,
          bottom: rect.top + scroll.clientHeight,
          left: rect.left,
          right: rect.left + scroll.clientWidth,
        },
        visible,
        scroll: scroll.scrollTop,
        destroyed: p?.destroyed,
        source: p?.service.region(0),
        nativeMarkdown: p
          ? undefined
          : (h as Host & { nativeMarkdown: () => string }).nativeMarkdown(),
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
            if (side === 'bounded' && reconstruct && cycle === 0) {
              await root.evaluate((el) => {
                const h = el as Host & { releaseHistory: () => void };
                const held = new Promise<void>((resolve) => {
                  h.releaseHistory = resolve;
                });
                h.proof.delayFetch = () => held;
              });
            }
            await page.keyboard.press(key);
            if (side === 'bounded' && reconstruct && cycle === 0) {
              expect(await root.evaluate((el) => !!(el as Host).proof.pendingFetch)).toBe(true);
              await root.evaluate((el) => {
                const h = el as Host & { releaseHistory: () => void };
                h.proof.delayFetch = undefined;
                h.releaseHistory();
              });
            }
            const current = await frame(page, side);
            phases.push({ name: `${cycle}:${key}`, ...current });
            if (side === 'bounded') {
              expect(current.source).toBe(key === 'Control+z' ? source : typed.source);
              expect(current.actual).toEqual(key === 'Control+z' ? clicked.actual : typed.actual);
              expect(current.destroyed).toBeGreaterThan(typed.destroyed!);
            } else expect(current.offset).toBe(key === 'Control+z' ? clicked.offset : typed.offset);
          }
        }
        if (side === 'bounded' && reconstruct) {
          const beforeRemote = await frame(page, side);
          const stale = await root.evaluate(async (el) => {
            const p = (el as Host).proof;
            let release!: () => void;
            const held = new Promise<void>((resolve) => {
              release = resolve;
            });
            p.delayFetch = () => held;
            const obsolete = p.seek(p.selection.head);
            const at = p.service.region(0).indexOf('neighbor');
            p.remote({ from: at, to: at + 8, insert: 'remote neighbor' });
            p.delayFetch = undefined;
            release();
            return obsolete;
          });
          expect(stale).toBe(false);
          const remote = await frame(page, side);
          expect(remote.source).toBe(beforeRemote.source!.replace('neighbor', 'remote neighbor'));
          expect(remote.actual).toEqual(beforeRemote.actual);
          expect(remote.destroyed).toBeGreaterThan(beforeRemote.destroyed!);
          phases.push({ name: 'remote supersedes delayed reconstruction', ...remote });
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

for (const tail of [true, false])
  for (const fraction of [0, 1])
    test(`history reveals offscreen oversized caret after scrolling ${fraction ? 'down' : 'up'} ${tail ? 'with tail' : 'at end'}`, async ({
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
        await frame(page, side);
        await root.evaluate((el) => {
          const s = el.querySelector('[data-testid="editor-host"]')!.parentElement!;
          s.scrollTop = (s.scrollHeight - s.clientHeight) / 2;
        });
        await frame(page, side);
        const target = await root.evaluate((el) => {
          const s = el.querySelector('[data-testid="editor-host"]')!.parentElement!,
            r = s.getBoundingClientRect();
          return { x: r.left + 60, y: r.top + s.clientHeight / 2 };
        });
        await page.mouse.click(target.x, target.y);
        const clicked = await frame(page, side);
        await page.keyboard.press('X');
        const typed = await frame(page, side);
        const phases = [];
        for (let cycle = 0; cycle < 2; cycle++) {
          await root.evaluate((el, f) => {
            const s = el.querySelector('[data-testid="editor-host"]')!.parentElement!;
            s.scrollTop = (s.scrollHeight - s.clientHeight) * f;
          }, fraction);
          const away = await frame(page, side);
          if (side === 'native')
            expect(
              away.caret.top < away.viewport.top || away.caret.bottom > away.viewport.bottom,
            ).toBe(true);
          else expect(away.source).toBe(typed.source);
          for (const key of ['Control+z', 'Control+Shift+z']) {
            await page.keyboard.press(key);
            const current = await frame(page, side);
            phases.push({ key, cycle, ...current });
            if (side === 'bounded') {
              expect(current.source).toBe(key === 'Control+z' ? source : typed.source);
              expect(current.actual).toEqual(key === 'Control+z' ? clicked.actual : typed.actual);
              expect(current.destroyed).toBeGreaterThan(away.destroyed!);
            } else expect(current.offset).toBe(key === 'Control+z' ? clicked.offset : typed.offset);
          }
        }
        observations.push({ side, clicked, typed, phases });
      }
      await info.attach('offscreen-history-viewport.json', {
        body: JSON.stringify(observations),
        contentType: 'application/json',
      });
      for (const side of observations)
        for (const phase of side.phases) {
          expect(phase.error).toBe('');
          expect(phase.pm).toBe(phase.domPM);
          expect(phase.caret.top, side.side).toBeGreaterThanOrEqual(phase.viewport.top);
          expect(phase.caret.bottom, side.side).toBeLessThanOrEqual(phase.viewport.bottom);
          expect(phase.visible.some((s) => s.includes('abcdefghij'))).toBe(true);
          if (phase.stats) {
            expect(phase.actual).toEqual(phase.selection!.table!.head);
            expect(phase.stats.maxSourceContextBytes).toBeLessThanOrEqual(16384);
            expect(phase.stats.maxTableTransferPageBytes).toBeLessThanOrEqual(4096);
            expect(phase.stats.cachePages).toBeLessThanOrEqual(4);
            expect(phase.stats.cacheBytes).toBeLessThanOrEqual(16384);
            expect(phase.stats.pmNodes).toBeLessThanOrEqual(4096);
          }
        }
      for (let i = 0; i < observations[0].phases.length; i++) {
        const native = observations[0].phases[i],
          bounded = observations[1].phases[i];
        // Native scrolling reveals the caret at the edge in its travel direction.
        expect(
          Math.abs(
            bounded.caret.top - bounded.viewport.top - (native.caret.top - native.viewport.top),
          ),
        ).toBeLessThanOrEqual(1);
      }
    });

for (const scenario of [
  { name: 'hidden left 80px', column: 0, initial: 0, scroll: 80, hidden: true },
  { name: 'clamped left 250px', column: 0, initial: 0, scroll: 250, hidden: true },
  { name: 'visible unchanged', column: 0, initial: 0, scroll: 0, hidden: false },
  { name: 'inside left viewport edge', column: 0, initial: 0, scroll: 'inside', hidden: false },
  { name: 'outside left viewport edge', column: 0, initial: 0, scroll: 'outside', hidden: true },
  { name: 'hidden right', column: 3, initial: 400, scroll: 0, hidden: true },
])
  test(`horizontal history restores a visible logical caret: ${scenario.name}`, async ({
    mount,
    page,
  }, info) => {
    const source =
      '| ' +
      Array.from({ length: 8 }, (_, c) => `H${c}`).join(' | ') +
      ' |\n| ' +
      Array(8).fill('---').join(' | ') +
      ' |\n' +
      Array.from(
        { length: 60 },
        (_, r) => '| ' + Array.from({ length: 8 }, (_, c) => `r${r}c${c}`).join(' | ') + ' |',
      ).join('\n');
    await mount(Pair, { props: { sourceOverride: source } });
    for (const side of ['native', 'bounded'])
      await expect(page.getByTestId(side).locator('.tiptap')).toHaveCount(1);
    const observations = [];
    const visible = (q: Awaited<ReturnType<typeof frame>>) =>
      q.caret.top >= q.viewport.top &&
      q.caret.bottom <= q.viewport.bottom &&
      q.caret.left >= q.viewport.left &&
      q.caret.right <= q.viewport.right;
    for (const side of ['native', 'bounded']) {
      const root = page.getByTestId(side).getByTestId('proof');
      if (side === 'native')
        await root.evaluate((el) => {
          const dom = (el as Host).native.view.dom;
          dom.classList.add('proof-table-projection');
          dom.style.setProperty('--proof-column-width', '183px');
          dom.style.setProperty('--proof-table-width', '1464px');
          dom.style.width = '1464px';
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
      await root.evaluate((el, left) => {
        el.querySelector('[data-testid="editor-host"]')!.parentElement!.scrollLeft = left;
      }, scenario.initial);
      await frame(page, side);
      const target = await root.evaluate((el, column) => {
        const e = (el as Host).proof?.editor ?? (el as Host).native;
        const p = [...e!.view.dom.querySelectorAll('td p')].find(
          (p) => p.textContent === `r0c${column}`,
        )!;
        const r = p.getBoundingClientRect();
        return { x: r.left + 2, y: r.top + r.height / 2, text: p.textContent };
      }, scenario.column);
      expect(target.text).toBe(`r0c${scenario.column}`);
      await page.mouse.click(target.x, target.y);
      const clicked = await frame(page, side);
      await page.keyboard.press('X');
      const typed = await frame(page, side);
      const phases = [];
      for (let cycle = 0; cycle < 2; cycle++) {
        await root.evaluate((el, scroll) => {
          const h = el as Host,
            e = h.proof?.editor ?? h.native;
          const s = el.querySelector('[data-testid="editor-host"]')!.parentElement!;
          const x =
            e!.view.coordsAtPos(e!.state.selection.head).left -
            s.getBoundingClientRect().left +
            s.scrollLeft;
          s.scrollLeft =
            typeof scroll === 'number'
              ? scroll
              : scroll === 'inside'
                ? Math.floor(x)
                : Math.ceil(x) + 1;
        }, scenario.scroll);
        const away = await frame(page, side);
        if (side === 'native') expect(visible(away)).toBe(!scenario.hidden);
        for (const key of ['Control+z', 'Control+Shift+z']) {
          if (side === 'bounded' && cycle === 1)
            await root.evaluate((el) => {
              const h = el as Host & { releaseHorizontal: () => void };
              const held = new Promise<void>((resolve) => {
                h.releaseHorizontal = resolve;
              });
              h.proof.delayFetch = () => held;
            });
          await page.keyboard.press(key);
          if (side === 'bounded' && cycle === 1) {
            expect(await root.evaluate((el) => !!(el as Host).proof.pendingFetch)).toBe(true);
            await root.evaluate((el) => {
              const h = el as Host & { releaseHorizontal: () => void };
              h.proof.delayFetch = undefined;
              h.releaseHorizontal();
            });
          }
          const q = await frame(page, side);
          phases.push({ key, cycle, ...q });
          if (side === 'bounded') {
            expect(q.source).toBe(key === 'Control+z' ? source : typed.source);
            expect(q.actual).toEqual(key === 'Control+z' ? clicked.actual : typed.actual);
            expect(q.destroyed).toBeGreaterThan(away.destroyed!);
          } else {
            expect(q.nativeMarkdown).toBe(
              key === 'Control+z' ? clicked.nativeMarkdown : typed.nativeMarkdown,
            );
            expect(q.offset).toBe(key === 'Control+z' ? clicked.offset : typed.offset);
          }
        }
      }
      if (side === 'bounded')
        expect(typed.source).toBe(
          source.slice(0, clicked.selection!.head) + 'X' + source.slice(clicked.selection!.head),
        );
      observations.push({ side, clicked, typed, phases });
    }
    await info.attach('horizontal-history-viewport.json', {
      body: JSON.stringify(observations),
      contentType: 'application/json',
    });
    for (const observation of observations)
      for (const q of observation.phases) {
        expect(q.error).toBe('');
        expect(q.pm).toBe(q.domPM);
        expect(visible(q), `${observation.side} ${q.cycle} ${q.key}`).toBe(true);
        if (q.stats) {
          expect(q.actual).toEqual(q.selection!.table!.head);
          expect(q.stats.maxSourceContextBytes).toBeLessThanOrEqual(16384);
          expect(q.stats.maxTableTransferPageBytes).toBeLessThanOrEqual(4096);
          expect(q.stats.cachePages).toBeLessThanOrEqual(4);
          expect(q.stats.cacheBytes).toBeLessThanOrEqual(16384);
          expect(q.stats.pmNodes).toBeLessThanOrEqual(4096);
        }
      }
  });
