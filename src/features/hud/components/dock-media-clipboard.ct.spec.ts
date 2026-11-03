/**
 * Copy, cut and paste of dock composer media, end to end through the real dock
 * conversation, composer, controller and saga (wire fixtures, synthetic native
 * capture). Main's clipboard is replaced at its IPC boundary by
 * `DockMediaClipboardHarness`, so this proves the renderer flow: which tile is
 * copied with what, that cut removes only after a successful write, that a paste of
 * Intent media recreates it with fresh ids while any other paste reaches the
 * editor's own path, and that text copy/paste is never intercepted. The pastes
 * here are synthetic events: they do not prove the native macOS pasteboard
 * (see dock-media-clipboard.test.ts for main's side).
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../../test/ct-test';
import Harness from './__tests__/DockMediaClipboardHarness.svelte';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=';
type Write = { kind: string; name: string; bytes: number; marks: number };
const writes = async (harness: Locator) =>
  JSON.parse((await harness.getAttribute('data-writes')) ?? '[]') as Write[];
const reads = async (harness: Locator) => Number(await harness.getAttribute('data-reads'));
const screenshots = (page: Page) => page.locator('.tile[data-kind="image"] .open-tile');

/** A paste event as the OS would deliver it: an image file, and optionally text. */
async function paste(page: Page, text?: string, withFile = true) {
  await page.locator('[data-testid="message-input"] [contenteditable]').evaluate(
    (element, { png, text, withFile }) => {
      const transfer = new DataTransfer();
      if (withFile) {
        const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
        transfer.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
      }
      if (text) transfer.setData('text/plain', text);
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    },
    { png: PNG, text, withFile },
  );
}

test('copy, cut and paste screenshots through the dock composer', async ({ mount, page }, info) => {
  await page.setViewportSize({ width: 420, height: 700 });
  const harness = await mount(Harness);
  const editor = page.locator('[data-testid="message-input"] [contenteditable]');
  await expect(editor).toHaveAttribute('contenteditable', 'true');

  // A screenshot from the composer.
  await page.getByRole('button', { name: /^Capture the screen/ }).click();
  await expect(screenshots(page)).toHaveCount(1);

  // Text shortcuts stay text shortcuts: selecting and copying in the field writes nothing.
  await editor.fill('Keep this caption');
  await editor.press('ControlOrMeta+a');
  await editor.press('ControlOrMeta+c');
  expect(await writes(harness)).toEqual([]);

  // Copy from the focused tile: the screenshot as shown, editable (0 marks here).
  await screenshots(page).first().focus();
  await page.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => writes(harness)).toHaveLength(1);
  expect((await writes(harness))[0]).toMatchObject({ kind: 'image', marks: 0 });
  expect((await writes(harness))[0]!.bytes).toBeGreaterThan(0);

  // Paste it back: Intent media becomes a new screenshot (fresh ids), the text stays.
  await paste(page);
  await expect(screenshots(page)).toHaveCount(2);
  const ids = await page
    .locator('.tile[data-kind="image"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-attachment-id')));
  expect(new Set(ids).size).toBe(2);
  await expect(editor).toContainText('Keep this caption');

  // Another app's image is not Intent media: the editor's own paste attaches it.
  await page.getByRole('button', { name: 'Another app copies' }).click();
  const readsBefore = await reads(harness);
  await paste(page);
  await expect.poll(() => reads(harness)).toBe(readsBefore + 1);
  await expect(page.locator('[data-kind="file"][data-attachment-id]')).toHaveCount(1);
  await expect(screenshots(page)).toHaveCount(2);

  // A text-only paste is never held: no clipboard read, the text lands as typed.
  await editor.click();
  await editor.press('End');
  const readsForText = await reads(harness);
  await paste(page, ' and more', false);
  expect(await reads(harness)).toBe(readsForText);

  // Cut with a failing clipboard keeps the tile and says so inline.
  await page.getByRole('button', { name: 'Toggle clipboard failure' }).click();
  await screenshots(page).first().focus();
  await page.keyboard.press('ControlOrMeta+x');
  await expect(page.locator('[data-dock-notice]')).toContainText('Couldn’t copy to the clipboard');
  await expect(screenshots(page)).toHaveCount(2);
  await page.screenshot({ path: info.outputPath('media-clipboard-cut-failed.png') });

  // With the clipboard back, cut copies first, then removes the tile.
  await page.getByRole('button', { name: 'Toggle clipboard failure' }).click();
  const count = (await writes(harness)).length;
  await screenshots(page).first().focus();
  await page.keyboard.press('ControlOrMeta+x');
  await expect.poll(async () => (await writes(harness)).length).toBe(count + 1);
  await expect(screenshots(page)).toHaveCount(1);

  // Right-click: the Copy/Cut menu (Copy, then Cut).
  await screenshots(page).first().click({ button: 'right' });
  await expect.poll(async () => (await writes(harness)).length).toBe(count + 2);
  await expect(screenshots(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Menu chooses Cut' }).click();
  await screenshots(page).first().click({ button: 'right' });
  await expect(screenshots(page)).toHaveCount(0);
  expect(await writes(harness)).toHaveLength(count + 3);
  await page.screenshot({ path: info.outputPath('media-clipboard-final.png') });
});
