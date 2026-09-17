import { expect, test } from '@playwright/experimental-ct-svelte';
import Preview from '$features/onboarding/onboarding-layout.preview.svelte';

for (const width of [420, 900]) {
  test(`setup script trigger stays left-aligned and keyboard-operable ${width === 420 ? 'when wrapped' : 'on one line'}`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const component = await mount(Preview, { props: { compact: true } });
    const trigger = component.getByRole('button', { name: /Set up dev environment with/ });
    await expect(trigger).toBeVisible();
    // Observe startup autofocus before testing trigger keyboard focus.
    const prompt = component.locator(
      '[contenteditable="true"][role="textbox"][aria-label="Prompt"]',
    );
    await expect(prompt).toBeFocused();
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await trigger.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Setup Script', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).press('Escape');
    await expect(dialog).toHaveCount(0);

    await trigger.focus();
    await trigger.press('Space');
    await expect(dialog.getByRole('textbox', { name: 'Editor content' })).toBeVisible();
    await dialog.getByRole('button', { name: /Copy config files only/ }).click();
    await dialog.getByRole('button', { name: /Done/ }).click();
    await expect(dialog).toHaveCount(0);
    const pill = trigger.getByText('Copy config files only', { exact: true });
    await expect(pill).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const row = await trigger.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        left: box.left + parseFloat(style.paddingLeft),
        right: box.right - parseFloat(style.paddingRight),
        top: box.top,
        bottom: box.bottom,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      };
    });
    const prefix = trigger.getByText('Set up dev environment with', { exact: true });
    const suffix = trigger.getByText('script', { exact: true });
    const prefixBox = (await prefix.boundingBox())!;
    const pillBox = (await pill.boundingBox())!;
    const suffixBox = (await suffix.boundingBox())!;
    expect(Math.abs(prefixBox.x - row.left)).toBeLessThanOrEqual(1);
    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
    for (const part of [prefix, pill, suffix]) {
      const box = (await part.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(row.left - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(row.right + 1);
      expect(box.y).toBeGreaterThanOrEqual(row.top);
      expect(box.y + box.height).toBeLessThanOrEqual(row.bottom);
      expect(
        await part.evaluate((element) => element.scrollWidth - element.clientWidth),
      ).toBeLessThanOrEqual(1);
    }
    if (width === 420) {
      expect(suffixBox.y).toBeGreaterThanOrEqual(prefixBox.y + prefixBox.height);
      expect(suffixBox.y).toBeGreaterThanOrEqual(pillBox.y + pillBox.height);
      expect(Math.abs(suffixBox.x - row.left)).toBeLessThanOrEqual(1);
    } else {
      expect(pillBox.y).toBeLessThan(prefixBox.y + prefixBox.height);
    }
  });
}
