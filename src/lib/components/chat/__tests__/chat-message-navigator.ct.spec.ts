import { expect, test, type Locator, type Page } from '@playwright/experimental-ct-svelte';
import ChatMessageNavigatorIntegrationHost from './ChatMessageNavigatorIntegrationHost.svelte';

const cases = [
  { theme: 'light', width: 900, height: 760, zoom: 1, label: 'light wide' },
  { theme: 'dark', width: 900, height: 760, zoom: 1, label: 'dark wide' },
  { theme: 'light', width: 680, height: 760, zoom: 2, label: 'light narrow at 200%' },
  { theme: 'dark', width: 680, height: 760, zoom: 2, label: 'dark narrow at 200%' },
] as const;

async function expectUniqueVisible(locator: Locator) {
  await expect(locator).toHaveCount(1);
  await expect(locator).toBeVisible();
}

async function pickerForTrigger(page: Page, trigger: Locator) {
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const picker = page.getByRole('dialog', { name: 'Browse user messages' });
  await expectUniqueVisible(picker);
  return picker;
}

test.describe('chat message navigator production path', () => {
  for (const state of cases) {
    test(`keeps the real header, picker, and transcript contract in ${state.label}`, async ({
      context,
      mount,
      page,
    }) => {
      const viewport = { width: state.width / state.zoom, height: state.height / state.zoom };
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        ...viewport,
        deviceScaleFactor: state.zoom,
        mobile: false,
        screenWidth: state.width,
        screenHeight: state.height,
      });
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: state.theme });
      const component = await mount(ChatMessageNavigatorIntegrationHost, {
        props: { theme: state.theme },
      });

      await expect(component).toHaveAttribute('data-theme', state.theme);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.className))
        .toContain(state.theme);
      const header = component.locator('[data-panel-content-header]');
      const headerActions = header.locator('[data-panel-header-actions]');
      const title = header.getByText('Navigation agent', { exact: true });
      const listButton = headerActions.getByTestId('chat-message-navigator-trigger');
      const downButton = headerActions.getByTestId('chat-scroll-to-bottom-button');
      const panelActionsButton = headerActions.getByTestId('panel-actions-trigger');
      const closeButton = headerActions.getByTestId('panel-close-button');
      await expectUniqueVisible(header);
      await expectUniqueVisible(headerActions);
      await expectUniqueVisible(title);
      await expectUniqueVisible(listButton);
      await expectUniqueVisible(downButton);
      await expectUniqueVisible(panelActionsButton);
      await expectUniqueVisible(closeButton);
      await expect(downButton).toBeDisabled();
      expect(
        await headerActions.evaluate(
          (actions, ids) => {
            const nodes = ids.map((id) => actions.querySelector(`[data-testid="${id}"]`));
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
      const [titleBox, actionsBox, headerBox, listIconBox, arrowIconBox] = await Promise.all([
        title.boundingBox(),
        headerActions.boundingBox(),
        header.boundingBox(),
        listButton.locator('svg').boundingBox(),
        downButton.locator('svg').boundingBox(),
      ]);
      if (!titleBox || !actionsBox || !headerBox || !listIconBox || !arrowIconBox) {
        throw new Error('Expected complete production header geometry');
      }
      expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(actionsBox.x + 0.5);
      expect(actionsBox.x + actionsBox.width).toBeLessThanOrEqual(
        headerBox.x + headerBox.width + 0.5,
      );
      expect(listIconBox.width).toBeCloseTo(12, 0);
      expect(listIconBox.height).toBeCloseTo(12, 0);
      expect(arrowIconBox.width).toBeCloseTo(11, 0);
      expect(arrowIconBox.height).toBeCloseTo(11, 0);
      await expect(downButton).toHaveAttribute('data-icon-size', '11');

      const target = component.locator('[data-message-id="user-6"]');
      await expect(target).toHaveCount(0);
      await listButton.click();
      const dialog = await pickerForTrigger(page, listButton);
      await expect(dialog).toHaveRole('dialog', { name: 'Browse user messages' });
      const search = dialog.getByRole('combobox', { name: 'Filter user messages' });
      const options = dialog.getByRole('option');
      await expectUniqueVisible(search);
      await expect(search).toBeFocused();
      await expect(dialog.getByRole('listbox')).toHaveCount(1);
      await expect(options).toHaveCount(14);
      const optionDetails = await options.evaluateAll((nodes) =>
        nodes.map((node) => ({
          text: node.textContent?.trim(),
          title: node.getAttribute('title'),
          ariaLabel: node.getAttribute('aria-label'),
        })),
      );
      expect(optionDetails).toHaveLength(14);
      expect(optionDetails.some((item) => item.text?.includes('[SYSTEM NOTE]'))).toBe(false);
      expect(optionDetails.some((item) => item.title?.includes('[SYSTEM NOTE]'))).toBe(false);
      expect(optionDetails.some((item) => item.ariaLabel?.includes('[SYSTEM NOTE]'))).toBe(false);
      expect(optionDetails).toContainEqual({
        text: 'Virtualized target six',
        title: 'Virtualized target six',
        ariaLabel: null,
      });
      await expect(dialog.getByRole('option', { name: 'Internal-only picker row' })).toHaveCount(0);
      const initialOption = options.first();
      await expect(initialOption).toHaveAttribute('aria-selected', 'true');
      expect(
        await initialOption
          .locator('span')
          .evaluate((element) => getComputedStyle(element).fontWeight),
      ).toBe('400');
      expect(
        await search.evaluate((element) => {
          const style = getComputedStyle(element);
          return { boxShadow: style.boxShadow, outline: style.outlineStyle };
        }),
      ).toEqual({ boxShadow: 'none', outline: 'none' });
      await initialOption.focus();
      await expect(initialOption).toBeFocused();
      const rowFocus = await initialOption.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          boxShadow: style.boxShadow,
          outline: style.outlineStyle,
          backgroundColor: style.backgroundColor,
        };
      });
      expect(rowFocus.boxShadow).toBe('none');
      expect(rowFocus.outline).toBe('none');
      expect(rowFocus.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
      await search.focus();

      const dialogBox = await dialog.boundingBox();
      if (!dialogBox) throw new Error('Expected the message picker dialog');
      expect(dialogBox.width).toBeLessThanOrEqual(Math.min(448, viewport.width - 16) + 0.5);
      expect(dialogBox.x).toBeGreaterThanOrEqual(7.5);
      expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(viewport.width - 7.5);
      expect(dialogBox.y).toBeGreaterThanOrEqual(0);
      expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(viewport.height + 0.5);

      await search.pressSequentially('hidden picker suffix');
      await expect(search).toHaveValue('hidden picker suffix');
      await expect(options).toHaveCount(0);
      await search.fill('Virtualized target six');
      const option = dialog.getByRole('option', { name: 'Virtualized target six', exact: true });
      await expect(option).toHaveCount(1);
      await expect(option).toHaveAttribute('title', 'Virtualized target six');
      await option.click();

      await expect(dialog).toHaveCount(0);
      await expect(target).toHaveCount(1);
      await expect(target).toContainText('hidden picker suffix');
      await expect(target).toHaveClass(/message-highlight-flash/);
      await expect(downButton).toBeEnabled();
      const scrollContainer = component.locator('.conversation-column').locator('..');
      const [targetBox, scrollBox] = await Promise.all([
        target.boundingBox(),
        scrollContainer.boundingBox(),
      ]);
      if (!targetBox || !scrollBox) {
        throw new Error('Expected the production transcript and selected message');
      }
      expect(targetBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
      expect(Math.abs(targetBox.y - scrollBox.y)).toBeLessThanOrEqual(3);

      const selectedScrollTop = await scrollContainer.evaluate((element) => element.scrollTop);
      await component.getByTestId('append-streaming-message').click();
      await expect
        .poll(() => scrollContainer.evaluate((element) => element.scrollTop))
        .toBeCloseTo(selectedScrollTop, 0);
      await expect(downButton).toBeEnabled();
      await downButton.click();
      await expect(downButton).toBeDisabled();
      await expect
        .poll(() =>
          scrollContainer.evaluate(
            (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
          ),
        )
        .toBeLessThanOrEqual(2);
    });
  }

  test('preserves keyboard, pointer, focus, and outside interaction ordering', async ({
    mount,
    page,
  }) => {
    const component = await mount(ChatMessageNavigatorIntegrationHost);
    const header = component.locator('[data-panel-content-header]');
    const headerActions = header.locator('[data-panel-header-actions]');
    const trigger = headerActions.getByTestId('chat-message-navigator-trigger');
    const downButton = headerActions.getByTestId('chat-scroll-to-bottom-button');
    const outside = headerActions.getByTestId('panel-actions-trigger');
    const title = header.getByText('Navigation agent', { exact: true });
    await expectUniqueVisible(header);
    await expectUniqueVisible(headerActions);
    await expectUniqueVisible(trigger);
    await expectUniqueVisible(downButton);
    await expectUniqueVisible(outside);
    await expectUniqueVisible(title);

    await trigger.press('Space');
    let dialog = await pickerForTrigger(page, trigger);
    await expect(dialog).toHaveRole('dialog', { name: 'Browse user messages' });
    await expect(dialog.getByRole('combobox', { name: 'Filter user messages' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await outside.focus();
    await trigger.focus();
    dialog = await pickerForTrigger(page, trigger);
    const search = dialog.getByRole('combobox', { name: 'Filter user messages' });
    await expect(search).toBeFocused();
    await dialog.getByRole('option').first().focus();
    await expect(dialog).toBeVisible();
    await outside.focus();
    await expect(dialog).toHaveCount(0);

    await trigger.hover();
    dialog = await pickerForTrigger(page, trigger);
    await dialog.hover();
    await page.waitForTimeout(200);
    await expect(dialog).toBeVisible();
    await title.click();
    await expect(dialog).toHaveCount(0);
  });
});
