import {
  test,
  expect,
  openAvatar,
  choose,
  display,
  surface,
  stack,
  items,
  activations,
  outputJson,
  expectStack,
  nativeArt,
  captureAvatar,
} from '../lib/agent-avatar.mjs';

test('agent avatar: state changes retain the image node and its single accessible name', async ({
  page,
}, info) => {
  const host = await openAvatar(page);
  const image = surface(host);
  const original = await image.elementHandle();
  await captureAvatar(page, display(host), 'states-before', info);
  // Independent published labels from original003's English catalog; exercise
  // state transitions rather than testing unconditional source text or classes.
  const states = [
    ['running', 'Running'],
    ['responding', 'Responding'],
    ['unread', 'Unread'],
    ['completed', 'Completed'],
    ['failed', 'Failed'],
    ['question', 'Agent Has Questions'],
    ['waiting', 'Waiting'],
    ['needs-permission', 'Agent asked for permission'],
    ['attention-discussion', 'Requests a discussion'],
    ['attention-blocker', 'Reports a blocker'],
    ['idle', 'Idle'],
  ];
  try {
    for (const [state, label] of states) {
      await choose(page, host, 'Avatar state', state);
      await expect(image).toHaveAccessibleName(label);
      await expect(display(host).getByRole('img')).toHaveCount(2);
      await expect(image.locator('[data-avatar-unread-dot]')).toHaveCount(
        state === 'unread' ? 1 : 0,
      );
      expect(await image.evaluate((node, previous) => node === previous, original)).toBe(true);
      await nativeArt(image.locator('svg'));
    }
    await captureAvatar(page, display(host), 'states-after', info);
  } finally {
    await original.dispose();
  }
});

test('agent avatar: valid icon takes priority and unknown metadata preserves seeded artwork', async ({
  page,
}, info) => {
  const host = await openAvatar(page);
  const svg = display(host).getByRole('img', { name: 'Plain avatar display', exact: true });
  await choose(page, host, 'Specialist prop', 'implementor');
  await expect(svg).toHaveAttribute('data-avatar-design', 'implementor');
  await captureAvatar(page, display(host), 'design-before', info);
  await choose(page, host, 'Icon prop', 'verifier');
  await expect(svg).toHaveAttribute('data-avatar-design', 'verifier');
  await nativeArt(svg);
  await choose(page, host, 'Icon prop', 'unknown-icon');
  await expect(svg).toHaveAttribute('data-avatar-design', 'implementor');
  await choose(page, host, 'Catalog identity', 'fallback-glasses');
  await choose(page, host, 'Specialist prop', 'unknown-specialist');
  await expect(svg).toHaveAttribute('data-avatar-design', 'fallback-glasses');
  const before = await nativeArt(svg);
  await choose(page, host, 'Avatar state', 'waiting');
  await choose(page, host, 'Icon prop', 'none');
  await choose(page, host, 'Specialist prop', 'none');
  await expect(svg).toHaveAttribute('data-avatar-design', 'fallback-glasses');
  expect(await nativeArt(svg)).toEqual(before);
  await captureAvatar(page, display(host), 'design-after', info);
});

test('agent avatar: real container resizing preserves overflow counts and surviving keys', async ({
  page,
}, info) => {
  const host = await openAvatar(page);
  await expectStack(host, 3, 3);
  const first = await items(host).first().elementHandle();
  await captureAvatar(page, stack(host), 'stack-before', info);
  try {
    await choose(page, host, 'Maximum visible avatars', '6');
    await expectStack(host, 6, 0);
    expect(
      await items(host)
        .first()
        .evaluate((node, previous) => node === previous, first),
    ).toBe(true);
    await choose(page, host, 'Stack container width', '32');
    await expectStack(host, 0, 6);
    const narrow = await captureAvatar(page, stack(host), 'stack-narrow', info);
    const overflow = narrow.nodes.find((node) => !node.design && !node.key && !node.state);
    expect(overflow.bounds.x).toBeGreaterThanOrEqual(narrow.target.x - 1);
    expect(overflow.bounds.x + overflow.bounds.width).toBeLessThanOrEqual(
      narrow.target.x + narrow.target.width + 1,
    );
    await choose(page, host, 'Stack container width', '160');
    await expectStack(host, 6, 0);
    await choose(page, host, 'Maximum visible avatars', '0');
    await expectStack(host, 0, 6);
    await choose(page, host, 'Maximum visible avatars', '3');
    await expectStack(host, 3, 3);
    await captureAvatar(page, stack(host), 'stack-after', info);
  } finally {
    await first.dispose();
  }
});

test('agent avatar: custom item content receives one native activation and decorative items stay unnamed', async ({
  page,
}, info) => {
  const host = await openAvatar(page);
  await expectStack(host, 3, 3);
  await expect(stack(host).getByRole('img')).toHaveCount(0);
  await expect(stack(host).getByRole('button')).toHaveCount(0);
  await host.getByRole('switch', { name: 'Interactive custom item content', exact: true }).click();
  const button = stack(host).getByRole('button', { name: 'Activate catalog-stack-0', exact: true });
  await captureAvatar(page, stack(host), 'custom-before', info);
  const item = {
    key: 'catalog-stack-0',
    agentId: 'catalog-stack-0',
    specialist: 'coordinator',
    state: 'running',
  };
  await button.click();
  await expect.poll(() => outputJson(activations(host))).toEqual([item]);
  await button.press('Enter');
  await expect.poll(() => outputJson(activations(host))).toEqual([item, item]);
  await button.press('Space');
  await expect.poll(() => outputJson(activations(host))).toEqual([item, item, item]);
  await expect(button).toBeFocused();
  await captureAvatar(page, stack(host), 'custom-after', info);
  await host.getByRole('switch', { name: 'Interactive custom item content', exact: true }).click();
  await expect(stack(host).getByRole('button')).toHaveCount(0);
  await expect(stack(host).getByRole('img')).toHaveCount(0);
  await expect.poll(() => outputJson(activations(host))).toEqual([item, item, item]);
});
