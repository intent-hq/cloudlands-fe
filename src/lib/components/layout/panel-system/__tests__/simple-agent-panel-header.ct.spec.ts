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

for (const width of [190, 560]) {
  test(`keeps selector and controls reachable at ${width}px`, async ({ mount, page }, testInfo) => {
    const component = await mount(SimpleAgentPanelHeaderHost, {
      props: { fullActions: true, stackCount: 2, width },
      hooksConfig,
    });
    const header = component.locator('[data-panel-tabless-header]');
    const selector = header.getByTestId('pane-stack-selector-trigger');
    const controls = header.locator('[data-panel-header-actions]');
    const geometry = await header.evaluate((element) => {
      const header = element.getBoundingClientRect();
      const identity = element
        .querySelector('[data-panel-header-identity]')!
        .getBoundingClientRect();
      const actions = element.querySelector('[data-panel-header-actions]')!.getBoundingClientRect();
      return {
        contained: identity.left >= header.left && actions.right <= header.right,
        noOverlap: identity.right <= actions.left,
        overflow: element.scrollWidth > element.clientWidth,
      };
    });
    expect(geometry).toEqual({ contained: true, noOverlap: true, overflow: false });
    await selector.press('Enter');
    await page.getByRole('menuitem', { name: names.delegated, exact: true }).click();
    await expect(selector).toContainText(names.delegated);
    await expect(selector).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(controls.getByTestId('panel-actions-trigger')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(controls.getByTestId('panel-close-button')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(component).toHaveAttribute('data-close-count', '1');
    await testInfo.attach('header', { body: await header.screenshot(), contentType: 'image/png' });
  });
}

test('renames from the kebab menu with keyboard cancel and save', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(SimpleAgentPanelHeaderHost, {
    props: { activeAgent: 'delegated', stackCount: 2, width: 240 },
    hooksConfig,
  });
  const header = component.locator('[data-panel-tabless-header]');
  const menuTrigger = header.getByTestId('panel-actions-trigger');
  for (const save of [false, true]) {
    await menuTrigger.press('Enter');
    await page.getByRole('menuitem', { name: /Rename/i }).focus();
    await page.keyboard.press('Enter');
    const input = header.getByRole('textbox');
    await expect(input).toBeFocused();
    await input.fill('Renamed delegated agent');
    await component.update({ props: { width: 190 } });
    await expect(input).toBeFocused();
    await input.press(save ? 'Enter' : 'Escape');
    await expect(component).toHaveAttribute('data-rename-count', save ? '1' : '0');
  }
  await expect(component).toHaveAttribute(
    'data-last-rename',
    'delegated-tab:Renamed delegated agent',
  );
  await expect(header.getByTestId('pane-stack-selector-trigger')).toContainText(
    'Renamed delegated agent',
  );
  await testInfo.attach('renamed-header', {
    body: await header.screenshot(),
    contentType: 'image/png',
  });
});
