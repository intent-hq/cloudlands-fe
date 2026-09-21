import { expect, test } from '../../../../test/ct-test';
import DiagramActionsMenuSizingHarness from './DiagramActionsMenuSizingHarness.svelte';

test('uses compact sizing only for top-margin diagram actions', async ({ mount }) => {
  const component = await mount(DiagramActionsMenuSizingHarness);
  const trigger = (region: string) =>
    component.getByTestId(region).getByRole('button', { name: 'Diagram actions' });

  await expect(trigger('top-margin-menu')).toHaveCSS('height', '28px');
  await expect(trigger('default-presentation-menu')).toHaveCSS('height', '32px');
  await expect(trigger('standalone-menu')).toHaveCSS('height', '32px');
});
