import type { Locator } from '@playwright/experimental-ct-svelte';
import { expect, expectAnimationsToSettle, test } from '../../../../test/ct-test';
import DisclosureMotionPreparationHost from './DisclosureMotionPreparationHost.svelte';

function controlledContentSelector(id: string) {
  return `[id=${JSON.stringify(id)}]`;
}

async function controlledContent(component: Locator, trigger: Locator) {
  const id = await trigger.getAttribute('aria-controls');
  if (!id) throw new Error('Expected disclosure trigger to control content');
  return component.locator(controlledContentSelector(id));
}

async function expectAnimationsCleanedUp(locator: Locator) {
  await expect
    .poll(() => locator.evaluate((node) => node.getAnimations({ subtree: true }).length))
    .toBe(0);
}

async function unlockAt(transcript: Locator, top: number) {
  await transcript.evaluate((node, nextTop) => {
    node.dispatchEvent(new WheelEvent('wheel', { deltaY: -20 }));
    node.scrollTop = nextTop as number;
    node.dispatchEvent(new Event('scroll'));
  }, top);
}

test('keeps nested and outer subscription collapse bottom-following', async ({ mount }) => {
  const component = await mount(DisclosureMotionPreparationHost);
  const transcript = component.getByTestId('disclosure-transcript');
  await transcript.evaluate((node) => node.scrollTo(0, node.scrollHeight));

  const nested = component.getByTestId('one-shot-summary-toggle');
  await nested.evaluate((node) => (node as HTMLElement).click());
  await expect(nested).toHaveAttribute('aria-expanded', 'false');
  const outer = component.getByTestId('event-subscriptions-summary');
  await outer.evaluate((node) => (node as HTMLElement).click());

  await expect(component.getByTestId('one-shot-agent-list')).toHaveCount(0);
  await expect(outer).toHaveAttribute('aria-expanded', 'false');
  const body = component.getByTestId('event-subscriptions-body');
  await expect(body).toHaveCount(0);
  await expectAnimationsCleanedUp(component);
  expect(
    await transcript.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop),
  ).toBeLessThanOrEqual(8);
});

test('keeps native keyboard control of the outer subscription disclosure', async ({ mount }) => {
  const component = await mount(DisclosureMotionPreparationHost);
  const transcript = component.getByTestId('disclosure-transcript');
  await transcript.evaluate((node) => node.scrollTo(0, node.scrollHeight));
  const outer = component.getByTestId('event-subscriptions-summary');

  await outer.focus();
  await outer.press('Space');
  await expect(outer).toHaveAttribute('aria-expanded', 'false');
  await expect(component.getByTestId('event-subscriptions-body')).toHaveCount(0);
  await outer.press('Enter');

  await expect(outer).toHaveAttribute('aria-expanded', 'true');
  const body = component.getByTestId('event-subscriptions-body');
  await expect(body).toBeVisible();
  await expectAnimationsCleanedUp(component);
  expect(
    await transcript.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop),
  ).toBeLessThanOrEqual(8);
  await expectAnimationsCleanedUp(component);
});

test('accepts live response updates during collapse without stale detached content', async ({
  mount,
}) => {
  const initialProps = { responseStreaming: true, responseText: 'Initial live activity.' };
  const component = await mount(DisclosureMotionPreparationHost, { props: initialProps });
  const transcript = component.getByTestId('disclosure-transcript');
  await transcript.evaluate((node) => node.scrollTo(0, node.scrollHeight));
  const toggle = component.getByTestId('response-group-disclosure');

  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(component.getByTestId('prepared-response-current')).toHaveText(
    'Initial live activity.',
  );
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(component.getByTestId('prepared-response-body')).toBeVisible();
  // Let the expand motion settle before the pointer click that starts the
  // collapse (monorepo#4267): while the details grow, the followed-bottom
  // transcript re-pins every frame and shifts the trigger row up. Playwright
  // verifies the hit target only on pointerdown, so a row that moves before
  // mouseup lands the synthesized `click` on the common ancestor instead of the
  // button and the toggle is silently dropped.
  await expectAnimationsCleanedUp(await controlledContent(component, toggle));
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await component.update({
    props: { ...initialProps, responseText: 'Updated live activity while collapsing.' },
  });
  await expect(component.locator('[data-operational-expanded-content]')).toHaveCount(0);
  const current = component.getByTestId('prepared-response-current');
  await expect(current).toBeVisible();
  await expect(current).toHaveText('Updated live activity while collapsing.');
  expect(
    await current.evaluate((node) => node.closest('[data-operational-expanded-content]') === null),
  ).toBe(true);
  const body = component.getByTestId('prepared-response-body');
  await expect(body).toHaveCount(1);
  await expect(body).toBeVisible();
  expect(
    await body.evaluate((node) => {
      const groupContent = node.closest('[data-response-group-content]');
      return groupContent?.closest('[data-operational-preview-content]') !== null;
    }),
  ).toBe(true);
  expect(
    await body.evaluate((node) => node.closest('[data-operational-expanded-content]') === null),
  ).toBe(true);
  expect(
    await transcript.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop),
  ).toBeLessThanOrEqual(8);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(component.getByTestId('prepared-response-body')).toContainText(
    'Updated live activity while collapsing.',
  );
  // Wait for disclosure cleanup after the live content update.
  await expectAnimationsToSettle(component.locator('[data-operational-expanded-content]'), {
    subtree: false,
    includeFinished: true,
  });
});

for (const cohort of [
  {
    name: 'after_all collapsed',
    fixtureId: 'after-all-collapsed',
    agentCount: 9,
    finishedCount: 2,
    expanded: false,
  },
  {
    name: 'after_all expanded',
    fixtureId: 'after-all-expanded',
    agentCount: 7,
    finishedCount: 2,
    expanded: true,
  },
  {
    name: 'immediate expanded',
    fixtureId: 'immediate-expanded',
    agentCount: 1,
    finishedCount: 0,
    expanded: true,
  },
]) {
  test(`reconciles the ${cohort.name} sandbox cohort with production subscription DOM`, async ({
    mount,
  }) => {
    const component = await mount(DisclosureMotionPreparationHost, {
      props: {
        fixtureId: cohort.fixtureId,
        agentCount: cohort.agentCount,
        finishedCount: cohort.finishedCount,
        subscriptionMode: 'agents',
        initiallyExpanded: cohort.expanded,
      },
    });
    await expect(component.getByTestId('event-subscriptions-outer-header')).toHaveCount(0);
    const list = component.getByTestId('one-shot-agent-list');
    if (cohort.agentCount === 1) {
      await expect(component.getByTestId('one-shot-header')).toHaveCount(0);
      await expect(component.getByTestId('one-shot-summary-toggle')).toHaveCount(0);
      await expect(list).toHaveCount(1);
      await expect(list).toHaveAttribute('data-agent-list-mode', 'direct');
      await expect(list.locator('[data-subscription-motion-row]')).toHaveCount(1);
      await expect(component.getByTestId('finished-agent-group')).toHaveCount(0);
      return;
    }
    await expect(component.getByTestId('one-shot-summary-toggle')).toHaveAttribute(
      'aria-expanded',
      String(cohort.expanded),
    );
    await expect(list).toHaveCount(cohort.expanded ? 1 : 0);
    if (cohort.expanded) {
      await expect(list).toHaveAttribute('data-agent-list-mode', 'grouped');
      await expect(list.locator('[data-subscription-motion-row]')).toHaveCount(
        cohort.agentCount - cohort.finishedCount,
      );
      await expect(component.getByTestId('finished-agent-group')).toHaveCount(
        cohort.finishedCount > 0 ? 1 : 0,
      );
    }
  });
}

test('does not move an intentionally unlocked viewport during disclosure changes', async ({
  mount,
}) => {
  const component = await mount(DisclosureMotionPreparationHost);
  const transcript = component.getByTestId('disclosure-transcript');
  const anchor = component.getByTestId('disclosure-visible-anchor');
  await unlockAt(transcript, 420);
  const beforeTop = await transcript.evaluate((node) => node.scrollTop);
  const beforeAnchor = await anchor.evaluate((node) => node.getBoundingClientRect().top);

  await component.getByTestId('response-group-disclosure').dispatchEvent('click');
  await component.getByTestId('one-shot-summary-toggle').dispatchEvent('click');
  await component.getByTestId('event-subscriptions-summary').dispatchEvent('click');
  await expect.poll(() => transcript.evaluate((node) => node.scrollTop)).toBeCloseTo(beforeTop, 1);
  expect(await anchor.evaluate((node) => node.getBoundingClientRect().top)).toBeCloseTo(
    beforeAnchor,
    1,
  );
  await expect(component.getByTestId('disclosure-bottom-state')).toContainText('unlocked');
});

test('completes reduced-motion disclosure cleanup without residual animations or focus', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(DisclosureMotionPreparationHost);
  const response = component.getByTestId('response-group-disclosure');
  await response.click();
  const focusTarget = component.getByTestId('prepared-response-focus');
  await focusTarget.focus();
  await response.evaluate((node) => (node as HTMLElement).click());
  await expect(response).toHaveAttribute('aria-expanded', 'false');
  await expect(component.getByTestId('prepared-response-body')).toHaveCount(0);
  await expect(response).toBeFocused();

  await component.getByTestId('one-shot-summary-toggle').click();
  await component.getByTestId('event-subscriptions-summary').click();
  await expect(component.getByTestId('one-shot-agent-list')).toHaveCount(0);
  await expect(component.getByTestId('event-subscriptions-body')).toBeHidden();
  await expectAnimationsCleanedUp(component);
});

test('honors animation debug disable with immediate clean disclosure states', async ({ mount }) => {
  const component = await mount(DisclosureMotionPreparationHost, {
    props: { animationsEnabled: false },
  });
  const response = component.getByTestId('response-group-disclosure');
  const outer = component.getByTestId('event-subscriptions-summary');

  await response.dispatchEvent('click');
  await expect(response).toHaveAttribute('aria-expanded', 'true');
  await outer.dispatchEvent('click');
  await expect(outer).toHaveAttribute('aria-expanded', 'false');
  const details = await controlledContent(component, response);
  await expect(details).toBeVisible();
  await expect(component.getByTestId('event-subscriptions-body')).toHaveCount(0);
  await expectAnimationsCleanedUp(details);
});
