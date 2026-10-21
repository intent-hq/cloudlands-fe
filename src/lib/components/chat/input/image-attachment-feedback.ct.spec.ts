import { expect, test } from '../../../../test/ct-test';
import Host from './ImageAttachmentFeedbackHost.svelte';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';

for (const method of ['paste', 'drop'] as const) {
  test(`${method} shows image attachments without success toasts and preserves the draft`, async ({
    mount,
    page,
  }, testInfo) => {
    await mount(Host);
    const editor = page.locator('.tiptap-editor');
    await editor.fill('Keep this draft');
    const loading = await page.getByTestId('message-input').evaluateHandle((input) => {
      const filenameChips: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of [...record.addedNodes, ...record.removedNodes]) {
            for (const name of ['first.png', 'second.png']) {
              if (node.textContent?.includes(name)) filenameChips.push(name);
            }
          }
        }
      });
      observer.observe(input, { childList: true, subtree: true });
      return { filenameChips, observer };
    });
    await testInfo.attach('before-images.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await editor.evaluate(
      (node, { png, method }) => {
        const data = new DataTransfer();
        const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
        data.items.add(new File([bytes], 'first.png', { type: 'image/png' }));
        data.items.add(new File([bytes], 'second.png', { type: 'image/png' }));
        node.dispatchEvent(
          method === 'paste'
            ? new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
            : new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }),
        );
      },
      { png, method },
    );
    await expect(page.getByRole('img', { name: 'first.png', exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: 'second.png', exact: true })).toBeVisible();
    const filenameChips = await loading.evaluate(({ filenameChips, observer }) => {
      observer.disconnect();
      return filenameChips;
    });
    expect(filenameChips).toEqual([]);
    await testInfo.attach('attachment-loading.json', {
      body: JSON.stringify({ method, filenameChips }),
      contentType: 'application/json',
    });
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
    await expect(editor).toHaveText('Keep this draft');
    await testInfo.attach('after-images.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await page.getByRole('button', { name: 'Remove first.png', exact: true }).click();
    await expect(page.getByRole('img', { name: 'first.png', exact: true })).toHaveCount(0);
    await expect(page.getByRole('img', { name: 'second.png', exact: true })).toBeVisible();
    await expect(editor).toHaveText('Keep this draft');
  });
}
