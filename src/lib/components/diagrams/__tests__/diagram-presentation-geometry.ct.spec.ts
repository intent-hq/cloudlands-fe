import { expect, test } from '../../../../test/ct-test';
import DiagramPresentationGeometryHarness from './DiagramPresentationGeometryHarness.svelte';

test('keeps diagram control focus visible', async ({ mount }) => {
  const component = await mount(DiagramPresentationGeometryHarness);
  const surfaces = component.locator('[data-diagram-presentation]');
  const trigger = component.getByRole('button', { name: 'Diagram actions' }).first();

  await expect(surfaces.first()).toHaveCSS('border-top-style', 'none');
  await expect(surfaces.first()).toHaveCSS('box-shadow', 'none');

  await trigger.focus();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveCSS('outline-style', 'solid');
});
