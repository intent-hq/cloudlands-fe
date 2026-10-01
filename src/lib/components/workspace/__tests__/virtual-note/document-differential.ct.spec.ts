import { test, expect } from '../../../../../test/ct-test';
import type { Page } from '@playwright/test';
import type { Editor } from '@tiptap/core';
import type { DocumentSession } from './document-session';
import Harness from './DifferentialProofHarness.svelte';
type Host = HTMLElement & { proof: DocumentSession; native: Editor };
async function state(page: Page, side: string) {
  return page
    .getByTestId(side)
    .getByTestId('proof')
    .evaluate((el) => {
      const h = el as Host,
        e = h.proof?.editor ?? h.native;
      return {
        doc: e!.getJSON(),
        selection: e!.state.selection.toJSON(),
        error: h.proof?.error ?? '',
      };
    });
}
async function select(page: Page, side: string, anchor: number, head = anchor) {
  await expect(page.getByTestId(side).locator('.tiptap')).toHaveCount(1);
  await page
    .getByTestId(side)
    .getByTestId('proof')
    .evaluate(
      (el, r) => {
        const h = el as Host,
          e = h.proof?.editor ?? h.native;
        e!.view.focus();
        e!.commands.setTextSelection({ from: r.anchor, to: r.head });
      },
      { anchor, head },
    );
  await expect
    .poll(async () => (await state(page, side)).selection)
    .toEqual({ type: 'text', anchor, head });
  await expect
    .poll(() =>
      page
        .getByTestId(side)
        .getByTestId('proof')
        .evaluate((el) => {
          const h = el as Host,
            e = h.proof?.editor ?? h.native,
            selection = window.getSelection()!;
          if (
            !selection.anchorNode ||
            !selection.focusNode ||
            !e!.view.dom.contains(selection.anchorNode)
          )
            return null;
          return {
            anchor: e!.view.posAtDOM(selection.anchorNode, selection.anchorOffset),
            head: e!.view.posAtDOM(selection.focusNode, selection.focusOffset),
          };
        }),
    )
    .toEqual({ anchor, head });
}
async function seam(page: Page) {
  await expect(page.getByTestId('native').locator('.tiptap')).toHaveCount(1);
  return page
    .getByTestId('native')
    .getByTestId('proof')
    .evaluate((el) => (el as Host).native.state.doc.firstChild!.nodeSize);
}
async function same(page: Page) {
  const native = await state(page, 'native');
  await expect.poll(() => state(page, 'bounded')).toEqual(native);
}

for (const direction of ['forward', 'backward'] as const)
  test(`native differential: ${direction} Shift-selection crosses a source seam`, async ({
    mount,
    page,
  }) => {
    await mount(Harness);
    await expect(page.getByTestId('bounded').locator('.tiptap')).toContainText('Region 0001');
    const edge = await seam(page);
    for (const side of ['native', 'bounded']) {
      await select(page, side, direction === 'forward' ? edge - 3 : edge + 3);
      for (let n = 0; n < 7; n++)
        await page.keyboard.press(direction === 'forward' ? 'Shift+ArrowRight' : 'Shift+ArrowLeft');
    }
    await same(page);
  });

for (const key of ['Backspace', 'Delete', 'Enter'])
  test(`native differential: ${key}, undo and redo at the seam`, async ({ mount, page }) => {
    await mount(Harness);
    await expect(page.getByTestId('bounded').locator('.tiptap')).toContainText('Region 0001');
    const edge = await seam(page);
    for (const side of ['native', 'bounded']) {
      await select(page, side, key === 'Backspace' ? edge + 1 : edge - 1);
      await page.keyboard.press(key);
    }
    await same(page);
    for (const side of ['native', 'bounded']) {
      await page.getByTestId(side).locator('.tiptap').focus();
      await page.keyboard.press('Control+z');
    }
    await same(page);
    for (const side of ['native', 'bounded']) {
      await page.getByTestId(side).locator('.tiptap').focus();
      await page.keyboard.press('Control+Shift+z');
    }
    await same(page);
  });

test('native differential: typing and bold undo grouping and selection restoration', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  await expect(page.getByTestId('bounded').locator('.tiptap')).toContainText('Region 0001');
  for (const side of ['native', 'bounded']) {
    await select(page, side, 1);
    await page.keyboard.type('hello');
    await page.keyboard.press('Shift+Home');
    await expect
      .poll(async () => (await state(page, side)).selection)
      .toEqual({ type: 'text', anchor: 6, head: 1 });
    await page.keyboard.press('Control+b');
  }
  await same(page);
  for (let n = 0; n < 2; n++) {
    for (const side of ['native', 'bounded']) {
      await page.getByTestId(side).locator('.tiptap').focus();
      await page.keyboard.press('Control+z');
    }
    await same(page);
  }
  for (let n = 0; n < 2; n++) {
    for (const side of ['native', 'bounded']) {
      await page.getByTestId(side).locator('.tiptap').focus();
      await page.keyboard.press('Control+Shift+z');
    }
    await same(page);
  }
});

test('native differential: clipboard paste and cut across the seam', async ({
  mount,
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await mount(Harness);
  await expect(page.getByTestId('bounded').locator('.tiptap')).toContainText('Region 0001');
  const edge = await seam(page);
  const copied: string[] = [],
    cut: string[] = [];
  for (const side of ['native', 'bounded']) {
    await select(page, side, edge - 4, edge + 5);
    await page.keyboard.press('Control+c');
    copied.push(await page.evaluate(() => navigator.clipboard.readText()));
    await page.keyboard.press('Control+x');
    cut.push(await page.evaluate(() => navigator.clipboard.readText()));
  }
  expect(copied[0].length).toBeGreaterThan(0);
  expect(copied[1]).toBe(copied[0]);
  expect(cut[1]).toBe(cut[0]);
  await same(page);
  await page
    .getByTestId('bounded')
    .getByTestId('proof')
    .evaluate((el) => (el as Host).proof.show(0, true));
  await same(page);
  for (const side of ['native', 'bounded']) {
    await page.evaluate(() => navigator.clipboard.writeText('paste 🌍\n\nsecond'));
    await page.getByTestId(side).locator('.tiptap').focus();
    await page.keyboard.press('Control+v');
    await expect(page.getByTestId(side).locator('.tiptap')).toContainText('paste 🌍');
  }
  await same(page);
  for (const side of ['native', 'bounded']) {
    await page.getByTestId(side).locator('.tiptap').focus();
    await page.keyboard.press('Control+z');
  }
  await same(page);
});

test('native differential: real pointer drag across the seam preserves direction', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  await expect(page.getByTestId('bounded').locator('.tiptap')).toContainText('Region 0001');
  for (const side of ['native', 'bounded']) {
    const points = await page
      .getByTestId(side)
      .locator('.tiptap')
      .evaluate((el) => {
        const paragraphs = el.querySelectorAll('p');
        return [paragraphs[0], paragraphs[1]].map((p) => {
          const text = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode()!;
          const range = document.createRange();
          range.setStart(text, 4);
          range.setEnd(text, 5);
          const r = range.getBoundingClientRect();
          return { x: r.left + 1, y: r.top + r.height / 2 };
        });
      });
    await page.mouse.move(points[1].x, points[1].y);
    await page.mouse.down();
    await page.mouse.move(points[0].x, points[0].y, { steps: 10 });
    await page.mouse.up();
  }
  await same(page);
});

test('native differential: Chromium composition grouping and restored selection', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  await expect(page.getByTestId('bounded').locator('.tiptap')).toContainText('Region 0001');
  const cdp = await page.context().newCDPSession(page);
  for (const side of ['native', 'bounded']) {
    await select(page, side, 1);
    await cdp.send('Input.imeSetComposition', { text: '日本', selectionStart: 2, selectionEnd: 2 });
    await cdp.send('Input.insertText', { text: '日本語' });
    await expect(page.getByTestId(side).locator('.tiptap')).toContainText('日本語');
  }
  await same(page);
  for (const side of ['native', 'bounded']) {
    await page.getByTestId(side).locator('.tiptap').focus();
    await page.keyboard.press('Control+z');
  }
  await same(page);
  for (const side of ['native', 'bounded']) {
    await page.getByTestId(side).locator('.tiptap').focus();
    await page.keyboard.press('Control+Shift+z');
  }
  await same(page);
  await cdp.detach();
});
