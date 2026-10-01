import { test, expect } from '../../../../../test/ct-test';
import type { Page } from '@playwright/test';
import Harness from './DocumentProofHarness.svelte';

const snapshot = async (page: Page) => JSON.parse(await page.getByTestId('snapshot').innerText());
async function seek(page: Page, id: number) {
  await page.getByTestId('scroll').evaluate((el, n) => {
    el.scrollTop = n * 2400;
  }, id);
  await expect.poll(async () => (await snapshot(page)).active).toBe(id);
}

test('regression: clean fifth region remains traversable', async ({ mount, page }) => {
  await mount(Harness);
  await expect(page.locator('.tiptap')).toContainText('Region 0000');
  for (let id = 1; id <= 20; id++) await seek(page, id);
  await seek(page, 0);
});

test('regression: save after 65 inserts does not prevent undo', async ({ mount, page }) => {
  await mount(Harness);
  const editor = page.locator('.tiptap');
  await expect(editor).toContainText('Region 0000');
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('x'.repeat(65));
  await page.getByTestId('proof').dispatchEvent('proof-save');
  await page.keyboard.press('Control+z');
  await expect(editor).not.toContainText('xxx');
});

test('regression: undo follows A then B chronology from another view', async ({ mount, page }) => {
  await mount(Harness);
  const editor = page.locator('.tiptap');
  await expect(editor).toContainText('Region 0000');
  await page.keyboard.type('AAA');
  await seek(page, 9999);
  await page.keyboard.type('BBB');
  await seek(page, 0);
  await page.keyboard.press('Control+z');
  await seek(page, 9999);
  await expect(editor).not.toContainText('BBB');
  await seek(page, 0);
  await expect(editor).toContainText('AAA');
});

test('regression: deleting then undoing an anchor restores its decoration', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  const editor = page.locator('.tiptap');
  await expect(editor.locator('[data-proof-comment]')).not.toHaveCount(0);
  await editor.evaluate((el) => {
    const marks = el.querySelectorAll('[data-proof-comment]');
    const first = marks[0].firstChild!;
    const last = marks[marks.length - 1].lastChild!;
    window.getSelection()!.setBaseAndExtent(first, 0, last, last.textContent!.length);
  });
  await page.keyboard.press('Backspace');
  await expect(editor.locator('[data-proof-comment]')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(editor.locator('[data-proof-comment]')).not.toHaveCount(0);
});

test('document endpoints, eviction counters and distant chronological redo stay bounded', async ({
  mount,
  page,
}, info) => {
  await mount(Harness);
  const editor = page.locator('.tiptap');
  await expect(editor).toContainText('Region 0000');
  await page.keyboard.type('AAA');
  await seek(page, 9999);
  await page.keyboard.type('BBB');
  const editedB = await snapshot(page);
  for (let id = 1; id <= 20; id++) await seek(page, id);
  const before = await snapshot(page);
  expect(before.created - before.destroyed).toBe(1);
  expect(before.destroyed).toBeGreaterThanOrEqual(20);
  expect(before.cachePages).toBeLessThanOrEqual(4);
  expect(before.cacheBytes).toBeLessThanOrEqual(16384);
  expect(before.activeBytes).toBeLessThanOrEqual(16384);
  expect(before.pmNodes).toBeLessThanOrEqual(256);
  await page.keyboard.press('Control+z');
  await expect(editor).not.toContainText('BBB');
  await page.keyboard.press('Control+z');
  await expect(editor).not.toContainText('AAA');
  await page.keyboard.press('Control+Shift+z');
  expect(
    await page
      .getByTestId('proof')
      .evaluate((el) =>
        (
          el as HTMLElement & { proof: import('./document-session').DocumentSession }
        ).proof.service.region(0),
      ),
  ).toContain('AAA');
  await page.keyboard.press('Control+Shift+z');
  await expect(editor).toContainText('BBB');
  const current = await snapshot(page);
  expect(current.selection).toMatchObject({
    anchor: editedB.selection.anchor,
    head: editedB.selection.head,
    affinity: editedB.selection.affinity,
  });
  await page.keyboard.press('Control+a');
  const all = await snapshot(page);
  expect(all.selection.anchor).toBe(0);
  expect(all.selection.head).toBeGreaterThan(500000);
  expect(all.reads).toBe(current.reads);
  expect(all.mounted).toBe(1);
  await page.keyboard.press('Shift+ArrowLeft');
  const adjusted = await snapshot(page);
  expect(adjusted.selection.anchor).toBe(0);
  expect(adjusted.selection.head).toBe(all.selection.head - 1);
  expect(adjusted.reads).toBe(all.reads);
  await info.attach('document-bounds.json', {
    body: JSON.stringify({ before, current, all }, null, 2),
    contentType: 'application/json',
  });
  await page.screenshot({ path: info.outputPath('document-proof.png') });
});

test('composition pins a view while an earlier boundary fetch is delayed, then survives eviction and history', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  const editor = page.locator('.tiptap');
  await expect(editor).toContainText('Region 0000');
  await page.keyboard.press('Control+Home');
  await page.getByTestId('proof').evaluate((el) => {
    const h = el as HTMLElement & {
      proof: import('./document-session').DocumentSession;
      release: () => void;
      pending: Promise<boolean>;
    };
    h.proof.delayFetch = () =>
      new Promise<void>((resolve) => {
        h.release = resolve;
      });
    h.pending = h.proof.show(1);
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: '日本', selectionStart: 2, selectionEnd: 2 });
  await expect(editor).toContainText('日本');
  const aborted = await page.getByTestId('proof').evaluate(async (el) => {
    const h = el as HTMLElement & {
      proof: import('./document-session').DocumentSession;
      release: () => void;
      pending: Promise<boolean>;
    };
    h.release();
    h.proof.delayFetch = undefined;
    return h.pending;
  });
  expect(aborted).toBe(false);
  expect((await snapshot(page)).active).toBe(0);
  await cdp.send('Input.insertText', { text: '日本語' });
  await expect(editor).toContainText('日本語');
  await seek(page, 20);
  await page.keyboard.press('Control+z');
  await expect(editor).not.toContainText('日本');
  await page.keyboard.press('Control+Shift+z');
  await expect(editor).toContainText('日本語');
  await cdp.detach();
});

test('earlier remote splice remaps a draft and history; overlap retains both', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  await expect(page.locator('.tiptap')).toContainText('Region 0000');
  await seek(page, 9999);
  await page.keyboard.type('draft');
  const result = await page.getByTestId('proof').evaluate((el) => {
    const p = (el as HTMLElement & { proof: import('./document-session').DocumentSession }).proof;
    const before = { ...p.selection };
    p.remote({ from: 0, to: 0, insert: 'Earlier ' });
    const after = { ...p.selection };
    let conflict = '';
    try {
      p.remote({ from: after.head - 4, to: after.head, insert: 'collision' });
    } catch (e) {
      conflict = String(e);
    }
    return { before, after, conflict, dirty: p.service.dirty, depth: p.service.depth };
  });
  expect(result.after.head).toBe(result.before.head + 8);
  expect(result.conflict).toContain('Conflict');
  expect(result.dirty).toContain(9999);
  expect(result.depth).toBe(1);
  await page.keyboard.type('next');
  expect((await snapshot(page)).source).toContain('draftnextRegion 9999');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.tiptap')).not.toContainText('draft');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.tiptap')).toContainText('draft');
});

test('accepted appended transactions share the root history event and exact source', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  await expect(page.locator('.tiptap')).toContainText('Region 0000');
  await page
    .getByTestId('proof')
    .evaluate((el) => (el as HTMLElement & { appendProbe: () => void }).appendProbe());
  const result = await snapshot(page);
  expect(result.source.startsWith('RAPPENDEDOOTRegion')).toBe(true);
  expect(result.acceptedRoots).toBe(1);
  expect(result.acceptedAppended).toBe(1);
  expect(result.journalEvents).toBe(1);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.tiptap')).not.toContainText('ROOT');
  await expect(page.locator('.tiptap')).not.toContainText('APPENDED');
});

test('returning after a paragraph split reloads the same source caret and screen anchor', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  const editor = page.locator('.tiptap');
  await expect(editor).toContainText('Region 0000');
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('height');
  await page.keyboard.press('Enter');
  const before = await snapshot(page);
  const caret = () =>
    page.evaluate(() => {
      const selection = window.getSelection()!;
      const range = selection.getRangeAt(0);
      const r = range.getBoundingClientRect();
      const host = document.querySelector('[data-testid="editor-host"]')!.getBoundingClientRect();
      return { top: Math.round(r.top - host.top), left: Math.round(r.left - host.left) };
    });
  const position = await caret();
  await seek(page, 20);
  await seek(page, 0);
  expect((await snapshot(page)).selection).toEqual(before.selection);
  expect(await caret()).toEqual(position);
  expect((await snapshot(page)).source).toBe(before.source);
});
