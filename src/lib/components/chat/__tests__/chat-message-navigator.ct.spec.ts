import { expect, test } from '@playwright/experimental-ct-svelte';
import ChatMessageNavigatorIntegrationHost from './ChatMessageNavigatorIntegrationHost.svelte';

test.describe('chat message navigator production path', () => {
  test('registers in the real header and navigates virtualized history without restoring follow', async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 760 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(ChatMessageNavigatorIntegrationHost);

    const headerActions = component.locator('[data-panel-header-actions]');
    const listButton = component.getByTestId('chat-message-navigator-trigger');
    const downButton = component.getByTestId('chat-scroll-to-bottom-button');
    await expect(headerActions).toBeVisible();
    await expect(downButton).toBeDisabled();
    expect(
      await headerActions.evaluate(
        (header, ids) => {
          const nodes = ids.map((id) => header.querySelector(`[data-testid="${id}"]`));
          return nodes.every(
            (node, index) =>
              node &&
              (index === nodes.length - 1 ||
                Boolean(
                  node.compareDocumentPosition(nodes[index + 1]!) &
                  Node.DOCUMENT_POSITION_FOLLOWING,
                )),
          );
        },
        [
          'chat-message-navigator-trigger',
          'chat-scroll-to-bottom-button',
          'panel-actions-trigger',
          'panel-close-button',
        ],
      ),
    ).toBe(true);
    await expect(listButton.locator('svg')).toHaveClass(/size-3/);

    const target = component.locator('[data-message-id="user-6"]');
    await expect(target).toHaveCount(0);
    await listButton.click();
    const search = page.getByRole('combobox', { name: 'Filter user messages' });
    await expect(search).toBeFocused();
    await expect(page.getByRole('listbox')).toHaveCount(1);
    await expect(page.getByRole('option')).toHaveCount(14);
    await search.fill('Virtualized target six');
    const option = page.getByRole('option', { name: 'Virtualized target six' });
    await expect(option).toHaveCount(1);
    await option.click();

    await expect(page.getByRole('dialog', { name: 'Browse user messages' })).toHaveCount(0);
    await expect(target).toHaveCount(1);
    await expect(target).toHaveClass(/message-highlight-flash/);
    await expect(downButton).toBeEnabled();
    const scrollContainer = component.locator('.conversation-column').locator('..');
    const header = component.locator('[data-panel-content-header]');
    const [targetBox, scrollBox, headerBox] = await Promise.all([
      target.boundingBox(),
      scrollContainer.boundingBox(),
      header.boundingBox(),
    ]);
    if (!targetBox || !scrollBox || !headerBox) {
      throw new Error('Expected the production header, transcript, and selected message');
    }
    expect(targetBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
    expect(Math.abs(targetBox.y - scrollBox.y)).toBeLessThanOrEqual(3);

    const selectedScrollTop = await scrollContainer.evaluate((element) => element.scrollTop);
    await component.getByTestId('append-streaming-message').click();
    await page.waitForTimeout(100);
    expect(await scrollContainer.evaluate((element) => element.scrollTop)).toBeCloseTo(
      selectedScrollTop,
      0,
    );
    await downButton.click();
    await expect(downButton).toBeDisabled();
  });
});
