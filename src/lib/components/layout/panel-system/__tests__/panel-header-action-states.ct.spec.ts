import type { Locator } from '@playwright/test';
import { expect, test } from '../../../../../test/ct-test';
import { failOnConsoleErrors } from '../../../../../test/ct-console-errors';
import SimpleAgentPanelHeaderHost from './mocks/SimpleAgentPanelHeaderHost.svelte';
import HeaderOwnerAvatarHost from './mocks/HeaderOwnerAvatarHost.svelte';

failOnConsoleErrors(test);

const hooksConfig = {
  mockIpc: {
    'workspace:get': {
      success: true,
      data: {
        id: 'simple-agent-header-workspace',
        title: 'Header interaction fixture',
        status: 'active',
        worktreePath: '/tmp/simple-agent-header-workspace',
      },
    },
  },
};

function surfaceColor(trigger: Locator) {
  return trigger.locator('[data-slot="button-surface"]').evaluate((surface) => {
    return getComputedStyle(surface).backgroundColor;
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`header menus share hover and persistent open surfaces in ${theme} mode`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(SimpleAgentPanelHeaderHost, {
      props: { fullActions: true, stackCount: 2, width: 560, theme },
      hooksConfig,
    });
    const header = component.locator('[data-panel-tabless-header]');
    let hoverColor: string | undefined;
    let openColor: string | undefined;
    for (const id of [
      'browser-tabs-trigger',
      'chat-message-navigator-trigger',
      'panel-actions-trigger',
      'pane-stack-selector-trigger',
    ]) {
      const trigger = header.getByTestId(id);
      await page.mouse.move(800, 600);
      const restingColor = await surfaceColor(trigger);
      await trigger.hover();
      await expect.poll(() => surfaceColor(trigger)).not.toBe(restingColor);
      const hovered = await surfaceColor(trigger);
      if (hoverColor) expect(hovered).toBe(hoverColor);
      hoverColor = hovered;

      await trigger.press('Enter');
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await page.mouse.move(800, 600);
      await expect.poll(() => surfaceColor(trigger)).not.toBe(restingColor);
      const opened = await surfaceColor(trigger);
      if (openColor) expect(opened).toBe(openColor);
      openColor = opened;
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(trigger).toBeFocused();
      await expect.poll(() => surfaceColor(trigger)).toBe(restingColor);
      const focus = await trigger.evaluate((node) => {
        const style = getComputedStyle(node);
        return { visible: node.matches(':focus-visible'), outline: style.outlineStyle };
      });
      expect(focus.visible).toBe(true);
      expect(focus.outline).toBe('solid');
    }
  });
}

test('narrow header keeps spaced targets usable through menu, scroll and disabled-column actions', async ({
  mount,
  page,
}) => {
  const component = await mount(SimpleAgentPanelHeaderHost, {
    props: { fullActions: true, stackCount: 2, width: 280 },
    hooksConfig,
  });
  const header = component.locator('[data-panel-tabless-header]');
  const actions = header.locator('[data-panel-header-actions]');
  const rects = await actions.locator('button').evaluateAll((buttons) =>
    buttons.map((button) => {
      const { x, y, width, height, right } = button.getBoundingClientRect();
      return { x, y, width, height, right };
    }),
  );
  for (const [index, rect] of rects.entries()) {
    expect(rect.width).toBe(28);
    expect(rect.height).toBe(28);
    if (index > 0) {
      expect(rect.y).toBe(rects[0].y);
      expect(rect.x - rects[index - 1].right).toBeGreaterThanOrEqual(2);
    }
  }
  expect(await header.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);

  const browser = header.getByTestId('browser-tabs-trigger');
  await browser.click();
  await expect(browser).toHaveAttribute('aria-expanded', 'true');
  const outside = await component.getByTestId('header-adjacent-content').boundingBox();
  await page.mouse.click(outside!.x + 10, outside!.y + outside!.height - 10);
  await expect(browser).toHaveAttribute('aria-expanded', 'false');

  const scroll = header.getByTestId('chat-scroll-to-bottom-button');
  await scroll.click();
  await expect(scroll).toBeDisabled();
  await header.getByTestId('chat-message-navigator-trigger').focus();
  await page.keyboard.press('Tab');
  await expect(header.getByTestId('panel-actions-trigger')).toBeFocused();

  const add = header.locator('[data-add-panel-column]');
  await add.click();
  await add.click();
  await add.click();
  await expect(component).toHaveAttribute('data-column-count', '4');
  await expect(add).toHaveAttribute('aria-disabled', 'true');
  await add.press('Enter');
  await expect(component).toHaveAttribute('data-column-count', '4');
  await header.getByTestId('panel-close-button').press('Enter');
  await expect(component).toHaveAttribute('data-close-count', '1');
});

test('browser owner uses a toolbar target without resizing inline identity and forwards activation', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(HeaderOwnerAvatarHost);
  const owner = component.getByTestId('header-owner').getByRole('button');
  const inline = component.getByTestId('inline-owner').getByRole('button');
  const size = (node: Locator) =>
    node.evaluate((element) => {
      const { width, height } = element.getBoundingClientRect();
      return { width, height };
    });
  expect(await size(owner)).toEqual({ width: 28, height: 28 });
  expect((await size(inline)).width).toBeLessThan(28);
  expect(await size(owner.getByTestId('inline-agent-avatar-ring'))).toEqual(
    await size(inline.getByTestId('inline-agent-avatar-ring')),
  );
  expect(await size(owner.locator('[data-agent-avatar]'))).toEqual(
    await size(inline.locator('[data-agent-avatar]')),
  );
  const resting = await surfaceColor(owner);
  await owner.hover();
  await expect.poll(() => surfaceColor(owner)).not.toBe(resting);
  await page.mouse.move(800, 600);
  await page.keyboard.press('Tab');
  await expect(owner).toBeFocused();
  expect(await owner.evaluate((node) => node.matches(':focus-visible'))).toBe(true);
  expect(await owner.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('solid');
  await owner.press('Space');
  await expect(component).toHaveAttribute('data-activations', '1');
  await owner.click({ modifiers: ['ControlOrMeta'] });
  await expect(component).toHaveAttribute('data-activations', '2');
  await expect(component).toHaveAttribute('data-modified', 'true');
});
