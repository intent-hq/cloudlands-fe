import { expect, test } from '@playwright/experimental-ct-svelte';
import ScrollToBottomButtonHost from './ScrollToBottomButtonHost.svelte';

for (const theme of ['light', 'dark'] as const) {
  for (const config of [
    { width: 720, zoom: 1 },
    { width: 320, zoom: 2 },
  ]) {
    test(`keeps the borderless arrow clear of message actions in ${theme} at ${config.width}px/${config.zoom}x`, async ({
      mount,
      page,
    }) => {
      const component = await mount(ScrollToBottomButtonHost, { props: { theme, ...config } });
      const button = component.getByTestId('chat-scroll-to-bottom-button');
      await expect(button).toBeVisible();

      const style = await button.evaluate((node) => {
        const computed = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        const actionsRect = document
          .querySelector<HTMLElement>('[data-testid="message-actions"]')!
          .getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return {
          width: rect.width,
          height: rect.height,
          icon: Number.parseFloat(getComputedStyle(node.querySelector('svg')!).width),
          border: [
            computed.borderTopWidth,
            computed.borderRightWidth,
            computed.borderBottomWidth,
            computed.borderLeftWidth,
          ],
          background: computed.backgroundColor,
          zIndex: computed.zIndex,
          topHit: hit === node || hit?.closest('button') === node,
          overlapsActions:
            rect.left < actionsRect.right &&
            rect.right > actionsRect.left &&
            rect.top < actionsRect.bottom &&
            rect.bottom > actionsRect.top,
        };
      });
      expect(style.border).toEqual(['0px', '0px', '0px', '0px']);
      expect(style.width).toBeGreaterThanOrEqual(36);
      expect(style.height).toBeGreaterThanOrEqual(36);
      expect(style.icon).toBeCloseTo(20, 1);
      expect(style.background).toBe('rgba(0, 0, 0, 0)');
      expect(Number(style.zIndex)).toBe(45);
      expect(style.topHit).toBe(true);
      expect(style.overlapsActions).toBe(false);

      await button.hover();
      expect(await button.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(
        'rgba(0, 0, 0, 0)',
      );

      await component.getByTestId('focus-before').focus();
      for (let tabCount = 0; tabCount < 8; tabCount += 1) {
        if (await button.evaluate((node) => document.activeElement === node)) break;
        await page.keyboard.press('Tab');
      }
      await expect(button).toBeFocused();
      expect(await button.getAttribute('aria-label')).toBeTruthy();
      const focused = await button.evaluate((node) => {
        const computed = getComputedStyle(node);
        return { background: computed.backgroundColor, outlineWidth: computed.outlineWidth };
      });
      expect(focused.background).not.toBe('rgba(0, 0, 0, 0)');
      expect(Number.parseFloat(focused.outlineWidth)).toBeGreaterThanOrEqual(2);

      await button.click();
      await expect(component.getByTestId('arrow-click-count')).toHaveText('1');

      await button.focus();
      await page.keyboard.press('Enter');
      await page.keyboard.press('Space');
      await expect(component.getByTestId('arrow-click-count')).toHaveText('3');
    });
  }
}

test('keeps exact bottom follow through delayed subscription mount and resize, then permits manual unlock', async ({
  mount,
  page,
}) => {
  const component = await mount(ScrollToBottomButtonHost);
  const scroll = component.getByTestId('bottom-follow-scroll');
  const button = component.getByTestId('chat-scroll-to-bottom-button');
  const distance = () =>
    scroll.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop);

  await scroll.evaluate((node) => (node.scrollTop = 40));
  await component.getByTestId('mount-subscription').click();
  await button.click();
  await expect(component.getByTestId('follow-state')).toHaveText('true');
  await expect.poll(distance).toBeLessThanOrEqual(1);
  await expect(component.getByTestId('delayed-subscription')).toBeVisible();
  await expect.poll(distance).toBeLessThanOrEqual(1);

  await component.getByTestId('expand-subscription').click();
  await expect.poll(distance).toBeLessThanOrEqual(1);
  const finalSpacer = component.getByTestId('final-spacer');
  expect(
    await scroll.evaluate(
      (node, spacer) =>
        Math.abs(
          node.getBoundingClientRect().bottom -
            (spacer as HTMLElement).getBoundingClientRect().bottom,
        ),
      await finalSpacer.elementHandle(),
    ),
  ).toBeLessThanOrEqual(1);

  await scroll.hover();
  await page.mouse.wheel(0, -80);
  await expect(component.getByTestId('follow-state')).toHaveText('false');
  const unlockedTop = await scroll.evaluate((node) => node.scrollTop);
  await component.getByTestId('expand-subscription').click();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))),
  );
  expect(await scroll.evaluate((node) => node.scrollTop)).toBeCloseTo(unlockedTop, 1);
});
