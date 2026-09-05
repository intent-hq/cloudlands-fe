import { expect, test } from '@playwright/experimental-ct-svelte';
import ScenarioContractHost from './ScenarioContractHost.svelte';
import { NEW_WORKSPACE_SCENARIOS, type Scenario } from './scenarios';

async function expectActionableControl(
  component: ReturnType<Parameters<typeof test>[0]>,
  scenario: Scenario,
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
      await expect(component.locator('[data-source-state] button:enabled').first()).toBeVisible();
      return;
    case 'retry':
      await expect(component.locator('section[role="alert"] button:enabled').first()).toBeVisible();
      return;
    case 'reconnect':
      await expect(component.locator('section[role="alert"] button:enabled')).toHaveCount(1);
      return;
    case 'conflict':
      await expect(component.locator('section[role="alert"] button:enabled')).toHaveCount(2);
      return;
    case 'none':
      await expect(component.locator('[data-coordinator-state]')).toBeVisible();
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
      await expectActionableControl(component, scenario);

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

      const progress = component.locator('progress');
      if (scenario.contract.allowsClonePercent) {
        await expect(progress).toHaveCount(1);
        await expect(progress).toHaveAttribute('value', '47');
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
