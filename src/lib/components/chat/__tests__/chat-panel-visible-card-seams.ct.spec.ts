import { expect, test } from '@playwright/experimental-ct-svelte';
import type { AgentMessage } from '$shared/types';
import { QUESTION_RESOURCE_MIME_TYPE } from '$shared/types/question-resource';
import { failOnConsoleErrors } from '../../../../test/ct-console-errors';
import ChatPanelOperationalGeometryHost from './ChatPanelOperationalGeometryHost.svelte';

failOnConsoleErrors(test);
test.afterEach(async ({ page }) => {
  expect(await page.pageErrors()).toEqual([]);
});

const timestamp = '2026-08-17T12:00:00.000Z';
const event = (id: string, type: string, data: Record<string, unknown>): AgentMessage => ({
  id,
  role: 'user',
  timestamp,
  contentBlocks: [{ type: 'text', text: `Event ${id}` }],
  metadata: {
    type: 'event_notification',
    eventTypes: [type],
    eventCount: 1,
    events: [{ type, data, timestamp }],
  },
});
const assistant = (contentBlocks: AgentMessage['contentBlocks']): AgentMessage => ({
  id: 'seam-assistant',
  role: 'assistant',
  timestamp,
  contentBlocks,
});
const hiddenQuestion = assistant([
  {
    type: 'resource',
    resource: {
      uri: 'intent-question://resolved-seam',
      name: 'Resolved question',
      mimeType: QUESTION_RESOURCE_MIME_TYPE,
      text: JSON.stringify({
        attachmentId: 'resolved-seam',
        header: 'Scope',
        question: 'Proceed?',
        options: [{ label: 'Yes' }, { label: 'No' }],
      }),
    },
  },
]);

for (const [scenario, between] of [
  ['adjacent', []],
  ['empty assistant', [assistant([])]],
  ['question-only assistant', [hiddenQuestion]],
  [
    'ignored notice',
    [
      {
        id: 'seam-notice',
        role: 'notice',
        timestamp,
        contentBlocks: [{ type: 'text', text: 'Internal fixture notice' }],
      } as AgentMessage,
    ],
  ],
  ['visible prose', [assistant([{ type: 'text', text: 'Visible response between the cards.' }])]],
  [
    'visible tool',
    [
      assistant([
        { type: 'tool_use', id: 'seam-tool', name: 'view', input: { path: 'src/example.ts' } },
        {
          type: 'tool_result',
          id: 'seam-result',
          tool_use_id: 'seam-tool',
          output: 'Read complete.',
        },
      ]),
    ],
  ],
] as const) {
  test(`measures visible card seams with ${scenario}`, async ({ mount, page }, testInfo) => {
    await page.setViewportSize({ width: 900, height: 1100 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(ChatPanelOperationalGeometryHost, {
      props: {
        width: 720,
        cardSeamMessages: [
          event('seam-sent', 'agent:reportToParent', {
            agentName: 'Sender',
            summary: 'Ready for review.',
          }),
          ...between,
          event('seam-completed', 'agent:idle', {
            agentName: 'Reviewer',
            summary: 'Review complete.',
          }),
          event('seam-attention', 'agent:attention-requested', {
            agentName: 'Planner',
            kind: 'discussion',
            reason: 'Choose the next step.',
          }),
        ],
      },
      // ChatPanel re-reads the queue via `agent.getQueue` on mount; this
      // fixture seeds no queue, so the scripted daemon answers empty
      // (intent-hq/intent#5276).
      hooksConfig: { mockBackend: { 'agent.getQueue': { success: true, queue: [] } } },
    });
    const cards = component.getByTestId('event-wakeup-card');
    await expect(cards).toHaveCount(3);
    await page.evaluate(() => document.fonts.ready);
    const measure = () =>
      component.evaluate((root) => {
        const cards = [...root.querySelectorAll('[data-testid="event-wakeup-card"]')].map(
          (node) => {
            const box = node.getBoundingClientRect();
            return { top: box.top, bottom: box.bottom, height: box.height };
          },
        );
        const body = root
          .querySelector('[data-message-id="seam-assistant"]')
          ?.getBoundingClientRect();
        return {
          cards,
          gaps: cards.slice(1).map((card, i) => card.top - cards[i].bottom),
          bodyHeight: body?.height ?? 0,
        };
      });
    const collapsed = await measure();
    await testInfo.attach('collapsed-seams', {
      body: JSON.stringify(collapsed, null, 2),
      contentType: 'application/json',
    });
    await testInfo.attach('collapsed-cards', {
      body: await component.screenshot(),
      contentType: 'image/png',
    });
    expect.soft(collapsed.gaps[1]).toBeCloseTo(16, 1);
    if (scenario.startsWith('visible')) {
      expect(collapsed.bodyHeight).toBeGreaterThan(0);
      expect(collapsed.gaps[0]).toBeGreaterThan(collapsed.bodyHeight);
    } else {
      expect.soft(collapsed.bodyHeight).toBe(0);
      expect.soft(collapsed.gaps[0]).toBeCloseTo(16, 1);
    }
    const summary = cards.nth(1).getByTestId('event-wakeup-summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(cards.nth(1).getByTestId('event-wakeup-details')).toBeVisible();
    const expanded = await measure();
    await testInfo.attach('expanded-seams', {
      body: JSON.stringify(expanded, null, 2),
      contentType: 'application/json',
    });
    expect.soft(expanded.gaps[1]).toBeCloseTo(16, 1);
    expect(expanded.cards[1].height).toBeGreaterThan(collapsed.cards[1].height);
    await page.keyboard.press('Enter');
    await expect(cards.nth(1).getByTestId('event-wakeup-details')).toHaveCount(0);
    await expect(summary).toBeFocused();
  });
}
