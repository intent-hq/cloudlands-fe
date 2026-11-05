import type { Locator } from '@playwright/experimental-ct-svelte';
import { expect, expectAnimationsToSettle, test } from '../../../../test/ct-test';
import StreamingToolEntryHost from './StreamingToolEntryHost.svelte';

async function expectBottomLocked(host: Locator) {
  await expect(host).toHaveAttribute('data-following', 'true');
  await expect
    .poll(() =>
      host
        .getByTestId('tool-entry-transcript')
        .evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop),
    )
    .toBeLessThanOrEqual(2);
}

for (const grouped of [false, true]) {
  test(`follows a new ${grouped ? 'grouped' : 'top-level'} tool row to the bottom`, async ({
    mount,
  }) => {
    const host = await mount(StreamingToolEntryHost, { props: { grouped } });
    if (grouped) {
      const disclosure = host.getByTestId('response-group-disclosure');
      await disclosure.dispatchEvent('click');
      await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    }
    await expectBottomLocked(host);
    await host.update({ props: { grouped, count: 3 } });
    await expect(host.locator('[data-tool-entry]')).toHaveCount(3);
    await expectAnimationsToSettle(host);
    await expectBottomLocked(host);
  });
}

test('keeps user scrollback fixed while new tool rows arrive', async ({ mount }) => {
  const host = await mount(StreamingToolEntryHost);
  await expectBottomLocked(host);
  const transcript = host.getByTestId('tool-entry-transcript');
  const anchor = host.getByTestId('tool-entry-anchor');
  await transcript.evaluate((node) => {
    node.dispatchEvent(new WheelEvent('wheel', { deltaY: -240 }));
    node.scrollTop -= 240;
    node.dispatchEvent(new Event('scroll'));
  });
  await expect(host).toHaveAttribute('data-following', 'false');
  const initialTop = await transcript.evaluate((node) => node.scrollTop);
  const initialAnchor = await anchor.evaluate((node) => node.getBoundingClientRect().top);
  await host.update({ props: { count: 3 } });
  await expect(host.locator('[data-tool-entry]')).toHaveCount(3);
  await expectAnimationsToSettle(host);
  expect(await transcript.evaluate((node) => node.scrollTop)).toBeCloseTo(initialTop, 1);
  expect(await anchor.evaluate((node) => node.getBoundingClientRect().top)).toBeCloseTo(
    initialAnchor,
    1,
  );
  await expect(host).toHaveAttribute('data-following', 'false');
});

test('inserts a reduced-motion tool row without residual animation', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const host = await mount(StreamingToolEntryHost);
  await expectBottomLocked(host);
  await host.update({ props: { count: 3 } });
  const rows = host.locator('[data-tool-entry]');
  await expect(rows).toHaveCount(3);
  await expect(rows.last()).toBeVisible();
  await expect.poll(() => rows.last().evaluate((node) => node.getAnimations().length)).toBe(0);
  await expectBottomLocked(host);
});
