import { expect, test } from '../../../../test/ct-test';
import SettingsSidebarPreview from '../settings-sidebar.preview.svelte';

const sidebarRows =
  '[data-settings-tab], [data-settings-agent-row], [data-settings-sidebar-back] button';

test('keeps Back, grouped settings and specialists in one keyboard sequence', async ({
  mount,
  page,
}) => {
  const component = await mount(SettingsSidebarPreview);
  await page.evaluate(() => document.fonts.ready);
  const tabs = component.locator('[data-settings-tab]');
  const specialists = component.locator('[data-settings-agent-row]');
  const back = component.locator('[data-settings-sidebar-back] button');
  await expect(specialists).toHaveCount(3);
  await back.focus();
  await page.keyboard.press('Enter');
  await expect(component.locator('[data-settings-back-count]')).toHaveText('1');
  await page.keyboard.press('Tab');
  const expectedOrder = [
    'agent-behavior',
    'providers',
    'connections',
    'devices',
    'mobile',
    'collaboration',
    'display',
    'app-behavior',
    'input',
    'setup',
    'advanced',
  ];
  for (const id of expectedOrder) {
    const tab = component.locator(`[data-settings-tab="${id}"]`);
    await expect(tab).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(tab).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Tab');
  }
  await expect(specialists.first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(specialists.first()).toHaveAttribute('aria-current', 'page');
  await expect(component.locator('[data-settings-tab][aria-current="page"]')).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(component.locator('#specialist-reviewer')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(component.locator('#specialist-reviewer')).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Tab');
  await expect(component.locator('#create-specialist')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(component.locator('#create-specialist')).toHaveAttribute('aria-current', 'page');
  const focusStyle = await component.locator('#create-specialist').evaluate((node) => {
    const style = getComputedStyle(node);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(focusStyle.style).not.toBe('none');
  expect(focusStyle.width).toBeGreaterThan(0);
  expect(
    await component
      .locator(sidebarRows)
      .evaluateAll((rows) => rows.every((row) => row.scrollWidth <= row.clientWidth + 1)),
  ).toBe(true);
  const hint = await back.locator('kbd').evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      background: style.backgroundColor,
      border: parseFloat(style.borderWidth),
      padding: parseFloat(style.padding),
    };
  });
  expect(hint.background).toBe('rgba(0, 0, 0, 0)');
  const lastTab = (await tabs.last().boundingBox())!;
  const firstSpecialist = (await specialists.first().boundingBox())!;
  expect(firstSpecialist.y).toBeGreaterThan(lastTab.y + lastTab.height);
});

test('keeps narrow rows inside the sidebar and truncates long specialist labels without losing keyboard access', async ({
  mount,
  page,
}) => {
  const component = await mount(SettingsSidebarPreview, { props: { narrow: true } });
  await page.evaluate(() => document.fonts.ready);
  const specialist = component.locator('#specialist-reviewer');
  const label = specialist.locator('[data-settings-sidebar-label] > span').first();
  const truncation = await label.evaluate((node) => ({
    overflow: node.scrollWidth - node.clientWidth,
    ellipsis: getComputedStyle(node).textOverflow,
    font: getComputedStyle(node).fontSize,
  }));
  expect(truncation.overflow).toBeGreaterThan(0);
  expect(truncation.ellipsis).toBe('ellipsis');
  const bounds = await component.evaluate((sidebar) => {
    const outer = sidebar.getBoundingClientRect();
    return [...sidebar.querySelectorAll('button')].map((row) => {
      const rect = row.getBoundingClientRect();
      return {
        within: rect.left >= outer.left && rect.right <= outer.right,
        overflow: row.scrollWidth - row.clientWidth,
        height: rect.height,
      };
    });
  });
  expect(bounds.every((row) => row.within && row.overflow <= 1)).toBe(true);
  await specialist.focus();
  await page.keyboard.press('Enter');
  await expect(specialist).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Tab');
  await expect(component.locator('#create-specialist')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(component.locator('#create-specialist')).toHaveAttribute('aria-current', 'page');
});

for (const theme of ['light', 'dark'] as const) {
  test(`keeps a quiet selected surface without a raised shadow in ${theme}`, async ({
    mount,
    page,
  }) => {
    await page.evaluate(
      (value) => document.documentElement.classList.toggle('dark', value),
      theme === 'dark',
    );
    const component = await mount(SettingsSidebarPreview);
    await page.evaluate(() => document.fonts.ready);
    const tab = component.locator('[data-settings-tab="providers"]');
    const before = await tab.evaluate((node) => getComputedStyle(node).backgroundColor);
    await tab.hover();
    await expect
      .poll(() => tab.evaluate((node) => getComputedStyle(node).backgroundColor))
      .not.toBe(before);
    await tab.click();
    await page.mouse.move(1000, 0);
    await expect(tab).toHaveAttribute('aria-current', 'page');
    await expect
      .poll(() => tab.evaluate((node) => getComputedStyle(node).backgroundColor))
      .not.toBe(before);
    expect(await tab.evaluate((node) => getComputedStyle(node).boxShadow)).toBe('none');
    const specialist = component.locator('[data-settings-agent-row]').first();
    await specialist.hover();
    await specialist.click();
    await page.mouse.move(1000, 0);
    await expect(specialist).toHaveAttribute('aria-current', 'page');
    await expect(tab).not.toHaveAttribute('aria-current', 'page');
    expect(await specialist.evaluate((node) => getComputedStyle(node).boxShadow)).toBe('none');
    const back = component.locator('[data-settings-sidebar-back] button');
    await back.hover();
    const create = component.locator('#create-specialist');
    await create.hover();
  });
}
