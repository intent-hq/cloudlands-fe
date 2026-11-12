import { expect, test } from '../../../test/ct-test';
import DockRailPreview from './dock-rail.preview.svelte';
import { dockRailPreview } from './dock-rail.preview-fixtures';

test('reduced motion keeps pointer and keyboard opening free of spring animation', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const now = new Date('2026-11-06T12:00:00Z');
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  const component = await mount(DockRailPreview, { props: dockRailPreview.states.notch.props });
  const shell = component.getByTestId('dock-shell');
  const surface = component.getByTestId('dock-surface');
  await surface.dispatchEvent('pointerenter', { pointerType: 'mouse' });
  await page.clock.runFor(120);
  await expect(shell).toHaveAttribute('data-reveal', '1');
  await surface.dispatchEvent('pointerleave', { pointerType: 'mouse', clientX: 0, clientY: 599 });
  await page.clock.runFor(160);
  await expect(shell).toHaveAttribute('data-reveal', '0');
  await component.update({ props: { ...dockRailPreview.states.notch.props, focusRequest: 1 } });
  await expect(shell).toHaveAttribute('data-reveal', '1');
  await test.info().attach('reduced-motion', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});
