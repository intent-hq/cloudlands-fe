import { test, expect } from '../../../../../test/ct-test';
import type { Page } from '@playwright/test';
import Harness from './EditingProofHarness.svelte';

const snapshot = async (page: Page) => JSON.parse(await page.getByTestId('snapshot').innerText());
async function seek(page: Page, index: number) {
  await page.getByTestId('scroll').evaluate((element, i) => {
    element.scrollTop = i * 2400;
  }, index);
  await expect.poll(async () => (await snapshot(page)).active).toBe(index);
}

test('real typing, formatting, nested lists and tables only mount and parse a bounded region', async ({
  mount,
  page,
}, info) => {
  await mount(Harness);
  const editor = page.locator('.tiptap');
  await expect(editor).toContainText('Nested child');
  await expect(editor.locator('table')).toHaveCount(1);
  await expect(editor.locator('ul ul')).toHaveCount(1);
  const first = await snapshot(page);
  expect(first.calls.map((c: { method: string }) => c.method)).toEqual([
    'read',
    'read',
    'annotations',
  ]);
  expect(first.maxParsedBytes).toBeLessThan(8192);
  await editor.locator('p').first().click();
  await page.keyboard.press('Home');
  await page.keyboard.type('Typed ');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('bold');
  await page.keyboard.press('Control+b');
  await expect(editor.locator('strong')).toHaveText('bold');
  await editor.locator('td').first().click();
  await page.keyboard.type(' table edit');
  await expect(editor.locator('td').first()).toContainText('table edit');
  await editor.locator('ul ul p').click();
  await page.keyboard.type(' nested edit');
  await expect(editor.locator('ul ul')).toContainText('nested edit');
  await editor.locator('p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' long edit');
  await expect(editor.locator('p').last()).toContainText('long edit');
  const after = await snapshot(page);
  expect(after.calls).toEqual(first.calls);
  expect(after.parsedBytes).toBe(first.parsedBytes);
  expect(after.serializedBytes).toBe(0);
  const originalAnchor = first.annotations.find((a: { id: string }) => a.id === 'thread-0');
  const shiftedAnchor = after.annotations.find((a: { id: string }) => a.id === 'thread-0');
  expect(shiftedAnchor.from).toBe(originalAnchor.from + 10);
  expect(shiftedAnchor.text).toBe(originalAnchor.text);
  expect(await editor.locator('*').count()).toBeLessThan(128);
  await seek(page, 9999);
  await expect(page.locator('.tiptap')).toHaveCount(1);
  expect((await snapshot(page)).retained).toBe(2);
  await info.attach('bounded-work.json', {
    body: JSON.stringify(
      {
        initial: first,
        afterTyping: after,
        afterSeek: await snapshot(page),
        mountedElements: await editor.locator('*').count(),
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  await page.screenshot({ path: info.outputPath('bounded-editor.png') });
});

test('native cross-page selection/delete maps annotation positions and undo survives remount', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  const editor = page.locator('.tiptap');
  await expect(editor).toContainText('Page two boundary.');
  const before = await snapshot(page);
  expect(before.annotations[0].text).toBe('Page one boundary.\nPage two boundary.');
  // Browser selection spans the transport page boundary, within one PM document.
  await editor.evaluate((element) => {
    const paragraphs = element.querySelectorAll('p');
    const selection = window.getSelection()!;
    const text = (p: Element) => {
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      return walker.nextNode()!;
    };
    selection.setBaseAndExtent(text(paragraphs[1]), 5, text(paragraphs[2]), 8);
  });
  await page.keyboard.press('Backspace');
  await expect(editor).toContainText('Page  boundary.');
  await page.keyboard.type('Joined');
  await expect(editor).toContainText('Page Joined boundary.');
  const edited = await snapshot(page);
  expect(edited.annotations.find((a: { id: string }) => a.id === 'thread-0').text).toBe(
    'Page Joined boundary.',
  );
  await seek(page, 7000);
  await expect(editor).toContainText('Region 7000');
  await seek(page, 0);
  await expect(editor).toBeFocused();
  expect((await snapshot(page)).selection).toEqual(edited.selection);
  await expect(editor).toContainText('Page Joined boundary.');
  await page.keyboard.press('Control+z');
  // Native history may group delete+typing. Undo until the original span returns.
  if (!(await editor.innerText()).includes('Page two boundary.'))
    await page.keyboard.press('Control+z');
  await expect(editor).toContainText('Page one boundary.');
  await expect(editor).toContainText('Page two boundary.');
  expect((await snapshot(page)).parsedBytes).toBeLessThan(8192);
  await page.keyboard.press('Control+Shift+z');
  await expect(editor).not.toContainText('Page two boundary.');
});

test('Chromium IME composition pins the view; committed text and dirty draft survive scrolling and failed save', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  const editor = page.locator('.tiptap');
  await expect(editor).toContainText('Region 0');
  await editor.locator('p').first().click();
  await page.keyboard.press('Home');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: '日本', selectionStart: 2, selectionEnd: 2 });
  await expect(editor).toContainText('日本');
  await page.getByTestId('scroll').evaluate((element) => {
    element.scrollTop = 2400;
  });
  await expect.poll(async () => (await snapshot(page)).error).toContain('Composition pins');
  expect((await snapshot(page)).active).toBe(0);
  await cdp.send('Input.insertText', { text: '日本語' });
  await expect(editor).toContainText('日本語');
  await seek(page, 1);
  await seek(page, 0);
  await expect(editor).toContainText('日本語');
  await page.getByTestId('proof').dispatchEvent('proof-offline');
  await page.getByTestId('proof').dispatchEvent('proof-save');
  expect((await snapshot(page)).dirty).toContain(0);
  expect((await snapshot(page)).error).toContain('Offline');
  await page.getByTestId('proof').dispatchEvent('proof-save');
  expect((await snapshot(page)).dirty).not.toContain(0);
  expect(
    (await snapshot(page)).calls.filter((c: { method: string }) => c.method === 'write'),
  ).toHaveLength(1);
  await cdp.detach();
});

test('bounded retention refuses a fifth region without dropping dirty history', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  const editor = page.locator('.tiptap');
  await expect(editor).toContainText('Region 0');
  await page.keyboard.type('Keep draft ');
  for (const id of [1, 2, 3]) await seek(page, id);
  await page.getByTestId('scroll').evaluate((element) => {
    element.scrollTop = 4 * 2400;
  });
  await expect.poll(async () => (await snapshot(page)).error).toContain('capacity');
  expect((await snapshot(page)).retained).toBe(4);
  await seek(page, 0);
  await expect(editor).toContainText('Keep draft');
  await page.keyboard.press('Control+z');
  await expect(editor).not.toContainText('Keep draft');
});

test('records the region-edge navigation and select-all limitation of the minimal integration', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  const editor = page.locator('.tiptap');
  await expect(editor).toContainText('Region 0');
  await page.keyboard.press('Control+End');
  await page.keyboard.press('ArrowDown');
  expect((await snapshot(page)).active).toBe(0);
  await page.keyboard.press('Control+a');
  const selected = await page.evaluate(() => window.getSelection()?.toString());
  expect(selected).toContain('Region 0');
  expect(selected).not.toContain('Region 1');
  // Evidence of a missing document-wide selection layer, NOT accepted product semantics.
  expect((await snapshot(page)).calls).toHaveLength(3);
});
