import { expect, test } from '@playwright/experimental-ct-svelte';
import DiagramPresentationGeometryHarness from './DiagramPresentationGeometryHarness.svelte';

test('keeps diagram surfaces separated and control focus visible', async ({ mount }) => {
  const component = await mount(DiagramPresentationGeometryHarness);
  const surfaces = component.locator('[data-diagram-presentation]');
  const trigger = component.getByRole('button', { name: 'Diagram actions' }).first();

  const geometry = await component.evaluate((root) => {
    const rect = (selector: string) =>
      root.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
    const diagrams = root.querySelectorAll<HTMLElement>('[data-diagram-presentation]');
    const first = diagrams[0].getBoundingClientRect();
    const second = diagrams[1].getBoundingClientRect();
    return {
      before: first.top - rect('[data-testid="before"]').bottom,
      between: second.top - first.bottom,
      after: rect('[data-testid="after"]').top - second.bottom,
    };
  });

  expect(geometry).toEqual({ before: 24, between: 24, after: 24 });
  await expect(surfaces.first()).toHaveCSS('border-top-style', 'none');
  await expect(surfaces.first()).toHaveCSS('box-shadow', 'none');

  await trigger.focus();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveCSS('outline-style', 'solid');
  await expect(trigger).toHaveCSS('outline-width', '2px');
});
