import { expect, test } from '../../test/ct-test';
import Preview from './machine-rail.preview.svelte';

test('shows retained device details without offering another window’s retained devices to add', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Preview, { props: { scenario: 'retained-home' } });
  const home = component.locator('[data-machine-id="home-machine"]');
  await expect(home).toHaveAccessibleName('Home workstation');
  await expect(home.locator('svg')).toBeVisible();
  await component.getByRole('button', { name: 'Add a machine to this window' }).click();
  await expect(page.getByTestId('machine-rail-add-item')).toHaveText(['Saved machine']);
  await testInfo.attach('retained-device-add-menu', {
    body: await page.screenshot({ path: testInfo.outputPath('retained-device-add-menu.png') }),
    contentType: 'image/png',
  });
});

test('keeps the home device visible and focused as its details disappear and return', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 600 });
  const component = await mount(Preview, { props: { scenario: 'missing-home' } });
  const home = component.locator('[data-machine-id="home-machine"]');
  await expect(home).toHaveAccessibleName('Unknown machine');
  await expect(home.locator('svg')).toBeVisible();
  await component.getByRole('textbox', { name: 'Draft' }).fill('Keep my work here');
  await home.focus();
  await testInfo.attach('missing-device-fallback', {
    body: await component.screenshot({ path: testInfo.outputPath('missing-device-fallback.png') }),
    contentType: 'image/png',
  });

  await component.update({ props: { scenario: 'restored-home' } });
  await expect(home).toHaveAccessibleName('Home workstation');
  await expect(home.locator('svg')).toBeVisible();
  await expect(home).toBeFocused();
  await expect(component.getByRole('textbox', { name: 'Draft' })).toHaveValue('Keep my work here');

  await component.update({ props: { scenario: 'missing-home' } });
  await expect(home).toHaveAccessibleName('Unknown machine');
  await expect(home.locator('svg')).toBeVisible();
  await expect(home).toBeFocused();
  await home.press('Enter');
  await expect(component.getByTestId('machine-rail-requests')).toHaveText('["home-machine"]');
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await testInfo.attach('missing-device-fallback-dark', {
    body: await component.screenshot({
      path: testInfo.outputPath('missing-device-fallback-dark.png'),
    }),
    contentType: 'image/png',
  });
});

test('keeps an unknown secondary device visible and removable without affecting the cloud device', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Preview, { props: { scenario: 'missing-secondary' } });
  const unknown = component.locator('[data-machine-id="unknown-machine"]');
  const cloud = component.locator('[data-machine-id="cloud-machine"]');
  await expect(unknown.locator('svg')).toBeVisible();
  await expect(cloud).toHaveAccessibleName('reliablesite');
  await component.getByRole('button', { name: 'Add a machine to this window' }).click();
  const remove = page.locator(
    '[data-testid="machine-rail-remove-item"][data-machine-id="unknown-machine"]',
  );
  await expect(remove).toHaveText('Unknown machine');
  await expect(remove.locator('svg')).toBeVisible();
  await remove.click();
  await expect(component.locator('[data-machine-id="unknown-machine"]')).toHaveCount(0);
  await expect(cloud).toHaveAttribute('aria-current', 'true');
  await expect(cloud.locator('svg')).toBeVisible();
  await testInfo.attach('removed-unknown-device', {
    body: await component.screenshot({ path: testInfo.outputPath('removed-unknown-device.png') }),
    contentType: 'image/png',
  });
});

test('keeps pending, offline, and guest devices usable alongside missing details', async ({
  mount,
}, testInfo) => {
  const component = await mount(Preview, { props: { scenario: 'pending-home' } });
  const home = component.locator('[data-machine-id="home-machine"]');
  await expect(home).toHaveAttribute('aria-busy', 'true');
  await expect(home.locator('svg')).toBeVisible();
  await expect(
    component.getByRole('button', { name: 'Build server (disconnected)' }),
  ).toBeVisible();
  await expect(component.getByRole('button', { name: 'Guest host' }).locator('svg')).toBeVisible();
  await testInfo.attach('device-states', {
    body: await component.screenshot({ path: testInfo.outputPath('device-states.png') }),
    contentType: 'image/png',
  });
});
