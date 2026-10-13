import { test, expect } from '../../../../../test/ct-test';
import type { Page } from '@playwright/test';
import Harness from './ParagraphProofHarness.svelte';
import { focus, settled, type Host } from './paragraph-browser';
const parts = [
  'plain café 🌍 repeated repeated',
  'marked **café 🌍 repeated** and [repeated](https://example.test)',
  '- parent café repeated\n  - child 🌍 repeated\n- sibling repeated',
  '```text\nfenced café 🌍 repeated\n```',
  '| H | R |\n| --- | --- |\n| cell café 🌍 | repeated |',
  'following café 🌍 repeated repeated',
];
const source = parts.join('\n\n');
type OracleHost = Host & {
  nativeMarkdown: () => string;
  reloadNative: (source: string) => Promise<void>;
};
async function edges(page: Page, boundary: number) {
  return page
    .getByTestId('native')
    .getByTestId('proof')
    .evaluate((el, boundary) => {
      const e = (el as Host).native;
      let before = 0;
      for (let i = 0; i < boundary; i++) before += e.state.doc.child(i).nodeSize;
      const leftRoot = e.state.doc.child(boundary),
        rightRoot = e.state.doc.child(boundary + 1);
      let left = -1,
        right = -1;
      if (leftRoot.isTextblock) left = before + leftRoot.nodeSize - 1;
      else
        leftRoot.descendants((node, pos) => {
          if (node.isTextblock) left = before + 1 + pos + node.nodeSize - 1;
        });
      before += leftRoot.nodeSize;
      if (rightRoot.isTextblock) right = before + 1;
      else
        rightRoot.descendants((node, pos) => {
          if (node.isTextblock && right < 0) right = before + 1 + pos + 1;
        });
      if (left < 0 || right < 0) throw new Error('Native boundary has no text caret');
      return { left, right };
    }, boundary);
}
async function capture(page: Page, side: string) {
  await settled(page);
  return page
    .getByTestId(side)
    .getByTestId('proof')
    .evaluate((el) => {
      const h = el as Host,
        e = h.proof?.editor ?? h.native,
        s = e.state.selection,
        d = window.getSelection()!;
      return {
        doc: e.getJSON(),
        selection: s.toJSON(),
        pm: { anchor: s.anchor, head: s.head },
        dom: {
          anchor: e.view.posAtDOM(d.anchorNode!, d.anchorOffset),
          head: e.view.posAtDOM(d.focusNode!, d.focusOffset),
        },
        error: h.proof?.error ?? '',
        logical: h.proof?.selection,
        source: h.proof?.service.region(0),
        stats: h.proof?.snapshot(),
      };
    });
}
async function select(page: Page, side: string, from: number, to = from) {
  await focus(page, side);
  await page
    .getByTestId(side)
    .getByTestId('proof')
    .evaluate(
      (el, p) => {
        const h = el as Host,
          e = h.proof?.editor ?? h.native;
        e.commands.setTextSelection(p);
      },
      { from, to },
    );
  await settled(page);
}
for (let boundary = 0; boundary < 5; boundary++) {
  for (const operation of ['Backspace', 'Delete', 'insert', 'paste'] as const) {
    test(`mixed boundary ${boundary}: browser ${operation}, eviction and history`, async ({
      mount,
      page,
      context,
    }, info) => {
      if (operation === 'paste')
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await mount(Harness, { props: { sourceOverride: source } });
      for (const side of ['native', 'bounded']) await focus(page, side);
      const { left, right } = await edges(page, boundary);
      const results = [];
      for (const side of ['native', 'bounded']) {
        if (operation === 'insert' || operation === 'paste')
          await select(page, side, left - 1, right + 1);
        else await select(page, side, operation === 'Backspace' ? right : left);
        if (operation === 'paste') {
          await page.evaluate(() => navigator.clipboard.writeText('PASTED café'));
          await page.keyboard.press('Control+v');
        } else if (operation === 'insert') await page.keyboard.type('INSERTED');
        else await page.keyboard.press(operation);
        results.push(await capture(page, side));
      }
      await info.attach('mixed-native-browser.json', {
        body: JSON.stringify({ boundary, operation, results }),
        contentType: 'application/json',
      });
      const [native, bounded] = results;
      for (const r of results) {
        expect(r.error).toBe('');
        expect(r.dom).toEqual(r.pm);
      }
      expect(bounded.doc).toEqual(native.doc);
      expect(bounded.selection).toEqual(native.selection);
      if (boundary > 0) expect(bounded.source!.startsWith(parts[0])).toBe(true);
      if (boundary < 4) expect(bounded.source!.endsWith(parts[5])).toBe(true);
      const destroyed = await page
        .getByTestId('bounded')
        .getByTestId('proof')
        .evaluate(async (el) => {
          const p = (el as Host).proof,
            old = p.editor!;
          p.save();
          await p.seek(p.selection.head);
          return old.isDestroyed;
        });
      expect(destroyed).toBe(true);
      await focus(page, 'bounded');
      expect((await capture(page, 'bounded')).doc).toEqual(native.doc);
      const histories = [];
      for (const key of ['Control+z', 'Control+Shift+z']) {
        const pair = [];
        for (const side of ['native', 'bounded']) {
          await focus(page, side);
          await page.keyboard.press(key);
          await settled(page);
          pair.push(await capture(page, side));
        }
        histories.push(pair);
        await info.attach(`mixed-history-${histories.length}.json`, {
          body: JSON.stringify(pair),
          contentType: 'application/json',
        });
        expect(pair[1].error).toBe('');
        expect(pair[1].doc).toEqual(pair[0].doc);
        expect(pair[1].selection).toEqual(pair[0].selection);
        for (const r of pair) expect(r.dom).toEqual(r.pm);
      }
      await info.attach('mixed-native-history.json', {
        body: JSON.stringify(histories),
        contentType: 'application/json',
      });
      const canonical = await page
        .getByTestId('native')
        .getByTestId('proof')
        .evaluate((el) => (el as OracleHost).nativeMarkdown());
      const fresh = await page
        .getByTestId('bounded')
        .getByTestId('proof')
        .evaluate(async (el, canonical) => {
          const h = el as Host;
          return {
            actual: (await h.parseSource(h.proof.service.region(0))).doc,
            expected: (await h.parseSource(canonical)).doc,
          };
        }, canonical);
      expect(fresh.actual).toEqual(fresh.expected);
    });
  }
  for (const direction of ['forward', 'backward'] as const) {
    for (const gesture of ['shift', 'pointer'] as const) {
      test(`mixed boundary ${boundary}: ${direction} ${gesture} selection`, async ({
        mount,
        page,
      }, info) => {
        await mount(Harness, { props: { sourceOverride: source } });
        for (const side of ['native', 'bounded']) await focus(page, side);
        const { left, right } = await edges(page, boundary),
          results = [];
        for (const side of ['native', 'bounded']) {
          const first = direction === 'forward' ? left - 1 : right + 1,
            last = direction === 'forward' ? right + 1 : left - 1;
          await select(
            page,
            side,
            gesture === 'shift' ? (direction === 'forward' ? left : right) : first,
          );
          if (gesture === 'shift')
            await page.keyboard.press(
              direction === 'forward' ? 'Shift+ArrowRight' : 'Shift+ArrowLeft',
            );
          else {
            const coords = await page
              .getByTestId(side)
              .getByTestId('proof')
              .evaluate(
                (el, p) => {
                  const h = el as Host,
                    e = h.proof?.editor ?? h.native;
                  const scroller = e.view.dom.parentElement!.parentElement!;
                  const a = e.view.coordsAtPos(p.first),
                    b = e.view.coordsAtPos(p.last);
                  scroller.scrollTop +=
                    (Math.min(a.top, b.top) + Math.max(a.bottom, b.bottom)) / 2 -
                    (scroller.getBoundingClientRect().top + scroller.clientHeight / 2);
                  const point = (at: number) => {
                    const r = e.view.coordsAtPos(at);
                    return { x: r.left, y: (r.top + r.bottom) / 2 };
                  };
                  return { first: point(p.first), last: point(p.last) };
                },
                { first, last },
              );
            await page.mouse.move(coords.first.x, coords.first.y);
            await page.mouse.down();
            await page.mouse.move(coords.last.x, coords.last.y, { steps: 8 });
            await page.mouse.up();
          }
          results.push(await capture(page, side));
        }
        await info.attach('mixed-browser-selection.json', {
          body: JSON.stringify({ boundary, direction, gesture, results }),
          contentType: 'application/json',
        });
        for (const r of results) {
          expect(r.error).toBe('');
          expect(r.dom).toEqual(r.pm);
        }
        expect(results[1].selection).toEqual(results[0].selection);
        expect(results[1].doc).toEqual(results[0].doc);
      });
    }
  }
}
