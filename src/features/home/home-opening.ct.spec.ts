import { expect, test } from '../../test/ct-test';
import Preview from './home.preview.svelte';

for (const platform of ['MacIntel', 'Linux x86_64']) {
  const modifier = platform === 'MacIntel' ? 'Meta' : 'Control';

  test(`Home opens a row with ${modifier} while normal clicks keep the preview`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.addInitScript((value) => {
      Object.defineProperty(navigator, 'platform', { get: () => value });
    }, platform);
    await page.reload();
    await page.setViewportSize({ width: 1440, height: 900 });
    const component = await mount(Preview);
    const row = component.locator('[data-home-workspace="home-review"]');
    const before = await page.evaluate(() => window.__homeWorkspacePreview?.navigation());
    await row.click();
    await expect(component.locator('[data-home-detail]')).toBeVisible();
    expect(await page.evaluate(() => window.__homeWorkspacePreview?.navigation())).toEqual(before);
    await row.click({ modifiers: [modifier] });
    await expect
      .poll(() => page.evaluate(() => window.__homeWorkspacePreview?.navigation().currentTabId))
      .toBe('home-review');
    await expect(row.locator('..')).toHaveAttribute('aria-selected', 'true');
    const tabs = await page.evaluate(() => window.__homeWorkspacePreview?.navigation().tabOrder);
    expect(tabs?.filter((id) => id === 'home-review')).toHaveLength(1);
    await testInfo.attach(`home-open-${modifier}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  test(`Home supports ${modifier}-Enter without selecting the preview`, async ({ mount, page }) => {
    await page.addInitScript((value) => {
      Object.defineProperty(navigator, 'platform', { get: () => value });
    }, platform);
    await page.reload();
    const component = await mount(Preview);
    const option = component.locator('[data-home-workspace="home-review"]').locator('..');
    await option.focus();
    await page.keyboard.press(`${modifier}+Enter`);
    await expect
      .poll(() => page.evaluate(() => window.__homeWorkspacePreview?.navigation().currentTabId))
      .toBe('home-review');
    await expect(component.locator('[data-home-detail]')).toHaveCount(0);
  });
}

test('Home menu controls keep their own actions and can open an archived workspace', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const component = await mount(Preview);
  const row = component.locator('[data-home-workspace="home-review"]');
  const before = await page.evaluate(() => window.__homeWorkspacePreview?.navigation());
  const modifier = await page.evaluate(() =>
    navigator.platform.toUpperCase().includes('MAC') ? 'Meta' : 'Control',
  );
  await row.getByRole('button').click({ modifiers: [modifier] });
  expect(await page.evaluate(() => window.__homeWorkspacePreview?.navigation())).toEqual(before);
  await page.keyboard.press('Escape');
  await row.getByRole('button').focus();
  await page.keyboard.press(`${modifier}+Enter`);
  await expect(page.getByRole('menu')).toBeVisible();
  expect(await page.evaluate(() => window.__homeWorkspacePreview?.navigation())).toEqual(before);
  await page.getByRole('menuitem', { name: /^Pin/ }).click();
  await expect(component.locator('[data-home-group="pinned"]')).toBeVisible();
  await expect(component.locator('[data-home-detail]')).toHaveCount(0);
  await component.getByRole('button', { name: /^Archived/ }).click();
  const archived = component.locator('[data-home-workspace="home-archived"]');
  await archived.getByRole('button').click();
  await testInfo.attach('home-open-menu', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.getByRole('menuitem', { name: /^Open workspace/ }).click();
  await expect
    .poll(() => page.evaluate(() => window.__homeWorkspacePreview?.navigation().currentTabId))
    .toBe('home-archived');
});

test('Home title remains operable with a long title in a narrow preview', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 900 });
  const component = await mount(Preview);
  await component.locator('[data-home-workspace="home-ready"]').click();
  const open = component
    .locator('[data-home-detail]')
    .getByRole('button', { name: 'Open workspace' });
  await expect(open).toBeInViewport();
  await open.focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(() => page.evaluate(() => window.__homeWorkspacePreview?.navigation().currentTabId))
    .toBe('home-ready');
  await testInfo.attach('home-long-title-open', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('Home board supports modifier click and keyboard opening', async ({ mount, page }) => {
  const component = await mount(Preview, { props: { scenario: 'board' } });
  const modifier = await page.evaluate(() =>
    navigator.platform.toUpperCase().includes('MAC') ? 'Meta' : 'Control',
  );
  await component.locator('[data-home-workspace="home-review"]').click({ modifiers: [modifier] });
  await expect
    .poll(() => page.evaluate(() => window.__homeWorkspacePreview?.navigation().currentTabId))
    .toBe('home-review');
  await expect(component.locator('[data-home-detail]')).toHaveCount(0);
  await component.locator('[data-home-workspace="home-running"]').focus();
  await page.keyboard.press(`${modifier}+Enter`);
  await expect
    .poll(() => page.evaluate(() => window.__homeWorkspacePreview?.navigation().currentTabId))
    .toBe('home-running');
  await expect(component.locator('[data-home-detail]')).toHaveCount(0);
});
