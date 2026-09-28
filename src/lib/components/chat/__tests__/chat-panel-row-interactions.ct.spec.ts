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
  await expect
    .poll(() =>
      page
        .locator('[data-testid="chat-transcript-scroll-viewport"]:visible')
        .evaluateAll((viewports) =>
          Math.max(
            0,
            ...viewports.map((viewport) => {
              const rows = [...viewport.querySelectorAll('[data-chat-operational-row]')];
              const visible = rows.filter((row) => {
                const box = (
                  row.querySelector('[data-operational-disclosure-row]') ?? row
                ).getBoundingClientRect();
                let top = 0,
                  bottom = window.innerHeight;
                for (let parent = row.parentElement; parent; parent = parent.parentElement) {
                  if (/auto|scroll|hidden|clip/.test(getComputedStyle(parent).overflowY)) {
                    const clip = parent.getBoundingClientRect();
                    top = Math.max(top, clip.top);
                    bottom = Math.min(bottom, clip.bottom);
                  }
                }
                return box.height > 0 && box.top < bottom && box.bottom > top;
              });
              return rows.length - visible.length;
            }),
          ),
        ),
    )
    .toBeLessThanOrEqual(26);
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

for (const shape of ['many-groups', 'one-history-block'] as const) {
  test(`search reaches offscreen reasoning in ${shape}`, async ({ mount, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const source = messages();
    source[1].contentBlocks =
      shape === 'many-groups'
        ? Array.from({ length: 100 }, (_, i): ContentBlock[] => [
            { type: 'text', id: `reason-open-${i}`, text: '<group:Prepping>Visible description.' },
            {
              type: 'thinking',
              id: `reason-${i}`,
              text: `Evidence ${i}\n\nReasoning target-${i}-end`,
            },
            { type: 'text', id: `reason-close-${i}`, text: '</group:Prepping>' },
          ]).flat()
        : [
            { type: 'text', id: 'history-open', text: '<group:Prepping>Visible description.' },
            {
              type: 'thinking',
              id: 'history',
              text: Array.from({ length: 100 }, (_, i) => `**Reasoning target-${i}-end**`).join(
                '\n\n',
              ),
            },
            { type: 'text', id: 'history-close', text: '</group:Prepping>' },
            { type: 'text', id: 'history-after', text: 'End of completed history.' },
          ];
    const host = await mount(ChatPanelOperationalGeometryHost, {
      props: { liveMessages: source, detachedStatus: true },
    });
    const viewport = host.getByTestId('chat-transcript-scroll-viewport');
    await viewport.click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('ControlOrMeta+f');
    const input = host.getByRole('search', { name: 'Find in panel' }).getByRole('textbox');
    await input.fill('Reasoning target-10-end');
    await expect(host.getByText('Reasoning target-10-end', { exact: true })).toBeInViewport();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const ranges = CSS.highlights?.get('current-search-result') as
            Iterable<Range> | undefined;
          return ranges ? Array.from(ranges)[0]?.toString() : undefined;
        }),
      )
      .toBe('Reasoning target-10-end');
    await input.fill('Reasoning target-90-end');
    await expect(host.getByText('Reasoning target-90-end', { exact: true })).toBeInViewport();
    await input.press('Escape');
  });
}

test('focus pins a row until blur, and manual expansion survives eviction', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const host = await mount(ChatPanelOperationalGeometryHost, {
    props: { liveMessages: messages(), detachedStatus: true },
  });
  const viewport = host.getByTestId('chat-transcript-scroll-viewport');
  const group = host.getByTestId('response-group-disclosure').filter({ hasText: 'Inspect 90' });
  await expect(group).toBeVisible();
  await group.focus();
  await group.press('Enter');
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  const position = await viewport.evaluate((n) => n.scrollTop);
  await viewport.evaluate((n) => {
    n.dispatchEvent(new WheelEvent('wheel', { deltaY: -10000 }));
    n.scrollTop = 0;
  });
  await expect(group).toBeFocused();
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  await host.getByTestId('message-input').locator('.tiptap-editor').focus();
  await expect(group).toHaveCount(0);
  await viewport.evaluate((n, top) => {
    n.scrollTop = top;
  }, position);
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  await expect(host.getByText('Hidden tool marker-90-end.', { exact: true })).toBeVisible();
});

test('editing a prompt retains the editor without exempting its operational turn', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const host = await mount(ChatPanelOperationalGeometryHost, {
    props: { liveMessages: messages(), detachedStatus: true },
  });
  const viewport = host.getByTestId('chat-transcript-scroll-viewport');
  await viewport.evaluate((n) => {
    n.dispatchEvent(new WheelEvent('wheel', { deltaY: -10000 }));
    n.scrollTop = 0;
  });
  const user = host.locator('[data-message-id="interaction-user"]');
  await user.getByTestId('user-message-surface').dblclick();
  const editor = user.locator('.tiptap-editor');
  await expect(editor).toBeFocused();
  await editor.press('ControlOrMeta+End');
  await editor.pressSequentially(' Keep this draft.');
  await viewport.evaluate((n) => {
    n.scrollTop = n.scrollHeight;
  });
  await expect(editor).toBeFocused();
  await expect(editor).toContainText('Keep this draft.');
  await expect.poll(() => host.locator('[data-chat-operational-row]').count()).toBeLessThan(60);
  await editor.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(user.getByTestId('user-message-surface')).toContainText(
    'Inspect the interaction history',
  );
});

for (const initiallyLazy of [false, true]) {
  test(`history prepend and replay keep the row budget with initial lazy mode ${initiallyLazy}`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const history = Array.from(
      { length: 44 },
      (_, i): AgentMessage =>
        ({
          id: `older-${i}`,
          role: i % 2 === 0 ? 'user' : 'assistant',
          timestamp: `2026-09-27T10:00:${String(i).padStart(2, '0')}Z`,
          contentBlocks:
            i % 2 === 0
              ? [{ type: 'text', text: `Older prompt ${i}` }]
              : messages(30)[1].contentBlocks,
        }) as AgentMessage,
    );
    const initial = initiallyLazy ? [...history, ...messages()] : messages();
    const host = await mount(ChatPanelOperationalGeometryHost, {
      props: { liveMessages: initial, detachedStatus: true },
    });
    const viewport = host.getByTestId('chat-transcript-scroll-viewport');
    await expect
      .poll(() => viewport.evaluate((n) => n.scrollHeight - n.clientHeight - n.scrollTop))
      .toBeLessThanOrEqual(2);
    await host.update({
      props: { liveMessages: [...history, ...messages()], detachedStatus: true },
    });
    await viewport.click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('ControlOrMeta+f');
    const input = host.getByRole('search', { name: 'Find in panel' }).getByRole('textbox');
    await input.fill('Hidden tool marker-10-end.');
    await expect(
      host
        .locator('[data-message-id="older-1"]')
        .getByText('Hidden tool marker-10-end.', { exact: true }),
    ).toBeVisible();
    await input.press('Escape');
    await host.update({
      props: { liveMessages: structuredClone([...history, ...messages()]), detachedStatus: true },
    });
    await expect.poll(() => host.locator('[data-chat-operational-row]').count()).toBeLessThan(60);
  });
}

test('agent switching cancels pending navigation and restores the retained conversation', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const alternate = messages(80).map((m) => ({ ...m, id: `alternate-${m.id}` }));
  const props = { liveMessages: messages(), alternateMessages: alternate, detachedStatus: true };
  const host = await mount(ChatPanelOperationalGeometryHost, { props });
  await host.getByTestId('chat-transcript-scroll-viewport').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('ControlOrMeta+f');
  await host
    .getByRole('search', { name: 'Find in panel' })
    .getByRole('textbox')
    .fill('Hidden tool marker-10-end.');
  await host.update({ props: { ...props, activeAgent: 'secondary' } });
  await expect(host.locator('[data-message-id="alternate-interaction-assistant"]')).toBeVisible();
  const activeScroll = host.locator('[data-testid="chat-transcript-scroll-viewport"]:visible');
  await expect
    .poll(() => activeScroll.evaluate((n) => n.scrollHeight - n.clientHeight - n.scrollTop))
    .toBeLessThanOrEqual(2);
  await host.update({ props: { ...props, activeAgent: 'primary' } });
  await expect(host.locator('[data-message-id="interaction-assistant"]')).toBeVisible();
  await expect
    .poll(() =>
      host
        .locator(
          '[data-testid="chat-transcript-scroll-viewport"]:visible [data-chat-operational-row]',
        )
        .count(),
    )
    .toBeLessThan(60);
});

test('streaming growth and completion follow only while the user follows the tail', async ({
  mount,
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const live = (count: number, streaming = true) =>
    messages(count).map((m) =>
      m.role === 'assistant' ? { ...m, isStreaming: streaming, streamingComplete: !streaming } : m,
    );
  const host = await mount(ChatPanelOperationalGeometryHost, {
    props: { liveMessages: live(100), liveStreaming: true, height: 760 },
  });
  const viewport = host.getByTestId('chat-transcript-scroll-viewport');
  const distance = () => viewport.evaluate((n) => n.scrollHeight - n.clientHeight - n.scrollTop);
  await expect.poll(distance).toBeLessThanOrEqual(2);
  async function sampleFollowing(change: () => Promise<unknown>) {
    await viewport.evaluate((node) => {
      const root = node as HTMLElement & { samples?: number[] };
      root.samples = [];
      const sample = () => {
        root.samples!.push(root.scrollHeight - root.clientHeight - root.scrollTop);
        if (root.samples!.length < 40) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await change();
    await expect
      .poll(() =>
        viewport.evaluate((n) => (n as HTMLElement & { samples: number[] }).samples.length),
      )
      .toBe(40);
    const samples = await viewport.evaluate(
      (n) => (n as HTMLElement & { samples: number[] }).samples,
    );
    await info.attach('follow-bottom-frames', {
      body: JSON.stringify(samples),
      contentType: 'application/json',
    });
    expect(Math.max(...samples.map(Math.abs))).toBeLessThanOrEqual(2);
  }
  await sampleFollowing(() =>
    host.update({ props: { liveMessages: live(120), liveStreaming: true, height: 760 } }),
  );
  await sampleFollowing(() =>
    host.update({
      props: { liveMessages: live(120), liveStreaming: true, height: 600, width: 380 },
    }),
  );
  const disclosure = host.getByTestId('response-group-disclosure').last();
  await sampleFollowing(() => disclosure.click());
  await sampleFollowing(() => disclosure.click());
  await viewport.evaluate((n) => {
    n.dispatchEvent(new WheelEvent('wheel', { deltaY: -600 }));
    n.scrollTop -= 600;
  });
  await expect.poll(distance).toBeGreaterThan(100);
  const before = await viewport.evaluate((n) => n.scrollTop);
  await host.update({
    props: { liveMessages: live(140), liveStreaming: true, height: 600, width: 380 },
  });
  await expect.poll(() => viewport.evaluate((n) => n.scrollTop)).toBeCloseTo(before, 0);
  await host.update({
    props: { liveMessages: live(140, false), liveStreaming: false, height: 600, width: 380 },
  });
  await expect.poll(() => viewport.evaluate((n) => n.scrollTop)).toBeCloseTo(before, 0);
});

test('search restores its canonical disclosure after a group is prepended', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const source = messages();
  const host = await mount(ChatPanelOperationalGeometryHost, {
    props: { liveMessages: source, detachedStatus: true },
  });
  await host.getByTestId('chat-transcript-scroll-viewport').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('ControlOrMeta+f');
  const input = host.getByRole('search', { name: 'Find in panel' }).getByRole('textbox');
  await input.fill('Hidden tool marker-10-end.');
  const disclosure = host
    .getByTestId('response-group-disclosure')
    .filter({ hasText: 'Inspect 10' });
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await input.press('Enter');
  const prepended = structuredClone(source);
  prepended[1].contentBlocks!.unshift({
    type: 'text',
    id: 'prepended-open',
    text: '<group:Prepended>New group description</group:Prepended>',
  });
  await host.update({ props: { liveMessages: prepended, detachedStatus: true } });
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await input.press('Escape');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
});
