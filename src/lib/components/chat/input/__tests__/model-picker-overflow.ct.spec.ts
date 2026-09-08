import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator, Page } from '@playwright/test';
import ModelPickerGeometryHost from './ModelPickerGeometryHost.svelte';

const outerMenu = (page: Page) =>
  page.getByRole('listbox').filter({ has: page.getByRole('searchbox') });
const innerMenu = (page: Page) => page.locator('[data-slot="select-content"]');
const modelTrigger = (page: Page) => page.getByTestId('model-picker-host').getByRole('button');

async function expectHitTarget(target: Locator) {
  // Never scrollIntoViewIfNeeded here: that can conceal clipping by scrolling
  // an overflow-hidden ancestor, moving the entire model picker instead.
  await expect
    .poll(() =>
      target.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return [0.1, 0.5, 0.9].every((fraction) =>
          element.contains(
            document.elementFromPoint(rect.x + rect.width * fraction, rect.y + rect.height / 2),
          ),
        );
      }),
    )
    .toBe(true);
}

async function expectBounded(menu: Locator, page: Page, boundary?: Locator) {
  await expect(menu).toBeVisible();
  const viewport = page.viewportSize()!;
  const limits = boundary ? (await boundary.boundingBox())! : { x: 0, y: 0, ...viewport };
  await expect
    .poll(async () => {
      const box = (await menu.boundingBox())!;
      return (
        box.x >= limits.x - 1 &&
        box.y >= limits.y - 1 &&
        box.x + box.width <= limits.x + limits.width + 1 &&
        box.y + box.height <= limits.y + limits.height + 1
      );
    })
    .toBe(true);
}

for (const placement of ['settings', 'composer', 'modal'] as const) {
  for (const constrained of [false, true]) {
    test(`${placement} ${constrained ? 'short/narrow long-list' : 'normal'} popup selection and dismissal`, async ({
      mount,
      page,
    }, testInfo) => {
      await page.setViewportSize(
        constrained ? { width: 320, height: 320 } : { width: 900, height: 800 },
      );
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await mount(ModelPickerGeometryHost, { props: { placement, longList: constrained } });
      const trigger = modelTrigger(page);
      await trigger.click();
      const outer = outerMenu(page);
      // Svelte's slide transition can start after mount; wait for the final
      // available-space height, not an arbitrary animation delay.
      await expect
        .poll(() =>
          outer.evaluate((element) =>
            Math.abs(
              element.getBoundingClientRect().height -
                parseFloat(getComputedStyle(element).maxHeight),
            ),
          ),
        )
        .toBeLessThan(1);
      await expectBounded(
        outer,
        page,
        placement === 'modal' ? page.getByTestId('picker-modal') : undefined,
      );
      if (!constrained && placement !== 'modal')
        expect((await outer.boundingBox())!.height).toBe(360);
      const initialOuter = await outer.boundingBox();
      const effortTrigger = page.getByTestId('effort-picker-trigger');
      await expectHitTarget(effortTrigger);
      await effortTrigger.click();
      const inner = innerMenu(page);
      await expectBounded(inner, page);
      expect(
        await effortTrigger.evaluate((element) =>
          Boolean(
            document
              .getElementById(element.getAttribute('aria-controls')!)
              ?.querySelector('[role="listbox"]'),
          ),
        ),
      ).toBe(true);
      // The popup border emits mousedown (unlike option pointerdown, which
      // prevents it); it must not be mistaken for a click outside the parent.
      await inner.click({ position: { x: 1, y: 1 } });
      await expect(outer).toBeVisible();
      await expect(inner).toBeVisible();
      await expect(inner.getByRole('option')).toHaveCount(constrained ? 22 : 8);
      const viewport = inner.locator('[data-select-viewport]');
      const last = inner.getByRole('option').last();
      if (constrained) {
        expect(await viewport.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
        await viewport.hover();
        await page.mouse.wheel(0, 2000);
      }
      await expectHitTarget(last);
      // Nested scrolling must not move the footer by scrolling or resizing
      // the parent (horizontal collision positioning can settle on scroll).
      const currentOuter = (await outer.boundingBox())!;
      expect(Math.abs(currentOuter.y - initialOuter!.y)).toBeLessThan(1);
      expect(Math.abs(currentOuter.height - initialOuter!.height)).toBeLessThan(1);
      await expectBounded(outer, page);
      expect(await outer.evaluate((el) => el.scrollTop)).toBe(0);
      await page.screenshot({
        path: testInfo.outputPath(`${placement}-${constrained ? 'short' : 'normal'}.png`),
      });
      await testInfo.attach('geometry', {
        body: JSON.stringify({
          outer: initialOuter,
          inner: await inner.boundingBox(),
          last: await last.boundingBox(),
        }),
        contentType: 'application/json',
      });
      await last.click();
      await expect(page.getByTestId('selection')).toHaveText(
        JSON.stringify({
          model: 'reasoning-model',
          effort: constrained ? 'last-effort' : 'max',
          changes: 1,
        }),
      );
      await expect(inner).toHaveCount(0);
      await expect(outer).toBeVisible();

      // Reopen the outer picker to check controlled-value persistence.
      await effortTrigger.press('Escape');
      await expect(outer).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await trigger.click();
      await effortTrigger.press('Enter');
      await expect(inner.getByRole('option').last()).toHaveAttribute('aria-selected', 'true');
      await effortTrigger.press('Home');
      await effortTrigger.press('Enter');
      await expect(page.getByTestId('selection')).toHaveText(
        JSON.stringify({ model: 'reasoning-model', effort: null, changes: 2 }),
      );

      // Keyboard-select the final level, then close one layer at a time.
      await effortTrigger.press('Enter');
      await effortTrigger.press('End');
      await expectHitTarget(inner.getByRole('option').last());
      await effortTrigger.press('Enter');
      await expect(page.getByTestId('selection')).toHaveText(
        JSON.stringify({
          model: 'reasoning-model',
          effort: constrained ? 'last-effort' : 'max',
          changes: 3,
        }),
      );
      await effortTrigger.press('Enter');
      await effortTrigger.press('Escape');
      await expect(inner).toHaveCount(0);
      await expect(outer).toBeVisible();
      await expect(effortTrigger).toBeFocused();
      await effortTrigger.press('Escape');
      await expect(outer).toHaveCount(0);
      await expect(trigger).toBeFocused();
      if (placement === 'modal') await expect(page.getByRole('dialog')).toBeVisible();

      await trigger.click();
      await effortTrigger.click();
      if (placement === 'modal') {
        await page
          .getByRole('heading', { name: 'Model settings' })
          .click({ position: { x: 2, y: 2 } });
      } else {
        await page.mouse.click(2, page.viewportSize()!.height / 2);
      }
      await expect(inner).toHaveCount(0);
      await expect(outer).toHaveCount(0);
      if (placement === 'modal') await expect(page.getByRole('dialog')).toBeVisible();

      // The model list still scrolls and selects independently of effort.
      await trigger.click();
      const modelViewport = outer.locator('[data-scroll-container]');
      await modelViewport.hover();
      await page.mouse.wheel(0, 2000);
      const lastModel = outer.getByRole('option', { name: 'Model 20', exact: true });
      await expectHitTarget(lastModel);
      await lastModel.click();
      await expect(page.getByTestId('selection')).toContainText('"model":"model-20"');
      await expect(outer).toHaveCount(0);
    });
  }
}

// intent#4159: committing a changed effort must not drop focus to <body> while
// the outer picker stays open. Focus is asserted via document.activeElement,
// and the trigger is never focused or pressed through a locator.
for (const input of ['keyboard', 'pointer'] as const) {
  for (const outcome of ['accept', 'reject'] as const) {
    test(`${input} effort commit keeps focus on the effort trigger when the change is ${outcome}ed`, async ({
      mount,
      page,
    }) => {
      await page.setViewportSize({ width: 900, height: 800 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await mount(ModelPickerGeometryHost, {
        props: { reasoningOutcome: outcome, settleDelayMs: 150 },
      });
      await modelTrigger(page).click();
      const outer = outerMenu(page);
      await expect(outer).toBeVisible();
      const effortTrigger = page.getByTestId('effort-picker-trigger');
      await effortTrigger.click();
      const inner = innerMenu(page);
      await expect(inner).toBeVisible();
      const target = inner.getByRole('option', { name: 'Off', exact: true });
      await expectHitTarget(target);
      if (input === 'keyboard') {
        await page.keyboard.press('ArrowDown');
        await expect(target).toHaveAttribute('data-highlighted');
        await page.keyboard.press('Enter');
      } else {
        const box = (await target.boundingBox())!;
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      }
      await expect(inner).toHaveCount(0);
      await expect(page.getByTestId('reasoning-settled')).toHaveText('1');
      await expect(page.getByTestId('selection')).toHaveText(
        JSON.stringify(
          outcome === 'accept'
            ? { model: 'reasoning-model', effort: 'none', changes: 1 }
            : { model: 'reasoning-model', effort: null, changes: 0 },
        ),
      );
      await expect(outer).toBeVisible();
      expect(
        await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null),
      ).toBe('effort-picker-trigger');
      await expect(effortTrigger).toBeFocused();
      await expect(effortTrigger).not.toHaveAttribute('aria-busy');

      // Focus is genuinely live: the outer Escape layer still closes the picker.
      await page.keyboard.press('Escape');
      await expect(outer).toHaveCount(0);
      await expect(modelTrigger(page)).toBeFocused();
    });
  }
}

test('disabled reasoning cannot open or change while model selection remains usable', async ({
  mount,
  page,
}) => {
  await mount(ModelPickerGeometryHost, { props: { disabled: true } });
  await modelTrigger(page).click();
  await expect(page.getByTestId('effort-picker-trigger')).toBeDisabled();
  await expect(innerMenu(page)).toHaveCount(0);
  const search = page.getByRole('searchbox');
  await search.fill('Model 20');
  await search.press('Enter');
  await expect(page.getByTestId('selection')).toHaveText(
    JSON.stringify({ model: 'model-20', effort: null, changes: 0 }),
  );
});
