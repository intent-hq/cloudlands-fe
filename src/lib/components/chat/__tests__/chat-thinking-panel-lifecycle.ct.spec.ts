import { expect, test } from '@playwright/experimental-ct-svelte';
import ChatThinkingPanelLifecycleHost from './ChatThinkingPanelLifecycleHost.svelte';

test.setTimeout(120_000);

test('restarts motion when a cached panel reveals and remounts', async ({ mount }) => {
  const component = await mount(ChatThinkingPanelLifecycleHost, {
    props: { revealed: true, remountKey: 0 },
  });
  const primary = component.locator('[data-tab-id="agent-tab-primary"]');
  let mark = primary.locator('[data-slot="intent-mark-loader"]');
  await expect(mark).toHaveAttribute('data-motion-state', 'playing');
  await mark.evaluate(
    (node) => ((window as typeof window & { panelMark?: Element }).panelMark = node),
  );

  await component.update({ props: { revealed: false, remountKey: 0 } });
  await expect(primary).toBeHidden();
  await expect(mark).toHaveAttribute('data-motion-state', 'neutral');
  await component.update({ props: { revealed: true, remountKey: 0 } });
  await expect(mark).toHaveAttribute('data-motion-state', 'playing');
  expect(
    await mark.evaluate(
      (node) => (window as typeof window & { panelMark?: Element }).panelMark === node,
    ),
  ).toBe(true);

  await component.update({ props: { revealed: true, remountKey: 1 } });
  mark = primary.locator('[data-slot="intent-mark-loader"]');
  await expect(mark).toHaveAttribute('data-motion-state', 'playing');
  expect(
    await mark.evaluate(
      (node) => (window as typeof window & { panelMark?: Element }).panelMark === node,
    ),
  ).toBe(false);
});

test('keeps concurrent panels independent and preserves lifecycle presentation', async ({
  mount,
}) => {
  const message =
    'Calling the daemon tool exactly as sent while the second panel keeps its own animation';
  const component = await mount(ChatThinkingPanelLifecycleHost, {
    props: {
      revealed: true,
      concurrent: true,
      phase: 'tool-call',
      message,
      timestamp: Date.now() - 2_000,
      width: 180,
      zoom: 2,
    },
  });
  const marks = component.locator('[data-slot="intent-mark-loader"]');
  await expect(marks).toHaveCount(2);
  for (const mark of await marks.all()) {
    await expect(mark).toHaveAttribute('data-variant', 'twist');
    await expect(mark).toHaveAttribute('data-motion-state', 'playing');
    expect(
      await mark.evaluate(
        (node) =>
          node
            .getAnimations({ subtree: true })
            .filter((animation) => animation.effect?.getTiming().iterations === Infinity).length,
      ),
    ).toBe(5);
  }

  const firstRow = component.locator('[data-streaming-typing-row]').first();
  await expect(firstRow.getByTestId('streaming-status-thinking-label')).toHaveText('Thinking');
  const lifecycle = firstRow.getByTestId('streaming-status-phase');
  await expect(lifecycle).toHaveText(message);
  expect(
    await lifecycle.evaluate((node) => node.closest('[aria-live], [role="status"]')),
  ).toBeNull();
  const elapsed = firstRow.getByTestId('streaming-status-elapsed');
  await expect(elapsed).toHaveCSS('opacity', '0');
  await firstRow.hover();
  await expect(elapsed).toHaveCSS('opacity', '1');
  await expect(elapsed).toHaveAttribute('aria-live', 'off');
  await expect(firstRow.locator('[role="status"]')).toHaveCount(1);

  await marks
    .first()
    .evaluate(
      (node) => ((window as typeof window & { firstPanelMark?: Element }).firstPanelMark = node),
    );
  for (const [phase, variant] of [
    ['launch', 'pulse'],
    ['streaming', 'bloom'],
    ['future-phase', 'bloom'],
    ['tool-waiting', 'twist'],
  ] as const) {
    await component.update({
      props: { revealed: true, concurrent: true, phase, message: `Daemon ${phase}` },
    });
    await expect(marks.first()).toHaveAttribute('data-variant', variant);
    await expect(marks.first()).toHaveAttribute('data-motion-state', 'playing');
    expect(
      await marks
        .first()
        .evaluate(
          (node) =>
            (window as typeof window & { firstPanelMark?: Element }).firstPanelMark === node,
        ),
    ).toBe(true);
  }
});
