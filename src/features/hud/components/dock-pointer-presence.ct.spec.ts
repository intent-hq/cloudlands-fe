import { expect, test } from '../../../test/ct-test';
import Harness from './__tests__/DockPresenceBrowserHarness.svelte';

// The non-key dock window can stop receiving hover; main's cursor poll then reports
// presence. That report alone must open the compact notch and close it again.
test('main pointer presence alone expands the compact notch and collapses it on leave', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 600 });
  await mount(Harness);
  const shell = page.getByTestId('dock-shell');
  await expect(shell).toHaveAttribute('data-expanded', 'false');
  const surface = (await page.getByTestId('dock-surface').boundingBox())!;
  const point = { x: surface.x + surface.width / 2, y: surface.y + surface.height / 2 };
  const emit = (inside: boolean) =>
    page.evaluate(
      ({ inside, point }) =>
        (window as unknown as { __dockPresence: (presence: unknown) => void }).__dockPresence({
          inside,
          ...point,
          revision: 1,
        }),
      { inside, point },
    );

  await emit(true);
  await expect(shell).toHaveAttribute('data-expanded', 'true');
  await emit(false);
  await expect(shell).toHaveAttribute('data-expanded', 'false');
});
