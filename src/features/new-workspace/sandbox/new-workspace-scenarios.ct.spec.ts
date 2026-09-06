import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Page } from '@playwright/test';
import ScenarioContractHost from './ScenarioContractHost.svelte';
import { NEW_WORKSPACE_SCENARIOS, type Scenario } from './scenarios';

const consoleErrors = new WeakMap<Page, string[]>();

test.beforeEach(({ page }) => {
  const errors: string[] = [];
  consoleErrors.set(page, errors);
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
});

test.afterEach(({ page }, testInfo) => {
  const errors = consoleErrors.get(page) ?? [];
  const unexpected = errors.filter(
    (error) =>
      !(
        testInfo.title.includes('setup-branch-fetch-failure') &&
        error.includes('Failed to fetch branches')
      ),
  );
  expect(unexpected, `Unexpected console errors in ${testInfo.title}`).toEqual([]);
});

async function expectActionableControl(
  component: ReturnType<Parameters<typeof test>[0]>,
  scenario: Scenario,
  page: Page,
) {
  switch (scenario.contract.control) {
    case 'start':
      await expect(component.getByTestId('draft-start')).toBeEnabled();
      return;
    case 'provider':
      await expect(
        component.locator('[data-coordinator-state] button:enabled').first(),
      ).toBeVisible();
      return;
    case 'source':
      await component.getByTestId('prompt-actions-trigger').click();
      await expect(page.getByRole('menuitem', { name: 'Pick a repo' })).toBeEnabled();
      return;
    case 'retry':
      await expect(component.locator('[role="alert"] button:enabled').first()).toBeVisible();
      return;
    case 'reconnect':
      await expect(component.locator('[role="alert"] button:enabled')).toHaveCount(1);
      return;
    case 'conflict':
      await expect(component.locator('[role="alert"] button:enabled')).toHaveCount(2);
      return;
    case 'none':
      await expect(component.getByTestId('draft-composer')).toBeVisible();
  }
}

test.describe('new-workspace scenario contracts', () => {
  for (const scenario of NEW_WORKSPACE_SCENARIOS) {
    test(`new-workspace scenario: ${scenario.id}`, async ({ mount, page }) => {
      await page.setViewportSize({ width: scenario.contract.width, height: 1000 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const component = await mount(ScenarioContractHost, { props: { scenarioId: scenario.id } });
      const shell = component.locator('[data-controller-phase]');
      const editor = component.locator('.tiptap-editor');

      await expect(shell).toHaveAttribute('data-controller-phase', scenario.expectedPhase);
      await expectActionableControl(component, scenario, page);

      if (scenario.initialControllerState.input.intentText) {
        await expect(editor).toContainText(scenario.initialControllerState.input.intentText);
      }
      if ((await editor.getAttribute('contenteditable')) === 'true') {
        await editor.focus();
        await page.evaluate(() =>
          window.dispatchEvent(new Event('new-workspace-scenario-refresh')),
        );
        await expect(editor).toBeFocused();
      }

      const progress = component.getByTestId('setup-card-progress-bar');
      if (scenario.contract.allowsClonePercent) {
        await expect(progress).toHaveCount(1);
        await expect(progress).toHaveAttribute('aria-valuenow', '47');
      } else {
        await expect(progress).toHaveCount(0);
      }

      const shellBox = await shell.boundingBox();
      const composerBox = await component.getByTestId('draft-composer').boundingBox();
      expect(shellBox).not.toBeNull();
      expect(composerBox).not.toBeNull();
      expect(composerBox!.x).toBeGreaterThanOrEqual(shellBox!.x);
      expect(composerBox!.x + composerBox!.width).toBeLessThanOrEqual(
        shellBox!.x + shellBox!.width + 1,
      );
      await expect
        .poll(() => component.evaluate((node) => node.getAnimations({ subtree: true }).length))
        .toBe(0);
      await expect(component).toHaveAttribute('data-capture-stable', 'true');
    });
  }
});

test('selected source setup expands and opens its Change picker', async ({ mount, page }) => {
  const component = await mount(ScenarioContractHost, {
    props: { scenarioId: 'source-local-repo' },
  });
  const expand = component.getByRole('button', { name: 'Expand project setup' });
  await expand.focus();
  await expect(expand).toBeFocused();
  await expand.press('Enter');
  await expect(component.getByTestId('selected-project')).toBeVisible();
  const change = component.getByRole('button', { name: 'Change' });
  await change.focus();
  await expect(change).toBeFocused();
  await change.click();
  await expect(page.getByTestId('draft-source-picker')).toBeVisible();
  await page.getByRole('button', { name: 'Select a repository' }).click();
  await expect(page.getByRole('button', { name: 'Select a folder' })).toBeVisible();
});

test('conflict actions remain readable and reachable in a narrow panel', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 900 });
  const component = await mount(ScenarioContractHost, {
    props: { scenarioId: 'recovery-draft-conflict' },
  });
  const alert = component.getByRole('alert');
  const bounds = await alert.boundingBox();
  const buttons = alert.getByRole('button');
  for (const button of await buttons.all()) {
    await button.focus();
    await expect(button).toBeFocused();
    const box = await button.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(bounds!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
  }
});
