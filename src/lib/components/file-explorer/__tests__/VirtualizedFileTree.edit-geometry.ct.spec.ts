import { expect, test } from '../../../../test/ct-test';
import type { Locator } from '@playwright/test';
import VirtualizedFileTreeEditGeometryHost from './mocks/VirtualizedFileTreeEditGeometryHost.svelte';

async function expectRenameDecorationInsideTree(component: Locator, path: string) {
  const tree = component.getByRole('tree');
  const row = tree.locator(`[data-file-path="${path}"]`);
  const before = await row.boundingBox();

  await row.dispatchEvent('dblclick');
  await expect(row.getByRole('textbox')).toBeFocused();

  const geometry = await row.evaluate((element) => {
    const decoration = element.querySelector<HTMLElement>(':scope > span[aria-hidden="true"]')!;
    const tree = element.closest<HTMLElement>('[role="tree"]')!;
    const scroll = tree.firstElementChild as HTMLElement;
    const rect = (node: Element) => {
      const box = node.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    };
    const style = getComputedStyle(decoration);
    return {
      decoration: rect(decoration),
      scroll: rect(scroll),
      tree: rect(tree),
      borderWidths: [
        style.borderTopWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
        style.borderLeftWidth,
      ],
    };
  });
  const after = await row.boundingBox();

  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  expect(after!.y).toBeCloseTo(before!.y, 1);
  expect(after!.height).toBeCloseTo(before!.height, 1);
  expect(geometry.borderWidths).toEqual(['1px', '1px', '1px', '1px']);

  for (const ancestor of [geometry.scroll, geometry.tree]) {
    expect(geometry.decoration.left).toBeGreaterThanOrEqual(ancestor.left - 0.5);
    expect(geometry.decoration.right).toBeLessThanOrEqual(ancestor.right + 0.5);
    expect(geometry.decoration.top).toBeGreaterThanOrEqual(ancestor.top - 0.5);
    expect(geometry.decoration.bottom).toBeLessThanOrEqual(ancestor.bottom + 0.5);
  }
}

test('keeps the first root-row rename border inside the unscrolled tree', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(VirtualizedFileTreeEditGeometryHost, {
    props: { theme: 'light' },
  });
  await expect(component.getByRole('tree').locator(':scope > div')).toHaveJSProperty(
    'scrollTop',
    0,
  );
  await expectRenameDecorationInsideTree(component, '/project/README.md');
});

test('keeps a nested-row rename border inside the dark tree', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(VirtualizedFileTreeEditGeometryHost, {
    props: { theme: 'dark' },
  });
  await expectRenameDecorationInsideTree(component, '/project/src/nested.ts');
});

for (const theme of ['light', 'dark'] as const) {
  test(`fills the same panel width at root and depth two in ${theme}`, async ({ mount, page }) => {
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      theme === 'dark',
    );
    const component = await mount(VirtualizedFileTreeEditGeometryHost, { props: { theme } });
    const rows = component.locator('[data-file-path]');
    const root = rows.first();
    const nested = rows.last();
    await nested.hover();
    const fill = (row: Locator) => row.locator(':scope > span[aria-hidden="true"]');
    const rootBox = (await fill(root).boundingBox())!;
    const nestedBox = (await fill(nested).boundingBox())!;
    expect(nestedBox.x).toBeCloseTo(rootBox.x, 1);
    expect(nestedBox.width).toBeCloseTo(rootBox.width, 1);
    await expect(fill(nested)).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expectRenameDecorationInsideTree(component, '/project/src/nested.ts');
  });
}
