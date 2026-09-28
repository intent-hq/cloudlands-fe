import type { AgentMessage, ContentBlock } from '$shared/types';
import { expect, test } from '../../../../test/ct-test';
import ChatPanelOperationalGeometryHost from './ChatPanelOperationalGeometryHost.svelte';

test.setTimeout(60_000);

const messages = (count = 100): AgentMessage[] => [
  {
    id: 'interaction-user',
    role: 'user',
    timestamp: '2026-09-28T10:00:00Z',
    contentBlocks: [{ type: 'text', text: 'Inspect the interaction history' }],
  },
  {
    id: 'interaction-assistant',
    role: 'assistant',
    timestamp: '2026-09-28T10:00:01Z',
    contentBlocks: Array.from({ length: count }, (_, i): ContentBlock[] => [
      { type: 'text', id: `open-${i}`, text: `<group:Inspect ${i}>` },
      {
        type: 'thinking',
        id: `reason-${i}`,
        text: `Reasoning ${i}\n\nHidden reasoning marker-${i}-end.`,
      },
      {
        type: 'tool_result',
        id: `result-${i}`,
        tool_use_id: `orphan-${i}`,
        output: `Hidden tool marker-${i}-end.`,
      },
      { type: 'text', id: `close-${i}`, text: `</group:Inspect ${i}>` },
    ]).flat(),
  } as AgentMessage,
];

test.beforeEach(async ({ page }) => {
  await page.evaluate(() => {
    const counts: number[] = [];
    let count = 0;
    const observer = new MutationObserver((records) => {
      const added = new Set<Element>();
      for (const record of records) {
        if (
          record.type === 'attributes' &&
          record.oldValue === null &&
          record.target instanceof Element &&
          record.target.hasAttribute('data-chat-operational-row')
        )
          added.add(record.target);
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches('[data-chat-operational-row]')) added.add(node);
          node.querySelectorAll('[data-chat-operational-row]').forEach((row) => added.add(row));
        }
      }
      count += added.size;
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-chat-operational-row'],
      attributeOldValue: true,
    });
    const frame = () => {
      counts.push(count);
      count = 0;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    Object.assign(window, { operationalMountCounts: counts });
  });
});

test.afterEach(async ({ page }, info) => {
  const counts = await page.evaluate(
    () => (window as unknown as { operationalMountCounts: number[] }).operationalMountCounts,
  );
  await info.attach('physical-row-mounts-per-frame', {
    body: JSON.stringify(counts),
    contentType: 'application/json',
  });
  expect(Math.max(0, ...counts)).toBeLessThanOrEqual(4);
});

for (const navigation of ['search', 'deep-link']) {
  test(`${navigation} reveals an unmounted group and its tool payload`, async ({ mount, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const host = await mount(ChatPanelOperationalGeometryHost, {
      props: { liveMessages: messages(), detachedStatus: true },
    });
    const viewport = host.getByTestId('chat-transcript-scroll-viewport');
    await expect
      .poll(() => viewport.evaluate((n) => n.scrollHeight - n.clientHeight - n.scrollTop))
      .toBeLessThanOrEqual(2);
    await expect(host.getByText('Hidden tool marker-10-end.', { exact: true })).toHaveCount(0);
    if (navigation === 'search') {
      await viewport.click({ position: { x: 4, y: 4 } });
      await page.keyboard.press('ControlOrMeta+f');
      await host
        .getByRole('search', { name: 'Find in panel' })
        .getByRole('textbox')
        .fill('Hidden tool marker-10-end.');
    } else {
      await page.evaluate(() =>
        window.dispatchEvent(
          new CustomEvent('chat:open-message', {
            detail: {
              agentId: 'chat-panel-operational-agent',
              messageId: 'interaction-assistant',
              query: 'Hidden tool marker-10-end.',
              requestId: 'row-deep-link',
            },
          }),
        ),
      );
    }
    await expect(host.getByText('Hidden tool marker-10-end.', { exact: true })).toBeVisible();
    await expect.poll(() => host.locator('[data-chat-operational-row]').count()).toBeLessThan(60);
  });
}

test('real chat follows disclosure growth and resizing, but preserves user scrollback', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const host = await mount(ChatPanelOperationalGeometryHost, {
    props: { liveMessages: messages(), detachedStatus: true },
  });
  const viewport = host.getByTestId('chat-transcript-scroll-viewport');
  const distance = () => viewport.evaluate((n) => n.scrollHeight - n.clientHeight - n.scrollTop);
  await expect.poll(distance).toBeLessThanOrEqual(2);
  const group = host.getByTestId('response-group-disclosure').last();
  await group.click();
  await group.click();
  await expect.poll(distance).toBeLessThanOrEqual(2);
  await host.update({ props: { liveMessages: messages(110), detachedStatus: true, width: 380 } });
  await expect.poll(distance).toBeLessThanOrEqual(2);
  await viewport.evaluate((n) => {
    n.dispatchEvent(new WheelEvent('wheel', { deltaY: -500 }));
    n.scrollTop -= 500;
  });
  await expect.poll(distance).toBeGreaterThan(100);
  const before = await viewport.evaluate((n) => n.scrollTop);
  await host.update({ props: { liveMessages: messages(120), detachedStatus: true, width: 380 } });
  await expect.poll(() => viewport.evaluate((n) => n.scrollTop)).toBeCloseTo(before, 0);
  await expect.poll(distance).toBeGreaterThan(100);
});
