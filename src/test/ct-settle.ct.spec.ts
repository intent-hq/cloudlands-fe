import SettleProbeHarness from './__tests__/SettleProbeHarness.svelte';
import { clickAndSettle, expect, expectMotionToSettle, motionSnapshot, test } from './ct-test';

// Playwright highlights the diff in its error messages with ANSI colour codes.
const plain = (error: Error | null) => error?.message.replace(/\u001b\[[0-9;]*m/g, '');

test('waits for a JavaScript-driven height motion to reach its end', async ({ mount }) => {
  const component = await mount(SettleProbeHarness);
  const toggle = component.getByTestId('js-toggle');
  const region = component.getByTestId('js-region');

  const opened = await clickAndSettle(toggle, region);
  expect(opened.height).toBe(120);
  expect((await region.boundingBox())!.height).toBe(120);

  const closed = await clickAndSettle(toggle, region);
  expect(closed.height).toBe(0);
});

test('waits for motion that starts after the quiet window', async ({ mount }) => {
  // The motion starts 400 ms after the click, longer than the 100 ms quiet window: a
  // stillness check alone would pass before it began.
  const component = await mount(SettleProbeHarness, { props: { startDelayMs: 400 } });
  const opened = await clickAndSettle(
    component.getByTestId('js-toggle'),
    component.getByTestId('js-region'),
  );
  expect(opened.height).toBe(120);
});

test('waits for a delayed CSS transition', async ({ mount }) => {
  const component = await mount(SettleProbeHarness, { props: { startDelayMs: 300 } });
  const opened = await clickAndSettle(
    component.getByTestId('css-toggle'),
    component.getByTestId('css-region'),
  );
  expect(opened.height).toBe(120);
});

test('lets the next click land on a control the motion moved', async ({ mount }) => {
  const component = await mount(SettleProbeHarness);
  const next = component.getByTestId('next');
  for (let round = 0; round < 3; round += 1) {
    await clickAndSettle(component.getByTestId('js-toggle'), component.getByTestId('js-region'));
    await clickAndSettle(component.getByTestId('css-toggle'), component.getByTestId('css-region'));
    await next.click();
  }
  await expect(next).toHaveAttribute('data-clicks', '3');
});

test('ignores infinite animations inside the region', async ({ mount }) => {
  const component = await mount(SettleProbeHarness);
  const region = component.getByTestId('js-region');
  await expect
    .poll(() =>
      component
        .getByTestId('spinner')
        .evaluate((node) => node.getAnimations().map((animation) => animation.playState)),
    )
    .toEqual(['running']);
  await expectMotionToSettle(region);
});

test('waits for a scroll position to settle', async ({ mount }) => {
  const component = await mount(SettleProbeHarness, { props: { startDelayMs: 200 } });
  const settled = await clickAndSettle(
    component.getByTestId('scroll-down'),
    component.getByTestId('scroller'),
  );
  expect(settled.scrollTop).toBe(600);
});

test('settles motion started without a click when given the starting snapshot', async ({
  mount,
}) => {
  const component = await mount(SettleProbeHarness, { props: { startDelayMs: 300 } });
  const region = component.getByTestId('js-region');
  const before = await motionSnapshot(region);
  await component.getByTestId('js-toggle').evaluate((node: HTMLButtonElement) => node.click());
  const settled = await expectMotionToSettle(region, { changedFrom: before });
  expect(settled.height).toBe(120);
});

test('keeps waiting for a change when the click replaces the region with an identical one', async ({
  mount,
}) => {
  // The region is replaced 50 ms after the click, while the wait watches the old node; the
  // size change only starts 400 ms after the click.
  const component = await mount(SettleProbeHarness, { props: { startDelayMs: 400 } });
  const settled = await clickAndSettle(
    component.getByTestId('replace'),
    component.getByTestId('replaced-region'),
  );
  expect(settled.height).toBe(120);
});

test('requireChange: false accepts a click that moves nothing', async ({ mount }) => {
  const component = await mount(SettleProbeHarness);
  const settled = await clickAndSettle(
    component.getByTestId('noop'),
    component.getByTestId('js-region'),
    { requireChange: false },
  );
  expect(settled.height).toBe(0);
});

test('fails, naming the region, when the click never changes it', async ({ mount }) => {
  const component = await mount(SettleProbeHarness);
  const error = await clickAndSettle(
    component.getByTestId('noop'),
    component.getByTestId('js-region'),
    { timeout: 1_500 },
  ).then(
    () => null,
    (caught: Error) => caught,
  );
  expect(plain(error)).toContain('should move or resize');
  expect(plain(error)).toContain('has not changed from');
});

test('fails with the last position when the region never stops', async ({ mount }) => {
  const component = await mount(SettleProbeHarness);
  await component.getByTestId('wobble').click();
  const error = await expectMotionToSettle(component.getByTestId('wobble-region'), {
    timeout: 1_500,
  }).then(
    () => null,
    (caught: Error) => caught,
  );
  expect(plain(error)).toContain('should settle');
  expect(plain(error)).toContain('still moving at');
});
