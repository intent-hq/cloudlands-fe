import { test, expect } from '../../../../test/ct-test';
import SidebarMenuHarness from './SidebarMenuHarness.svelte';

type Page = Parameters<Parameters<typeof test.beforeEach>[1]>[0]['page'];
type Locator = ReturnType<Page['locator']>;

async function anatomy(menu: Locator) {
  return menu.evaluate((element) => {
    const surface = getComputedStyle(element);
    return {
      radius: surface.borderRadius,
      background: surface.backgroundColor,
      color: surface.color,
      border: surface.border,
      shadow: surface.boxShadow,
      padding: surface.padding,
      rows: Array.from(element.querySelectorAll('[data-menu-item]')).map((row) => {
        const style = getComputedStyle(row);
        return {
          role: row.getAttribute('role'),
          height: row.getBoundingClientRect().height,
          padding: style.padding,
          radius: style.borderRadius,
          color: style.color,
          font: style.font,
          gap: style.gap,
        };
      }),
    };
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`context and overflow have identical rounded root and child anatomy in ${theme}`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      theme === 'dark',
    );
    await page.setViewportSize({ width: 420, height: 480 });
    const component = await mount(SidebarMenuHarness, { props: { edge: true } });
    const snapshots = [];
    for (const via of ['overflow', 'context'] as const) {
      const trigger = component.getByRole('button', {
        name: via === 'overflow' ? 'Workspace actions' : 'Workspace',
        exact: true,
      });
      if (via === 'overflow') await trigger.click();
      else await trigger.click({ button: 'right' });
      const root = page.getByRole('menu', { name: 'Workspace actions' });
      await expect(root).toBeVisible();
      const rootStyles = await anatomy(root);
      expect(parseFloat(rootStyles.radius)).toBeGreaterThan(0);
      await test
        .info()
        .attach(`${via}-${theme}-root`, {
          body: await root.screenshot(),
          contentType: 'image/png',
        });
      const more = page.getByRole('menuitem', { name: 'More', exact: true });
      await more.hover();
      const child = page.getByRole('menuitem', { name: 'Export', exact: true });
      await expect(child).toBeVisible();
      const submenu = page.getByRole('menu').filter({ has: child });
      const subStyles = await anatomy(submenu);
      expect(subStyles.radius).toBe(rootStyles.radius);
      await expect
        .poll(() =>
          child.evaluate((item) => {
            const bounds = item.getBoundingClientRect();
            const hit = document.elementFromPoint(
              bounds.left + bounds.width / 2,
              bounds.top + bounds.height / 2,
            );
            return !!hit && item.contains(hit) && bounds.left >= 0 && bounds.right <= innerWidth;
          }),
        )
        .toBe(true);
      snapshots.push({ root: rootStyles, submenu: subStyles });
      await child.hover();
      await child.click();
      await expect(component.getByTestId('selection')).toHaveText('export');
      await expect(page.getByRole('menu')).toHaveCount(0);
    }
    expect(snapshots[1]).toEqual(snapshots[0]);
    await test
      .info()
      .attach(`anatomy-${theme}`, {
        body: Buffer.from(JSON.stringify(snapshots)),
        contentType: 'application/json',
      });
  });
}

test('keyboard context invocation supports paging, nested Escape, focus return and Tab dismissal', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 420, height: 480 });
  const component = await mount(SidebarMenuHarness, { props: { edge: true, long: true } });
  const source = component.getByRole('button', { name: 'Workspace', exact: true });
  await source.focus();
  await page.keyboard.press('Shift+F10');
  const rename = page.getByRole('menuitem', { name: 'Rename' });
  await expect(rename).toBeFocused();
  await page.keyboard.press('End');
  const last = page.getByRole('menuitem', { name: 'Delete', exact: true });
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport();
  await page.keyboard.press('PageUp');
  await expect(last).not.toBeFocused();
  await page.keyboard.press('Home');
  await expect(rename).toBeFocused();
  const more = page.getByRole('menuitem', { name: 'More', exact: true });
  await more.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menuitem', { name: 'Export' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(source).toBeFocused();
  await page.keyboard.press('Shift+F10');
  await expect(rename).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(component.getByRole('button', { name: 'Workspace actions' })).toBeFocused();
});
