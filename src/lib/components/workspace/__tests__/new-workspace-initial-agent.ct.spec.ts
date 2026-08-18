import { expect, test } from '@playwright/experimental-ct-svelte';
import NewWorkspaceInitialAgentHarness from './mocks/NewWorkspaceInitialAgentHarness.svelte';

for (const coordinator of [true, false]) {
  for (const lifecycle of [
    { name: 'immediate', delayed: false, restore: false },
    { name: 'delayed snapshot', delayed: true, restore: false },
    { name: 'restore', delayed: false, restore: true },
  ]) {
    test(`renders one focused pinned initial agent for ${coordinator ? 'coordinator' : 'non-coordinator'} ${lifecycle.name}`, async ({
      mount,
    }) => {
      const component = await mount(NewWorkspaceInitialAgentHarness, {
        props: {
          coordinator,
          delayed: lifecycle.delayed,
          restore: lifecycle.restore,
          scenario: `${coordinator}-${lifecycle.name.replace(' ', '-')}`,
        },
      });
      const state = component.locator('[data-initial-agent-state]');

      await expect(state).toHaveAttribute('data-agent-count', '1');
      await expect(state).toHaveAttribute('data-agent-pinned', 'true');
      const agentPanelId = await state.getAttribute('data-agent-panel-id');
      await expect(state).toHaveAttribute('data-focused-panel-id', agentPanelId!);
      await expect(state).toHaveAttribute('data-reusable-panel-id', '');
      await expect(state).toHaveAttribute('data-panel-order', agentPanelId!);
      await expect(component.locator('[data-panel-id]')).toHaveCount(1);
      await expect(component.locator(`[data-panel-id="${agentPanelId}"]`)).toHaveAttribute(
        'data-focused',
        'true',
      );
    });
  }
}
