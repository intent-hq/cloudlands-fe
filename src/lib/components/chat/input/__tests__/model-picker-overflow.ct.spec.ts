import { expect, test } from '../../../../../test/ct-test';
import type { Locator, Page } from '@playwright/test';
import ModelPickerGeometryHost from './ModelPickerGeometryHost.svelte';
import SimpleRichInputQueueHost from '../SimpleRichInputQueueHost.svelte';

const outerMenu = (page: Page) =>
  page.locator('[data-slot="dropdown-content"]').filter({ has: page.getByRole('searchbox') });
const innerMenu = (page: Page) => page.locator('[data-slot="select-content"]');
const modelTrigger = (page: Page) => page.getByTestId('model-picker-host').getByRole('button');

test('compact composer Auto gauge stays centered and stable after explicit effort', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(ModelPickerGeometryHost, { props: { placement: 'composer' } });
  await page.evaluate(() => document.fonts.ready);
  const trigger = modelTrigger(page);
  const gauge = trigger.getByTestId('model-reasoning-effort-gauge');
  const needle = trigger.getByTestId('model-reasoning-effort-gauge-needle');
  await expect(trigger).toHaveAccessibleName('Reasoning model · Auto');
  await expect(needle).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  const initial = await gauge.boundingBox();
  expect(initial).not.toBeNull();
  const label = trigger.getByText('Reasoning model', { exact: true });
  const labelBox = (await label.boundingBox())!;
  const iconBox = (await trigger.getByRole('img').boundingBox())!;
  expect(iconBox.x + iconBox.width).toBeLessThan(labelBox.x);
  expect(labelBox.x + labelBox.width).toBeLessThan(initial!.x);
  expect(initial!.x + initial!.width).toBeLessThanOrEqual(320);
  const bounds = (await trigger.boundingBox())!;
  expect(Math.abs(initial!.y + initial!.height / 2 - bounds.y - bounds.height / 2)).toBeLessThan(1);
  await expectHitTarget(trigger);
  await testInfo.attach('compact-composer-auto-gauge', {
    body: await trigger.screenshot(),
    contentType: 'image/png',
  });
  await trigger.press('Enter');
  await page.getByTestId('effort-picker-trigger').click();
  await innerMenu(page).getByRole('option', { name: 'High', exact: true }).click();
  await expect(trigger).toHaveAccessibleName('Reasoning model · High');
  await expect(needle).not.toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  expect(await gauge.boundingBox()).toEqual(initial);
  expect(await trigger.boundingBox()).toEqual(bounds);
  await page.getByTestId('effort-picker-trigger').click();
  await innerMenu(page).getByRole('option', { name: 'Auto', exact: true }).click();
  await page.getByTestId('effort-picker-trigger').press('Escape');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAccessibleName('Reasoning model · Auto');
  await expect(needle).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  expect(await gauge.boundingBox()).toEqual(initial);
  await testInfo.attach('auto-gauge-geometry', {
    body: JSON.stringify({ initial, after: await gauge.boundingBox(), trigger: bounds }),
    contentType: 'application/json',
  });
});

test('composer model content aligns with text while its hover target extends on both sides', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(SimpleRichInputQueueHost, { props: { queueCount: 0 } });
  await component.locator('.tiptap-editor').fill('Align this composer');
  await page.evaluate(() => document.fonts.ready);
  const trigger = component.locator('[data-chat-input-primary-actions] button').first();
  const geometry = await trigger.evaluate((button) => {
    const content = button.querySelector('span.inline-flex')!.getBoundingClientRect();
    const label = button.querySelector<HTMLElement>('span.inline-flex > span.truncate')!;
    const text = button
      .closest('[data-testid="message-input"]')!
      .querySelector('.tiptap-editor p')!
      .getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    return {
      alignment: content.left - text.left,
      leftInset: content.left - rect.left,
      rightInset: rect.right - content.right,
      labelClipped: label.scrollWidth > label.clientWidth,
    };
  });
  expect(Math.abs(geometry.alignment)).toBeLessThan(1);
  expect(geometry.leftInset).toBeGreaterThanOrEqual(8);
  expect(Math.abs(geometry.leftInset - geometry.rightInset)).toBeLessThan(1);
  expect(geometry.labelClipped).toBe(false);
  await expectHitTarget(trigger);
  // The composer rows above the action bar can still be settling vertically after the
  // fill, so two absolute boundingBox() reads can straddle that shift (intent#5340).
  // Hover may only change paint on the trigger itself, so measure its box against its
  // action bar, with both rects read in one frame.
  const triggerInBar = () =>
    trigger.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const bar = button.closest('[data-chat-input-action-bar]')!.getBoundingClientRect();
      return {
        left: rect.left - bar.left,
        top: rect.top - bar.top,
        width: rect.width,
        height: rect.height,
      };
    });
  const rest = await triggerInBar();
  const background = await trigger.evaluate((el) => getComputedStyle(el).backgroundColor);
  await trigger.hover();
  await expect
    .poll(() => trigger.evaluate((el) => getComputedStyle(el).backgroundColor))
    .not.toBe(background);
  expect(await triggerInBar()).toEqual(rest);
});

test('model labels stay normal weight through pointer and keyboard selection', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(ModelPickerGeometryHost);
  const trigger = modelTrigger(page);
  await trigger.press('Enter');
  const current = page.getByRole('option', { name: /Reasoning model/ });
  const next = page.getByRole('option', { name: 'Model 2', exact: true });
  const currentLabel = current.getByText('Reasoning model', { exact: true });
  const nextLabel = next.getByText('Model 2', { exact: true });
  await expect(current).toHaveAttribute('aria-selected', 'true');
  await expect(currentLabel).toHaveCSS('font-weight', '400');
  await expect(nextLabel).toHaveCSS('font-weight', '400');
  await next.click();
  await expect(page.getByTestId('selection')).toContainText('"model":"model-2"');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(next).toHaveAttribute('aria-selected', 'true');
  await expect(current).toHaveAttribute('aria-selected', 'false');
  await expect(currentLabel).toHaveCSS('font-weight', '400');
  await expect(nextLabel).toHaveCSS('font-weight', '400');
  await page.getByRole('searchbox').fill('Reasoning');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('selection')).toContainText('"model":"reasoning-model"');
  await expect(page.getByRole('searchbox')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('provider rail, immediately visible search and bottom-footer effort remain independent', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(ModelPickerGeometryHost, { props: { multipleProviders: true } });
  const trigger = modelTrigger(page);
  await trigger.press('Enter');
  const outer = outerMenu(page);
  const search = page.getByRole('searchbox');
  await expect(search).toBeFocused();
  const rail = page.getByTestId('model-provider-rail');
  const list = outer.getByRole('listbox');
  const railBox = (await rail.boundingBox())!;
  const listBox = (await list.boundingBox())!;
  expect(railBox.x + railBox.width).toBeLessThanOrEqual(listBox.x + 1);
  expect(railBox.width).toBeLessThan(56);
  const emptyWidth = (await search.boundingBox())!.width;
  const selected = list.getByRole('option', { name: /Reasoning model/ });
  await expect(selected).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab')).toHaveCount(2);
  const effort = page.getByTestId('effort-picker-trigger');
  expect(await effort.evaluate((el) => el.parentElement?.closest('button'))).toBeNull();
  const section = page.getByTestId('model-reasoning-section');
  const sectionBox = (await section.boundingBox())!;
  const panelBox = (await outer.boundingBox())!;
  expect(await section.evaluate((el) => el.closest('[role="listbox"]'))).toBeNull();
  expect(sectionBox.y).toBeGreaterThanOrEqual(listBox.y + listBox.height);
  expect(Math.abs(sectionBox.x - listBox.x)).toBeLessThan(1);
  expect(Math.abs(sectionBox.width - listBox.width)).toBeLessThan(1);
  expect(panelBox.y + panelBox.height - sectionBox.y - sectionBox.height).toBeLessThanOrEqual(1);
  const labelBox = (await section.getByText('Reasoning effort', { exact: true }).boundingBox())!;
  const controlBox = (await effort.boundingBox())!;
  expect(
    Math.abs(labelBox.y + labelBox.height / 2 - controlBox.y - controlBox.height / 2),
  ).toBeLessThan(1);
  expect(labelBox.x + labelBox.width).toBeLessThan(controlBox.x);

  await list.hover();
  await page.mouse.wheel(0, 2000);
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await section.boundingBox()).toEqual(sectionBox);
  await expectHitTarget(effort);
  await page.keyboard.type('Model 20');
  await expect(search).toHaveValue('Model 20');
  expect((await search.boundingBox())!.width).toBe(emptyWidth);
  expect(await search.evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth))).toBe(0);
  await expect(list.getByRole('option')).toHaveCount(1);
  await expect(effort).toBeVisible();
  expect(await section.boundingBox()).toEqual(sectionBox);
  await page.keyboard.press('Tab');
  await expect(list.getByRole('option')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(effort).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('selection')).toHaveText(
    JSON.stringify({ model: 'reasoning-model', effort: 'max', changes: 1 }),
  );
  await expect(effort).toBeFocused();
  await outer.getByRole('button', { name: 'Clear search' }).click();
  await expect(search).toBeFocused();
  await expect(selected).toHaveAttribute('aria-selected', 'true');
  await expect(effort).toBeVisible();

  const codex = page.getByRole('tab', { name: /Codex/ });
  const claude = page.getByRole('tab', { name: /Claude/ });
  await page.getByRole('tab', { name: /Claude/ }).press('Enter');
  await expect(outer).toBeVisible();
  await expect(list.getByRole('option', { name: 'Other provider model' })).toBeVisible();
  await codex.press('Enter');
  await expect(selected).toHaveAttribute('aria-selected', 'true');
  await codex.press('ArrowDown');
  await expect(claude).toBeFocused();
  await expect(claude).toHaveAttribute('aria-selected', 'true');
  await expect(list.getByRole('option', { name: 'Other provider model' })).toBeVisible();
  await expect(effort).toHaveAccessibleName(/Max/);
  expect(await section.boundingBox()).toEqual(sectionBox);
  await page.keyboard.press('ArrowUp');
  await expect(codex).toBeFocused();
  await expect(selected).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab').first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab').last()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('tab').first()).toBeFocused();
  await codex.press('Enter');
  await page.getByTestId('model-provider-refresh-button').press('Enter');
  await expect(outer).toBeVisible();
  await expect(page.getByTestId('refresh-requests')).toHaveText(
    JSON.stringify([{ channel: 'codex:get-models', params: { forceRefresh: true } }]),
  );
  await search.fill('Model 20');
  await search.press('Escape');
  await expect(outer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  await expect(selected).toHaveAttribute('aria-selected', 'true');
  await search.fill('Model 20');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('selection')).toContainText('"model":"model-20"');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(search).toHaveValue('Model 20');
  await outer.getByRole('button', { name: 'Clear search' }).click();
  await claude.press('Enter');
  await list.getByRole('option', { name: 'Other provider model' }).click();
  await expect(page.getByTestId('selection')).toContainText('"model":"other-model"');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(effort).toHaveCount(0);
});

for (const { opening, width } of [
  { opening: 'pointer', width: 900 },
  { opening: 'keyboard', width: 320 },
] as const) {
  test(`full-width search is immediately ready on ${opening} open at ${width}px`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: opening === 'pointer' ? 'no-preference' : 'reduce' });
    await mount(ModelPickerGeometryHost);
    await page.evaluate(() => document.fonts.ready);
    const trigger = modelTrigger(page);
    if (opening === 'pointer') await trigger.click();
    else await trigger.press('Enter');
    const search = page.getByRole('searchbox');
    await expect(search).toBeFocused();
    const outer = outerMenu(page);
    const panelBox = (await outer.boundingBox())!;
    const listBox = (await outer.getByRole('listbox').boundingBox())!;
    const refresh = page.getByTestId('model-provider-refresh-button');
    const refreshBox = (await refresh.boundingBox())!;
    const box = (await search.boundingBox())!;
    const firstOption = outer.getByRole('option').first();
    const firstRow = (await firstOption.boundingBox())!;
    const labelTextX = await firstOption
      .getByText('Reasoning model', { exact: true })
      .evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range.getBoundingClientRect().x;
      });
    const searchTextX = await search.evaluate((el) => {
      const style = getComputedStyle(el);
      return (
        el.getBoundingClientRect().x +
        parseFloat(style.borderLeftWidth) +
        parseFloat(style.paddingLeft)
      );
    });
    // Compare the caret/content start with actual label text, not either box edge.
    expect(Math.abs(searchTextX - labelTextX)).toBeLessThan(1);
    expect(box.x).toBeGreaterThanOrEqual(listBox.x);
    expect(box.x + box.width).toBeLessThanOrEqual(refreshBox.x);
    expect(refreshBox.x - box.x - box.width).toBeLessThan(8);
    expect(box.y - panelBox.y).toBeLessThanOrEqual(8);
    expect(firstRow.y - box.y - box.height).toBe(4);
    const presentation = await search.evaluate((el) => ({
      placeholder: (el as HTMLInputElement).placeholder,
      caret: getComputedStyle(el).caretColor,
      color: getComputedStyle(el).color,
      border: getComputedStyle(el).borderTopWidth,
      outline: getComputedStyle(el).outlineStyle,
      background: getComputedStyle(el.parentElement!).backgroundColor,
      fieldBackground: getComputedStyle(el).backgroundColor,
      visibleLeadingIcons: Array.from(el.parentElement!.querySelectorAll('svg')).filter(
        (icon) => icon.getClientRects().length > 0,
      ).length,
      resizing: el
        .parentElement!.getAnimations()
        .some((animation) =>
          (animation.effect as KeyframeEffect).getKeyframes().some((frame) => 'width' in frame),
        ),
    }));
    expect(presentation.placeholder.length).toBeGreaterThan(0);
    expect(presentation.caret).toBe(presentation.color);
    expect(presentation.caret).not.toBe('rgba(0, 0, 0, 0)');
    expect(presentation.border).toBe('0px');
    expect(presentation.outline).toBe('none');
    expect(presentation.background).toBe('rgba(0, 0, 0, 0)');
    expect(presentation.fieldBackground).toBe('rgba(0, 0, 0, 0)');
    expect(presentation.visibleLeadingIcons).toBe(0);
    expect(presentation.resizing).toBe(false);
    await expectHitTarget(search);
    await expectHitTarget(refresh);
    // No search click/fill: the first keystroke after either open must filter.
    await page.keyboard.type('Model 20');
    await expect(search).toHaveValue('Model 20');
    await expect(outer.getByRole('option')).toHaveCount(1);
    expect((await search.boundingBox())!.width).toBe(box.width);
    await search.press('Tab');
    await expect(search).not.toBeFocused();
    await expect(search).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    expect(await search.evaluate((el) => getComputedStyle(el.parentElement!).backgroundColor)).toBe(
      'rgba(0, 0, 0, 0)',
    );
    const clear = page.getByRole('button', { name: 'Clear search' });
    await expectHitTarget(clear);
    await clear.click();
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await search.press('Escape');
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(search).toBeFocused();
    expect((await search.boundingBox())!.width).toBe(box.width);
  });
}

test('first-open, hover and reopened selected highlights fit the full row without trigger shifts', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await mount(ModelPickerGeometryHost);
  const trigger = modelTrigger(page);
  await page.mouse.move(850, 750);
  // Mount does not wait for Inter: measure the real font, not its fallback.
  await page.evaluate(() => document.fonts.ready);
  const rest = (await trigger.boundingBox())!;
  await trigger.hover();
  expect(await trigger.boundingBox()).toEqual(rest);
  const padding = await trigger.evaluate((el) => ({
    left: parseFloat(getComputedStyle(el).paddingLeft),
    right: parseFloat(getComputedStyle(el).paddingRight),
  }));
  expect(padding.left).toBeGreaterThanOrEqual(8);
  expect(padding.left).toBe(padding.right);
  await page.mouse.move(850, 750);
  await trigger.press('Enter');
  const outer = outerMenu(page);
  const row = outer.getByRole('option', { name: /Reasoning model/ });
  const selectedHighlight = outer.locator('.bg-selected');
  async function aligned() {
    await expect(async () => {
      const a = (await row.boundingBox())!;
      const b = (await selectedHighlight.boundingBox())!;
      for (const key of ['x', 'y', 'width', 'height'] as const)
        expect(Math.abs(a[key] - b[key])).toBeLessThan(1);
    }).toPass();
  }
  await aligned();
  await row.hover();
  await aligned();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await aligned();
  const search = page.getByRole('searchbox');
  await search.press('ArrowDown');
  const activeId = await search.getAttribute('aria-activedescendant');
  await expect(page.locator(`[id="${activeId}"]`)).toHaveAccessibleName('Model 2');
  await aligned();
  expect(await outer.evaluate((el) => el.getAnimations().length)).toBe(0);
});

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
      const controlledListboxId = await effortTrigger.getAttribute('aria-controls');
      expect(controlledListboxId).toBeTruthy();
      const controlledListbox = page.locator('[id="' + controlledListboxId + '"]');
      await expect(controlledListbox).toHaveCount(1);
      await expect(controlledListbox).toHaveAttribute('role', 'listbox');
      await expect(controlledListbox.getByRole('option')).toHaveCount(constrained ? 22 : 8);
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
      await expect(outer).toBeVisible();
      await expect(effortTrigger).toHaveAccessibleName(/Max|last-effort/);
      await page.keyboard.press('Escape');
      await expect(outer).toHaveCount(0);
      await expect(trigger).toBeFocused();
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
