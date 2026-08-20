import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Page } from '@playwright/test';
import PanelHeaderActionsHost from '../../layout/panel-system/__tests__/mocks/PanelHeaderActionsHost.svelte';

test.setTimeout(60_000);

async function setSliderValue(page: Page, count: number) {
  const slider = page.getByRole('slider', { name: 'Panel columns' });
  await slider.evaluate((element: HTMLInputElement, value: number) => {
    element.value = String(value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, count);
}

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
          'More',
          'Panel history',
          'Go back',
          'Go forward',
          'Panel columns: 2',
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
        for (const action of [columnTrigger, actionsTrigger, closeTrigger]) {
          const box = await action.boundingBox();
          expect(box!.width / zoom).toBeCloseTo(28, 0);
          expect(box!.height / zoom).toBeCloseTo(28, 0);
        }

        for (const count of [1, 2, 3, 4]) {
          await columnTrigger.click();
          await setSliderValue(page, count);
          await page.keyboard.press('Escape');
          const columnIcon = controls.locator(`[data-panel-column-icon="${count}"]`);
          const bars = columnIcon.locator('[data-panel-column-icon-bar]');
          await expect(columnTrigger).toHaveAccessibleName(`Panel columns: ${count}`);
          await expect(columnIcon).toHaveCount(1);
          await expect(bars).toHaveCount(count);
          const [iconBox, triggerBox] = await Promise.all([
            columnIcon.boundingBox(),
            columnTrigger.boundingBox(),
          ]);
          expect(iconBox!.width / zoom).toBeCloseTo(16, 1);
          expect(iconBox!.height / zoom).toBeCloseTo(16, 1);
          expect(iconBox!.x).toBeGreaterThanOrEqual(triggerBox!.x);
          expect(iconBox!.y).toBeGreaterThanOrEqual(triggerBox!.y);
          expect(iconBox!.x + iconBox!.width).toBeLessThanOrEqual(
            triggerBox!.x + triggerBox!.width + 0.5,
          );
          expect(iconBox!.y + iconBox!.height).toBeLessThanOrEqual(
            triggerBox!.y + triggerBox!.height + 0.5,
          );
          const barGeometry = await bars.evaluateAll((elements) =>
            elements.map((element) => {
              const box = element.getBoundingClientRect();
              return { width: box.width, height: box.height };
            }),
          );
          expect(new Set(barGeometry.map(({ width }) => width.toFixed(3))).size).toBe(1);
          expect(new Set(barGeometry.map(({ height }) => height.toFixed(3))).size).toBe(1);
          expect(barGeometry.every(({ width, height }) => width > 0 && height > 0)).toBe(true);
        }
      });
    }
  }
}

for (const theme of ['light', 'dark'] as const) {
  for (const zoom of [1, 2]) {
    test(`keeps the empty ${theme} structural header ordered at ${zoom * 100}% zoom`, async ({
      mount,
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const component = await mount(PanelHeaderActionsHost, {
        props: { theme, zoom, populated: false, initialCount: 4 },
      });
      const header = component.locator('[data-empty-panel-header]');
      const trigger = header.locator('[data-panel-column-count-trigger]');
      const close = header.locator('[data-testid="panel-close-button"]');
      expect(
        await header
          .locator('button')
          .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))),
      ).toEqual(['Panel columns: 4', 'Close panel']);
      const [headerBox, triggerBox, iconBox, closeBox] = await Promise.all([
        header.boundingBox(),
        trigger.boundingBox(),
        trigger.locator('[data-panel-column-icon="4"]').boundingBox(),
        close.boundingBox(),
      ]);
      expect(triggerBox!.x).toBeLessThan(closeBox!.x);
      expect(iconBox!.width / zoom).toBeCloseTo(16, 1);
      expect(iconBox!.height / zoom).toBeCloseTo(16, 1);
      expect(triggerBox!.height / zoom).toBeCloseTo(28, 0);
      expect(headerBox!.height / zoom).toBeGreaterThanOrEqual(triggerBox!.height / zoom);
      expect(closeBox!.x + closeBox!.width).toBeLessThanOrEqual(
        headerBox!.x + headerBox!.width + 0.5,
      );
    });
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
  const dialog = page.getByRole('dialog', { name: 'Panel columns' });
  const slider = page.getByRole('slider', { name: 'Panel columns' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(':scope > p')).toHaveText(
    'Change the number of columns for panes in this workspace. Newly opened panes open in the rightmost column.',
  );
  expect(
    await dialog.evaluate((node) => Array.from(node.children).map((child) => child.tagName)),
  ).toEqual(['P', 'DIV', 'INPUT']);
  await expect(dialog.getByText('Columns', { exact: true })).toBeVisible();
  await expect(dialog.locator('output')).toHaveText('2');
  await expect(slider).toBeFocused();
  await expect(slider).toHaveAttribute('min', '1');
  await expect(slider).toHaveAttribute('max', '4');
  await expect(slider).toHaveAttribute('step', '1');
  await expect(slider).toHaveAttribute('aria-valuetext', '2 columns');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(slider).toBeFocused();

  await page.keyboard.press('Home');
  await expect(component).toHaveAttribute('data-current-count', '1');
  await expect(dialog.locator('output')).toHaveText('1');
  await page.keyboard.press('ArrowLeft');
  await expect(component).toHaveAttribute('data-current-count', '1');
  await page.keyboard.press('ArrowRight');
  await expect(component).toHaveAttribute('data-current-count', '2');
  await page.keyboard.press('End');
  await expect(component).toHaveAttribute('data-current-count', '4');
  await expect(dialog.locator('output')).toHaveText('4');
  await expect(slider).toHaveAttribute('aria-valuetext', '4 columns');
  await page.keyboard.press('ArrowRight');
  await expect(component).toHaveAttribute('data-current-count', '4');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await trigger.click();
  const sliderBox = await slider.boundingBox();
  await slider.click({ position: { x: 1, y: sliderBox!.height / 2 } });
  await expect(component).toHaveAttribute('data-current-count', '1');
  await slider.click({ position: { x: sliderBox!.width - 1, y: sliderBox!.height / 2 } });
  await expect(component).toHaveAttribute('data-current-count', '4');
  await page.keyboard.press('Escape');

  for (const count of [1, 2, 3, 4]) {
    await trigger.click();
    await setSliderValue(page, count);
    await page.keyboard.press('Escape');
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
  await expect(page.locator(':focus')).toHaveAttribute('aria-label', 'Close panel');
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
  const [iconBox, triggerBox] = await Promise.all([icon.boundingBox(), trigger.boundingBox()]);
  expect(iconBox!.width / 2).toBeCloseTo(16, 1);
  expect(iconBox!.height / 2).toBeCloseTo(16, 1);
  expect(triggerBox!.width / 2).toBeCloseTo(28, 0);
  expect(triggerBox!.height / 2).toBeCloseTo(28, 0);
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
  await setSliderValue(page, 4);
  await page.keyboard.press('Escape');
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
  await setSliderValue(page, 3);
  await page.keyboard.press('Escape');
  const reducedIcon = trigger.locator('[data-panel-column-icon="3"]');
  await expect(reducedIcon).toHaveCount(1);
  expect(await reducedIcon.evaluate((element) => getComputedStyle(element).animationName)).toBe(
    'none',
  );
});
