import { expect, test } from '../../../../../test/ct-test';
import type { Locator, Page } from '@playwright/test';
import PanelVerticalMovementHarness from './mocks/PanelVerticalMovementHarness.svelte';

function pane(component: Locator, title: string) {
  return component.locator(`[data-panel-id]:has([data-tab-id="${title}"][aria-hidden="false"])`);
}

async function move(page: Page, panel: Locator, direction: string) {
  const trigger = panel.locator('[data-panel-tabless-header]').getByTestId('panel-actions-trigger');
  await trigger.focus();
  await trigger.press('Enter');
  const menu = page.locator('.panel-actions-menu-content');
  await expect(menu).toBeVisible();
  const arrow = menu.getByRole('menuitem', { name: `Move panel ${direction}`, exact: true });
  await expect(arrow).toBeEnabled();
  await arrow.press('Enter');
  await expect(menu).toHaveCount(0);
}

async function geometry(panel: Locator) {
  const box = await panel.boundingBox();
  if (!box) throw new Error('Moved pane is not visible');
  return box;
}

for (const direction of ['up', 'down'] as const) {
  test(`moves active content ${direction}, resizes rows, restores, then moves horizontally`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(PanelVerticalMovementHarness);
    const state = component.getByTestId('vertical-layout-state');
    const alpha = pane(component, 'alpha');
    const original = await geometry(alpha);
    await move(page, alpha, direction);
    const beta = pane(component, 'beta');
    await expect(alpha).toHaveCount(1);
    await expect(beta).toBeVisible();
    const upper = direction === 'up' ? alpha : beta;
    const lower = direction === 'up' ? beta : alpha;
    await expect
      .poll(async () => {
        const a = await geometry(upper);
        const b = await geometry(lower);
        return a.y + a.height <= b.y && Math.abs(a.x - b.x) < 1;
      })
      .toBe(true);
    await expect(state).toHaveAttribute('data-columns', '1');
    await expect(alpha).toHaveAttribute('data-focused', 'true');
    await expect
      .poll(() => alpha.evaluate((node) => node.contains(document.activeElement)))
      .toBe(true);
    const split = { alpha: await geometry(alpha), beta: await geometry(beta) };
    expect(split.alpha.width).toBeCloseTo(original.width, 0);
    expect(split.beta.width).toBeCloseTo(original.width, 0);
    for (const bounds of Object.values(split)) {
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(original.y + original.height + 1);
    }
    await expect(alpha.locator('[data-tab-id="alpha"][aria-hidden="false"]')).toBeVisible();
    await expect(beta.locator('[data-tab-id="beta"][aria-hidden="false"]')).toBeVisible();

    await alpha.locator('[data-panel-tabless-header]').getByTestId('panel-actions-trigger').click();
    const boundary = page.getByRole('menuitem', { name: `Move panel ${direction}`, exact: true });
    await expect(boundary).toBeDisabled();
    await page.keyboard.press('Escape');

    const handle = component.locator('button[data-resize-axis="y"]');
    await expect(handle).toHaveCount(1);
    const beforeResize = await geometry(upper);
    const divider = await geometry(handle);
    await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2);
    await page.mouse.down();
    await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2 + 60, {
      steps: 4,
    });
    await page.mouse.up();
    await expect
      .poll(async () => (await geometry(upper)).height - beforeResize.height)
      .toBeGreaterThan(40);
    const resized = { alpha: await geometry(alpha), beta: await geometry(beta) };
    await component
      .getByTestId('restore-layout')
      .evaluate((node: HTMLButtonElement) => node.click());
    await expect
      .poll(async () => Math.abs((await geometry(alpha)).height - resized.alpha.height))
      .toBeLessThan(1);
    await expect(state).toHaveAttribute('data-columns', '1');
    await testInfo.attach(`vertical-${direction}.png`, {
      body: await component.screenshot(),
      contentType: 'image/png',
    });

    // Beta still owns Gamma: horizontal movement must create a column, never enter Alpha's row.
    await move(page, beta, 'right');
    const gamma = pane(component, 'gamma');
    await expect(gamma).toBeVisible();
    await expect(state).toHaveAttribute('data-columns', '2');
    await expect
      .poll(async () => {
        const a = await geometry(alpha);
        const b = await geometry(beta);
        return b.x >= a.x + a.width;
      })
      .toBe(true);
    await expect(beta).toHaveAttribute('data-focused', 'true');
    const horizontal = {
      alpha: await geometry(alpha),
      beta: await geometry(beta),
      gamma: await geometry(gamma),
    };
    await testInfo.attach(`vertical-${direction}-geometry.json`, {
      body: JSON.stringify(
        { original, split, resized, horizontal, layout: JSON.parse((await state.textContent())!) },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    await testInfo.attach(`horizontal-after-${direction}.png`, {
      body: await component.screenshot(),
      contentType: 'image/png',
    });
  });
}

test('disables both vertical directions for a lone pane', async ({ mount, page }) => {
  const component = await mount(PanelVerticalMovementHarness, { props: { lone: true } });
  await component
    .locator('[data-panel-tabless-header]')
    .getByTestId('panel-actions-trigger')
    .click();
  for (const direction of ['up', 'down']) {
    await expect(
      page.getByRole('menuitem', { name: `Move panel ${direction}`, exact: true }),
    ).toBeDisabled();
  }
});

for (const direction of ['up', 'down'] as const) {
  test(`closing the ${direction === 'up' ? 'top' : 'bottom'} row keeps its survivor visible`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(PanelVerticalMovementHarness);
    const alpha = pane(component, 'alpha');
    const original = await geometry(alpha);
    await move(page, alpha, direction);
    const beta = pane(component, 'beta');
    await expect(beta.locator('[data-tab-id="beta"][aria-hidden="false"]')).toBeVisible();
    await alpha.locator('[data-panel-tabless-header]').getByTestId('panel-close-button').click();
    await expect(alpha).toHaveCount(0);
    await expect(beta.locator('[data-tab-id="beta"][aria-hidden="false"]')).toBeVisible();
    await expect
      .poll(async () => Math.abs((await geometry(beta)).height - original.height))
      .toBeLessThan(1);
    const survivor = await geometry(beta);
    expect(survivor.y + survivor.height).toBeLessThanOrEqual(original.y + original.height + 1);
    await testInfo.attach(`close-${direction}-geometry.json`, {
      body: JSON.stringify({ original, survivor }),
      contentType: 'application/json',
    });
    await testInfo.attach(`close-${direction}.png`, {
      body: await component.screenshot(),
      contentType: 'image/png',
    });
  });
}

for (const direction of ['up', 'down'] as const) {
  test(`combines a single-tab row ${direction} and restores the combined content`, async ({
    mount,
    page,
  }, testInfo) => {
    const component = await mount(PanelVerticalMovementHarness);
    const state = component.getByTestId('vertical-layout-state');
    const alpha = pane(component, 'alpha');
    const original = await geometry(alpha);
    await move(page, alpha, direction === 'up' ? 'down' : 'up');
    await move(page, alpha, direction);
    await expect(component.locator('[data-panel-id]')).toHaveCount(1);
    await expect(alpha).toHaveAttribute('data-focused', 'true');
    await expect
      .poll(() => alpha.evaluate((node) => node.contains(document.activeElement)))
      .toBe(true);
    await expect
      .poll(async () => Math.abs((await geometry(alpha)).height - original.height))
      .toBeLessThan(1);
    const combined = JSON.parse((await state.textContent())!);
    expect(combined.panels.source.tabs.map((tab: { id: string }) => tab.id)).toEqual([
      'beta',
      'gamma',
      'alpha',
    ]);
    expect(combined.panels.source.activeTabId).toBe('alpha');
    await component
      .getByTestId('restore-layout')
      .evaluate((node: HTMLButtonElement) => node.click());
    await expect(alpha).toBeVisible();
    await expect(component.locator('[data-panel-id]')).toHaveCount(1);
    await testInfo.attach(`combined-${direction}.png`, {
      body: await component.screenshot(),
      contentType: 'image/png',
    });
  });
}

for (const direction of ['left', 'right'] as const) {
  test(`moves a single-tab lower row ${direction} into a side column`, async ({
    mount,
    page,
  }, testInfo) => {
    const component = await mount(PanelVerticalMovementHarness);
    const alpha = pane(component, 'alpha');
    await move(page, alpha, 'down');
    const beta = pane(component, 'beta');
    await move(page, alpha, direction);
    await expect(component.getByTestId('vertical-layout-state')).toHaveAttribute(
      'data-columns',
      '2',
    );
    await expect(alpha).toHaveAttribute('data-focused', 'true');
    await expect
      .poll(() => alpha.evaluate((node) => node.contains(document.activeElement)))
      .toBe(true);
    await expect
      .poll(async () => {
        const a = await geometry(alpha);
        const b = await geometry(beta);
        return (
          Math.abs(a.y - b.y) < 1 &&
          (direction === 'left' ? a.x + a.width <= b.x : b.x + b.width <= a.x)
        );
      })
      .toBe(true);
    await component
      .getByTestId('restore-layout')
      .evaluate((node: HTMLButtonElement) => node.click());
    await expect(alpha).toBeVisible();
    await expect(beta).toBeVisible();
    await expect(component.getByTestId('vertical-layout-state')).toHaveAttribute(
      'data-columns',
      '2',
    );
    await testInfo.attach(`single-row-${direction}.png`, {
      body: await component.screenshot(),
      contentType: 'image/png',
    });
  });
}
