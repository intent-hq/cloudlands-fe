import type { MountResult } from '@playwright/experimental-ct-svelte';
import { expect, test } from '../../../../../test/ct-test';
import {
  failOnConsoleErrors,
  peekConsoleErrors,
  takeConsoleErrors,
} from '../../../../../test/ct-console-errors';
import SimpleAgentPanelHeaderHost from './mocks/SimpleAgentPanelHeaderHost.svelte';

failOnConsoleErrors(test);

// The full-actions header's panel menu mounts the real WorkspaceActionsMenu,
// which resolves its editor/reveal paths through `workspace:get`. Answer in
// the `{ success, data }` envelope the workspaces seeder serves so the lookup
// does not fall back on a caught UnbridgedMockIpcChannelError
// (intent-hq/intent#5276).
const hooksConfig = {
  mockIpc: {
    'workspace:get': {
      success: true,
      data: {
        id: 'simple-agent-header-workspace',
        title: 'Simple agent header workspace',
        status: 'active',
        worktreePath: '/tmp/simple-agent-header-workspace',
      },
    },
  },
};

// Negative harness check (intent-hq/intent#5276): without the `workspace:get`
// mock, opening the panel actions menu mounts the real WorkspaceActionsMenu,
// whose path lookup fails, is caught, and surfaces through the console-error
// guard.
test('fails the console-error guard when the workspace:get mock is missing', async ({
  mount,
  page,
}) => {
  const component = await mount(SimpleAgentPanelHeaderHost, {
    props: { fullActions: true, stackCount: 2, width: 560 },
  });
  const header = component.locator('[data-panel-tabless-header]');
  await header.getByTestId('panel-actions-trigger').click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect
    .poll(() => peekConsoleErrors(page).some((text) => text.includes("channel 'workspace:get'")))
    .toBe(true);
  const errors = takeConsoleErrors(page);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain('[WorkspaceActionsMenu] Failed to resolve path');
});

const names = {
  root: 'Root coordinator with a deliberately long current agent name',
  delegated: 'Layout verifier with a deliberately long current agent name',
} as const;

type HeaderLocator = ReturnType<MountResult<typeof SimpleAgentPanelHeaderHost>['locator']>;

async function measureHeader(header: HeaderLocator) {
  return header.evaluate((element) => {
    const rect = (node: Element) => {
      const { x, y, width, height, right, bottom } = node.getBoundingClientRect();
      return { x, y, width, height, right, bottom };
    };
    const identity = element.querySelector('[data-panel-agent-header-identity]')!;
    const actions = element.querySelector('[data-panel-header-actions]')!;
    const title = identity.querySelector('[data-panel-header-title]')!;
    const editable = title.querySelector('.agent-header-editable')!;
    const control = title.querySelector('button, input')!;
    const controls = [...actions.querySelectorAll<HTMLButtonElement>('button')];
    return {
      header: rect(element),
      identity: rect(identity),
      actions: rect(actions),
      avatar: rect(identity.querySelector('[data-panel-header-leading-surface]')!),
      title: rect(title),
      control: rect(control),
      surface: rect(editable.querySelector(':scope > span[aria-hidden]')!),
      controls: controls.map((button) => ({ ...rect(button), disabled: button.disabled })),
      hitTargets: [control, ...controls.filter((button) => !button.disabled)].map((node) => {
        const box = node.getBoundingClientRect();
        return [box.left + 2, box.left + box.width / 2, box.right - 2].every((x) =>
          node.contains(document.elementFromPoint(x, box.top + box.height / 2)),
        );
      }),
      overflow: element.scrollWidth > element.clientWidth,
      contentTop: element
        .closest('[data-testid="simple-agent-panel-header-host"]')!
        .querySelector('[data-testid="header-adjacent-content"]')!
        .getBoundingClientRect().top,
    };
  });
}

async function expectContainedHeader(header: HeaderLocator, actionCount: number) {
  const geometry = await measureHeader(header);
  expect(geometry.controls).toHaveLength(actionCount);
  expect(geometry.overflow).toBe(false);
  expect(geometry.hitTargets.every(Boolean)).toBe(true);
  expect(geometry.control.width).toBeGreaterThan(0);
  expect(geometry.contentTop).toBeGreaterThanOrEqual(geometry.header.bottom);
  expect(geometry.control.x).toBeGreaterThanOrEqual(geometry.title.x);
  expect(geometry.control.right).toBeLessThanOrEqual(geometry.title.right + 0.5);
  expect(geometry.title.x).toBeGreaterThanOrEqual(geometry.avatar.right);
  expect(geometry.surface.x).toBeGreaterThanOrEqual(geometry.avatar.right - 0.5);
  expect(geometry.surface.right).toBeLessThanOrEqual(geometry.header.right);
  const sameRow =
    geometry.identity.y < geometry.actions.bottom && geometry.actions.y < geometry.identity.bottom;
  if (sameRow) expect(geometry.surface.right).toBeLessThanOrEqual(geometry.actions.x + 0.5);
  for (const [index, button] of geometry.controls.entries()) {
    expect(button.width).toBe(28);
    expect(button.height).toBe(28);
    expect(button.x).toBeGreaterThanOrEqual(geometry.header.x);
    expect(button.right).toBeLessThanOrEqual(geometry.header.right);
    if (index > 0) expect(button.x).toBeGreaterThanOrEqual(geometry.controls[index - 1].right);
  }
  return geometry;
}

test('contains the full stacked header and inline rename at regular width', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(SimpleAgentPanelHeaderHost, {
    props: { fullActions: true, stackCount: 2, width: 560 },
    hooksConfig,
  });
  const header = component.locator('[data-panel-tabless-header]');
  await page.evaluate(() => document.fonts.ready);
  const before = await measureHeader(header);
  await testInfo.attach('full-header-geometry', {
    body: JSON.stringify(before),
    contentType: 'application/json',
  });
  await testInfo.attach('full-header', {
    body: await header.screenshot(),
    contentType: 'image/png',
  });
  await expectContainedHeader(header, 8);
  const name = header.getByRole('button', { name: names.root });
  await name.click();
  const input = header.getByRole('textbox');
  await expect(input).toBeFocused();
  expect(
    await input.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd]),
  ).toEqual([0, names.root.length]);
  await expectContainedHeader(header, 8);
  await input.fill('Short');
  await input.press('Enter');
  await expect(component).toHaveAttribute('data-rename-count', '1');
  await header.getByRole('button', { name: 'Short', exact: true }).press('Space');
  await expect(input).toBeFocused();
  await input.fill(names.root);
  await header.getByTestId('panel-actions-trigger').click();
  await expect(component).toHaveAttribute('data-rename-count', '2');
  await page.keyboard.press('Escape');
  await expect(header.getByTestId('panel-actions-trigger')).toBeFocused();
  await expectContainedHeader(header, 8);
  await expect(component).toHaveAttribute('data-zoom-count', '0');
});

for (const width of [280, 320]) {
  test(`keeps full-header actions and rename reachable at ${width}px`, async ({
    mount,
    page,
  }, testInfo) => {
    const component = await mount(SimpleAgentPanelHeaderHost, {
      props: { fullActions: true, stackCount: 2, width, theme: 'dark' },
      hooksConfig,
    });
    const header = component.locator('[data-panel-tabless-header]');
    await page.evaluate(() => document.fonts.ready);
    await testInfo.attach('narrow-header-geometry', {
      body: JSON.stringify(await measureHeader(header)),
      contentType: 'application/json',
    });
    await testInfo.attach('narrow-header', {
      body: await header.screenshot(),
      contentType: 'image/png',
    });
    await expectContainedHeader(header, 8);
    const narrowGeometry = await measureHeader(header);
    expect(narrowGeometry.actions.y).toBeGreaterThanOrEqual(narrowGeometry.identity.bottom);
    await header.getByRole('button', { name: names.root }).press('Enter');
    const input = header.getByRole('textbox');
    await expect(input).toBeFocused();
    expect((await input.boundingBox())!.width).toBeGreaterThanOrEqual(60);
    await expectContainedHeader(header, 8);
    await input.fill('Cancelled');
    await input.press('Escape');
    await expect(component).toHaveAttribute('data-rename-count', '0');
    const task = header.getByTestId('task-progress-trigger');
    await task.click();
    await expect(task).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(task).toBeFocused();
    await page.keyboard.press('Tab');
    const browser = header.getByRole('button', { name: /browser tab/i });
    await expect(browser).toBeFocused();
    await browser.press('Enter');
    await expect(page.getByRole('menuitem', { name: /Header preview/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(browser).toBeFocused();
    await page.keyboard.press('Tab');
    const navigator = header.getByTestId('chat-message-navigator-trigger');
    await expect(navigator).toBeFocused();
    await navigator.press('Enter');
    await page.getByTestId('chat-message-navigator-search').fill('Review header');
    await page.keyboard.press('Enter');
    await expect(component).toHaveAttribute('data-selected-message', 'first');
    await expect(navigator).toBeFocused();
    const scroll = header.getByTestId('chat-scroll-to-bottom-button');
    await scroll.click();
    await expect(scroll).toBeDisabled();
    await navigator.focus();
    await page.keyboard.press('Tab');
    const menu = header.getByTestId('panel-actions-trigger');
    await expect(menu).toBeFocused();
    await menu.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeFocused();
    const selector = header.getByTestId('pane-stack-selector-trigger');
    await selector.click();
    await page.getByRole('menuitem', { name: new RegExp(names.delegated) }).click();
    await expect(header.getByRole('button', { name: names.delegated })).toBeVisible();
    await header.locator('[data-add-panel-column]').click();
    await expect(component).toHaveAttribute('data-column-count', '2');
    await header.getByTestId('panel-close-button').press('Space');
    await expect(component).toHaveAttribute('data-close-count', '1');
    await expect(component).toHaveAttribute('data-zoom-count', '0');
    await expectContainedHeader(header, 8);
  });
}

test('wraps only below the full stacked action and rename budget during panel resize', async ({
  mount,
}) => {
  const component = await mount(SimpleAgentPanelHeaderHost, {
    props: { fullActions: true, stackCount: 2, width: 380 },
  });
  const header = component.locator('[data-panel-tabless-header]');
  const regular = await expectContainedHeader(header, 8);
  expect(regular.identity.y).toBe(regular.actions.y);
  await header.getByRole('button', { name: names.root }).click();
  const input = header.getByRole('textbox');
  await input.fill('A long editable name that must stay inside the resizing header');
  await component.update({ props: { width: 360 } });
  await expect(input).toBeFocused();
  const narrow = await expectContainedHeader(header, 8);
  expect(narrow.actions.y).toBeGreaterThanOrEqual(narrow.identity.bottom);
  await component.update({ props: { width: 380 } });
  await expect(input).toBeFocused();
  const restored = await expectContainedHeader(header, 8);
  expect(restored.identity.y).toBe(restored.actions.y);
  expect(restored.header.height).toBe(regular.header.height);
  await input.press('Escape');
  await expect(component).toHaveAttribute('data-rename-count', '0');
});

test('shows only the current agent identity across root, delegated, single, stacked, and width states', async ({
  mount,
}) => {
  const component = await mount(SimpleAgentPanelHeaderHost);

  for (const activeAgent of ['root', 'delegated'] as const) {
    for (const stackCount of [1, 2] as const) {
      for (const width of [240, 560]) {
        await component.update({ props: { activeAgent, stackCount, width } });
        const header = component.locator('[data-panel-tabless-header]');
        const identity = header.locator('[data-panel-agent-header-identity]');
        const currentName = names[activeAgent];
        const otherName = names[activeAgent === 'root' ? 'delegated' : 'root'];

        await expect(identity).toHaveCount(1);
        const avatarSlot = identity.getByTestId('panel-header-agent-avatar-slot');
        const avatar = avatarSlot.locator('svg[data-agent-avatar]');
        await expect(avatar).toHaveCount(1);
        await expect(avatar).toHaveAttribute('data-avatar-variant', 'emphasized');
        await expect(avatar).toHaveAttribute('width', '24');
        await expect(avatar).toHaveAttribute('height', '24');
        await expect(avatarSlot.locator('[data-panel-agent-chat-glyph]')).toHaveCount(0);
        await expect(avatarSlot.locator('[data-panel-agent-chat-text-glyph]')).toHaveCount(0);
        const stateAvatar = identity.locator('[data-agent-avatar-with-state]');
        await expect(stateAvatar).toHaveCount(1);
        await expect(stateAvatar).toHaveAttribute('data-avatar-state', 'idle');
        const geometry = await avatarSlot.evaluate((slot) => {
          const avatar = slot.querySelector<SVGElement>('[data-agent-avatar]')!;
          const slotRect = slot.getBoundingClientRect();
          const avatarRect = avatar.getBoundingClientRect();
          return {
            slot: [slotRect.width, slotRect.height],
            avatar: [avatarRect.width, avatarRect.height],
          };
        });
        expect(geometry).toEqual({ slot: [24, 24], avatar: [24, 24] });
        await expect(identity.getByRole('button', { name: currentName })).toHaveCount(1);
        await expect(header).not.toContainText(otherName);
        await expect(header.locator('[data-pane-stack]')).toHaveCount(0);
        await expect(header.locator('[data-pane-stack-layer]')).toHaveCount(0);
        await expect(header.locator('[data-pane-stack-position]')).toHaveCount(0);
        await expect(header.locator('[data-pane-stack-overflow-trigger]')).toHaveCount(0);
        await expect(header.locator('[data-panel-identity-back]')).toHaveCount(0);
        await expect(header.locator('[data-panel-identity-forward]')).toHaveCount(0);
        await expect(header.getByTestId('panel-actions-trigger')).toBeVisible();
        await expect(header.getByTestId('panel-close-button')).toBeVisible();

        const nameGeometry = await identity
          .getByRole('button', { name: currentName })
          .evaluate((element) => {
            // Button truncates its text inside the `button-label` slot; measure
            // the element that actually clips the name.
            const text =
              element.querySelector<HTMLElement>('[data-slot="button-label"]') ?? element;
            return {
              clientWidth: text.clientWidth,
              scrollWidth: text.scrollWidth,
              overflow: getComputedStyle(text).overflow,
              textOverflow: getComputedStyle(text).textOverflow,
            };
          });
        expect(nameGeometry.overflow).toBe('hidden');
        expect(nameGeometry.textOverflow).toBe('ellipsis');
        if (width === 240)
          expect(nameGeometry.scrollWidth).toBeGreaterThan(nameGeometry.clientWidth);
      }
    }
  }
});

test('keeps keyboard rename focus, cancel, and save behavior', async ({ mount, page }) => {
  const component = await mount(SimpleAgentPanelHeaderHost, {
    props: { activeAgent: 'delegated', stackCount: 2, width: 240 },
  });
  const identity = component.locator('[data-panel-agent-header-identity]');
  const nameButton = identity.getByRole('button', { name: names.delegated });

  await nameButton.focus();
  await page.keyboard.press('Enter');
  const input = identity.locator('input[type="text"]');
  await expect(input).toBeFocused();
  await input.fill('Cancelled verifier rename');
  await page.keyboard.press('Escape');
  await expect(component).toHaveAttribute('data-last-rename', '');
  await expect(identity.getByRole('button', { name: names.delegated })).toBeVisible();

  await identity.getByRole('button', { name: names.delegated }).press('Enter');
  await expect(input).toBeFocused();
  await input.fill('Renamed delegated agent');
  await page.keyboard.press('Enter');
  await expect(component).toHaveAttribute(
    'data-last-rename',
    'delegated-tab:Renamed delegated agent',
  );
  await expect(identity.getByRole('button', { name: 'Renamed delegated agent' })).toBeVisible();
});
