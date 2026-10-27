import { expect, test } from '../../../test/ct-test';
import FeedbackPreview from './annotation-feedback.preview.svelte';

for (const width of [1280, 380]) {
  test(`direct feedback destination lists stay inside the anchored popup at ${width}px`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(FeedbackPreview, { props: { failFirst: false } });
    await expect(page.getByRole('button', { name: 'Send to agent', exact: true })).toBeEnabled();
    const destination = page.getByRole('button', { name: 'Workspace', exact: true });
    await destination.click();
    const popup = page.locator('.annotation-destination-popover');
    const workspace = popup.getByRole('combobox', { name: 'Workspace', exact: true });
    const agent = popup.getByRole('combobox', { name: 'Agent', exact: true });
    await expect(workspace).toBeFocused();
    await page.getByRole('option', { name: 'Website polish', exact: true }).click();
    await expect(workspace).toHaveValue('Website polish');
    await expect(agent).toHaveValue('Coordinator · Main agent');

    for (const name of ['Dock implementor', 'Coordinator · Main agent', 'Dock implementor']) {
      await agent.click();
      const option = page.getByRole('option', { name, exact: true });
      await expect(option).toBeVisible();
      expect(
        await option.evaluate((node) => Boolean(node.closest('.annotation-destination-popover'))),
      ).toBe(true);
      await option.click();
      await expect(agent).toHaveValue(name);
      await expect(agent).toHaveAttribute('aria-expanded', 'false');
    }

    await agent.click();
    const inputBefore = await agent.boundingBox();
    await agent.fill('Dock');
    const option = page.getByRole('option', { name: 'Dock implementor', exact: true });
    await expect(option).toBeVisible();
    const inputAfter = await agent.boundingBox();
    expect(inputAfter).toEqual(inputBefore);
    const popupBox = await popup.boundingBox();
    const optionBox = await option.boundingBox();
    if (!popupBox || !optionBox) throw new Error('Destination popup and option must render');
    expect(popupBox.x).toBeGreaterThanOrEqual(0);
    expect(popupBox.x + popupBox.width).toBeLessThanOrEqual(width);
    expect(popupBox.y).toBeGreaterThanOrEqual(0);
    expect(popupBox.y + popupBox.height).toBeLessThanOrEqual(900);
    expect(optionBox.x).toBeGreaterThanOrEqual(popupBox.x);
    expect(optionBox.x + optionBox.width).toBeLessThanOrEqual(popupBox.x + popupBox.width);
    expect(optionBox.y).toBeGreaterThanOrEqual(popupBox.y);
    expect(optionBox.y + optionBox.height).toBeLessThanOrEqual(popupBox.y + popupBox.height);

    const artifact = testInfo.outputPath(`feedback-recipient-${width}.png`);
    await page.screenshot({ path: artifact, animations: 'disabled' });
    await testInfo.attach('Anchored destination popup', {
      path: artifact,
      contentType: 'image/png',
    });
    await testInfo.attach('Destination containment', {
      body: JSON.stringify({ width, popupBox, optionBox, inputBefore, inputAfter }),
      contentType: 'application/json',
    });
    await agent.press('Escape');
    await expect(agent).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('listbox')).toBeHidden();
    await expect(popup).toBeVisible();
    await expect(agent).toHaveValue('Dock implementor');
    await agent.press('Escape');
    await expect(popup).toBeHidden();
    await expect(destination).toBeFocused();
    await expect(destination).toContainText('Website polish');
    await expect(destination).toContainText('Dock implementor');
  });
}
