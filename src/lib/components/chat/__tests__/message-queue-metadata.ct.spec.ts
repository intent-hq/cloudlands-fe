import { expect, test } from '../../../../test/ct-test';
import Preview from '../message-queue-metadata.preview.svelte';

for (const state of [
  { label: 'regular narrow message', width: 320, isSticky: false },
  { label: 'pinned minimum-width message', width: 240, isSticky: true },
]) {
  test(`delivery metadata is a zero-reflow hover/focus overlay for ${state.label}`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: state.width, height: 500 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(Preview, { props: { isSticky: state.isSticky } });
    await expect(component).toHaveAttribute('data-testid', 'delivered-queue-preview');
    await expect(component).toHaveAttribute('data-previous-requests', '0');
    await page.evaluate(() => document.fonts.ready);
    const surface = component.getByTestId('user-message-surface');
    const toolbar = surface.getByTestId('message-actions');
    const notice = toolbar.getByTestId('queued-message-notice');
    const bodyBox = (await surface.boundingBox())!;
    await expect(toolbar).toHaveCSS('opacity', '0');
    await expect(toolbar).toHaveCSS('position', 'absolute');
    await surface.hover();
    await expect(toolbar).toHaveCSS('opacity', '1');
    await expect(notice).toBeVisible();
    const hoverBox = (await surface.boundingBox())!;
    expect(hoverBox.height).toBeCloseTo(bodyBox.height, 1);
    const toolbarBox = (await toolbar.boundingBox())!;
    expect(toolbarBox.x).toBeGreaterThanOrEqual(bodyBox.x);
    expect(toolbarBox.x + toolbarBox.width).toBeLessThanOrEqual(bodyBox.x + bodyBox.width);

    await page.mouse.move(state.width - 1, 450);
    await expect(toolbar).toHaveCSS('opacity', '0');
    await page.keyboard.press('Tab');
    const metadata = toolbar.getByRole('button', { name: 'Waited in queue for 1m 39s' });
    await expect(metadata).toBeFocused();
    await expect(toolbar).toHaveCSS('opacity', '1');
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toContainText('1m 39s');
    await expect(tooltip).toContainText('2026');
    expect((await surface.boundingBox())!.height).toBeCloseTo(bodyBox.height, 1);
    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect(toolbar.getByRole('button', { name: /^Copy message/ })).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(component).toHaveAttribute('data-previous-requests', '1');

    await component.update({ props: { isSticky: state.isSticky, showQueueInfo: false } });
    await expect(notice).toHaveCount(0);
    expect((await surface.boundingBox())!.height).toBeCloseTo(bodyBox.height, 1);
  });
}
