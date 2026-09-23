import { test, expect } from '../../../../test/ct-test';
import SidebarMenuHarness from './SidebarMenuHarness.svelte';
import { expectDestructiveMenuInk, expectMenuFirstLine } from '../../../../test/menu-geometry';

type Page = Parameters<Parameters<typeof test.beforeEach>[1]>[0]['page'];
type Locator = ReturnType<Page['locator']>;

test('right-click descriptions keep the icon and shortcut centered on the first label line', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 360, height: 600 });
  const component = await mount(SidebarMenuHarness, { props: { multiline: true } });
  const trigger = component.getByRole('button', { name: 'Workspace', exact: true });
  await trigger.click({ button: 'right' });
  const root = page.getByRole('menu', { name: 'Workspace actions' });
  const locked = root.getByRole('menuitem', { name: 'Locked', exact: true });
  await expect(locked).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect((await locked.boundingBox())!.height).toBeGreaterThan(40);
  await expectMenuFirstLine(locked, locked.getByText('Locked', { exact: true }));
  await testInfo.attach('context-first-line', {
    body: await root.screenshot(),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('first-line measurement is atomic across popup movement and still rejects misaligned accessories', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(SidebarMenuHarness, { props: { multiline: true } });
  await page.getByRole('button', { name: 'Workspace', exact: true }).click({ button: 'right' });
  const root = page.getByRole('menu', { name: 'Workspace actions' });
  const row = root.getByRole('menuitem', { name: 'Locked', exact: true });
  const label = row.getByText('Locked', { exact: true });
  await expect(row).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await row.scrollIntoViewIfNeeded();
  const before = (await root.boundingBox())!;

  await label.evaluate((element) => {
    const menu = element.closest<HTMLElement>('[role="menu"]')!;
    const original = Range.prototype.getClientRects;
    Range.prototype.getClientRects = function () {
      const rects = original.call(this);
      if (element.contains(this.commonAncestorContainer)) {
        Range.prototype.getClientRects = original;
        // Reproduce placement moving the entire popup after the text read,
        // without faking either the text or accessory geometry.
        queueMicrotask(() => (menu.style.translate = '0 29px'));
      }
      return rects;
    };
  });
  await expectMenuFirstLine(row, label);
  expect((await root.boundingBox())!.y).not.toBe(before.y);

  for (const [selector, slot] of [
    ['[data-slot="menu-item-leading"] svg', 'menu-item-leading'],
    ['kbd', 'KBD'],
  ]) {
    const accessory = row.locator(selector);
    await accessory.evaluate((element) => element.setAttribute('style', 'translate: 0 8px'));
    await expect(expectMenuFirstLine(row, label)).rejects.toThrow(slot);
    await accessory.evaluate((element) => element.removeAttribute('style'));
  }
});

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
      const textEdges = await root
        .locator('[data-menu-item] > span:not([aria-hidden="true"]) > span')
        .evaluateAll((labels) =>
          labels.map((label) => {
            const range = document.createRange();
            range.selectNodeContents(label);
            return range.getBoundingClientRect().left;
          }),
        );
      expect(textEdges.length).toBeGreaterThan(6);
      expect(Math.max(...textEdges) - Math.min(...textEdges)).toBeLessThan(1);
      const rootStyles = await anatomy(root);
      expect(parseFloat(rootStyles.radius)).toBeGreaterThan(0);
      await test.info().attach(`${via}-${theme}-root`, {
        body: await root.screenshot(),
        contentType: 'image/png',
      });
      await expectDestructiveMenuInk(root.getByRole('menuitem', { name: 'Delete', exact: true }));
      const more = page.getByRole('menuitem', { name: 'More', exact: true });
      await more.hover();
      const child = page.getByRole('menuitem', { name: 'Export', exact: true });
      await expect(child).toBeVisible();
      const submenu = page.getByRole('menu').filter({ has: child });
      const subStyles = await anatomy(submenu);
      expect(subStyles.radius).toBe(rootStyles.radius);
      await test.info().attach(`${via}-${theme}-submenu`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
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
    await test.info().attach(`anatomy-${theme}`, {
      body: Buffer.from(JSON.stringify(snapshots)),
      contentType: 'application/json',
    });
  });
}

test('root and child surfaces remain usable when their preferred width exceeds the viewport', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 200, height: 480 });
  const component = await mount(SidebarMenuHarness, { props: { edge: true } });
  await component
    .getByRole('button', { name: 'Workspace', exact: true })
    .click({ button: 'right' });
  const root = page.getByRole('menu', { name: 'Workspace actions' });
  await expect(root).toBeVisible();
  const fitsViewport = (menu: Locator) =>
    menu.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.left >= 8 && bounds.right <= innerWidth - 8 && bounds.width <= innerWidth - 16;
    });
  await expect.poll(() => fitsViewport(root)).toBe(true);
  await page.getByRole('menuitem', { name: 'More', exact: true }).hover();
  const child = page.getByRole('menuitem', { name: 'Export', exact: true });
  await expect(child).toBeVisible();
  await expect.poll(() => fitsViewport(page.getByRole('menu').filter({ has: child }))).toBe(true);
  await child.hover();
  await expect(child).toBeVisible();
  await page.keyboard.press('Escape');
  const more = page.getByRole('menuitem', { name: 'More', exact: true });
  await expect(more).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(child).toBeFocused();
  await page.setViewportSize({ width: 420, height: 480 });
  await expect
    .poll(async () => {
      const triggerBounds = await more.boundingBox();
      const childBounds = await page.getByRole('menu').filter({ has: child }).boundingBox();
      return (
        !!triggerBounds &&
        !!childBounds &&
        (childBounds.x >= triggerBounds.x + triggerBounds.width ||
          childBounds.x + childBounds.width <= triggerBounds.x)
      );
    })
    .toBe(true);
  await page.setViewportSize({ width: 200, height: 480 });
  await expect.poll(() => fitsViewport(page.getByRole('menu').filter({ has: child }))).toBe(true);
  await expect(child).toBeFocused();
  await child.click();
  await expect(component.getByTestId('selection')).toHaveText('export');
  await expect(page.getByRole('menu')).toHaveCount(0);
});

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
