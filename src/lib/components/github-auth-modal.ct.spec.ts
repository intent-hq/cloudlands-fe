import { expect, test } from '../../test/ct-test';
import GitHubAuthModalPreview from './github-auth-modal.preview.svelte';

for (const state of ['ready', 'starting', 'code', 'error', 'daemon-auth']) {
  test(`GitHub ${state} fits a narrow viewport and can be cancelled`, async ({ mount, page }) => {
    await page.setViewportSize({ width: 360, height: 560 });
    await mount(GitHubAuthModalPreview, {
      hooksConfig: { previewScene: { scene: 'github-auth-modal', state } },
    });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const bounds = await dialog.evaluate((element) => ({
      overflow: element.scrollWidth - element.clientWidth,
      top: element.getBoundingClientRect().top,
      bottom: element.getBoundingClientRect().bottom,
    }));
    expect(bounds.overflow).toBeLessThanOrEqual(1);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.bottom).toBeLessThanOrEqual(560);
    if (state === 'code') await expect(dialog).toContainText('ABCD-1234');
    if (state === 'error') await expect(dialog).toContainText('authorization code expired');
    if (state === 'daemon-auth') await expect(dialog).toContainText('auggie login');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });
}
