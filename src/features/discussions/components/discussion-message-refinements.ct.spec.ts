import { expect, test } from '../../../test/ct-test';
import Preview from './discussion-message-refinements.preview.svelte';

test('actions animate below the bubble without moving content and stay reachable', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(Preview, { props: { continuationActions: false } });
  const original = component.locator('[data-discussion-message="original"]');
  const row = component.locator('[data-discussion-message="addressed"]');
  const withoutActions = (await row.boundingBox())!;
  await component.update({ props: { continuationActions: true } });
  const bounds = (await row.boundingBox())!;
  expect(bounds.height).toBe(withoutActions.height);
  const contentBounds = () =>
    component.locator('[data-discussion-message], [data-discussion-bubble]').evaluateAll((nodes) =>
      nodes.map((node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height };
      }),
    );
  const restingContent = await contentBounds();
  const toolbar = row.locator('[data-discussion-message-actions]');
  await toolbar.evaluate((node) => {
    node.addEventListener('transitionrun', () => {
      node.dataset.observedTransitions = String(Number(node.dataset.observedTransitions ?? 0) + 1);
    });
  });
  await page.mouse.move(bounds.x + 2, bounds.y + 2);
  await expect(toolbar).toHaveCSS('opacity', '1');
  await expect
    .poll(() => toolbar.evaluate((node) => Number(node.dataset.observedTransitions)))
    .toBeGreaterThan(0);
  const toolbarBounds = (await toolbar.boundingBox())!;
  const bubble = (await row.locator('[data-discussion-bubble]').boundingBox())!;
  expect(toolbarBounds.y).toBeGreaterThanOrEqual(bubble.y + bubble.height);
  expect(toolbarBounds.x + toolbarBounds.width).toBeLessThanOrEqual(bubble.x + bubble.width);
  expect(await contentBounds()).toEqual(restingContent);
  await page.mouse.move(toolbarBounds.x + toolbarBounds.width / 2, bubble.y + bubble.height + 1);
  await expect(toolbar).toHaveCSS('opacity', '1');
  await toolbar.hover();
  await expect(toolbar).toHaveCSS('opacity', '1');
  expect(await contentBounds()).toEqual(restingContent);
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
  expect(await contentBounds()).toEqual(restingContent);
  await row.getByRole('button', { name: 'Reply', exact: true }).focus();
  await expect(toolbar).toHaveCSS('opacity', '1');
  expect(await contentBounds()).toEqual(restingContent);
  await original.getByRole('button', { name: 'Reply', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(original).toHaveAttribute('data-discussion-reply-selected', 'true');
});

test('reduced-motion keyboard reveal keeps actions below the bubble without animations', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(Preview);
  const row = component.locator('[data-discussion-message="original"]');
  const toolbar = row.locator('[data-discussion-message-actions]');
  await row.getByRole('button', { name: 'Reply', exact: true }).focus();
  await expect(toolbar).toHaveCSS('opacity', '1');
  const revealed = await row.evaluate((node) => {
    const bubble = node.querySelector('[data-discussion-bubble]')!.getBoundingClientRect();
    const actions = node
      .querySelector('[data-discussion-message-actions]')!
      .getBoundingClientRect();
    return {
      below: actions.top >= bubble.bottom,
      animations: node.getAnimations({ subtree: true }).length,
    };
  });
  expect(revealed.below).toBe(true);
  expect(revealed.animations).toBe(0);
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

test('narrow control containment', async ({ mount }) => {
  const component = await mount(Preview, { props: { narrow: true } });
  await expect(
    component.locator('[data-discussion-message="original"] [data-discussion-message-references]'),
  ).toBeHidden();
  await expect(component.getByRole('button', { name: 'Show more', exact: true })).toBeVisible();
  expect(await component.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const bubble = component.locator('[data-discussion-bubble="agent"]');
  const bounds = (await bubble.boundingBox())!;
  for (const control of await bubble.getByRole('button').all()) {
    await expect(control).toBeVisible();
    const button = (await control.boundingBox())!;
    expect(button.x).toBeGreaterThanOrEqual(bounds.x);
    expect(button.x + button.width).toBeLessThanOrEqual(bounds.x + bounds.width);
  }
  const continuation = component.locator('[data-discussion-message="addressed"]');
  await continuation.hover();
  await expect(continuation.locator('[data-discussion-message-actions]')).toHaveCSS('opacity', '1');
  const textCoverage = await continuation.evaluate((row) => {
    const toolbar = row.querySelector('[data-discussion-message-actions]')!.getBoundingClientRect();
    const body = row.querySelector('[data-discussion-bubble]')!;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const lines: DOMRect[] = [];
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      lines.push(...range.getClientRects());
    }
    return {
      fragments: lines.length,
      covered: lines.filter(
        (line) =>
          line.width > 0 &&
          line.height > 0 &&
          line.left < toolbar.right &&
          line.right > toolbar.left &&
          line.top < toolbar.bottom &&
          line.bottom > toolbar.top,
      ).length,
    };
  });
  expect(textCoverage.fragments).toBeGreaterThan(0);
  expect(textCoverage.covered).toBe(0);
});
