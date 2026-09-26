import { expect, test } from '../../../../test/ct-test';
import Preview from '../chat-mermaid-streaming.preview.svelte';

test('stepping the production chat preview retains incomplete paint and replay resets it', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(Preview, { props: { startAt: 'start' } });
  const renderer = component.locator('.mermaid-renderer');
  const svg = component.locator('.mermaid-svg > svg');
  const next = component.getByRole('button', { name: 'Next chunk' });
  await expect(renderer).toHaveAttribute('data-render-settled', 'true');
  await expect(svg.locator('g.node')).toHaveCount(1);

  await next.click();
  await expect(svg.locator('g.node')).toHaveCount(2);
  await expect(renderer).toHaveAttribute('data-render-settled', 'true');
  const goodPaint = await svg.evaluate((el) => el.outerHTML);
  const generation = Number(await renderer.getAttribute('data-render-generation'));
  await next.click();
  await expect
    .poll(async () => Number(await renderer.getAttribute('data-render-generation')))
    .toBeGreaterThan(generation);
  await expect(renderer).toHaveAttribute('data-render-settled', 'true');
  expect(await svg.evaluate((el) => el.outerHTML)).toBe(goodPaint);
  await expect(component.getByRole('alert')).toHaveCount(0);
  const source = component.getByRole('button', { name: 'View source' });
  await source.focus();
  await source.press('Enter');
  await expect(component.getByRole('region', { name: 'View source' })).toContainText('C[Sh');
  await next.click();
  await expect(svg.locator('g.node')).toHaveCount(3);
  await expect(renderer).toHaveAttribute('data-render-settled', 'true');
  await expect(component.getByRole('region', { name: 'View source' })).toContainText('C[Ship]');
  await next.click();
  await expect(next).toBeDisabled();
  await expect(renderer).toHaveAttribute('data-render-settled', 'true');
  // Layout settlement can precede the global reduced-motion transitions' final frame.
  // Capture visibility now and wait only for those short transitions, never a reveal.
  const motion = await svg.evaluate(async (root) => {
    const animations = root.getAnimations({ subtree: true });
    const immediate = {
      reveals: root.querySelectorAll('[data-mermaid-reveal]').length,
      visible: [...root.querySelectorAll('g.node rect, g.node foreignObject')].every(
        (part) => Number(getComputedStyle(part).opacity) === 1,
      ),
      unexpectedAnimations: animations.filter(
        (animation) =>
          !(animation instanceof CSSTransition) ||
          animation.effect!.getTiming().duration !== 0.01 ||
          animation.effect!.getTiming().delay !== 0,
      ).length,
    };
    if (immediate.unexpectedAnimations === 0) {
      await Promise.all(animations.map((animation) => animation.finished));
    }
    return { ...immediate, animations: root.getAnimations({ subtree: true }).length };
  });
  expect(motion).toEqual({ reveals: 0, visible: true, unexpectedAnimations: 0, animations: 0 });

  await component.getByRole('button', { name: 'Replay' }).click();
  await component.getByRole('button', { name: 'Pause' }).click();
  await expect(svg.locator('g.node')).toHaveCount(1);
  await expect(renderer).toHaveAttribute('data-render-settled', 'true');
  await expect(component.getByRole('region', { name: 'View source' })).toHaveCount(0);
  await expect(svg.locator('[data-mermaid-reveal]')).toHaveCount(0);
  // The global reduced-motion policy leaves 0.01ms style transitions until the next frame.
  await expect.poll(() => svg.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  expect(
    await svg
      .locator('g.node rect, g.node foreignObject')
      .evaluateAll((parts) => parts.every((part) => Number(getComputedStyle(part).opacity) === 1)),
  ).toBe(true);
});

test('a narrow replay keeps controls reachable and scrolls to the final node', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const component = await mount(Preview);
  await expect(component.locator('.mermaid-renderer')).toHaveAttribute(
    'data-render-settled',
    'true',
  );
  const viewport = component.locator('.mermaid-svg-viewport');
  const lastNode = component.locator('.mermaid-svg g.node').filter({ hasText: 'Ship' });
  const nodeIsInView = () =>
    lastNode.evaluate((node) => {
      const view = node.closest('.mermaid-svg-viewport')!.getBoundingClientRect();
      const bounds = node.getBoundingClientRect();
      return bounds.left >= view.left && bounds.right <= view.right;
    });
  expect(await nodeIsInView()).toBe(false);
  await viewport.hover();
  await page.mouse.wheel(1000, 0);
  await expect.poll(nodeIsInView).toBe(true);
  expect(await component.evaluate((root) => root.scrollWidth <= root.clientWidth)).toBe(true);
  const source = component.getByRole('button', { name: 'View source' });
  await source.focus();
  await source.press('Enter');
  await expect(component.getByRole('region', { name: 'View source' })).toContainText('C[Ship]');
});

test('replay starts a fresh reveal after a completed response', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // Pause the real reveal at its start; check animation lifecycle, not a timed midpoint.
  await page.addStyleTag({
    content: '[data-mermaid-reveal] { animation-play-state: paused !important; }',
  });
  const component = await mount(Preview);
  const svg = component.locator('.mermaid-svg > svg');
  await expect(component.locator('.mermaid-renderer')).toHaveAttribute(
    'data-render-settled',
    'true',
  );
  expect(await svg.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  await component.getByRole('button', { name: 'Replay' }).click();
  await component.getByRole('button', { name: 'Pause' }).click();
  await expect(svg.locator('g.node')).toHaveCount(1);
  await expect(component.locator('.mermaid-renderer')).toHaveAttribute(
    'data-render-settled',
    'true',
  );
  expect(await svg.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBeGreaterThan(0);
  await svg.evaluate((el) =>
    el.getAnimations({ subtree: true }).forEach((animation) => animation.finish()),
  );
  await expect.poll(() => svg.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
});
