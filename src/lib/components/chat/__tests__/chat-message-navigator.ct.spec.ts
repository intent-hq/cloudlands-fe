import { expect, test } from '@playwright/experimental-ct-svelte';
import ChatMessageNavigatorHost from './ChatMessageNavigatorHost.svelte';

for (const theme of ['light', 'dark'] as const) {
  for (const config of [
    { width: 720, zoom: 1, viewportWidth: 760 },
    { width: 320, zoom: 1, viewportWidth: 360 },
    { width: 320, zoom: 2, viewportWidth: 700 },
  ]) {
    test(`keeps exact header geometry in ${theme} at ${config.width}px/${config.zoom}x`, async ({
      mount,
      page,
    }) => {
      await page.setViewportSize({ width: config.viewportWidth, height: 900 });
      const component = await mount(ChatMessageNavigatorHost, { props: { theme, ...config } });
      const title = component.getByTestId('chat-header-title');
      const list = component.getByTestId('chat-message-navigator-trigger');
      const arrow = component.getByTestId('chat-scroll-to-bottom-button');
      const kebab = component.getByTestId('chat-header-kebab');
      const close = component.getByTestId('chat-header-close');
      const transcript = component.getByTestId('chat-navigation-transcript');

      const [titleRect, listRect, arrowRect, kebabRect, closeRect] = await Promise.all([
        title.boundingBox(),
        list.boundingBox(),
        arrow.boundingBox(),
        kebab.boundingBox(),
        close.boundingBox(),
      ]);
      if (!titleRect || !listRect || !arrowRect || !kebabRect || !closeRect) {
        throw new Error('Expected all stable chat header controls to be visible');
      }
      expect(titleRect.x + titleRect.width).toBeLessThanOrEqual(listRect.x);
      expect(listRect.x).toBeLessThan(arrowRect.x);
      expect(arrowRect.x).toBeLessThan(kebabRect.x);
      expect(kebabRect.x).toBeLessThan(closeRect.x);
      expect(listRect.x + listRect.width).toBeLessThanOrEqual(arrowRect.x);
      expect(listRect.width).toBeCloseTo(36 * config.zoom, 1);
      expect(arrowRect.width).toBeCloseTo(36 * config.zoom, 1);
      await expect(transcript.getByTestId('chat-scroll-to-bottom-button')).toHaveCount(0);

      await expect(arrow).toBeEnabled();
      await arrow.click();
      await expect(component.getByTestId('chat-bottom-state')).toHaveText('true');
      await expect(arrow).toBeDisabled();
      await transcript.evaluate((node) => (node.scrollTop = 20));
      await expect(component.getByTestId('chat-bottom-state')).toHaveText('false');
      await expect(arrow).toBeEnabled();

      await list.click();
      const panel = page.getByTestId('chat-message-navigator-panel');
      await expect(panel).toBeVisible();
      await expect(page.getByTestId('chat-message-navigator-search')).toHaveCount(0);
      const menu = page.getByRole('menu');
      await expect(menu).toHaveCount(1);
      await expect(page.getByRole('listbox')).toHaveCount(0);
      await expect(menu.getByRole('menuitem')).toHaveCount(5);
      const firstResult = page.getByTestId('chat-message-navigator-result').first();
      await expect(firstResult).toBeFocused();
      const panelRect = await panel.evaluate((node) => node.getBoundingClientRect().toJSON());
      expect(panelRect.left).toBeGreaterThanOrEqual(0);
      expect(panelRect.right).toBeLessThanOrEqual(config.viewportWidth);
      expect(panelRect.width).toBeCloseTo(Math.min(448, config.viewportWidth - 16), 1);
      const focusTreatment = await firstResult.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          backgroundColor: style.backgroundColor,
          boxShadow: style.boxShadow,
          outlineStyle: style.outlineStyle,
        };
      });
      const previewFontSize = await firstResult
        .locator('span')
        .evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
      expect(previewFontSize).toBeLessThan(13);
      expect(focusTreatment.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
      expect(focusTreatment.boxShadow).toBe('none');
      expect(focusTreatment.outlineStyle).toBe('none');
      const longResult = page
        .getByTestId('chat-message-navigator-result')
        .filter({ hasText: 'This long user message' });
      const truncation = await longResult.locator('span').evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          whiteSpace: style.whiteSpace,
          overflow: style.overflow,
          textOverflow: style.textOverflow,
        };
      });
      expect(truncation).toEqual({
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      });
    });
  }
}

test('supports hover, keyboard, dismissal, and virtualized message selection', async ({
  mount,
  page,
}) => {
  const component = await mount(ChatMessageNavigatorHost);
  const trigger = component.getByTestId('chat-message-navigator-trigger');

  await trigger.hover();
  await expect(page.getByTestId('chat-message-navigator-panel')).toBeVisible();
  await page.waitForTimeout(200);
  await page.getByTestId('chat-message-navigator-panel').hover();
  await page.waitForTimeout(220);
  await expect(page.getByTestId('chat-message-navigator-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('chat-message-navigator-panel')).toBeHidden();
  await component.getByTestId('chat-navigation-transcript').click({ position: { x: 20, y: 20 } });

  await trigger.focus();
  await expect(page.getByTestId('chat-message-navigator-result').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await component.getByTestId('chat-navigation-transcript').click({ position: { x: 20, y: 20 } });
  await trigger.press('Enter');
  await expect(page.getByTestId('chat-message-navigator-result').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await component.getByTestId('chat-navigation-transcript').click({ position: { x: 20, y: 20 } });
  await trigger.press('Space');
  const alpha = page.getByTestId('chat-message-navigator-result').filter({ hasText: 'Alpha' });
  const beta = page.getByTestId('chat-message-navigator-result').filter({ hasText: 'Beta' });
  const another = page.getByTestId('chat-message-navigator-result').filter({ hasText: 'Another' });
  const azure = page.getByTestId('chat-message-navigator-result').filter({ hasText: 'Azure' });
  const last = page.getByTestId('chat-message-navigator-result').filter({ hasText: 'This long' });
  await expect(alpha).toBeFocused();
  await page.keyboard.press('a');
  await expect(another).toBeFocused();
  await page.keyboard.press('a');
  await expect(azure).toBeFocused();
  await page.keyboard.press('a');
  await expect(alpha).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(beta).toBeFocused();
  await page.keyboard.press('End');
  await expect(last).toBeFocused();
  await page.keyboard.press('Home');
  await expect(alpha).toBeFocused();
  await page.keyboard.press('Space');
  await expect(component.getByTestId('chat-selected-message')).toHaveText('first');
  await expect(page.getByTestId('chat-message-navigator-panel')).toBeHidden();

  await trigger.press('Enter');
  await expect(alpha).toBeFocused();
  await page.keyboard.press('a');
  await expect(another).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(component.getByTestId('chat-selected-message')).toHaveText('virtual-target');
  await expect(page.getByTestId('chat-message-navigator-panel')).toBeHidden();
  const target = component.getByTestId('virtualized-message');
  await expect(target).toHaveClass(/message-highlight-flash/);
  const [headerRect, transcriptRect, targetRect] = await Promise.all([
    component.getByTestId('chat-navigation-header').boundingBox(),
    component.getByTestId('chat-navigation-transcript').boundingBox(),
    target.boundingBox(),
  ]);
  if (!headerRect || !transcriptRect || !targetRect) {
    throw new Error('Expected the selected message and transcript geometry to be visible');
  }
  expect(targetRect.y).toBeGreaterThanOrEqual(headerRect.y + headerRect.height);
  expect(Math.abs(targetRect.y - transcriptRect.y)).toBeLessThanOrEqual(1);
  await expect(component.getByTestId('chat-scroll-to-bottom-button')).toBeEnabled();

  await trigger.click();
  await expect(page.getByTestId('chat-message-navigator-panel')).toBeVisible();
  const transcriptBox = await component.getByTestId('chat-navigation-transcript').boundingBox();
  if (!transcriptBox) throw new Error('Expected the transcript to be visible');
  await page.mouse.click(transcriptBox.x + 20, transcriptBox.y + 20);
  await expect(page.getByTestId('chat-message-navigator-panel')).toBeHidden();
});
