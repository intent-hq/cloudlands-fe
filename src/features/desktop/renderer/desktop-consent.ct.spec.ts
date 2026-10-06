import { test, expect } from '../../../test/ct-test';
import Harness from './DesktopConsentHarness.svelte';

test.use({ viewport: { width: 360, height: 640 }, reducedMotion: 'reduce' });
for (const claimsPrimary of [false, true]) {
  test(`consent actions remain reachable with primary claim ${claimsPrimary}`, async ({
    mount,
    page,
  }, testInfo) => {
    await mount(Harness, { props: { claimsPrimary } });
    const card = page.getByRole('group', { name: 'Desktop control permission' });
    await expect(card).toBeVisible();
    if (claimsPrimary)
      await expect(card.getByText(/Allowing control sets Windows workstation/)).toBeVisible();
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
}

test('missing macOS permissions stay readable and Allow remains a fresh explicit action', async ({
  mount,
  page,
}, testInfo) => {
  await mount(Harness, { props: { missingPermissions: true } });
  const card = page.getByRole('group', { name: 'Desktop control permission' });
  await expect(card.getByRole('status')).toContainText('Accessibility access is missing');
  await expect(card.getByRole('status')).toContainText('Screen Recording access is missing');
  await expect(page.getByRole('status', { name: 'Decision' })).toHaveText('');
  const before = await card.boundingBox();
  expect(before).not.toBeNull();
  for (const label of ['Allow once', 'Allow future sessions for this agent', 'Deny']) {
    const button = card.getByRole('button', { name: label });
    await expect(button).toBeInViewport({ ratio: 1 });
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
    expect(box.y + box.height).toBeLessThanOrEqual(640);
  }
  await page.screenshot({ path: testInfo.outputPath('desktop-permissions.png') });
  await card.getByRole('button', { name: 'Allow once' }).click();
  await expect(page.getByRole('status', { name: 'Decision' })).toHaveText('allow_once');
});

for (const height of [480, 640]) {
  test(`permission setup keeps Deny visible at ${height}px while guidance scrolls`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 360, height });
    await mount(Harness, {
      props: { missingPermissions: true, claimsPrimary: true, settingUp: true },
    });
    await page.evaluate(() => document.fonts.ready);
    const card = page.getByRole('group', { name: 'Desktop control permission' });
    const guidance = card.getByRole('region', { name: 'Desktop control permission' });
    const deny = card.getByRole('button', { name: 'Deny' });
    await expect(deny).toBeInViewport({ ratio: 1 });
    await expect(deny).toBeEnabled();
    await expect(card.getByRole('button', { name: 'Allow once' })).toBeDisabled();
    await expect(
      card.getByRole('button', { name: 'Allow future sessions for this agent' }),
    ).toBeDisabled();
    expect(await guidance.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
      true,
    );
    await guidance.focus();
    await page.keyboard.press('End');
    await expect.poll(() => guidance.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(deny).toBeInViewport({ ratio: 1 });
    await expect(card.getByRole('status')).toContainText('request a new session and Allow again');
    await expect(page.getByRole('status', { name: 'Decision' })).toHaveText('');
    await page.screenshot({ path: testInfo.outputPath('desktop-setup-scroll.png') });
    await deny.click();
    await expect(page.getByRole('status', { name: 'Decision' })).toHaveText('deny');
  });
}
