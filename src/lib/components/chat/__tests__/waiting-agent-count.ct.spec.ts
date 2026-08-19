import { expect, test } from '@playwright/experimental-ct-svelte';
import AgentSubscriptionInlineHost from './AgentSubscriptionInlineHost.svelte';

test('keeps the complete waiting count before the adaptive avatar stack', async ({ mount }) => {
  const component = await mount(AgentSubscriptionInlineHost, {
    props: { agentCount: 27, width: 340, initiallyExpanded: false },
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const zoom of [1, 2]) {
      let previousVisible = Number.POSITIVE_INFINITY;
      // Narrowest width still fitting the untruncated count, the overflow
      // badge, and the chevron: the title alone spans ~185px of content box.
      for (const width of [340, 300, 270]) {
        await component.update({
          props: { agentCount: 27, width, initiallyExpanded: false, theme, zoom },
        });
        const summary = component.getByRole('button', { name: 'Waiting for 27 agents' });
        if ((await summary.getAttribute('aria-expanded')) === 'true') await summary.click();
        await expect(summary).toHaveAccessibleName('Waiting for 27 agents');

        const title = component.getByTestId('one-shot-summary-title');
        const stack = summary.locator('[data-agent-avatar-stack]');
        const overflow = stack.locator('[data-agent-avatar-overflow]');
        const chevron = component.getByTestId('one-shot-collapse-toggle');
        await expect(overflow).toBeVisible();
        await expect
          .poll(() => title.evaluate((node) => node.scrollWidth <= node.clientWidth))
          .toBe(true);

        // The adaptive stack re-measures via ResizeObserver, so wait until the
        // rendered count is stable across spaced readings before asserting.
        const readVisible = () => stack.locator('[data-agent-avatar-stack-item]').count();
        let visible = await readVisible();
        let stableReads = 0;
        await expect
          .poll(
            async () => {
              const next = await readVisible();
              stableReads = next === visible ? stableReads + 1 : 0;
              visible = next;
              return stableReads >= 2;
            },
            { intervals: [100] },
          )
          .toBe(true);
        expect(visible).toBeLessThanOrEqual(previousVisible);
        previousVisible = visible;
        const geometry = await Promise.all([
          title.boundingBox(),
          overflow.boundingBox(),
          chevron.boundingBox(),
        ]);
        const [titleBox, overflowBox, chevronBox] = geometry;
        expect(titleBox).not.toBeNull();
        expect(overflowBox).not.toBeNull();
        expect(chevronBox).not.toBeNull();
        expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(
          overflowBox!.x + overflowBox!.width,
        );
        expect(overflowBox!.x + overflowBox!.width).toBeLessThanOrEqual(chevronBox!.x);
      }
    }
  }
});

test('labels a retained all-finished cohort as finished', async ({ mount }) => {
  const component = await mount(AgentSubscriptionInlineHost, {
    props: { agentCount: 3, finishedCount: 3, initiallyExpanded: false },
  });

  const summary = component.getByRole('button', { name: '3 agents finished' });
  await expect(summary).toBeVisible();
  await expect(summary.locator('[data-icon="circle-check"]')).toBeVisible();
  await expect(summary.locator('[data-icon="hourglass"]')).toHaveCount(0);
  await summary.click();
  await expect(component.getByTestId('agent-list-item')).toHaveCount(3);
  await expect(component.getByTestId('finished-agent-summary')).toHaveCount(0);
});
