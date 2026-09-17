import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator, Page } from '@playwright/test';
import TooltipHarness from './TooltipHarness.svelte';

test.use({ viewport: { width: 1280, height: 800 }, colorScheme: 'light', reducedMotion: 'reduce' });

async function tabTo(page: Page, target: Locator) {
  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((node) => node === document.activeElement)) break;
  }
  await expect(target).toBeFocused();
}

async function expectRelationship(trigger: Locator, tooltip: Locator, description: string) {
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveAttribute('id', /^\S+$/);
  const id = (await tooltip.getAttribute('id'))!;
  await expect(trigger).toHaveAccessibleDescription(description);
  expect(await trigger.getAttribute('aria-describedby')).toBe(id);
  expect(
    await tooltip.evaluate((node) => ({
      resolves: document.getElementById(node.id) === node,
      matches: Array.from(document.querySelectorAll('[id]')).filter((item) => item.id === node.id)
        .length,
    })),
  ).toEqual({ resolves: true, matches: 1 });
  return id;
}

async function expectDismissed(trigger: Locator, tooltip: Locator) {
  await expect(tooltip).toHaveCount(0);
  await expect(trigger).not.toHaveAttribute('aria-describedby', /.+/);
  await expect(trigger).toHaveAccessibleDescription('');
}

test('generic wrapped and passive triggers resolve unique descriptions through focus hover and Escape', async ({
  mount,
  page,
}) => {
  await mount(TooltipHarness);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.mouse.move(1200, 700);
  const wrapped = page.getByRole('button', { name: 'Show wrapped help', exact: true });
  const wrappedTooltip = page.getByRole('tooltip', { name: 'Wrapped button help', exact: true });
  await tabTo(page, wrapped);
  const wrappedId = await expectRelationship(wrapped, wrappedTooltip, 'Wrapped button help');
  await page.keyboard.press('Escape');
  await expect(wrapped).toBeFocused();
  await expectDismissed(wrapped, wrappedTooltip);
  await wrapped.hover();
  expect(await expectRelationship(wrapped, wrappedTooltip, 'Wrapped button help')).toBe(wrappedId);
  await page.mouse.move(1200, 700);
  await expectDismissed(wrapped, wrappedTooltip);

  const passive = page.getByRole('button', { name: 'Passive status', exact: true });
  const passiveTooltip = page.getByRole('tooltip', { name: 'Passive status help', exact: true });
  await tabTo(page, passive);
  const passiveId = await expectRelationship(passive, passiveTooltip, 'Passive status help');
  expect(passiveId).not.toBe(wrappedId);
  await page.keyboard.press('Escape');
  await expect(passive).toBeFocused();
  await expectDismissed(passive, passiveTooltip);
  await passive.hover();
  expect(await expectRelationship(passive, passiveTooltip, 'Passive status help')).toBe(passiveId);
  await page.keyboard.press('Escape');
  await expectDismissed(passive, passiveTooltip);
});

for (const target of [
  { name: 'Show wrapped help', help: 'Wrapped button help', fixture: 'wrapped-tooltip' },
  { name: 'Passive status', help: 'Passive status help', fixture: 'passive-tooltip' },
]) {
  test(`generic ${target.fixture} portal renders the tooltip inside the viewport clear of its trigger with contained text`, async ({
    mount,
    page,
  }, testInfo) => {
    await mount(TooltipHarness);
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const trigger = page.getByRole('button', { name: target.name, exact: true });
    const tooltip = page.getByRole('tooltip', { name: target.help, exact: true });
    await trigger.hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveCSS('opacity', '1');
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const triggerBox = (await trigger.boundingBox())!;
    const geometry = await tooltip.evaluate((node) => {
      const rect = (value: DOMRect) => ({
        x: value.x,
        y: value.y,
        width: value.width,
        height: value.height,
      });
      const range = document.createRange();
      range.selectNodeContents(node);
      return {
        box: rect(node.getBoundingClientRect()),
        text: Array.from(range.getClientRects()).map(rect),
      };
    });
    await testInfo.attach(`${target.fixture}-geometry`, {
      body: JSON.stringify({ viewport: page.viewportSize(), triggerBox, ...geometry }, null, 2),
      contentType: 'application/json',
    });
    expect(await page.getByTestId(target.fixture).getByRole('tooltip').count()).toBe(0);
    const box = geometry.box;
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1280);
    expect(box.y + box.height).toBeLessThanOrEqual(800);
    expect(
      box.y + box.height <= triggerBox.y ||
        box.y >= triggerBox.y + triggerBox.height ||
        box.x + box.width <= triggerBox.x ||
        box.x >= triggerBox.x + triggerBox.width,
    ).toBe(true);
    expect(geometry.text.length).toBeGreaterThan(0);
    for (const text of geometry.text) {
      expect(text.width).toBeGreaterThan(0);
      expect(text.height).toBeGreaterThan(0);
      expect(text.x).toBeGreaterThanOrEqual(box.x - 1);
      expect(text.y).toBeGreaterThanOrEqual(box.y - 1);
      expect(text.x + text.width).toBeLessThanOrEqual(box.x + box.width + 1);
      expect(text.y + text.height).toBeLessThanOrEqual(box.y + box.height + 1);
    }
    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
    await page.mouse.move(1200, 700);
  });
}
