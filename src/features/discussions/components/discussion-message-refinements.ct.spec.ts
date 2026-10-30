import { expect, expectNoAnimations, test } from '../../../test/ct-test';
import Preview from './discussion-message-refinements.preview.svelte';

test('message actions remain reachable with pointer and keyboard', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(Preview, { props: { continuationActions: false } });
  const original = component.locator('[data-discussion-message="original"]');
  const row = component.locator('[data-discussion-message="addressed"]');
  await component.update({ props: { continuationActions: true } });
  const toolbar = row.locator('[data-discussion-message-actions]');
  await toolbar.evaluate((node) => {
    node.addEventListener('transitionrun', () => {
      node.dataset.observedTransitions = String(Number(node.dataset.observedTransitions ?? 0) + 1);
    });
  });
  await row.hover();
  await expect(toolbar).toHaveCSS('opacity', '1');
  await expect
    .poll(() => toolbar.evaluate((node) => Number(node.dataset.observedTransitions)))
    .toBeGreaterThan(0);
  await toolbar.hover();
  await expect(toolbar).toHaveCSS('opacity', '1');
  await toolbar.getByRole('button', { name: 'Message actions', exact: true }).click();
  const copy = page.getByRole('menuitem', { name: 'Copy message', exact: true });
  await copy.hover();
  await expect(toolbar).toHaveCSS('opacity', '1');
  await copy.click();
  await expect(component.locator('[data-copied]')).toHaveText(
    await row.locator('[data-discussion-bubble]').innerText(),
  );
  await row.evaluate((node) => {
    if (node.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  });
  await page.mouse.move(700, 700);
  await expect(toolbar).toHaveCSS('opacity', '0');
  await row.getByRole('button', { name: 'Reply', exact: true }).focus();
  await expect(toolbar).toHaveCSS('opacity', '1');
  await original.getByRole('button', { name: 'Reply', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(original).toHaveAttribute('data-discussion-reply-selected', 'true');
});

test('reduced-motion keyboard reveal allows reply without animations', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(Preview);
  const row = component.locator('[data-discussion-message="original"]');
  const toolbar = row.locator('[data-discussion-message-actions]');
  await row.getByRole('button', { name: 'Reply', exact: true }).focus();
  await expect(toolbar).toHaveCSS('opacity', '1');
  // Reduced motion shortens transitions to 0.01 ms; a finished one can linger in
  // getAnimations() for a frame, so count only animations that are really moving.
  await expectNoAnimations(row);
  await page.keyboard.press('Enter');
  await expect(row).toHaveAttribute('data-discussion-reply-selected', 'true');
});

test('agent markdown, inline mentions, reply navigation and expansion remain usable', async ({
  mount,
}) => {
  const component = await mount(Preview);
  const human = component.locator('[data-discussion-message="addressed"]');
  await expect(human.locator('[data-discussion-agent-mention]')).toHaveCount(1);
  await expect(human.locator('[data-discussion-agent-mention]')).toHaveText('@Reviewer');
  await expect(human.locator('time')).toHaveCount(0);
  const agent = component.locator('[data-discussion-message="response"]');
  await expect(agent.locator('li')).toHaveCount(2);
  await expect(agent.locator('code').filter({ hasText: 'createInviteLink' })).toHaveText(
    'createInviteLink',
  );
  await expect(agent.locator('td code')).toHaveText('hello @sam_name');
  await expect(agent.locator('[data-discussion-text-mention]')).toHaveText('@alex');
  await expect(agent.getByRole('link', { name: '@alex', exact: true })).toHaveCount(0);
  await expect(
    agent.locator('[data-discussion-bubble="agent"] button', { hasText: '#84' }),
  ).toBeVisible();
  const reply = agent.getByRole('button', { name: 'Jump to message from Alex' });
  await reply.click();
  await expect(component.locator('[data-jumped]')).toHaveText('addressed');
  await expect(human).toBeFocused();
  await expect(agent.locator('[data-discussion-collapsed]')).toHaveCount(1);
  await agent.getByRole('button', { name: 'Show more', exact: true }).click();
  await expect(agent.getByRole('button', { name: 'Show less', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(agent.locator('[data-discussion-collapsed]')).toHaveCount(0);
  await agent.getByRole('button', { name: 'Show less', exact: true }).click();
  await expect(agent.locator('[data-discussion-collapsed]')).toHaveCount(1);
  await agent.getByRole('link', { name: 'Review notes' }).focus();
  await expect(agent.locator('[data-discussion-collapsed]')).toHaveCount(0);
});

test('message controls remain available in a narrow panel', async ({ mount }) => {
  const component = await mount(Preview, { props: { narrow: true } });
  await expect(
    component.locator('[data-discussion-message="original"] [data-discussion-message-references]'),
  ).toBeHidden();
  await expect(component.getByRole('button', { name: 'Show more', exact: true })).toBeVisible();
  const bubble = component.locator('[data-discussion-bubble="agent"]');
  for (const control of await bubble.getByRole('button').all()) {
    await expect(control).toBeVisible();
  }
  const continuation = component.locator('[data-discussion-message="addressed"]');
  await continuation.hover();
  await expect(continuation.locator('[data-discussion-message-actions]')).toHaveCSS('opacity', '1');
});
