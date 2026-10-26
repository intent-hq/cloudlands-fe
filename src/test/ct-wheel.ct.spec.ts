import WheelProbeHarness from './__tests__/WheelProbeHarness.svelte';
import { expect, test, wheelUntilScrolled } from './ct-test';

test('scrolls down and right, and returns the starting position', async ({ mount }) => {
  const component = await mount(WheelProbeHarness);
  const scroller = component.getByTestId('scroller');

  const down = await wheelUntilScrolled(scroller, { deltaY: 120 });
  expect(down.before).toEqual({ scrollTop: 0, scrollLeft: 0 });
  expect(down.after.scrollTop).toBeGreaterThan(0);
  expect(down.wheels).toBeGreaterThanOrEqual(1);

  const right = await wheelUntilScrolled(scroller, { deltaX: 120 });
  expect(right.before.scrollLeft).toBe(0);
  expect(right.after.scrollLeft).toBeGreaterThan(0);
});

test('scrolls up from the bottom', async ({ mount }) => {
  const component = await mount(WheelProbeHarness);
  const scroller = component.getByTestId('scroller');
  await scroller.evaluate((node) => node.scrollTo(0, node.scrollHeight));
  const bottom = await scroller.evaluate((node) => node.scrollTop);

  const { before, after } = await wheelUntilScrolled(scroller, { deltaY: -120 });
  expect(before.scrollTop).toBe(bottom);
  expect(after.scrollTop).toBeLessThan(bottom);
});

test('resends a dropped wheel until the container scrolls', async ({ mount }) => {
  const component = await mount(WheelProbeHarness, { props: { dropWheels: 1 } });
  const scroller = component.getByTestId('scroller');

  const result = await wheelUntilScrolled(scroller, { deltaY: 120, attemptTimeout: 500 });
  expect(result.wheels).toBe(2);
  expect(result.after.scrollTop).toBeGreaterThan(0);
  await expect(scroller).toHaveAttribute('data-wheels-dropped', '1');
  await expect(scroller).toHaveAttribute('data-wheels-received', '2');
});

test('sends the wheel from page coordinates', async ({ mount, page }) => {
  const component = await mount(WheelProbeHarness);
  const scroller = component.getByTestId('scroller');
  const box = (await scroller.boundingBox())!;

  await wheelUntilScrolled(scroller, {
    deltaY: 120,
    pointer: { x: box.x + 20, y: box.y + 20 },
  });
  expect(await scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);

  // 'current' keeps that pointer position for the next wheel.
  await page.mouse.move(box.x + 30, box.y + 30);
  await wheelUntilScrolled(scroller, { deltaX: 120, pointer: 'current' });
  expect(await scroller.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
});

test('fails without resending when the container has no room in that direction', async ({
  mount,
}) => {
  const component = await mount(WheelProbeHarness);
  const scroller = component.getByTestId('scroller');
  const fixed = component.getByTestId('static');

  await expect(wheelUntilScrolled(fixed, { deltaY: 120, timeout: 500 })).rejects.toThrow(
    /can scroll down before wheel\(0, 120\)/,
  );
  // Already at the top: an upward wheel cannot scroll, whatever the content size.
  await expect(wheelUntilScrolled(scroller, { deltaY: -120, timeout: 500 })).rejects.toThrow(
    /can scroll up/,
  );
  await expect(scroller).toHaveAttribute('data-wheels-received', '0');
});

test('does not count movement against the wheel direction', async ({ mount }) => {
  const component = await mount(WheelProbeHarness, { props: { dropWheels: 100 } });
  const scroller = component.getByTestId('scroller');
  await scroller.evaluate((node) => {
    node.scrollTop = 400;
    // Every wheel is dropped, and something else pulls the list down meanwhile.
    node.addEventListener('wheel', () => {
      node.scrollTop += 50;
    });
  });

  await expect(
    wheelUntilScrolled(scroller, { deltaY: -120, timeout: 1_500, attemptTimeout: 300 }),
  ).rejects.toThrow(/scrolls the container up/);
  expect(await scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(400);
});

test('rejects a wheel without a delta', async ({ mount }) => {
  const component = await mount(WheelProbeHarness);
  await expect(wheelUntilScrolled(component.getByTestId('scroller'))).rejects.toThrow(
    /non-zero deltaX or deltaY/,
  );
});
