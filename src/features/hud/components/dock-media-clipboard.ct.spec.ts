/**
 * Copy, cut and paste of dock composer media, end to end through the real dock
 * conversation, composer, controller and sagas (wire fixtures, synthetic native
 * capture and recording). Main's clipboard and its `workspace-file://` protocol are
 * replaced at their boundaries by `DockMediaClipboardHarness`, so this proves the
 * renderer flow: which tile is copied with what; that cut removes only after a
 * complete, successful write (a failed or short recording download keeps it); that
 * a paste of Intent media recreates it with fresh ids only for the event's own
 * file and only in the draft and connection it was made in; that any other paste
 * reaches the editor's own path; and that text copy/paste is never intercepted.
 * The pastes here are synthetic events: they do not prove the native macOS
 * pasteboard (see dock-media-clipboard.test.ts for main's side).
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../../../test/ct-test';
import Harness from './__tests__/DockMediaClipboardHarness.svelte';

const FOREIGN_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=';
type Write = { kind: string; name: string; bytes: number; marks: number };
type Clipboard = {
  writes(): Write[];
  reads(): number;
  answered(): number;
  lastBytes(): string | null;
  foreign(): void;
  replace(): void;
  setFailWrites(value: boolean): void;
  setMenu(value: 'copy' | 'cut' | null): void;
  setMovie(value: 'ok' | 'missing' | 'short'): void;
  holdReads(value: boolean): void;
  reconnect(): void;
};
type ComposerE2E = { close(): void; reopen(): void };

const clipboard = <K extends keyof Clipboard>(
  page: Page,
  method: K,
  ...arg: Parameters<Clipboard[K]>
): Promise<ReturnType<Clipboard[K]>> =>
  page.evaluate(
    ([name, value]) =>
      (
        (window as unknown as { __dockMediaClipboard: Record<string, (v?: unknown) => unknown> })
          .__dockMediaClipboard[name] as (v?: unknown) => never
      )(value),
    [method, arg[0]] as const,
  );
const writes = (page: Page) => clipboard(page, 'writes');
const reads = (page: Page) => clipboard(page, 'reads');
const composer = (page: Page, action: 'close' | 'reopen') =>
  page.evaluate(
    (name) => (window as unknown as { __dockComposerE2E: ComposerE2E }).__dockComposerE2E[name](),
    action,
  );
const editor = (page: Page) => page.locator('[data-testid="message-input"] [contenteditable]');
const screenshots = (page: Page) => page.locator('.tile[data-kind="image"] .open-tile');
const recordings = (page: Page) => page.locator('.tile[data-kind="clip"] .open-tile');
const files = (page: Page) => page.locator('[data-kind="file"][data-attachment-id]');

/**
 * A paste event as the OS would deliver it. `own` carries back the file the last
 * copy gave the clipboard (an Intent paste); otherwise another app's PNG.
 */
async function paste(
  page: Page,
  {
    own = false,
    text,
    file = true,
    extra = false,
    name = 'pasted.png',
  }: { own?: boolean; text?: string; file?: boolean; extra?: boolean; name?: string } = {},
) {
  const base64 = !file ? null : own ? await clipboard(page, 'lastBytes') : FOREIGN_PNG;
  await editor(page).evaluate(
    (element, { base64, text, extra, foreign, name }) => {
      const transfer = new DataTransfer();
      const png = (data: string) => Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      if (base64) transfer.items.add(new File([png(base64)], name, { type: 'image/png' }));
      // A second file in the same paste (another app's image alongside).
      if (extra) transfer.items.add(new File([png(foreign)], 'other.png', { type: 'image/png' }));
      if (text) transfer.setData('text/plain', text);
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    },
    { base64, text, extra, foreign: FOREIGN_PNG, name },
  );
}

async function capture(page: Page) {
  const before = await screenshots(page).count();
  await page.getByRole('button', { name: /^Capture the screen/ }).click();
  await expect(screenshots(page)).toHaveCount(before + 1);
}

test('copy, cut and paste screenshots through the dock composer', async ({ mount, page }, info) => {
  await mount(Harness);
  await expect(editor(page)).toHaveAttribute('contenteditable', 'true');
  await capture(page);

  // Text shortcuts stay text shortcuts: selecting and copying in the field writes nothing.
  await editor(page).fill('Keep this caption');
  await editor(page).press('ControlOrMeta+a');
  await editor(page).press('ControlOrMeta+c');
  expect(await writes(page)).toEqual([]);

  // Copy from the focused tile: the screenshot as shown, editable (0 marks here).
  await screenshots(page).first().focus();
  await page.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => writes(page)).toHaveLength(1);
  expect((await writes(page))[0]).toMatchObject({ kind: 'image', marks: 0 });
  expect((await writes(page))[0]!.bytes).toBeGreaterThan(0);

  // Paste it back: Intent media becomes a new screenshot (fresh ids), the text stays.
  await paste(page, { own: true });
  await expect(screenshots(page)).toHaveCount(2);
  const ids = await page
    .locator('.tile[data-kind="image"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-attachment-id')));
  expect(new Set(ids).size).toBe(2);
  await expect(editor(page)).toContainText('Keep this caption');

  // Another app's image is not Intent media: the editor's own paste attaches it.
  await clipboard(page, 'foreign');
  const readsBefore = await reads(page);
  await paste(page);
  await expect.poll(() => reads(page)).toBe(readsBefore + 1);
  await expect(files(page)).toHaveCount(1);
  await expect(screenshots(page)).toHaveCount(2);

  // A text-only paste is never held: no clipboard read.
  const readsForText = await reads(page);
  await paste(page, { text: ' and more', file: false });
  expect(await reads(page)).toBe(readsForText);

  // Cut with a failing clipboard keeps the tile and says so inline.
  await clipboard(page, 'setFailWrites', true);
  await screenshots(page).first().focus();
  await page.keyboard.press('ControlOrMeta+x');
  await expect(page.locator('[data-dock-notice]')).toContainText('Couldn’t copy to the clipboard');
  await expect(screenshots(page)).toHaveCount(2);
  await page.screenshot({ path: info.outputPath('media-clipboard-cut-failed.png') });

  // With the clipboard back, cut copies first, then removes the tile.
  await clipboard(page, 'setFailWrites', false);
  const count = (await writes(page)).length;
  await screenshots(page).first().focus();
  await page.keyboard.press('ControlOrMeta+x');
  await expect.poll(async () => (await writes(page)).length).toBe(count + 1);
  await expect(screenshots(page)).toHaveCount(1);

  // Right-click: the Copy/Cut menu (Copy, then Cut).
  await screenshots(page).first().click({ button: 'right' });
  await expect.poll(async () => (await writes(page)).length).toBe(count + 2);
  await expect(screenshots(page)).toHaveCount(1);
  await clipboard(page, 'setMenu', 'cut');
  await screenshots(page).first().click({ button: 'right' });
  await expect(screenshots(page)).toHaveCount(0);
  expect(await writes(page)).toHaveLength(count + 3);
  await page.screenshot({ path: info.outputPath('media-clipboard-final.png') });
});

test('a recording is copied only from its complete file; a failed download keeps it on cut', async ({
  mount,
  page,
}, info) => {
  await mount(Harness);
  await expect(editor(page)).toHaveAttribute('contenteditable', 'true');
  await page.getByRole('button', { name: /^Record the screen/ }).click();
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(recordings(page)).toHaveCount(1);
  await expect(recordings(page).first()).toBeEnabled();

  // The file is missing (404 with a body) or arrives short: nothing is written, cut keeps it.
  for (const movie of ['missing', 'short'] as const) {
    await clipboard(page, 'setMovie', movie);
    await recordings(page).first().focus();
    await page.keyboard.press('ControlOrMeta+x');
    await expect(page.locator('[data-dock-notice]')).toContainText(
      'Couldn’t copy to the clipboard',
    );
    await expect(recordings(page)).toHaveCount(1);
    expect(await writes(page)).toEqual([]);
  }
  await page.screenshot({ path: info.outputPath('media-clipboard-recording-kept.png') });

  // The complete movie file: copy writes it, cut then removes the tile.
  await clipboard(page, 'setMovie', 'ok');
  await recordings(page).first().focus();
  await page.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => writes(page)).toHaveLength(1);
  expect((await writes(page))[0]).toMatchObject({ kind: 'clip', bytes: 16 });
  await recordings(page).first().focus();
  await page.keyboard.press('ControlOrMeta+x');
  await expect(recordings(page)).toHaveCount(0);
  expect(await writes(page)).toHaveLength(2);
});

test('a slow paste lands only in its own draft and connection, and only for its own file', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  await expect(editor(page)).toHaveAttribute('contenteditable', 'true');
  await capture(page);
  await screenshots(page).first().focus();
  await page.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => writes(page)).toHaveLength(1);

  // The conversation closes and reopens while the read is pending: nothing lands.
  await clipboard(page, 'holdReads', true);
  await paste(page, { own: true });
  await expect.poll(() => reads(page)).toBe(1);
  await composer(page, 'close');
  await composer(page, 'reopen');
  await expect(editor(page)).toHaveAttribute('contenteditable', 'true');
  await clipboard(page, 'holdReads', false);
  await expect.poll(() => clipboard(page, 'answered')).toBe(1);
  await settled(page, 'control-1.png');

  // The connection changes while the read is pending: nothing lands.
  await clipboard(page, 'holdReads', true);
  await paste(page, { own: true });
  await expect.poll(() => reads(page)).toBe(3);
  await clipboard(page, 'reconnect');
  const attachments = page.locator('[role="group"][aria-label="Attachments"] img');
  const before = await attachments.count();
  await clipboard(page, 'holdReads', false);
  // The conversation now asks to reconnect (no composer to paste a control into):
  // wait until main has answered, drain the page's pending tasks, then check.
  await expect.poll(() => clipboard(page, 'answered')).toBe(3);
  await page.evaluate(async () => {
    for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await expect(page.getByRole('img', { name: 'pasted.png', exact: true })).toHaveCount(0);
  await expect(attachments).toHaveCount(before);
});

/**
 * After a stale paste is released: a later ordinary paste (another app's image)
 * must arrive, proving the pipeline ran, while the stale paste left nothing, neither
 * a recreated screenshot nor its own file through the editor's paste.
 */
async function settled(page: Page, control: string) {
  await paste(page, { name: control });
  await expect(page.getByRole('img', { name: control, exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'pasted.png', exact: true })).toHaveCount(0);
  await expect(screenshots(page)).toHaveCount(1);
}

test('a paste is Intent media only for its own single file: a same-name, same-size copy or extra files are not', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  await expect(editor(page)).toHaveAttribute('contenteditable', 'true');
  await capture(page);
  await screenshots(page).first().focus();
  await page.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => writes(page)).toHaveLength(1);

  // Event A carries the copied file; by the time main is asked, B is on the clipboard.
  await clipboard(page, 'holdReads', true);
  await paste(page, { own: true });
  await expect.poll(() => reads(page)).toBe(1);
  await clipboard(page, 'replace');
  await clipboard(page, 'holdReads', false);
  // B has A's name and size but other bytes: A's own file goes the editor's ordinary
  // way; B is not recreated as a screenshot.
  await expect(files(page)).toHaveCount(1);
  await expect(screenshots(page)).toHaveCount(1);

  // Unchanged, the same paste is recognised as Intent media.
  await clipboard(page, 'holdReads', false);
  const before = (await writes(page)).length;
  await screenshots(page).first().focus();
  await page.keyboard.press('ControlOrMeta+c');
  await expect.poll(async () => (await writes(page)).length).toBe(before + 1);
  await paste(page, { own: true });
  await expect(screenshots(page)).toHaveCount(2);

  // The copied file with another file in the same paste is not one Intent copy: both
  // files reach the editor's own paste, nothing is recreated from the clipboard.
  const filesBefore = await files(page).count();
  await paste(page, { own: true, extra: true });
  await expect(files(page)).toHaveCount(filesBefore + 2);
  await expect(screenshots(page)).toHaveCount(2);
});
