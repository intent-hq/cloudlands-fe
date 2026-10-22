import { expect, test } from '../../../../test/ct-test';
import MarkdownViewer from '../MarkdownViewer.svelte';

const url = 'workspace-asset://steep-bear/mvijen53-4c87471b.png?backend=remote-1&v=2';

for (const isStreaming of [false, true]) {
  test(`saved image link opens a preview and restores focus (${isStreaming ? 'streaming' : 'static'})`, async ({
    mount,
    page,
  }, testInfo) => {
    const component = await mount(MarkdownViewer, {
      props: {
        content: `[See the **updated UI**](${url})`,
        workspaceId: 'steep-bear',
        isStreaming,
      },
    });
    const link = component.getByRole('link', { name: 'See the updated UI' });
    await link.locator('strong').click();
    const dialog = page.getByRole('dialog', { name: /image preview/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('img')).toHaveAttribute('src', url);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('img')).toHaveAttribute('src', url);
    await dialog.getByRole('button', { name: /^close preview$/i }).click();
    await expect(dialog).toHaveCount(0);
    await expect(link).toBeFocused();
    await testInfo.attach('saved-image-link.json', {
      body: JSON.stringify({
        url,
        isStreaming,
        click: 'preview opened',
        keyboard: 'preview opened',
        focus: 'restored',
        nativeBytes: 'not tested by browser',
      }),
      contentType: 'application/json',
    });
  });
}

test('saved image preview closes when its owning workspace changes', async ({ mount, page }) => {
  const component = await mount(MarkdownViewer, {
    props: { content: `[Preview](${url})`, workspaceId: 'steep-bear', allowFileMedia: false },
  });
  await component.getByRole('link').click();
  const dialog = page.getByRole('dialog', { name: /image preview/i });
  await expect(dialog).toBeVisible();
  await component.update({ props: { workspaceId: 'another-workspace' } });
  await expect(dialog).toHaveCount(0);
});

test('invalid saved image links never create a preview', async ({ mount, page }, testInfo) => {
  const rejected = [
    'workspace-asset://another-workspace/image.png',
    'workspace-asset://steep-bear/../image.png',
    'workspace-asset://steep-bear/a%2Fimage.png',
    'workspace-asset://steep-bear/image.png?backend=one&backend=two',
    'workspace-asset://steep-bear/image.png?backend=remote%2Fother',
    'workspace-asset://steep-bear/image.png?redirect=outside',
    'workspace-asset://steep-bear/image.png#fragment',
    'workspace-asset://steep-bear/image.svg',
  ];
  const component = await mount(MarkdownViewer, {
    props: { content: 'Links', workspaceId: 'steep-bear' },
  });
  for (const source of rejected) {
    await component.update({ props: { content: `[Preview](${source})` } });
    await component.getByRole('link').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-media-lightbox-content]')).toHaveCount(0);
  }
  await testInfo.attach('rejected-image-links.json', {
    body: JSON.stringify(rejected),
    contentType: 'application/json',
  });
});
