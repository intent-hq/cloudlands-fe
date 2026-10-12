import {
  test,
  expect,
  openAvatar,
  choose,
  display,
  surface,
  stack,
  items,
  expectStack,
  nativeArt,
  captureAvatar,
  settleAvatarMotion,
} from '../lib/agent-avatar.mjs';

test('agent avatar extended: unmount detaches old nodes and remount responds to new widths', async ({
  page,
}, info) => {
  const host = await openAvatar(page);
  await expectStack(host, 3, 3);
  const oldStack = await stack(host).elementHandle();
  await captureAvatar(page, stack(host), 'lifetime-before', info);
  try {
    await host.getByRole('switch', { name: 'Mount stack', exact: true }).click();
    await expect(stack(host)).toHaveCount(0);
    expect(await oldStack.evaluate((node) => node.isConnected)).toBe(false);
    await choose(page, host, 'Stack container width', '32');
    await host.getByRole('switch', { name: 'Mount stack', exact: true }).click();
    await expectStack(host, 0, 6);
    expect(await stack(host).evaluate((node, old) => node === old, oldStack)).toBe(false);
    await choose(page, host, 'Stack container width', '160');
    await expectStack(host, 3, 3);
    const survivor = await items(host).first().elementHandle();
    try {
      await choose(page, host, 'Stack alignment', 'start');
      expect(
        await items(host)
          .first()
          .evaluate((node, old) => node === old, survivor),
      ).toBe(true);
      await host.getByRole('switch', { name: 'Adaptive stack', exact: true }).click();
      await choose(page, host, 'Stack container width', '32');
      await expectStack(host, 3, 3);
      await host.getByRole('switch', { name: 'Adaptive stack', exact: true }).click();
      await expectStack(host, 0, 6);
      await choose(page, host, 'Stack container width', '160');
      await expectStack(host, 3, 3);
      await captureAvatar(page, stack(host), 'lifetime-after', info);
    } finally {
      await survivor.dispose();
    }
  } finally {
    await oldStack.dispose();
  }
  // Recovery and detached DOM are native evidence. Exact observer disconnect
  // and pending-frame cancellation remain static-only; no instrumentation mocks.
});

test('agent avatar extended: named and legacy sizing transitions retain accessible artwork', async ({
  page,
}, info) => {
  const host = await openAvatar(page);
  for (const variant of ['compact', 'standard', 'emphasized', 'card-stack', 'prominent']) {
    await choose(page, host, 'Avatar variant', variant);
    await expect(surface(host)).toHaveAccessibleName('Idle');
    await nativeArt(surface(host).locator('svg'));
    await captureAvatar(page, display(host), `named-${variant}`, info);
  }
  for (const size of ['18', '40', 'named variant']) {
    await choose(page, host, 'Legacy size', size);
    await choose(page, host, 'Avatar state', 'waiting');
    await expect(surface(host)).toHaveAccessibleName('Waiting');
    await nativeArt(surface(host).locator('svg'));
    await captureAvatar(page, display(host), `legacy-${size.replaceAll(' ', '-')}`, info);
  }
  // Record actual wrapper/SVG bounds; neither copied numeric sizes nor equality
  // between distinct source wrappers is a valid independent visual oracle.
});

test('agent avatar extended: reduced motion keeps the wrapper still and settles native artwork transitions', async ({
  page,
}, info) => {
  const host = await openAvatar(page);
  await captureAvatar(page, display(host), 'reduced-before', info);
  await choose(page, host, 'Avatar state', 'running');
  await expect(surface(host)).toHaveAccessibleName('Running');
  await settleAvatarMotion(surface(host), 'reduced-running', info);
  const art = await nativeArt(surface(host).locator('svg'));
  await choose(page, host, 'Avatar state', 'waiting');
  await expect(surface(host)).toHaveAccessibleName('Waiting');
  await settleAvatarMotion(surface(host), 'reduced-waiting', info);
  await expect(surface(host)).toHaveAccessibleName('Waiting');
  expect(await nativeArt(surface(host).locator('svg'))).toEqual(art);
  await captureAvatar(page, display(host), 'reduced-after', info);
});

test('agent avatar extended: forced colors preserve state naming and native artwork', async ({
  page,
}, info) => {
  await page.emulateMedia({ forcedColors: 'active' });
  const host = await openAvatar(page);
  await captureAvatar(page, display(host), 'forced-before', info);
  await choose(page, host, 'Avatar state', 'waiting');
  await expect(surface(host)).toHaveAccessibleName('Waiting');
  await nativeArt(surface(host).locator('svg'));
  await captureAvatar(page, display(host), 'forced-after', info);
  // Screenshot inspection is required; geometry alone does not prove contrast.
});

test('agent avatar extended: full motion settles state changes and completion removes animation', async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const host = await openAvatar(page, 'full');
  await captureAvatar(page, display(host), 'full-before', info);
  await choose(page, host, 'Avatar state', 'running');
  await expect(surface(host)).toHaveAccessibleName('Running');
  await choose(page, host, 'Avatar state', 'waiting');
  await expect(surface(host)).toHaveAccessibleName('Waiting');
  await expect
    .poll(() => surface(host).evaluate((node) => node.getAnimations({ subtree: true }).length))
    .toBe(0);
  await choose(page, host, 'Avatar state', 'completed');
  await expect(surface(host)).toHaveAccessibleName('Completed');
  expect(await surface(host).evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(
    0,
  );
  await captureAvatar(page, display(host), 'full-after', info);
  // This verifies endpoint behavior, never a timed animation midpoint.
});
