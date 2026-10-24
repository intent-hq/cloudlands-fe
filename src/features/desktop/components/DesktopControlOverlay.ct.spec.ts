import { expect, test } from '../../../test/ct-test';
import DesktopControlOverlay from './DesktopControlOverlay.svelte';

test('desktop session controls order, actions and button-only hit testing', async ({
  mount,
  page,
}) => {
  let stopped = 0;
  let opened = 0;
  const interactive: boolean[] = [];
  await page.setViewportSize({ width: 480, height: 48 });
  const component = await mount(DesktopControlOverlay, {
    props: {
      kind: 'controls',
      onStop: () => {
        stopped += 1;
      },
      onOpenAgent: () => {
        opened += 1;
      },
      onInteractive: (value: boolean) => interactive.push(value),
    },
  });
  const stop = component.getByRole('button', { name: 'Stop', exact: true });
  const label = component.getByText('Intent is controlling your machine');
  const arrow = component.getByRole('button', { name: 'Open controlling agent' });
  await expect(label).toBeVisible();
  expect(await page.locator('.controls').boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: 480,
    height: 48,
  });
  const bounds = await Promise.all([stop.boundingBox(), label.boundingBox(), arrow.boundingBox()]);
  expect(bounds[0]!.x + bounds[0]!.width).toBeLessThan(bounds[1]!.x);
  expect(bounds[1]!.x + bounds[1]!.width).toBeLessThan(bounds[2]!.x);
  await stop.hover();
  await expect.poll(() => interactive.at(-1)).toBe(true);
  await label.hover();
  await expect.poll(() => interactive.at(-1)).toBe(false);
  await stop.click();
  await expect.poll(() => stopped).toBe(1);
  await arrow.click();
  await expect.poll(() => opened).toBe(1);
  await page.screenshot({ path: '.demo-artifacts/desktop-overlay-controls.png' });
});

test('glow stays click-through and screenshot pulse uses the app primary token', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 600 });
  const props = {
    kind: 'glow' as const,
    pulse: 0,
    onStop: () => {},
    onOpenAgent: () => {},
    onInteractive: () => {},
  };
  const component = await mount(DesktopControlOverlay, { props });
  const glow = page.locator('.glow').first();
  await expect(glow).toHaveCSS('pointer-events', 'none');
  expect(await glow.boundingBox()).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  const color = await glow.evaluate((node) => {
    const probe = document.createElement('div');
    probe.style.color = 'hsl(var(--primary) / 0.8)';
    node.append(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return { expected, actual: getComputedStyle(node).borderTopColor };
  });
  expect(color.actual).toBe(color.expected);
  await expect(page.locator('.pulse')).toHaveCount(0);
  await component.update({ props: { ...props, pulse: 1 } });
  await expect(page.locator('.pulse')).toHaveCSS('animation-name', /screenshot-pulse/);
  await component.update({ props: { ...props, pulse: 2 } });
  await expect(page.locator('.pulse')).toHaveCount(1);
  await expect(component.getByRole('button')).toHaveCount(0);
});
