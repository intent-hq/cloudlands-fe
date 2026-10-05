import { expect, test } from '../../../../test/ct-test';
import Preview from '$features/onboarding/onboarding-layout.preview.svelte';

for (const width of [420, 900]) {
  test(`setup script trigger stays left-aligned and keyboard-operable at ${width}px`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const component = await mount(Preview, { props: { compact: true } });
    const trigger = component.getByLabel('Setup script', { exact: true });
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
    const pillBox = (await pill.boundingBox())!;
    expect(pillBox.x).toBeGreaterThanOrEqual(row.left - 1);
    expect(pillBox.x + pillBox.width).toBeLessThanOrEqual(row.right + 1);
    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
    expect(pillBox.y).toBeGreaterThanOrEqual(row.top);
    expect(pillBox.y + pillBox.height).toBeLessThanOrEqual(row.bottom);
    expect(
      await pill.evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1);
  });
}
