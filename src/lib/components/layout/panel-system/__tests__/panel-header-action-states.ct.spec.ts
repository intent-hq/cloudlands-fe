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

test('agent submenus support keyboard entry, selection and dismissal', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(SimpleAgentPanelHeaderHost, {
    props: { fullActions: true, stackCount: 2, width: 280 },
    hooksConfig,
  });
  const header = component.locator('[data-panel-tabless-header]');
  const trigger = header.getByTestId('panel-actions-trigger');
  await trigger.press('Enter');
  const root = page.locator('[data-slot="menu-content"]');
  for (const id of ['task-progress-trigger', 'browser-tabs-trigger']) {
    const item = root.getByTestId(id);
    await item.focus();
    await page.keyboard.press('ArrowRight');
    await expect(item).toHaveAttribute('aria-expanded', 'true');
    if (id === 'task-progress-trigger') {
      await expect(page.getByTestId('task-progress-list')).toContainText('Review the header');
    }
    await page.keyboard.press('Escape');
    await expect(item).toHaveAttribute('aria-expanded', 'false');
    await expect(item).toBeFocused();
  }
  const navigation = root.getByTestId('chat-message-navigator-trigger');
  await navigation.focus();
  await page.keyboard.press('ArrowRight');
  const search = page.getByTestId('chat-message-navigator-search');
  await search.fill('Review header');
  await search.press('Enter');
  await expect(component).toHaveAttribute('data-selected-message', 'first');
  await root.getByTestId('chat-scroll-to-bottom-button').click();
  await trigger.click();
  await expect(root.getByTestId('chat-scroll-to-bottom-button')).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await testInfo.attach('agent-actions', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('additional action dismisses the menu while header zoom and close remain accessible', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(SimpleAgentPanelHeaderHost, {
    props: { fullActions: true, stackCount: 2, width: 280 },
    hooksConfig,
  });
  const trigger = component
    .locator('[data-panel-tabless-header]')
    .getByTestId('panel-actions-trigger');
  await trigger.press('Enter');
  await expect(page.getByRole('menuitem', { name: /Zoom Panel/ })).toHaveCount(0);
  await page.getByTestId('chat-scroll-to-bottom-button').press('Enter');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  await expect(page.getByTestId('chat-scroll-to-bottom-button')).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await testInfo.attach('scroll-action-disabled-after-selection', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await component.locator('[data-panel-tabless-header]').dblclick({ position: { x: 2, y: 2 } });
  await expect(component).toHaveAttribute('data-zoom-count', '1');
  await component
    .locator('[data-panel-tabless-header]')
    .getByTestId('panel-close-button')
    .press('Enter');
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
