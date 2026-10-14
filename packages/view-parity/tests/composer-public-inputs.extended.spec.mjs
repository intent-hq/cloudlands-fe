import { copyFile } from 'node:fs/promises';
import { test, expect, openFixture } from '../lib/functional.mjs';

test('composer limit: native chooser retains existing files, admits replacements, and restores the bounded queue', async ({
  page,
}, info) => {
  // Independent public fixture contract: maxFiles=2, initially empty, with
  // ordinary onFilesChange/onSend callbacks. Use actual local PNG files.
  const names = ['existing.png', 'next.png', 'overflow.png'];
  const paths = await Promise.all(
    names.map(async (name) => {
      const path = info.outputPath(name);
      await copyFile(new URL('../../../static/favicon.png', import.meta.url), path);
      return path;
    }),
  );
  const sockets = [];
  page.on('websocket', (socket) => sockets.push(socket.url()));
  const fixture = await openFixture(page, 'message-composer', 'max-files');
  const field = fixture.getByRole('textbox');
  const tiles = fixture.getByRole('button', { name: /^Remove / });
  const payload = fixture.locator('[data-composer-sends]');
  const input = fixture.locator('input[type="file"]');
  const choose = async (files) => {
    const pending = page.waitForEvent('filechooser');
    await fixture.getByRole('button', { name: 'Attach files', exact: true }).click();
    const chooser = await pending;
    expect(chooser.isMultiple()).toBe(true);
    await chooser.setFiles(files);
    await expect(input).toHaveValue('');
  };
  const expectFileNames = async (labels) => {
    await expect(tiles).toHaveCount(labels.length);
    for (const [index, label] of labels.entries()) {
      await expect(tiles.nth(index)).toHaveAccessibleName(label);
    }
  };
  const before = await fixture.boundingBox();
  await expect(tiles).toHaveCount(0);
  await expect(payload).toHaveText('[]');
  await choose([paths[0]]);
  await expectFileNames(['Remove existing.png']);
  await choose(paths.slice(1));
  await expectFileNames(['Remove existing.png', 'Remove next.png']);
  await choose([paths[2]]);
  await expectFileNames(['Remove existing.png', 'Remove next.png']);
  await fixture.getByRole('button', { name: 'Remove existing.png', exact: true }).click();
  await choose([paths[2]]);
  await expectFileNames(['Remove next.png', 'Remove overflow.png']);
  await expect(fixture.getByText('2 attached', { exact: true })).toBeVisible();
  await expect(payload).toHaveText('[]');
  await fixture.getByRole('button', { name: 'Send', exact: true }).click();
  const sent = [{ text: '', files: ['next.png', 'overflow.png'] }];
  await expect(payload).toHaveText(JSON.stringify(sent));
  await fixture.getByRole('button', { name: 'Queue message', exact: true }).click();
  const queued = fixture.getByRole('button', { name: '2 attachments', exact: true });
  await expect(queued).toBeVisible();
  await expect(tiles).toHaveCount(0);
  await queued.press('F2');
  await expect(queued).toHaveCount(0);
  await expectFileNames(['Remove next.png', 'Remove overflow.png']);
  await expect(field).toHaveValue('');
  await expect(field).toBeFocused();
  await expect(payload).toHaveText(JSON.stringify(sent));
  expect(sockets, 'Public composer fixture must not connect to a backend').toEqual([]);
  await info.attach('limit-contract-and-geometry', {
    body: JSON.stringify({
      maxFiles: 2,
      realFileNames: names,
      before,
      after: await fixture.boundingBox(),
      sent,
    }),
    contentType: 'application/json',
  });
  await info.attach('bounded-files-restored', {
    body: await fixture.screenshot(),
    contentType: 'image/png',
  });
});

test('composer clipboard: native plaintext paste does not send and ordinary Enter sends once', async ({
  page,
}, info) => {
  const sockets = [];
  page.on('websocket', (socket) => sockets.push(socket.url()));
  const fixture = await openFixture(page, 'message-composer', 'max-files');
  const field = fixture.getByRole('textbox');
  const payload = fixture.locator('[data-composer-sends]');
  const text = 'First line: café\nSecond line: keep this text.';
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(page.url()).origin,
  });
  try {
    // Browser Clipboard API writes the real clipboard. Keyboard paste invokes
    // the textarea's native default action; no synthetic paste/input events.
    await page.evaluate((value) => globalThis.navigator.clipboard.writeText(value), text);
    expect(await page.evaluate(() => globalThis.navigator.clipboard.readText())).toBe(text);
    await field.evaluate((node) => {
      globalThis.composerClipboardEvents = [];
      for (const type of ['paste', 'input']) {
        node.addEventListener(type, (event) => {
          globalThis.composerClipboardEvents.push({
            type,
            trusted: event.isTrusted,
            inputType: event.inputType,
            text: event.clipboardData?.getData('text/plain'),
            fileCount: event.clipboardData?.files.length,
          });
        });
      }
    });
    await field.click();
    await field.press('ControlOrMeta+V');
    await expect(field).toHaveValue(text);
    await expect(field).toBeFocused();
    await expect(payload).toHaveText('[]');
    await expect(fixture.getByRole('button', { name: /^Remove / })).toHaveCount(0);
    const events = await page.evaluate(() => globalThis.composerClipboardEvents);
    expect(events).toContainEqual({ type: 'paste', trusted: true, text, fileCount: 0 });
    expect(events).toContainEqual({ type: 'input', trusted: true, inputType: 'insertFromPaste' });
    await info.attach('plaintext-before-send', {
      body: await fixture.screenshot(),
      contentType: 'image/png',
    });
    await field.press('Enter');
    await expect(payload).toHaveText(JSON.stringify([{ text, files: [] }]));
    await expect(field).toHaveValue('');
    await expect(field).toBeFocused();
    expect(sockets).toEqual([]);
    await info.attach('native-clipboard-events', {
      body: JSON.stringify({
        text,
        events,
        inputProvenance:
          'Clipboard API + normal keyboard paste; plaintext only, no file paste or drop claim',
      }),
      contentType: 'application/json',
    });
  } finally {
    await page.context().clearPermissions();
  }
});
