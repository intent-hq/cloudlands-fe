import { expect, test } from '../../../test/ct-test';
import Preview from './no-workspace-selected.preview.svelte';

for (const width of [240, 960]) {
  test(`home empty state centers within a ${width}px panel and keeps creation accessible`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width, height: 600 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(Preview);
    await page.evaluate(() => document.fonts.ready);
    const panel = page.locator('[data-home-empty-preview]');
    const content = component.locator('[data-slot="empty-state"] > div');
    const title = component.getByRole('heading', { level: 1 });
    const description = component.locator('[data-slot="empty-state-description"]');
    const action = component.getByRole('button', { name: 'New Workspace' });
    const bounds = (await panel.boundingBox())!;
    const block = (await content.boundingBox())!;

    expect(Math.abs(block.x + block.width / 2 - (bounds.x + bounds.width / 2))).toBeLessThanOrEqual(
      1,
    );
    expect(
      Math.abs(block.y + block.height / 2 - (bounds.y + bounds.height / 2)),
    ).toBeLessThanOrEqual(1);
    expect(block.width).toBeLessThanOrEqual(448);
    expect(block.x - bounds.x).toBeGreaterThanOrEqual(24);
    expect(bounds.x + bounds.width - (block.x + block.width)).toBeGreaterThanOrEqual(24);
    for (const element of [title, description, action]) {
      const box = (await element.boundingBox())!;
      expect(Math.abs(box.x + box.width / 2 - (bounds.x + bounds.width / 2))).toBeLessThanOrEqual(
        1,
      );
      expect(box.y).toBeGreaterThanOrEqual(bounds.y);
      expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
    await expect(title).toHaveCSS('text-align', 'center');
    await expect(description).toHaveCSS('text-align', 'center');
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

    const requested = component.locator('[data-create-workspace-requested]');
    await expect(requested).toHaveText('false');
    await page.keyboard.press('Tab');
    await expect(action).toBeFocused();
    await page.keyboard.press(width === 240 ? 'Enter' : 'Space');
    await expect(requested).toHaveText('true');
    expect(await content.boundingBox()).toEqual(block);
  });
}
