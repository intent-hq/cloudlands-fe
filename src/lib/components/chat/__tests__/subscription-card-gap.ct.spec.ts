import { expect, test } from '@playwright/experimental-ct-svelte';
import ConversationTurnGap from '../ConversationTurnGap.svelte';
import EventSubscriptionsCard from '../EventSubscriptionsCard.svelte';

for (const [seam, expected] of [
  ['cards', 8],
  ['content', 24],
] as const) {
  test(`measures the ${seam} boundary without an extra event gap`, async ({ mount }) => {
    const component = await mount(ConversationTurnGap, {
      props: {
        currentIsEventNotification: true,
        currentHasAssistantMessages: false,
        nextIsEventNotification: true,
        subscriptionCardSeam: seam,
      },
    });
    expect((await component.boundingBox())?.height).toBe(expected);
    await component.update({ props: { attentionQuestionAnswerSeam: true } });
    expect((await component.boundingBox())?.height).toBe(24);
  });
}

test('lets the parent own subscription spacing without stacking another margin', async ({
  mount,
  page,
}) => {
  const component = await mount(EventSubscriptionsCard, {
    props: { workspaceId: 'spacing', agentId: 'spacing-agent', isolatedPreview: { count: 1 } },
  });
  const utility = page.getByTestId('subscription-utility-area');
  const margin = () =>
    utility.evaluate((node) => Number.parseFloat(getComputedStyle(node).marginTop));
  expect(await margin()).toBe(24);
  await component.update({ props: { suppressTopGap: true } });
  expect(await margin()).toBe(0);
  await component.update({ props: { suppressTopGap: false, compact: true } });
  expect(await margin()).toBe(24);
});
