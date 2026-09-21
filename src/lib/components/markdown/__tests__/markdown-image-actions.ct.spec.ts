import { readFile } from 'node:fs/promises';
import { expect, test } from '../../../../test/ct-test';
import MarkdownViewer from '../MarkdownViewer.svelte';

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240"><rect width="480" height="240" rx="16" fill="#e8edf4"/><circle cx="120" cy="120" r="64" fill="#657ca8"/><path d="M240 152l48-64 72 64" fill="none" stroke="#657ca8" stroke-width="12"/></svg>';

for (const source of ['https', 'data'] as const) {
  test(`keyboard preview and original download for ${source} images`, async ({
    mount,
    page,
  }, testInfo) => {
    const src =
      source === 'https'
        ? 'https://image.test/original'
        : `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    await page.route('https://image.test/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: svg,
        headers: { 'access-control-allow-origin': '*' },
      }),
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(MarkdownViewer, {
      props: { content: `![diagram](${src})` },
    });
    const image = component.getByRole('button', { name: 'diagram', exact: true });
    await expect(image).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(image).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: /image preview/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('img', { name: 'diagram', exact: true })).toHaveAttribute(
      'src',
      src,
    );
    await dialog.getByRole('button', { name: /close preview/i }).click();
    await expect(dialog).toHaveCount(0);
    await expect(image).toBeFocused();
    await page.keyboard.press('Tab');
    const trigger = component.getByRole('button', { name: /image options/i });
    await expect(trigger).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menu')).toBeVisible();
    const screenshotPath = testInfo.outputPath('image-actions.png');
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach('image-actions', { path: screenshotPath, contentType: 'image/png' });
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: /download/i }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe('diagram.svg');
    expect(await readFile((await download.path())!, 'utf8')).toBe(svg);
    await expect(trigger).toBeFocused();
  });
}
