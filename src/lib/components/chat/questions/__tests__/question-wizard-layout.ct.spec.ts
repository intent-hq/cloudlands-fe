import { expect, test } from '@playwright/experimental-ct-svelte';
import QuestionPreview from '../question-card.preview.svelte';

for (const width of [280, 960]) {
  test(`keeps left-aligned questions and bottom actions within ${width}px`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(QuestionPreview, { props: { longContent: width === 280 } });
    const card = component.getByTestId('question-wizard-card');
    await expect(card).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const row = component.getByRole('radio').first();
    const title = row.getByText('Start with the smallest change', { exact: true });
    const description = row.getByText(/Keep the existing behavior|Preserve the current behavior/);
    const header = component.getByRole('heading', {
      name: 'How should we approach the next improvement?',
    });
    const hide = component.getByRole('button', { name: 'Hide', exact: true });
    const dismiss = component.getByRole('button', { name: 'Dismiss', exact: true });
    const [cardBox, rowBox, titleBox, descriptionBox, headerBox, hideBox, dismissBox] =
      await Promise.all(
        [card, row, title, description, header, hide, dismiss].map((node) => node.boundingBox()),
      );
    expect(cardBox!.width).toBeLessThanOrEqual(640);
    if (width === 960) expect(cardBox!.width).toBe(640);
    expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(width);
    expect(descriptionBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height);
    expect(descriptionBox!.x).toBeCloseTo(titleBox!.x, 0);
    expect(titleBox!.x - cardBox!.x).toBeLessThanOrEqual(24);
    if (width === 280) {
      const lineHeight = await header.evaluate((node) =>
        Number.parseFloat(getComputedStyle(node).lineHeight),
      );
      expect(headerBox!.height).toBeLessThanOrEqual(lineHeight * 4);
      expect(headerBox!.width).toBeGreaterThan(cardBox!.width * 0.8);
      expect(hideBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height);
    }
    expect(hideBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height);
    expect(hideBox!.x - cardBox!.x).toBeLessThanOrEqual(24);
    expect(hideBox!.y).toBeGreaterThan(rowBox!.y + rowBox!.height);
    expect(await header.evaluate((node) => getComputedStyle(node).textAlign)).toBe('left');
    expect(await description.evaluate((node) => getComputedStyle(node).textAlign)).toBe('left');
    const skipBox = await component
      .getByRole('button', { name: 'Skip', exact: true })
      .boundingBox();
    expect(skipBox!.y).toBeGreaterThanOrEqual(hideBox!.y);
    expect(skipBox!.x + skipBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width);
    expect(await title.evaluate((node) => getComputedStyle(node).fontWeight)).toBe('400');
    if (width === 960) expect(hideBox!.y).toBeCloseTo(dismissBox!.y, 0);
    expect(dismissBox!.x + dismissBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width);
    expect(await card.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(
      1,
    );
    if (width === 960) expect(rowBox!.height).toBeLessThanOrEqual(48);
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(component.getByTestId('question-result')).toContainText(
      'Start with the smallest change',
    );
  });
}

for (const theme of ['light', 'dark']) {
  test(`uses neutral keyboard focus without a collapsed hover fill in ${theme}`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate((value) => (document.documentElement.className = value), theme);
    const component = await mount(QuestionPreview, { props: { multiSelect: true } });
    const row = component.getByRole('checkbox').first();
    await row.focus();
    // Programmatic focus can retain pointer modality from CT mounting. Exercise
    // the actual roving keyboard interaction before sampling its visible outline.
    await page.keyboard.press('ArrowDown');
    await expect(component.getByRole('checkbox').nth(1)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(row).toBeFocused();
    expect(await row.evaluate((node) => node.matches(':focus-visible'))).toBe(true);
    const neutral = await row.evaluate((node) => {
      const probe = document.createElement('span');
      probe.style.color = 'hsl(var(--muted-foreground))';
      node.append(probe);
      const neutral = getComputedStyle(probe).color;
      probe.remove();
      return neutral;
    });
    // Reduced-motion transitions still settle on the next style frame.
    await expect(row).toHaveCSS('outline-color', neutral);
    await expect
      .poll(() => row.evaluate((node) => Number.parseFloat(getComputedStyle(node).outlineWidth)))
      .toBeGreaterThan(0);
    await expect(row).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('Space');
    await component.getByRole('button', { name: 'Hide', exact: true }).click();
    const expand = component.getByRole('button', { name: /Click to expand/i });
    await expand.hover();
    expect(
      await expand
        .locator('[data-slot="button-surface"]')
        .evaluate((node) => getComputedStyle(node).backgroundColor),
    ).toBe('rgba(0, 0, 0, 0)');
    await expand.focus();
    await page.keyboard.press('Enter');
    await expect(row).toHaveAttribute('aria-checked', 'true');
  });

  test(`keeps free-text editing borderless in ${theme} and submits the typed answer`, async ({
    mount,
    page,
  }) => {
    await page.evaluate((value) => (document.documentElement.className = value), theme);
    const component = await mount(QuestionPreview);
    const input = component.getByRole('textbox');
    await input.fill('Use the safe fixture first.');
    await expect(input).toBeFocused();
    const style = await input.evaluate((node) => {
      const style = getComputedStyle(node);
      return { border: style.borderTopWidth, outline: style.outlineStyle, shadow: style.boxShadow };
    });
    expect(style.border).toBe('0px');
    expect(style.outline).toBe('none');
    expect(style.shadow === 'none' || !/[1-9][0-9]*(?:\.[0-9]+)?px/.test(style.shadow)).toBe(true);
    await input.press('Enter');
    await expect(component.getByTestId('question-result')).toContainText(
      'Use the safe fixture first.',
    );
  });
}

test('retains multi-select shortcuts and hide/reopen behavior', async ({ mount, page }) => {
  const component = await mount(QuestionPreview, { props: { multiSelect: true } });
  await page.keyboard.press('1');
  await expect(component.getByRole('checkbox').first()).toHaveAttribute('aria-checked', 'true');
  expect(
    await component
      .getByRole('checkbox')
      .first()
      .getByText('Start with the smallest change', { exact: true })
      .evaluate((node) => getComputedStyle(node).fontWeight),
  ).toBe('400');
  await component.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(component.getByRole('checkbox')).toHaveCount(0);
  await component.getByRole('button', { name: /Click to expand/i }).click();
  await expect(component.getByRole('checkbox').first()).toHaveAttribute('aria-checked', 'true');
  await component.getByRole('button', { name: /Continue/ }).click();
  await expect(component.getByTestId('question-result')).toContainText(
    'Start with the smallest change',
  );
});
