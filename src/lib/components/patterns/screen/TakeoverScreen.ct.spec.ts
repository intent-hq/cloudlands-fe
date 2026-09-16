import { expect, test } from '@playwright/experimental-ct-svelte';
import InterruptedAgentsModal from '../../modals/InterruptedAgentsModal.svelte';

test('a bounded takeover scrolls to its last row while its body height is animating', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const agents = Array.from({ length: 40 }, (_, index) => ({
    agentId: `agent-${index}`,
    agentName: `Agent ${index}`,
    workspaceId: 'workspace',
    workspaceName: 'Workspace',
    prevStatus: 'running',
    interruptedAt: '2026-09-15T12:00:00Z',
  }));
  const component = await mount(InterruptedAgentsModal, {
    props: { open: true, inline: true, agents },
  });
  const viewport = page.locator('[data-slot="takeover-screen-body"]');
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollHeight > node.clientHeight))
    .toBe(true);

  await viewport.hover();
  await page.mouse.wheel(0, 10000);
  await expect(page.getByRole('option').last()).toBeInViewport();

  // Removing rows retargets the real spring. Sample on animation frames, not a timed midpoint.
  await component.update({ props: { open: true, inline: true, agents: agents.slice(0, 30) } });
  const sample = await viewport.evaluate(async (node) => {
    for (let frame = 0; frame < 120; frame++) {
      const body = node.querySelector<HTMLElement>('[data-slot="screen-body"]')!;
      const wrapper = body.parentElement!;
      if (
        Math.abs(wrapper.getBoundingClientRect().height - body.getBoundingClientRect().height) > 1
      ) {
        node.scrollTop = 0;
        node.scrollTop = node.scrollHeight;
        return {
          animating: true,
          scrollTop: node.scrollTop,
          bounded: node.scrollHeight > node.clientHeight,
        };
      }
      await new Promise(requestAnimationFrame);
    }
    return { animating: false, scrollTop: node.scrollTop, bounded: false };
  });
  expect(sample.animating).toBe(true);
  expect(sample.bounded).toBe(true);
  expect(sample.scrollTop).toBeGreaterThan(0);
  await viewport.hover();
  await page.mouse.wheel(0, 10000);
  await expect(page.getByRole('option').last()).toBeInViewport();
});
