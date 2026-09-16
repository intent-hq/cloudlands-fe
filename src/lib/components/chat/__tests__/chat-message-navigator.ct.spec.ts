import { expect, test, type Locator, type Page } from '@playwright/experimental-ct-svelte';
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

async function expectSharedDropdownSurface(surface: Locator) {
  const contract = await surface.evaluate((node) => {
    const probe = document.createElement('span');
    probe.style.cssText = [
      'background-color:hsl(var(--popover))',
      'color:hsl(var(--popover-foreground))',
      'border-color:hsl(var(--border))',
      'border-radius:var(--radius-medium)',
      'padding:var(--space-1)',
      'z-index:var(--layer-popover)',
    ].join(';');
    document.body.append(probe);
    const style = getComputedStyle(node);
    const tokens = getComputedStyle(probe);
    const result = {
      backgroundColor: style.backgroundColor,
      color: style.color,
      borderColor: style.borderTopColor,
      borderWidths: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth],
      borderRadius: style.borderTopLeftRadius,
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
      zIndex: style.zIndex,
      boxShadow: style.boxShadow,
      outlineStyle: style.outlineStyle,
      transitionProperty: style.transitionProperty,
      tokens: {
        backgroundColor: tokens.backgroundColor,
        color: tokens.color,
        borderColor: tokens.borderTopColor,
        borderRadius: tokens.borderTopLeftRadius,
        padding: tokens.paddingTop,
        zIndex: tokens.zIndex,
      },
    };
    probe.remove();
    return result;
  });
  expect(contract).toMatchObject({
    backgroundColor: contract.tokens.backgroundColor,
    color: contract.tokens.color,
    borderColor: contract.tokens.borderColor,
    borderWidths: ['1px', '1px', '1px'],
    borderRadius: contract.tokens.borderRadius,
    padding: Array(4).fill(contract.tokens.padding),
    zIndex: contract.tokens.zIndex,
    outlineStyle: 'none',
  });
  expect(contract.boxShadow).not.toBe('none');
  expect(contract.transitionProperty).toBe('none');
}

function splitShadowLayers(value: string) {
  const layers: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '(') depth += 1;
    else if (value[index] === ')') depth -= 1;
    else if (value[index] === ',' && depth === 0) {
      layers.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  layers.push(value.slice(start).trim());
  return layers;
}

function hasTransparentShadowColor(layer: string) {
  if (/\btransparent\b/i.test(layer)) return true;
  const color = layer.match(/\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^)]*\)/i)?.[0];
  if (!color) return false;
  const slashAlpha = color.match(/\/\s*([0-9]*\.?[0-9]+)(%)?\s*\)$/);
  if (slashAlpha) return Number(slashAlpha[1]) === 0;
  if (!/^rgba|^hsla/i.test(color)) return false;
  const commaAlpha = color.match(/,\s*([0-9]*\.?[0-9]+)(%)?\s*\)$/);
  return commaAlpha ? Number(commaAlpha[1]) === 0 : false;
}

function hasVisibleBoxShadow(value: string) {
  if (value === 'none') return false;
  return splitShadowLayers(value).some((layer) => {
    const lengths = layer.match(/-?(?:[0-9]+|[0-9]*\.[0-9]+)px/gi);
    if (!lengths || lengths.length < 2 || lengths.length > 4) return true;
    const hasNonZeroGeometry = lengths.some((length) => Number.parseFloat(length) !== 0);
    return hasNonZeroGeometry && !hasTransparentShadowColor(layer);
  });
}

async function pickerForTrigger(page: Page, trigger: Locator) {
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const picker = page.getByRole('dialog', { name: 'Browse user messages' });
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
        const popover = element.closest<HTMLElement>('[data-popover-content]');
        const lazyTurn = element.closest<HTMLElement>('[data-lazy-visible]');
        return {
          ancestry: popover ? 'dialog' : lazyTurn ? 'transcript' : 'other',
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
  // The CT page is reused across tests and CDP emulation overrides are
  // per-session, so clear the override on the SAME session and detach it to
  // keep the metrics from leaking into later specs in this worker.
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
      const headerContentActions = header.locator('[data-panel-header-content-actions]');
      const headerActions = header.locator('[data-panel-header-actions]');
      const title = header.locator('[data-panel-header-title]');
      const titleText = header.getByText('Navigation agent', { exact: true });
      const listButton = headerContentActions.getByTestId('chat-message-navigator-trigger');
      const downButton = headerContentActions.getByTestId('chat-scroll-to-bottom-button');
      const addColumnButton = headerActions.locator('[data-add-panel-column]');
      const panelActionsButton = headerActions.getByTestId('panel-actions-trigger');
      const closeButton = headerActions.getByTestId('panel-close-button');
      await expectUniqueVisible(header);
      await expectUniqueVisible(headerActions);
      await expectUniqueVisible(titleText);
      await expectUniqueVisible(listButton);
      await expectUniqueVisible(downButton);
      await expectUniqueVisible(addColumnButton);
      await expectUniqueVisible(panelActionsButton);
      await expectUniqueVisible(closeButton);
      await expect(downButton).toBeDisabled();
      expect(
        await headerActions
          .locator('button')
          .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-testid'))),
      ).toEqual([
        'chat-message-navigator-trigger',
        'chat-scroll-to-bottom-button',
        'panel-actions-trigger',
        null,
        'panel-close-button',
      ]);
      const [
        titleBox,
        actionsBox,
        headerBox,
        listButtonBox,
        downButtonBox,
        listIconBox,
        arrowIconBox,
        arrowComputedSize,
      ] = await Promise.all([
        title.boundingBox(),
        headerActions.boundingBox(),
        header.boundingBox(),
        listButton.boundingBox(),
        downButton.boundingBox(),
        listButton.locator('svg').boundingBox(),
        downButton.locator('svg').boundingBox(),
        downButton.locator('svg').evaluate((icon) => {
          const computed = getComputedStyle(icon);
          return {
            width: Number.parseFloat(computed.width),
            height: Number.parseFloat(computed.height),
          };
        }),
      ]);
      if (
        !titleBox ||
        !actionsBox ||
        !headerBox ||
        !listButtonBox ||
        !downButtonBox ||
        !listIconBox ||
        !arrowIconBox
      ) {
        throw new Error('Expected complete production header geometry');
      }
      expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(actionsBox.x + 0.5);
      expect(actionsBox.x + actionsBox.width).toBeLessThanOrEqual(
        headerBox.x + headerBox.width + 0.5,
      );
      expect(listIconBox.width).toBeCloseTo(14, 0);
      expect(listIconBox.height).toBeCloseTo(14, 0);
      expect(arrowIconBox.width).toBeCloseTo(16, 0);
      expect(arrowIconBox.height).toBeCloseTo(16, 0);
      expect(arrowComputedSize).toEqual({ width: 16, height: 16 });
      expect(listButtonBox.width).toBeCloseTo(28, 0);
      expect(listButtonBox.height).toBeCloseTo(28, 0);
      expect(downButtonBox.width).toBeCloseTo(28, 0);
      expect(downButtonBox.height).toBeCloseTo(28, 0);
      await expect(downButton).toHaveAttribute('data-icon-size', '16');

      const target = page.locator('[data-message-id="user-6"]');
      await expect(target).toHaveCount(1);
      expect(await duplicateLiveMessageIdentityPairs(page)).toEqual([]);
      await listButton.click();
      const dialog = await pickerForTrigger(page, listButton);
      await expect(dialog).toHaveRole('dialog', { name: 'Browse user messages' });
      await expectSharedDropdownSurface(dialog);
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
          height: node.getBoundingClientRect().height,
          textAlign: getComputedStyle(node).textAlign,
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
        height: 36,
        textAlign: 'left',
      });
      expect(optionDetails.every((item) => item.height === 36)).toBe(true);
      expect(optionDetails.every((item) => item.textAlign === 'left')).toBe(true);
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
      expect(
        await initialOption
          .locator('span')
          .evaluate((element) => getComputedStyle(element).fontWeight),
      ).toBe('400');
      const searchFocus = await search.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          backgroundColor: style.backgroundColor,
          borderColor: style.borderColor,
          boxShadow: style.boxShadow,
          outline: style.outlineStyle,
        };
      });
      expect(hasVisibleBoxShadow(searchFocus.boxShadow)).toBe(false);
      expect(searchFocus.outline).toBe('none');
      await search.press('ArrowDown');
      await search.press('ArrowUp');
      await initialOption.focus();
      await expect(initialOption).toBeFocused();
      const searchBlur = await search.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          backgroundColor: style.backgroundColor,
          borderColor: style.borderColor,
          boxShadow: style.boxShadow,
          outline: style.outlineStyle,
        };
      });
      expect(searchFocus.backgroundColor).toBe(searchBlur.backgroundColor);
      expect(searchFocus.borderColor).not.toBe(searchBlur.borderColor);
      expect(hasVisibleBoxShadow(searchBlur.boxShadow)).toBe(false);
      expect(searchFocus.outline).toBe(searchBlur.outline);
      const rowFocus = await initialOption.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          boxShadow: style.boxShadow,
          outline: style.outlineStyle,
          backgroundColor: style.backgroundColor,
        };
      });
      expect(hasVisibleBoxShadow(rowFocus.boxShadow)).toBe(true);
      expect(rowFocus.outline).toBe('none');
      expect(rowFocus.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
      await search.focus();
      await expect(search).toBeFocused();

      const pointerOption = options.nth(1);
      await pointerOption.hover();
      await expect(pointerOption).toHaveAttribute('aria-selected', 'true');
      expect(await pointerOption.evaluate((element) => getComputedStyle(element).textAlign)).toBe(
        'left',
      );
      await search.focus();
      await search.press('End');
      const keyboardOption = options.last();
      await expect(keyboardOption).toHaveAttribute('aria-selected', 'true');
      expect(await keyboardOption.evaluate((element) => getComputedStyle(element).textAlign)).toBe(
        'left',
      );
      await search.press('Home');

      const dialogBox = await dialog.boundingBox();
      if (!dialogBox) throw new Error('Expected the message picker dialog');
      const computedMaxWidth = await dialog.evaluate(
        (element) => getComputedStyle(element).maxWidth,
      );
      const panelBox = await component.locator('[data-panel-id="chat-panel"]').boundingBox();
      if (!panelBox) throw new Error('Expected the production panel boundary');
      expect(computedMaxWidth).not.toBe('none');
      expect(dialogBox.width).toBeLessThanOrEqual(Math.min(448, viewport.width - 16) + 0.5);
      expect(dialogBox.x).toBeGreaterThanOrEqual(Math.max(7.5, panelBox.x + 7.5));
      expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(
        Math.min(viewport.width - 7.5, panelBox.x + panelBox.width - 7.5),
      );
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
      const alignedBoxes = await Promise.all([search.boundingBox(), initialOption.boundingBox()]);
      for (const box of alignedBoxes) {
        if (!box) throw new Error('Expected aligned navigator geometry');
        for (const value of [box.x, box.y, box.width, box.height]) {
          expect(Math.abs(value * state.zoom - Math.round(value * state.zoom))).toBeLessThanOrEqual(
            0.5,
          );
        }
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
          ancestry: 'dialog',
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
      await expect(downButton).toBeEnabled();
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
      await expect(downButton).toBeEnabled();
      await listButton.focus();
      await expect(listButton).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByRole('dialog', { name: 'Browse user messages' })).toHaveCount(0);
      await expect(listButton).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(downButton).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(panelActionsButton).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(addColumnButton).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(closeButton).toBeFocused();
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
    const headerContentActions = header.locator('[data-panel-header-content-actions]');
    const headerActions = header.locator('[data-panel-header-actions]');
    const trigger = headerContentActions.getByTestId('chat-message-navigator-trigger');
    const downButton = headerContentActions.getByTestId('chat-scroll-to-bottom-button');
    const addColumnButton = headerActions.locator('[data-add-panel-column]');
    const outside = headerActions.getByTestId('panel-actions-trigger');
    const closeButton = headerActions.getByTestId('panel-close-button');
    const title = header.getByText('Navigation agent', { exact: true });
    await expectUniqueVisible(header);
    await expectUniqueVisible(headerActions);
    await expectUniqueVisible(trigger);
    await expectUniqueVisible(downButton);
    await expectUniqueVisible(addColumnButton);
    await expectUniqueVisible(outside);
    await expectUniqueVisible(title);

    await trigger.focus();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('dialog', { name: 'Browse user messages' })).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(outside).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(addColumnButton).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(closeButton).toBeFocused();

    await trigger.press('Space');
    let dialog = await pickerForTrigger(page, trigger);
    await expect(dialog).toHaveRole('dialog', { name: 'Browse user messages' });
    await expect(dialog.getByRole('combobox', { name: 'Filter user messages' })).toBeFocused();
    await trigger.focus();
    await trigger.press('Space');
    await expect(dialog).toHaveCount(0);

    await trigger.press('Space');
    dialog = await pickerForTrigger(page, trigger);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await trigger.press('Enter');
    dialog = await pickerForTrigger(page, trigger);
    await expect(dialog.getByRole('combobox', { name: 'Filter user messages' })).toBeFocused();
    await trigger.focus();
    await trigger.press('Enter');
    await expect(dialog).toHaveCount(0);

    await trigger.press('Enter');
    dialog = await pickerForTrigger(page, trigger);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await page.mouse.move(0, 0);
    await trigger.hover();
    const triggerTooltip = page.getByRole('tooltip', { name: 'Browse user messages' });
    await expect(triggerTooltip).toBeVisible();
    await trigger.click();
    dialog = await pickerForTrigger(page, trigger);
    await expect(dialog.getByRole('combobox', { name: 'Filter user messages' })).toBeFocused();
    await expect(triggerTooltip).toHaveCount(0);
    await page.waitForTimeout(350);
    await expect(triggerTooltip).toHaveCount(0);
    await title.click();
    await expect(dialog).toHaveCount(0);

    await trigger.click();
    dialog = await pickerForTrigger(page, trigger);
    await expect(dialog.getByRole('combobox', { name: 'Filter user messages' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await outside.focus();
    await trigger.focus();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    dialog = await pickerForTrigger(page, trigger);
    const search = dialog.getByRole('combobox', { name: 'Filter user messages' });
    await expect(search).toBeFocused();
    await dialog.getByRole('option').first().focus();
    await expect(dialog).toBeVisible();
    await outside.focus();
    await expect(dialog).toHaveCount(0);

    await page.mouse.move(0, 0);
    await trigger.hover();
    await page.waitForTimeout(350);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('dialog', { name: 'Browse user messages' })).toHaveCount(0);
    await expect(page.getByRole('tooltip', { name: 'Browse user messages' })).toBeVisible();
  });
});
