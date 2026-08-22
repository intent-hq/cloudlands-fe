import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Page } from '@playwright/test';
import PanelHeaderActionsHost from '../../layout/panel-system/__tests__/mocks/PanelHeaderActionsHost.svelte';

test.setTimeout(60_000);

async function selectColumnCount(page: Page, count: number) {
  await page
    .getByRole('button', { name: count === 1 ? '1 column' : `${count} columns`, exact: true })
    .click();
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
          await selectColumnCount(page, count);
          await page.keyboard.press('Escape');
          const columnIcon = controls.locator(`[data-panel-column-icon="${count}"]`);
          const dividers = columnIcon.locator(
            '[data-panel-column-divider][data-active="true"] line',
          );
          await expect(columnTrigger).toHaveAccessibleName(`Panel columns: ${count}`);
          await expect(columnIcon).toHaveCount(1);
          await expect(columnIcon.locator('[data-panel-column-icon-outline]')).toHaveCount(1);
          await expect(dividers).toHaveCount(count - 1);
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
          const dividerGeometry = await dividers.evaluateAll((elements) =>
            elements.map((element) => {
              const box = element.getBoundingClientRect();
              return {
                height: box.height,
                strokeWidth: element.getAttribute('stroke-width'),
                vectorEffect: element.getAttribute('vector-effect'),
              };
            }),
          );
          expect(
            dividerGeometry.every(
              ({ height, strokeWidth, vectorEffect }) =>
                height > 0 && strokeWidth === '1' && vectorEffect === 'non-scaling-stroke',
            ),
          ).toBe(true);
          if (dividerGeometry.length > 0) {
            expect(new Set(dividerGeometry.map(({ height }) => height.toFixed(3))).size).toBe(1);
          }
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
  const group = page.getByRole('group', { name: 'Panel columns' });
  const oneButton = page.getByRole('button', { name: '1 column', exact: true });
  const twoButton = page.getByRole('button', { name: '2 columns', exact: true });
  const fourButton = page.getByRole('button', { name: '4 columns', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(':scope > p')).toHaveText(
    'Change the number of columns for panes in this workspace. Newly opened panes open in the rightmost column.',
  );
  expect(
    await dialog.evaluate((node) => Array.from(node.children).map((child) => child.tagName)),
  ).toEqual(['P', 'DIV']);
  await expect(dialog.getByText('Columns', { exact: true })).toBeVisible();
  await expect(group).toBeVisible();
  await expect(group.getByRole('button')).toHaveCount(4);
  await expect(dialog.locator('output')).toHaveCount(0);
  await expect(dialog.getByRole('slider')).toHaveCount(0);
  await expect(twoButton).toBeFocused();
  await expect(twoButton).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(twoButton).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(oneButton).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(component).toHaveAttribute('data-current-count', '1');
  await expect(oneButton).toHaveAttribute('aria-pressed', 'true');
  await fourButton.click();
  await expect(component).toHaveAttribute('data-current-count', '4');
  await expect(fourButton).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  for (const count of [1, 2, 3, 4]) {
    await trigger.click();
    await selectColumnCount(page, count);
    await page.keyboard.press('Escape');
    await expect(component).toHaveAttribute('data-current-count', String(count));
    await expect(trigger).toHaveAccessibleName(`Panel columns: ${count}`);
    await expect(
      trigger.locator('[data-panel-column-divider][data-active="true"] line'),
    ).toHaveCount(count - 1);
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

test('keeps the divider glyph visible and equal in forced colors at 200% zoom', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  const component = await mount(PanelHeaderActionsHost, {
    props: { initialCount: 4, zoom: 2 },
  });
  const trigger = component.locator('[data-panel-column-count-trigger]');
  const icon = trigger.locator('[data-panel-column-icon="4"]');
  const outline = icon.locator('[data-panel-column-icon-outline]');
  const dividers = icon.locator('[data-panel-column-divider][data-active="true"] line');

  await expect(outline).toHaveCount(1);
  await expect(dividers).toHaveCount(3);
  const [iconBox, triggerBox] = await Promise.all([icon.boundingBox(), trigger.boundingBox()]);
  expect(iconBox!.width / 2).toBeCloseTo(16, 1);
  expect(iconBox!.height / 2).toBeCloseTo(16, 1);
  expect(triggerBox!.width / 2).toBeCloseTo(28, 0);
  expect(triggerBox!.height / 2).toBeCloseTo(28, 0);
  await expect(icon).toHaveAttribute('stroke', 'currentColor');
  await expect(icon).toHaveAttribute('stroke-width', '1');
  await expect(outline).toHaveAttribute('vector-effect', 'non-scaling-stroke');
  expect(
    await dividers.evaluateAll((elements) =>
      elements.map((element) => [
        element.getAttribute('stroke-width'),
        element.getAttribute('vector-effect'),
      ]),
    ),
  ).toEqual(Array.from({ length: 3 }, () => ['1', 'non-scaling-stroke']));
  const geometry = await dividers.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { height: box.height, stroke: getComputedStyle(element).stroke };
    }),
  );
  expect(new Set(geometry.map(({ height }) => height.toFixed(3))).size).toBe(1);
  expect(geometry.every(({ height, stroke }) => height > 0 && stroke !== 'none')).toBe(true);
  expect(await icon.evaluate((element) => getComputedStyle(element).color)).not.toBe(
    'rgba(0, 0, 0, 0)',
  );
});

test('moves stable dividers horizontally and updates immediately with reduced motion', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(PanelHeaderActionsHost, {
    props: { initialCount: 1, zoom: 2 },
  });
  const trigger = component.locator('[data-panel-column-count-trigger]');
  const initialIcon = await trigger.locator('[data-panel-column-icon="1"]').elementHandle();
  const initialOutline = await trigger.locator('[data-panel-column-icon-outline]').elementHandle();
  const dividerSlots = trigger.locator('[data-panel-column-divider]');
  await expect(dividerSlots).toHaveCount(3);
  const initialTransforms = await dividerSlots.evaluateAll((elements) =>
    elements.map((element) => (element as SVGElement).style.transform),
  );

  await trigger.click();
  await selectColumnCount(page, 4);
  await page.keyboard.press('Escape');
  const animatedIcon = trigger.locator('[data-panel-column-icon="4"]');
  await expect(animatedIcon).toHaveCount(1);
  expect(await initialIcon?.evaluate((element) => element.isConnected)).toBe(true);
  expect(await animatedIcon.evaluate((element, initial) => element === initial, initialIcon)).toBe(
    true,
  );
  expect(
    await animatedIcon
      .locator('[data-panel-column-icon-outline]')
      .evaluate((element, initial) => element === initial, initialOutline),
  ).toBe(true);
  await expect(
    animatedIcon.locator('[data-panel-column-divider][data-active="true"] line'),
  ).toHaveCount(3);
  const movedTransforms = await dividerSlots.evaluateAll((elements) =>
    elements.map((element) => (element as SVGElement).style.transform),
  );
  expect(movedTransforms.slice(0, 2)).not.toEqual(initialTransforms.slice(0, 2));
  expect(movedTransforms.every((transform) => transform.startsWith('translateX('))).toBe(true);
  const motion = await dividerSlots.first().evaluate((element) => {
    const style = getComputedStyle(element);
    return { property: style.transitionProperty, duration: style.transitionDuration };
  });
  expect(motion.property).toContain('transform');
  expect(motion.duration).not.toBe('0s');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const beforeReducedTransforms = movedTransforms;
  await trigger.click();
  await selectColumnCount(page, 3);
  await page.keyboard.press('Escape');
  const reducedIcon = trigger.locator('[data-panel-column-icon="3"]');
  await expect(reducedIcon).toHaveCount(1);
  await expect(
    reducedIcon.locator('[data-panel-column-divider][data-active="true"] line'),
  ).toHaveCount(2);
  const reducedTransforms = await dividerSlots.evaluateAll((elements) =>
    elements.map((element) => (element as SVGElement).style.transform),
  );
  expect(reducedTransforms).not.toEqual(beforeReducedTransforms);
  const reducedDurations = await dividerSlots.evaluateAll((elements) =>
    elements.map((element) => Number.parseFloat(getComputedStyle(element).transitionDuration)),
  );
  expect(reducedDurations.every((duration) => duration <= 0.00001)).toBe(true);
});
