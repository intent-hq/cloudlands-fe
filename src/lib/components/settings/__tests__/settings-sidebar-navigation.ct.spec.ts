import { expect, test } from '../../../../test/ct-test';
import SettingsSidebarPreview from '../settings-sidebar.preview.svelte';

test('keeps Back, grouped settings and specialists on one aligned keyboard sequence', async ({
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
    'display',
    'app-behavior',
    'input',
    'connections',
    'devices',
    'setup',
    'advanced',
    'agent-behavior',
    'providers',
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
  expect(focusStyle.width).toBeGreaterThanOrEqual(1);
  const geometry = await component
    .locator('[data-settings-tab], [data-settings-agent-row], [data-settings-sidebar-back] button')
    .evaluateAll((rows) =>
      rows.map((row) => {
        const list = row.querySelector('[data-slot="list-row"]')!;
        const title = row.querySelector('[data-settings-sidebar-label]')!;
        const style = getComputedStyle(title);
        const icon = list.firstElementChild!.firstElementChild!.getBoundingClientRect();
        return {
          x: title.getBoundingClientRect().x,
          height: row.getBoundingClientRect().height,
          font: style.fontSize,
          weight: style.fontWeight,
          overflow: row.scrollWidth - row.clientWidth,
          iconWidth: icon.width,
          iconHeight: icon.height,
          gap: parseFloat(getComputedStyle(list).columnGap),
        };
      }),
    );
  expect(
    Math.max(...geometry.map((row) => row.x)) - Math.min(...geometry.map((row) => row.x)),
  ).toBeLessThanOrEqual(1);
  expect(new Set(geometry.map((row) => row.font)).size).toBe(1);
  expect(new Set(geometry.map((row) => row.weight)).size).toBe(1);
  expect(geometry.every((row) => row.weight === '400')).toBe(true);
  expect(geometry.every((row) => row.font === '15px')).toBe(true);
  expect(geometry.every((row) => row.iconWidth === 16 && row.iconHeight === 16)).toBe(true);
  expect(geometry.every((row) => row.gap === 8)).toBe(true);
  expect(
    Math.max(...geometry.map((row) => row.height)) - Math.min(...geometry.map((row) => row.height)),
  ).toBeLessThanOrEqual(1);
  expect(geometry.every((row) => row.overflow <= 1)).toBe(true);
  expect(geometry.every((row) => row.height === 32)).toBe(true);
  const spacing = await component.locator('nav').evaluate((nav) => ({
    sections: parseFloat(getComputedStyle(nav).rowGap),
    rows: [...nav.querySelectorAll('section')].map(
      (section) => parseFloat(getComputedStyle(section.lastElementChild!).rowGap) || 0,
    ),
  }));
  expect(spacing.sections).toBe(16);
  expect(spacing.rows).toEqual([0, 0, 0, 0]);
  const hint = await back.locator('kbd').evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      background: style.backgroundColor,
      border: parseFloat(style.borderWidth),
      padding: parseFloat(style.padding),
    };
  });
  expect(hint.background).toBe('rgba(0, 0, 0, 0)');
  expect(hint.border).toBe(0);
  expect(hint.padding).toBe(0);
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
  expect(truncation.font).toBe('15px');
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
  expect(bounds.every((row) => row.within && row.overflow <= 1 && row.height === 32)).toBe(true);
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
    await specialist.click();
    await page.mouse.move(1000, 0);
    await expect(specialist).toHaveAttribute('aria-current', 'page');
    await expect(tab).not.toHaveAttribute('aria-current', 'page');
    expect(await specialist.evaluate((node) => getComputedStyle(node).boxShadow)).toBe('none');
  });
}
