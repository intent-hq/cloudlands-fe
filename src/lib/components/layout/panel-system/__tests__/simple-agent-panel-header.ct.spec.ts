import { expect, test } from '../../../../../test/ct-test';
import {
  failOnConsoleErrors,
  peekConsoleErrors,
  takeConsoleErrors,
} from '../../../../../test/ct-console-errors';
import SimpleAgentPanelHeaderHost from './mocks/SimpleAgentPanelHeaderHost.svelte';
import WorkspaceActionsMenu from '$features/workspace/components/WorkspaceActionsMenu.svelte';

failOnConsoleErrors(test);

// Mount the lookup directly: web panel headers omit native editor commands.
test('fails the console-error guard when the workspace:get mock is missing', async ({
  mount,
  page,
}) => {
  await mount(WorkspaceActionsMenu, {
    props: { workspaceId: 'simple-agent-header-workspace', filePath: '.' },
  });
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
