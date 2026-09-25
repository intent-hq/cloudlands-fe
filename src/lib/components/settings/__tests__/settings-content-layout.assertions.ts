import type { test } from '@playwright/experimental-ct-svelte';
import { expect } from '../../../../test/ct-test';

// Derive from CT's fixture so locator types match its expect, not another Playwright version.
type Page = Parameters<Parameters<typeof test>[2]>[0]['page'];
type Locator = ReturnType<Page['locator']>;

export async function assertSettingsContentLayout(root: Locator, stacked: boolean) {
  await expect(root.locator('#maxConcurrentAgents')).toHaveValue('12');
  await expect(root.locator('#idleReapMinutes')).toHaveValue('15');
  await expect(root.getByRole('switch').last()).toBeEnabled();
  const geometry = await root.locator('[data-slot="settings-field-row"]').evaluateAll((rows) =>
    rows.map((row) => {
      const rect = (element: Element) => {
        const box = element.getBoundingClientRect();
        return {
          x: box.x,
          y: box.y,
          right: box.right,
          bottom: box.bottom,
          width: box.width,
          height: box.height,
        };
      };
      const control = row.querySelector(
        '[data-slot="slider-root"], input:not([type="hidden"]), [role="switch"], [role="combobox"]',
      )!;
      const label = row.querySelector('[data-field-label]')!;
      return {
        id: row.id,
        row: rect(row),
        label: rect(label),
        description: rect(row.querySelector(`[id="${row.id}-description"]`)!),
        control: rect(control),
      };
    }),
  );
  expect(geometry).toHaveLength(10);
  for (const { id, row, label, description, control } of geometry) {
    expect(control.x, `${id} left containment`).toBeGreaterThanOrEqual(row.x);
    expect(control.right, `${id} right containment`).toBeLessThanOrEqual(row.right + 1);
    if (stacked) {
      expect(control.y, `${id} below description`).toBeGreaterThanOrEqual(description.bottom);
      expect(control.x, `${id} left alignment`).toBeCloseTo(label.x, 1);
    } else {
      expect(control.right, `${id} right alignment`).toBeCloseTo(row.right, 1);
      if (id === 'memory-budget') {
        // The stacked slider + number field starts at the label's top; its
        // 36px slider hit area is intentionally taller than a standard input.
        expect(control.y, `${id} composite top alignment`).toBeCloseTo(label.y, 1);
      } else {
        expect(
          Math.abs(control.y + control.height / 2 - (label.y + label.height / 2)),
          `${id} label/control alignment`,
        ).toBeLessThanOrEqual(1);
      }
    }
  }
  const reap = await root.locator('#idleReapToggle').boundingBox();
  expect(reap?.width).toBe(28);
  expect(reap?.height).toBe(16);
  return geometry;
}

export async function exerciseSettingsContent(page: Page, root: Locator) {
  const reap = root.locator('#idleReapToggle');
  await expect(reap).toHaveAttribute('aria-checked', 'true');
  await reap.focus();
  await page.keyboard.press('Space');
  await expect(reap).toHaveAttribute('aria-checked', 'false');
  await expect(root.locator('#idleReapMinutes')).toHaveCount(0);
  await page.keyboard.press('Space');
  await expect(root.locator('#idleReapMinutes')).toHaveValue('15');

  const budget = root.locator('#memoryBudgetMb');
  await budget.fill('5000');
  await budget.press('Enter');
  const slider = root.locator('#memory-budget').getByRole('slider');
  await expect(slider).toHaveAttribute('aria-valuenow', '5000');
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(budget).toHaveValue('5001');

  const cap = root.locator('#maxConcurrentAgents');
  await cap.fill('18');
  await cap.press('Enter');
  await expect(cap).toHaveValue('18');

  const retentionRow = root.locator('#workspace-api-retentionDays');
  await retentionRow.getByRole('spinbutton').fill('45');
  await retentionRow.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(retentionRow.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await expect(root.getByTestId('settings-writes')).toHaveText(
    JSON.stringify([
      { path: 'agents.idleReapMinutes', value: 0 },
      { path: 'agents.idleReapMinutes', value: 15 },
      { path: 'agents.memoryBudgetMb', value: 5000 },
      { path: 'agents.memoryBudgetMb', value: 5001 },
      { path: 'agents.maxConcurrent', value: 18 },
      { path: 'agents.toolPayloadRetentionDays', value: 45 },
    ]),
  );
}
