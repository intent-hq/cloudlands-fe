import { expect, type test } from '@playwright/experimental-ct-svelte';

// Derive from CT's fixture so locator types match its expect, not another Playwright version.
type Page = Parameters<Parameters<typeof test>[2]>[0]['page'];
type Locator = ReturnType<Page['locator']>;

export async function assertRtkLoading(root: Locator) {
  const row = root.locator('#cli-optimization');
  await expect(row.getByRole('status')).toBeVisible();
  await expect(row.locator('#rtk-enabled')).toHaveAttribute('aria-busy', 'true');
  await expect(row.getByRole('switch')).toHaveCount(0);
  await expect(root.getByTestId('settings-writes')).toHaveText('[]');
}

export async function assertRtkShellGeometry(root: Locator, stacked: boolean) {
  await expect(root.locator('#rtk-enabled').getByRole('switch')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(root.locator('#cow-isolation').getByRole('checkbox')).toBeEnabled();
  const geometry = await root.evaluate((root) => {
    const box = (selector: string) => {
      const r = root.querySelector(selector)!.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, height: r.height };
    };
    return {
      outer: box('#cli-optimization'),
      rtk: box('#rtk-enabled'),
      label: box('#rtk-enabled-label'),
      description: box('#rtk-enabled-description'),
      control: box('#rtk-enabled [role=switch]'),
      cow: box('#cow-isolation'),
      cowLabel: box('#cow-isolation-label'),
    };
  });
  expect(geometry.label.x).toBeCloseTo(geometry.cowLabel.x, 1);
  expect(geometry.label.y - geometry.outer.y).toBeCloseTo(geometry.cowLabel.y - geometry.cow.y, 1);
  expect(geometry.outer.height).toBeCloseTo(geometry.rtk.height, 1);
  expect(geometry.control.right).toBeLessThanOrEqual(geometry.rtk.right + 1);
  if (stacked) {
    expect(geometry.control.x).toBeCloseTo(geometry.label.x, 1);
    expect(geometry.control.y).toBeGreaterThanOrEqual(geometry.description.bottom);
  } else {
    expect(geometry.control.right).toBeCloseTo(geometry.rtk.right, 1);
    expect(geometry.control.y + geometry.control.height / 2).toBeCloseTo(
      geometry.label.y + geometry.label.height / 2,
      1,
    );
  }
  return geometry;
}

export async function exerciseShellAndRtk(page: Page, root: Locator) {
  const trigger = root.locator('#setting-default-shell');
  const label = root.locator('#default-shell-label');
  await label.hover();
  const bounds = await label.boundingBox();
  await label.click({ position: { x: bounds!.width - 4, y: bounds!.height / 2 } });
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(root.getByTestId('settings-writes')).toHaveText('[]');
  await page.getByRole('option', { name: 'Zsh', exact: true }).click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();

  const toggle = root.locator('#rtk-enabled').getByRole('switch');
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(root.getByTestId('settings-writes')).toHaveText(
    JSON.stringify([
      { path: 'workspace.defaultShell', value: '/bin/zsh' },
      { path: 'rtk.enabled', value: false },
    ]),
  );
}
