import type { Locator } from '@playwright/test';
import { expect, test } from '../../../../test/ct-test';
import Harness from './ActionMenuAlignmentHarness.svelte';

async function textLeft(label: Locator) {
  return label.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return (
      range.getBoundingClientRect().left -
      element.closest('[role="menu"]')!.getBoundingClientRect().left
    );
  });
}

async function textInset(label: Locator) {
  return label.evaluate((element) => {
    const row = element.closest('[data-menu-item]')!;
    const style = getComputedStyle(row);
    const range = document.createRange();
    range.selectNodeContents(element);
    return (
      range.getBoundingClientRect().left -
      row.getBoundingClientRect().left -
      parseFloat(style.borderLeftWidth) -
      parseFloat(style.paddingLeft)
    );
  });
}

for (const iconSource of ['root', 'section', 'radio', 'submenu', 'hidden'] as const) {
  test(`menu text shares a column with ${iconSource} icons and keeps submenus independent`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 600, height: 720 });
    await mount(Harness, { props: { iconSource } });
    const trigger = page.getByRole('button', { name: 'Actions', exact: true });
    await trigger.click();
    const root = page.getByRole('menu', { name: 'Workspace menu', exact: true });
    const rename = root.getByRole('menuitem', { name: 'Rename', exact: true });
    await expect(rename).toBeVisible();
    const left = await textLeft(rename.getByText('Rename', { exact: true }));
    const rootHasIcon = ['root', 'section', 'radio'].includes(iconSource);
    expect(await textInset(rename.getByText('Rename', { exact: true }))).toBeCloseTo(
      rootHasIcon ? 24 : 0,
      0,
    );
    for (const label of [
      'Workspace',
      'Manage',
      'Edit',
      'Locked',
      'Show details',
      'Density',
      'Compact',
      'Comfortable',
      'More',
      'Delete',
    ]) {
      expect(await textLeft(root.getByText(label, { exact: true }))).toBeCloseTo(left, 0);
    }
    expect(
      await textLeft(
        root
          .getByRole('menuitem', { name: 'Locked', exact: true })
          .getByText('Requires access', { exact: true }),
      ),
    ).toBeCloseTo(left, 0);
    const checkbox = root.getByRole('menuitemcheckbox', { name: 'Show details' });
    await checkbox.click();
    await expect(checkbox).toHaveAttribute('aria-checked', 'true');
    const compact = root.getByRole('menuitemradio', { name: 'Compact', exact: true });
    await compact.click();
    await expect(compact).toHaveAttribute('aria-checked', 'true');
    expect(await textLeft(compact.getByText('Compact', { exact: true }))).toBeCloseTo(left, 0);
    const more = root.getByRole('menuitem', { name: 'More', exact: true });
    await more.focus();
    await page.keyboard.press('ArrowRight');
    const child = page
      .getByRole('menu')
      .filter({ has: page.getByRole('menuitem', { name: 'Export', exact: true }) });
    const exportRow = child.getByRole('menuitem', { name: 'Export', exact: true });
    await expect(exportRow).toBeFocused();
    const childLeft = await textLeft(exportRow.getByText('Export', { exact: true }));
    expect(await textInset(exportRow.getByText('Export', { exact: true }))).toBeCloseTo(
      iconSource === 'submenu' ? 24 : 0,
      0,
    );
    expect(await textLeft(child.getByText('Copy', { exact: true }))).toBeCloseTo(childLeft, 0);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('selection')).toHaveText('export');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}
