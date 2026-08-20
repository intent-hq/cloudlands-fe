import { expect, test } from '@playwright/experimental-ct-svelte';
import PanelHeaderActionsHost from '../../layout/panel-system/__tests__/mocks/PanelHeaderActionsHost.svelte';

test.setTimeout(60_000);

for (const theme of ['light', 'dark'] as const) {
  for (const width of [240, 560]) {
    for (const zoom of [1, 2]) {
      test(`keeps one crisp panel column control in ${theme} at ${width}px and ${zoom * 100}% zoom`, async ({
        mount,
        page,
      }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const component = await mount(PanelHeaderActionsHost, {
          props: { theme, width, zoom, initialCount: 2 },
        });
        const header = component.locator('[data-panel-tabless-header]');
        const controls = header.locator('[data-panel-header-actions]');
        const columnTrigger = controls.locator('[data-panel-column-count-trigger]');
        const actionsTrigger = controls.locator('[data-testid="panel-actions-trigger"]');
        const closeTrigger = controls.locator('[data-testid="panel-close-button"]');

        await expect(columnTrigger).toHaveCount(1);
        expect(
          await controls
            .locator('button')
            .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))),
        ).toEqual([
          'Panel columns: 2',
          'More',
          'Panel history',
          'Go back',
          'Go forward',
          'Close panel',
        ]);
        const [headerBox, titleBox, controlsBox] = await Promise.all([
          header.boundingBox(),
          header.locator('[data-panel-header-title]').boundingBox(),
          controls.boundingBox(),
        ]);
        expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(controlsBox!.x + 0.5);
        expect(controlsBox!.x + controlsBox!.width).toBeLessThanOrEqual(
          headerBox!.x + headerBox!.width + 0.5,
        );
        await expect(columnTrigger).toHaveAccessibleName('Panel columns: 2');
        const columnIcon = controls.locator('[data-panel-column-icon="2"]');
        await expect(columnIcon).toHaveCount(1);
        await expect(columnIcon.locator('[data-panel-column-icon-bar]')).toHaveCount(2);
        for (const action of [columnTrigger, actionsTrigger, closeTrigger]) {
          const box = await action.boundingBox();
          expect(box!.width / zoom).toBeCloseTo(28, 0);
          expect(box!.height / zoom).toBeCloseTo(28, 0);
        }
      });
    }
  }
}

test('updates the workspace-scoped count and keeps keyboard focus order', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(PanelHeaderActionsHost, {
    props: { initialCount: 2 },
  });
  const trigger = component.locator('[data-panel-column-count-trigger]');

  await trigger.focus();
  await expect(page.getByRole('tooltip')).toContainText('Change panel column count. Current: 2');
  await page.keyboard.press('Enter');
  const radios = page.getByRole('menuitemradio');
  await expect(radios).toHaveCount(4);
  await expect(page.getByRole('menuitemradio', { name: '2 columns' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');

  for (const count of [1, 2, 3, 4]) {
    await trigger.click();
    await page
      .getByRole('menuitemradio', { name: `${count} column${count === 1 ? '' : 's'}` })
      .click();
    await expect(component).toHaveAttribute('data-current-count', String(count));
    await expect(trigger).toHaveAccessibleName(`Panel columns: ${count}`);
    await expect(trigger.locator('[data-panel-column-icon-bar]')).toHaveCount(count);
  }

  await component
    .getByTestId('restore-column-count')
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(component).toHaveAttribute('data-current-count', '3');
  await expect(trigger.locator('[data-panel-column-icon="3"]')).toHaveCount(1);

  await component.update({ props: { workspaceId: 'panel-actions-alternate' } });
  await expect(component).toHaveAttribute('data-current-count', '4');
  await expect(trigger.locator('[data-panel-column-icon="4"]')).toHaveCount(1);

  await component.update({ props: { workspaceId: 'panel-actions-workspace' } });
  await expect(component).toHaveAttribute('data-current-count', '3');
  await expect(trigger.locator('[data-panel-column-icon="3"]')).toHaveCount(1);

  await trigger.focus();
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveAttribute('aria-label', 'More');
});

test('keeps the four-bar glyph visible and equal in forced colors at 200% zoom', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  const component = await mount(PanelHeaderActionsHost, {
    props: { initialCount: 4, zoom: 2 },
  });
  const trigger = component.locator('[data-panel-column-count-trigger]');
  const icon = trigger.locator('[data-panel-column-icon="4"]');
  const bars = icon.locator('[data-panel-column-icon-bar]');

  await expect(bars).toHaveCount(4);
  await expect(icon).toHaveAttribute('stroke', 'currentColor');
  await expect(icon).toHaveAttribute('stroke-width', '1');
  await expect(icon).toHaveAttribute('vector-effect', 'non-scaling-stroke');
  expect(
    await bars.evaluateAll((elements) =>
      elements.map((element) => [
        element.getAttribute('stroke-width'),
        element.getAttribute('vector-effect'),
      ]),
    ),
  ).toEqual(Array.from({ length: 4 }, () => ['1', 'non-scaling-stroke']));
  const geometry = await bars.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { width: box.width, height: box.height };
    }),
  );
  expect(new Set(geometry.map(({ width }) => width.toFixed(3))).size).toBe(1);
  expect(new Set(geometry.map(({ height }) => height.toFixed(3))).size).toBe(1);
  expect(geometry.every(({ width, height }) => width > 0 && height > 0)).toBe(true);
  expect(await icon.evaluate((element) => getComputedStyle(element).color)).not.toBe(
    'rgba(0, 0, 0, 0)',
  );
});

test('animates count changes without scaling the one-pixel strokes', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(PanelHeaderActionsHost, {
    props: { initialCount: 1, zoom: 2 },
  });
  const trigger = component.locator('[data-panel-column-count-trigger]');
  const initialIcon = await trigger.locator('[data-panel-column-icon="1"]').elementHandle();

  await trigger.click();
  await page.getByRole('menuitemradio', { name: '4 columns' }).click();
  const animatedIcon = trigger.locator('[data-panel-column-icon="4"]');
  await expect(animatedIcon).toHaveCount(1);
  expect(await initialIcon?.evaluate((element) => element.isConnected)).toBe(false);
  const motion = await animatedIcon.evaluate((element) => {
    const style = getComputedStyle(element);
    return { name: style.animationName, duration: Number.parseFloat(style.animationDuration) };
  });
  expect(motion.name).toContain('panel-column-icon-change');
  expect(motion.duration).toBeGreaterThan(0);
  expect(
    await animatedIcon
      .locator('[data-panel-column-icon-bar]')
      .evaluateAll((elements) =>
        elements.map((element) => [
          element.getAttribute('stroke-width'),
          element.getAttribute('vector-effect'),
        ]),
      ),
  ).toEqual(Array.from({ length: 4 }, () => ['1', 'non-scaling-stroke']));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await trigger.click();
  await page.getByRole('menuitemradio', { name: '3 columns' }).click();
  const reducedIcon = trigger.locator('[data-panel-column-icon="3"]');
  await expect(reducedIcon).toHaveCount(1);
  expect(await reducedIcon.evaluate((element) => getComputedStyle(element).animationName)).toBe(
    'none',
  );
});
