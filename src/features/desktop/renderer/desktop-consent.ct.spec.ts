import { test, expect } from '../../../test/ct-test';
import Harness from './DesktopConsentHarness.svelte';

test.use({ viewport: { width: 360, height: 640 }, reducedMotion: 'reduce' });
test('consent actions remain visible and keyboard reachable in a narrow notification', async ({
  mount,
  page,
}, testInfo) => {
  await mount(Harness);
  const card = page.getByRole('group', { name: 'Desktop control permission' });
  await expect(card).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const labels = ['Allow once', 'Allow future sessions for this agent', 'Deny'];
  for (const label of labels) {
    const button = card.getByRole('button', { name: label });
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
  }
  await card.getByRole('button', { name: labels[0] }).focus();
  await page.keyboard.press('Tab');
  await expect(card.getByRole('button', { name: labels[1] })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(card.getByRole('button', { name: labels[2] })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status', { name: 'Decision' })).toHaveText('deny');
  await page.screenshot({ path: testInfo.outputPath('desktop-consent.png') });
});
