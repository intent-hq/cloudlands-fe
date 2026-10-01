import type { Locator, Page } from '@playwright/experimental-ct-svelte';
import { expect, test } from '../../../../test/ct-test';
import type { CDPSession } from '@playwright/test';
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
  const picker = page.locator('[data-chat-message-navigator-content]');
  await expectUniqueVisible(picker);
  return picker;
}

async function classifyMessageIdentityNodes(page: Page, messageId: string) {
  return page
    .locator(`[data-message-id="${messageId}"], [data-navigation-message-id="${messageId}"]`)
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const element = node as HTMLElement;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const popover = element.closest<HTMLElement>('[data-chat-message-navigator-content]');
        const lazyTurn = element.closest<HTMLElement>('[data-lazy-visible]');
        return {
          ancestry: popover ? 'menu' : lazyTurn ? 'transcript' : 'other',
          connected: element.isConnected,
          lifecycle: element.hasAttribute('data-navigation-message-id')
            ? 'navigation-option'
            : 'transcript-row',
          transitionState:
            popover?.getAttribute('data-state') ?? lazyTurn?.getAttribute('data-lazy-visible'),
          visible:
            element.isConnected &&
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0',
        };
      }),
    );
}

async function duplicateLiveMessageIdentityPairs(page: Page) {
  return page.locator('[data-message-id][data-message-role]').evaluateAll((nodes) => {
    const counts = new Map<string, number>();
    for (const node of nodes) {
      const element = node as HTMLElement;
      const key = `${element.dataset.messageId}:${element.dataset.messageRole}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].filter(([, count]) => count !== 1);
  });
}

test.describe('chat message navigator production path', () => {
  // Clear device emulation on the session that installed it before detaching.
  let activeCdp: CDPSession | null = null;

  test.afterEach(async () => {
    if (!activeCdp) return;
    await activeCdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
    await activeCdp.detach().catch(() => {});
    activeCdp = null;
  });

  for (const state of cases) {
    test(`keeps the real header, picker, and transcript contract in ${state.label}`, async ({
      context,
      mount,
      page,
    }) => {
      const viewport = { width: state.width / state.zoom, height: state.height / state.zoom };
      const cdp = await context.newCDPSession(page);
      activeCdp = cdp;
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        ...viewport,
        deviceScaleFactor: state.zoom,
        mobile: false,
        screenWidth: state.width,
        screenHeight: state.height,
      });
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: state.theme });
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      const component = await mount(ChatMessageNavigatorIntegrationHost, {
        props: { theme: state.theme },
      });

      await expect(component).toHaveAttribute('data-theme', state.theme);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.className))
        .toContain(state.theme);
      const header = component.locator('[data-panel-content-header]');
      const headerActions = header.locator('[data-panel-header-actions]');
      const title = header.locator('[data-panel-header-title]');
      const panelActionsButton = headerActions.getByTestId('panel-actions-trigger');
      const closeButton = headerActions.getByTestId('panel-close-button');
      const listButton = page.getByTestId('chat-message-navigator-trigger');
      const downButton = page.getByTestId('chat-floating-scroll-to-bottom-button');
      await expectUniqueVisible(header);
      await expectUniqueVisible(panelActionsButton);
      await expectUniqueVisible(closeButton);
      const [titleBox, actionsBox, headerBox] = await Promise.all([
        title.boundingBox(),
        headerActions.boundingBox(),
        header.boundingBox(),
      ]);
      if (!titleBox || !actionsBox || !headerBox) {
        throw new Error('Expected production header controls to remain reachable');
      }
      expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(actionsBox.x + 0.5);
      expect(actionsBox.x + actionsBox.width).toBeLessThanOrEqual(
        headerBox.x + headerBox.width + 0.5,
      );
      await panelActionsButton.click();
      await expectUniqueVisible(listButton);
      await expect(page.getByTestId('chat-scroll-to-bottom-button')).toHaveCount(0);
      await expect(downButton).toHaveCount(0);

      const target = page.locator('[data-message-id="user-6"]');
      await expect(target).toHaveCount(1);
      expect(await duplicateLiveMessageIdentityPairs(page)).toEqual([]);
      // Exercise the hover-open then click path: the click must not steal search focus.
      await listButton.hover();
      const dialog = await pickerForTrigger(page, listButton);
      await expect(dialog.getByRole('combobox', { name: 'Filter user messages' })).toBeFocused();
      await listButton.click();
      await expect(dialog).toHaveRole('menu');
      const search = dialog.getByRole('combobox', { name: 'Filter user messages' });
      const options = dialog.getByRole('option');
      await expectUniqueVisible(search);
      await expect(search).toBeFocused();
      await expect(dialog.getByRole('listbox')).toHaveCount(1);
      await expect(options).toHaveCount(25);
      const optionDetails = await options.evaluateAll((nodes) =>
        nodes.map((node) => ({
          text: node.textContent?.trim(),
          title: node.getAttribute('title'),
          ariaLabel: node.getAttribute('aria-label'),
        })),
      );
      expect(optionDetails).toHaveLength(25);
      expect(optionDetails.some((item) => item.text?.includes('queued at'))).toBe(false);
      expect(optionDetails.some((item) => item.text?.includes('queued before you completed'))).toBe(
        false,
      );
      expect(optionDetails.every((item) => item.title === null)).toBe(true);
      expect(
        optionDetails.some((item) => item.ariaLabel?.includes('queued before you completed')),
      ).toBe(false);
      expect(optionDetails).toContainEqual({
        text: 'Virtualized target six',
        title: null,
        ariaLabel: null,
      });
      expect(optionDetails.some((item) => item.text === 'OK')).toBe(true);
      expect(optionDetails.some((item) => item.text === 'Duplicate prefix — short sibling')).toBe(
        true,
      );
      expect(
        optionDetails.some(
          (item) => item.text === 'Multilingual: こんにちは Привет مرحبا café नमस्ते 😀',
        ),
      ).toBe(true);
      await expect(
        dialog.getByRole('option', { name: 'Authored literal [SYSTEM NOTE] must stay visible' }),
      ).toHaveCount(1);
      // The navigator opens anchored at the most recent (last) message.
      const initialOption = options.last();
      await expect(initialOption).toHaveAttribute('aria-selected', 'true');
      await expect(search).toBeFocused();
      await search.press('Home');
      await expect(options.first()).toHaveAttribute('aria-selected', 'true');
      await search.press('ArrowDown');
      await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
      await search.press('ArrowUp');
      await expect(options.first()).toHaveAttribute('aria-selected', 'true');
      await initialOption.focus();
      await expect(initialOption).toBeFocused();
      await search.focus();
      await expect(search).toBeFocused();

      const pointerOption = options.nth(1);
      await pointerOption.hover();
      await expect(pointerOption).toHaveAttribute('aria-selected', 'true');
      await search.focus();
      await search.press('End');
      const keyboardOption = options.last();
      await expect(keyboardOption).toHaveAttribute('aria-selected', 'true');
      await search.press('Home');

      const dialogBox = await dialog.boundingBox();
      if (!dialogBox) throw new Error('Expected the message picker dialog');
      expect(dialogBox.x).toBeGreaterThanOrEqual(0);
      expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(viewport.width + 0.5);
      expect(dialogBox.y).toBeGreaterThanOrEqual(0);
      expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(viewport.height + 0.5);
      const longOption = dialog.getByRole('option', { name: /deliberately long message preview/ });
      const longLabel = longOption.locator('span').last();
      const overflowContract = await longLabel.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          overflowX: style.overflowX,
          whiteSpace: style.whiteSpace,
          textOverflow: style.textOverflow,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        };
      });
      expect(overflowContract).toMatchObject({
        overflowX: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
      });
      expect(overflowContract.scrollWidth).toBeGreaterThan(overflowContract.clientWidth);
      for (const target of [dialog, dialog.getByRole('listbox'), longOption]) {
        expect(
          await target.evaluate((element) => element.scrollWidth - element.clientWidth),
        ).toBeLessThanOrEqual(0);
      }
      await search.pressSequentially('hidden picker suffix');
      await expect(search).toHaveValue('hidden picker suffix');
      await expect(options).toHaveCount(0);
      await search.fill('queued before you completed');
      await expect(options).toHaveCount(0);
      await search.fill('Virtualized target six');
      const option = dialog.getByRole('option', { name: 'Virtualized target six', exact: true });
      await expect(option).toHaveCount(1);
      await expect(option).not.toHaveAttribute('title', 'Virtualized target six');
      await expect(option).toHaveAttribute('data-navigation-message-id', 'user-6');
      expect(await classifyMessageIdentityNodes(page, 'user-6')).toEqual([
        {
          ancestry: 'other',
          connected: true,
          lifecycle: 'transcript-row',
          transitionState: undefined,
          visible: true,
        },
        {
          ancestry: 'menu',
          connected: true,
          lifecycle: 'navigation-option',
          transitionState: 'open',
          visible: true,
        },
      ]);
      await option.click();

      await expect(dialog).toHaveCount(0);
      await expect(target).toHaveCount(1);
      await expect(target).toHaveClass(/message-highlight-flash/);
      await expect(target).toHaveAttribute('data-message-role', 'user');
      expect(await duplicateLiveMessageIdentityPairs(page)).toEqual([]);
      expect(await classifyMessageIdentityNodes(page, 'user-6')).toEqual([
        {
          ancestry: 'other',
          connected: true,
          lifecycle: 'transcript-row',
          transitionState: undefined,
          visible: true,
        },
      ]);
      await page.keyboard.press('Escape');
      await expect(panelActionsButton).toHaveAttribute('aria-expanded', 'false');
      await expect(target).toContainText('Virtualized target six');
      await expect(target).not.toContainText('[SYSTEM NOTE]');
      await expect(target.getByTestId('queued-message-notice-text')).toHaveText(
        'Waited in queue for 37s',
      );
      await expect(target.getByTestId('queued-message-notice')).toHaveAttribute('title', /2026/);
      expect(await target.ariaSnapshot()).not.toContain('[SYSTEM NOTE]');
      await target.hover();
      await target.getByRole('button', { name: 'Copy message' }).click();
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe('Virtualized target six');
      const transcript = component.locator('.conversation-column');
      await expectUniqueVisible(transcript);
      const scrollContainer = transcript.locator('..');
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
      await component
        .getByTestId('append-streaming-message')
        .evaluate((element: HTMLButtonElement) => element.click());
      await expect
        .poll(() => scrollContainer.evaluate((element) => element.scrollTop))
        .toBeCloseTo(selectedScrollTop, 0);
      await panelActionsButton.focus();
      await page.keyboard.press('Tab');
      await expect(closeButton).toBeFocused();
      await expect(downButton).toBeVisible();
      await downButton.click();
      await expect(panelActionsButton).toHaveAttribute('aria-expanded', 'false');
      await expect
        .poll(() =>
          scrollContainer.evaluate(
            (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
          ),
        )
        .toBeLessThanOrEqual(2);
      await panelActionsButton.click();
      await expect(downButton).toHaveCount(0);
      await listButton.click();
      await pickerForTrigger(page, listButton);
      await test.info().attach(`navigator-${state.theme}-${state.zoom}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    });
  }

  test('preserves keyboard, pointer, focus, and outside interaction ordering', async ({
    mount,
    page,
  }) => {
    const component = await mount(ChatMessageNavigatorIntegrationHost);
    const header = component.locator('[data-panel-content-header]');
    const panelActions = header.getByTestId('panel-actions-trigger');
    const closeButton = header.getByTestId('panel-close-button');
    const trigger = page.getByTestId('chat-message-navigator-trigger');
    const picker = page.locator('[data-chat-message-navigator-content]');

    await panelActions.focus();
    await page.keyboard.press('Tab');
    await expect(closeButton).toBeFocused();
    await panelActions.press('Space');
    await trigger.focus();
    await trigger.press('ArrowRight');
    await pickerForTrigger(page, trigger);
    const search = picker.getByRole('combobox', { name: 'Filter user messages' });
    await expect(search).toBeFocused();
    await search.press('Escape');
    await expect(picker).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panelActions).toBeFocused();
    await expect(panelActions).toHaveAttribute('aria-expanded', 'false');

    await panelActions.press('Enter');
    await trigger.focus();
    await trigger.press('Enter');
    await pickerForTrigger(page, trigger);
    await expect(search).toBeFocused();
    await search.fill('Virtualized target six');
    await search.press('Enter');
    await expect(picker).toHaveCount(0);
    await expect(component.locator('[data-message-id="user-6"]')).toHaveClass(
      /message-highlight-flash/,
    );
    await page.keyboard.press('Escape');
    await expect(panelActions).toBeFocused();

    await panelActions.click();
    await trigger.hover();
    await pickerForTrigger(page, trigger);
    await expect(search).toBeFocused();
    await picker.getByRole('option').first().focus();
    await expect(picker).toBeVisible();
    await closeButton.focus();
    await expect(picker).toHaveCount(0);
    await expect(closeButton).toBeFocused();
    await expect(panelActions).toHaveAttribute('aria-expanded', 'true');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await trigger.click();
    await pickerForTrigger(page, trigger);
    await expect(search).toBeFocused();
    await page.mouse.click(0, 0);
    await expect(picker).toHaveCount(0);
    await expect(panelActions).toHaveAttribute('aria-expanded', 'false');
    await test.info().attach('navigator-outside-dismissal', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
});
