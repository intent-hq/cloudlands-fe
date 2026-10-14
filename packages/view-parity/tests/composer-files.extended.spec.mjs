import { copyFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test, expect, openFixture } from '../lib/functional.mjs';

test('composer files: native chooser filters and deduplicates, removal permits reselection, and an attachment-only queue restores the file', async ({
  page,
}, info) => {
  const imagePath = info.outputPath('local-image.png');
  const rejectedPath = info.outputPath('unsupported.txt');
  await copyFile(new URL('../../../static/favicon.png', import.meta.url), imagePath);
  await writeFile(rejectedPath, 'Unsupported local attachment');
  const requests = [];
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== '/intentd/ws') return;
    socket.on('framesent', ({ payload }) => requests.push(JSON.parse(String(payload))));
  });
  const fixture = await openFixture(page, 'message-composer', 'attachments');
  const field = fixture.getByRole('textbox');
  const attach = fixture.getByRole('button', { name: 'Attach files', exact: true });
  const image = fixture.getByRole('button', { name: 'Remove local-image.png', exact: true });
  const fileInput = fixture.locator('input[type="file"]');
  const choose = async (paths) => {
    const chooserPromise = page.waitForEvent('filechooser');
    await attach.click();
    const chooser = await chooserPromise;
    expect(chooser.isMultiple()).toBe(true);
    await chooser.setFiles(paths);
    await expect(fileInput).toHaveValue('');
  };

  await fixture.getByRole('button', { name: 'Remove workspace-map.png', exact: true }).click();
  await fixture.getByRole('button', { name: 'Remove brief.pdf', exact: true }).click();
  await expect(fixture.getByRole('button', { name: /^Remove / })).toHaveCount(0);
  await expect(fixture.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await choose([imagePath, rejectedPath]);
  await expect(image).toBeVisible();
  await expect(fixture.getByText('1 attached', { exact: true })).toBeVisible();
  await expect(fixture.getByText('unsupported.txt', { exact: true })).toHaveCount(0);
  await choose([imagePath]);
  await expect(image).toHaveCount(1);
  await expect(fixture.getByText('1 attached', { exact: true })).toBeVisible();
  await image.click();
  await expect(image).toHaveCount(0);
  await expect(fixture.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await choose([imagePath]);
  await expect(image).toBeVisible();
  await expect(field).toHaveValue('');

  // The actual catalog callback changes status to streaming. It deliberately
  // retains files, allowing the next native interaction to queue the attachment.
  await fixture.getByRole('button', { name: 'Send', exact: true }).click();
  await fixture.getByRole('button', { name: 'Queue message', exact: true }).click();
  const queued = fixture.getByRole('button', { name: '1 attachment', exact: true });
  await expect(queued).toBeVisible();
  await expect(image).toHaveCount(0);
  await expect(field).toBeFocused();
  await queued.press('F2');
  await expect(queued).toHaveCount(0);
  await expect(image).toBeVisible();
  await expect(field).toHaveValue('');
  await expect(field).toBeFocused();
  await expect(fixture.getByText('1 attached', { exact: true })).toBeVisible();

  await info.attach('attachment-evidence', {
    body: JSON.stringify({
      sourceImage: fileURLToPath(new URL('../../../static/favicon.png', import.meta.url)),
      requests,
      limits: 'No maxFiles prop in this fixture; no native drop, paste, IME or upload claim.',
    }),
    contentType: 'application/json',
  });
  expect(
    requests.filter(({ method }) =>
      /\.(set.*|update.*|create|delete|add|edit.*|restore.*|markSeen|execute|open|join|leave|computeNow|commit|stage|unstage|push|pull|refresh)$/.test(
        method ?? '',
      ),
    ),
  ).toEqual([]);
  await page.evaluate(() => globalThis.document.fonts.ready);
  await info.attach('composer-attachment-restored', {
    body: await fixture.screenshot(),
    contentType: 'image/png',
  });
});
