import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator } from '@playwright/test';
import ButtonHarness from '../button/ButtonHarness.svelte';
import MenuHarness from '../menu/MenuTestHarness.svelte';
import InitialPicker from '../../workspace/initializer/initial-agent-picker.preview.svelte';
import ScaledHighlight from './ScaledHighlightHarness.svelte';
import DropdownSupplement from './DropdownSupplementHarness.svelte';

for (const portal of [false, true]) {
  test(`dropdown supplemental controls own keyboard input, portal=${portal}`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await mount(DropdownSupplement, { props: { portal } });
    await page.getByRole('button', { name: 'Alpha', exact: true }).click();
    const menu = page.getByRole('listbox');
    const supplemental = page.getByRole('button', { name: 'Configure option' });
    await expect(supplemental).toBeVisible();
    expect(
      await supplemental.evaluate((element) => element.parentElement?.closest('button')),
    ).toBeNull();
    await supplemental.focus();
    await supplemental.press('Enter');
    await expect(page.getByTestId('supplement-result')).toHaveText(
      JSON.stringify({ value: 'alpha', changes: 0, actions: 1 }),
    );
    await expect(menu).toBeVisible();
    await page.getByRole('button', { name: 'Header action' }).press('Enter');
    await page.getByRole('button', { name: 'Footer action' }).press('Enter');
    await expect(page.getByTestId('slot-actions')).toHaveText(
      JSON.stringify({ header: 1, footer: 1 }),
    );
    await expect(page.getByTestId('supplement-result')).toHaveText(
      JSON.stringify({ value: 'alpha', changes: 0, actions: 1 }),
    );
    const search = page.getByRole('searchbox');
    await search.fill('Bet');
    await expect(page.getByRole('option')).toHaveCount(1);
    expect(
      await menu.evaluate(
        (element) =>
          element.getAnimations({ subtree: true }).filter((animation) => {
            const target = (animation.effect as KeyframeEffect)?.target;
            return (
              target instanceof HTMLElement &&
              target.tagName === 'DIV' &&
              !target.closest('[data-slot="menu-list-highlight"]')
            );
          }).length,
      ),
    ).toBe(0);
    await search.press('Enter');
    await expect(page.getByTestId('supplement-result')).toHaveText(
      JSON.stringify({ value: 'beta', changes: 1, actions: 1 }),
    );
  });
}

async function textInset(row: Locator) {
  return row.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.textContent?.trim()) node = walker.nextNode();
    const range = document.createRange();
    range.selectNodeContents(node!);
    return range.getBoundingClientRect().left - element.getBoundingClientRect().left;
  });
}

test('highlight local geometry survives scale and scroll without pointer movement', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(ScaledHighlight);
  const list = page.getByTestId('scaled-list');
  const selected = list.getByRole('button', { name: 'Second' });
  const highlight = list.locator('.bg-selected');
  async function expectAligned() {
    await expect(async () => {
      const a = (await selected.boundingBox())!;
      const b = (await highlight.boundingBox())!;
      for (const field of ['x', 'y', 'width', 'height'] as const)
        expect(Math.abs(a[field] - b[field])).toBeLessThan(0.05);
    }).toPass({ timeout: 1500 });
  }
  await expectAligned();
  await page.getByRole('button', { name: 'Toggle scale' }).click();
  await expectAligned();
  await list.evaluate((element) => (element.scrollTop = 20));
  await expectAligned();
  await selected.hover();
  await expect(list.locator('[data-slot="menu-list-highlight"]')).toHaveAttribute(
    'data-active-index',
    '1',
  );
});

for (const theme of ['light', 'dark']) {
  test(`raw Button children paint above the surface in ${theme}`, async ({ mount, page }) => {
    await page.evaluate(
      (value) => document.documentElement.classList.toggle('dark', value === 'dark'),
      theme,
    );
    await mount(ButtonHarness);
    const button = page.getByRole('button', { name: 'Raw content action' });
    await button.hover();
    const order = await button.evaluate((element) => {
      const surface = element.querySelector<HTMLElement>('[data-slot="button-surface"]')!;
      const label = element.querySelector<HTMLElement>('[data-testid="raw-label"]')!;
      surface.style.pointerEvents = 'auto';
      const box = label.getBoundingClientRect();
      const stack = document.elementsFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      surface.style.removeProperty('pointer-events');
      return { label: stack.indexOf(label), surface: stack.indexOf(surface) };
    });
    expect(order.label).toBeGreaterThanOrEqual(0);
    expect(order.label).toBeLessThan(order.surface);
    await button.click();
    await expect(page.getByTestId('raw-clicks')).toHaveText('1');
  });
}

test('text-only menu items use only the canonical inset', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(MenuHarness);
  await page.getByRole('button', { name: 'Actions' }).click();
  const row = page.getByRole('menuitem', { name: 'Apple' });
  await expect(row).toBeVisible();
  expect(await textInset(row)).toBeCloseTo(8, 0);
  expect(await textInset(page.getByRole('menuitemcheckbox'))).toBeCloseTo(8, 0);
  await row.click();
  await expect(page.getByTestId('selected')).toHaveText('apple');
});

for (const state of ['populated', 'empty', 'compact'] as const) {
  test(`specialist ${state} has bounded stacked rows and keyboard selection`, async ({
    mount,
    page,
  }, info) => {
    await page.setViewportSize({ width: 360, height: 720 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(InitialPicker, { props: { state } });
    const trigger =
      state === 'compact'
        ? page.getByTestId('specialist-fixture').getByRole('button').first()
        : page.locator('.specialist-trigger');
    await trigger.focus();
    await trigger.press('Enter');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await page.screenshot({ path: info.outputPath('specialist-open.png') });
    const bounds = await menu.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(360);
    const choice =
      state === 'empty'
        ? menu.getByRole('menuitem').first()
        : menu.getByRole('menuitem', { name: /A specialist with/ });
    const geometry = await choice.evaluate((element) => {
      const row = element.getBoundingClientRect();
      const spans = [...element.querySelectorAll('span')].filter(
        (span) => span.children.length === 0 && span.textContent?.trim(),
      );
      const [title, description] = spans.map((span) => span.getBoundingClientRect());
      return {
        titleWeight: getComputedStyle(spans[0]).fontWeight,
        rowBottom: row.bottom,
        titleBottom: title.bottom,
        descriptionTop: description.top,
        descriptionBottom: description.bottom,
        overflow: element.scrollWidth - element.clientWidth,
      };
    });
    console.log('specialist geometry', state, geometry);
    expect(geometry.titleWeight).toBe('400');
    expect(geometry.descriptionTop).toBeGreaterThanOrEqual(geometry.titleBottom - 1);
    expect(geometry.descriptionBottom).toBeLessThanOrEqual(geometry.rowBottom + 1);
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    if (state !== 'empty') {
      await page.keyboard.press('ArrowDown');
    }
    await expect(choice).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('specialist-selection')).toHaveText(
      state === 'empty' ? 'general' : 'fixture-long',
    );
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.press('Enter');
    await expect(menu).toBeVisible();
    await expect(
      choice
        .locator('span')
        .filter({ hasText: state === 'empty' ? /General/ : /A specialist with/ })
        .last(),
    ).toHaveCSS('font-weight', '400');
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });
}

test('welcome specialist prompt expands and rich controls contain their content', async ({
  mount,
  page,
}, info) => {
  await page.setViewportSize({ width: 360, height: 720 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(InitialPicker, { props: { state: 'welcome' } });
  const trigger = page.getByTestId('specialist-picker-trigger');
  async function expectContentsInside(control: Locator) {
    expect(
      await control.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return [...element.children]
          .filter((child) => child.getAttribute('data-slot') !== 'button-surface')
          .every((child) => {
            const bounds = child.getBoundingClientRect();
            return (
              bounds.top >= box.top && bounds.bottom <= box.bottom && bounds.right <= box.right
            );
          });
      }),
    ).toBe(true);
  }
  await expectContentsInside(trigger);
  const prompt = page.getByTestId('agent-welcome-description');
  const collapsedHeight = (await prompt.boundingBox())!.height;
  await page.getByRole('button', { name: /Show more/i }).click();
  expect((await prompt.boundingBox())!.height).toBeGreaterThan(collapsedHeight);
  await page.getByRole('button', { name: /Show less/i }).click();
  expect((await prompt.boundingBox())!.height).toBeCloseTo(collapsedHeight, 0);
  await trigger.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const longChoice = menu.getByRole('menuitem', { name: /A specialist with/ });
  await expectContentsInside(longChoice);
  await page.screenshot({ path: info.outputPath('welcome-specialist-open.png') });
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(longChoice).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('specialist-selection')).toHaveText('fixture-long');
  await expect(trigger).toBeFocused();
});
