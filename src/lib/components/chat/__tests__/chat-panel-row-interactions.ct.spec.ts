import type { AgentMessage, ContentBlock } from '$shared/types';
import { expect, test } from '../../../../test/ct-test';
import ChatPanelOperationalGeometryHost from './ChatPanelOperationalGeometryHost.svelte';

test.setTimeout(60_000);

for (const live of [false, true]) {
  test(`phase summary and body search survive eviction and restoration (streaming=${live})`, async ({
    mount,
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const transcript: AgentMessage[] = [
      {
        id: 'phase-message',
        role: 'assistant',
        timestamp: '2026-09-28T10:00:01Z',
        isStreaming: live,
        contentBlocks: [
          { type: 'thinking', id: 'compact-title', text: '## Compact title' },
          { type: 'text', text: '<group:Prepping>Inline prose remains separate.</group>' },
          { type: 'text', text: '<group:Prepping>' },
          { type: 'thinking', id: 'history-title', text: '## History group' },
          ...Array.from({ length: 80 }, (_, i): ContentBlock => ({
            type: 'thinking',
            id: `phases-${i}`,
            text: `## Context ${i}\n\n**needle-phase-${i}-end**\n\nBody needle-phase-${i}-end.`,
          })),
          { type: 'text', text: '</group>' },
          ...Array.from({ length: 80 }, (_, i): ContentBlock => ({
            type: 'thinking',
            id: `tail-${i}`,
            text: `## Tail ${i}`,
          })),
        ],
      },
    ];
    const host = await mount(ChatPanelOperationalGeometryHost, {
      props: { liveMessages: transcript, liveStreaming: live, detachedStatus: !live, height: 700 },
    });
    const viewport = host.getByTestId('chat-transcript-scroll-viewport');
    await expect.poll(() => host.locator('[data-chat-operational-row]').count()).toBeGreaterThan(0);
    await viewport.click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('ControlOrMeta+f');
    const input = host.getByRole('search', { name: 'Find in panel' }).getByRole('textbox');
    const query = 'needle-phase-40-end';
    const body = host.getByText(`Body ${query}.`, { exact: true });
    await input.fill(query);
    const title = host.getByRole('button', { name: query, exact: true });
    await expect(title).toBeInViewport();
    await expect(title).toHaveAttribute('aria-expanded', 'false');
    await input.press('Enter');
    await expect(body).toBeInViewport();
    await expect
      .poll(() =>
        page.evaluate(() =>
          Array.from(CSS.highlights.get('current-search-result') ?? [], (range) =>
            range.toString(),
          ).join(''),
        ),
      )
      .toBe(query);
    // Summary and body share a canonical row; active Find may retain that row.
    // Release search ownership before exercising eviction and restoration.
    await input.press('Escape');
    await expect(input).toHaveCount(0);
    await viewport.evaluate((node) => {
      node.dispatchEvent(new WheelEvent('wheel', { deltaY: 10000 }));
      node.scrollTop = node.scrollHeight;
    });
    await expect(title).toHaveCount(0);
    await viewport.click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('ControlOrMeta+f');
    await input.fill(query);
    await expect(title).toBeInViewport();
    await expect(title).toHaveAttribute('aria-expanded', 'false');
    await input.press('Enter');
    await expect(body).toBeInViewport();
    await info.attach('phase-search-after-eviction', {
      body: await host.screenshot(),
      contentType: 'image/png',
    });
    await input.fill('Inline prose remains separate.');
    await expect(
      host.getByText('Inline prose remains separate.', { exact: true }),
    ).toBeInViewport();
    await expect(host.getByRole('button', { name: 'Compact title', exact: true })).toHaveCount(0);
  });
}

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

test('the latest same-agent deep link wins over pending reveals and duplicate retries', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const host = await mount(ChatPanelOperationalGeometryHost, {
    props: { liveMessages: messages(), detachedStatus: true },
  });
  await expect.poll(() => host.locator('[data-chat-operational-row]').count()).toBeGreaterThan(0);
  await page.evaluate(async () => {
    const open = (index: number) =>
      window.dispatchEvent(
        new CustomEvent('chat:open-message', {
          detail: {
            agentId: 'chat-panel-operational-agent',
            messageId: 'interaction-assistant',
            query: `Hidden tool marker-${index}-end.`,
            requestId: `overlap-${index}`,
          },
        }),
      );
    open(10);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    open(90);
    open(90);
  });
  const target = host.getByText('Hidden tool marker-90-end.', { exact: true });
  await expect(target).toBeInViewport();
  // Let the superseded request exhaust its former retry window; the final
  // target must stay visible after both navigation pins have been released.
  await page.evaluate(async () => {
    for (let frame = 0; frame < 45; frame++) await new Promise(requestAnimationFrame);
  });
  await expect(target).toBeInViewport();
  await expect(host.getByText('Hidden tool marker-10-end.', { exact: true })).toHaveCount(0);
  const highlighted = await page.evaluate(() => {
    const ranges = CSS.highlights?.get('deep-open-match') as Iterable<Range> | undefined;
    return ranges ? Array.from(ranges, (range) => range.toString()).join(' ') : '';
  });
  expect(highlighted).toContain('marker-90-end.');
  expect(highlighted).not.toContain('marker-10-end.');
});

test('real chat follows disclosure growth and resizing, but preserves user scrollback', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const messagesWithAnchors = (count = 100) => {
    const source = messages(count);
    source[1].contentBlocks = source[1].contentBlocks!.flatMap((block, index): ContentBlock[] =>
      block.type === 'text' && block.text?.startsWith('</group:')
        ? [
            block,
            { type: 'thinking', id: `anchor-${index}`, text: `## Scrollback anchor ${index}` },
          ]
        : [block],
    );
    return source;
  };
  const host = await mount(ChatPanelOperationalGeometryHost, {
    props: { liveMessages: messagesWithAnchors(), detachedStatus: true },
  });
  const viewport = host.getByTestId('chat-transcript-scroll-viewport');
  const distance = () => viewport.evaluate((n) => n.scrollHeight - n.clientHeight - n.scrollTop);
  await expect.poll(distance).toBeLessThanOrEqual(2);
  const group = host.getByTestId('response-group-disclosure').last();
  await group.click();
  await group.click();
  await expect.poll(distance).toBeLessThanOrEqual(2);
  await host.update({
    props: { liveMessages: messagesWithAnchors(110), detachedStatus: true, width: 380 },
  });
  await expect.poll(distance).toBeLessThanOrEqual(2);
  await viewport.evaluate((n) => {
    n.dispatchEvent(new WheelEvent('wheel', { deltaY: -500 }));
    n.scrollTop -= 500;
  });
  await expect.poll(distance).toBeGreaterThan(100);
  const before = await viewport.evaluate((n) => n.scrollTop);
  const anchor = await viewport.evaluate((node) => {
    const clip = node.getBoundingClientRect();
    // Group summaries are not registered anchors. Use a standalone reasoning row.
    const row = [
      ...node.querySelectorAll(
        '[data-message-content-block="thinking"] [data-operational-disclosure-row]',
      ),
    ].find((row) => {
      const rect = row.getBoundingClientRect();
      return rect.top >= clip.top && rect.bottom <= clip.bottom;
    });
    if (!row) throw new Error('Expected a visible standalone reasoning anchor');
    return {
      key: row
        .closest('[data-operational-window-key]')!
        .getAttribute('data-operational-window-key')!,
      top: row.getBoundingClientRect().top - clip.top,
    };
  });
  const anchorTop = () =>
    viewport.evaluate((node, key) => {
      const row = [...node.querySelectorAll('[data-operational-window-key]')].find(
        (row) => row.getAttribute('data-operational-window-key') === key,
      );
      const summary = row?.querySelector('[data-operational-disclosure-row]');
      return summary
        ? summary.getBoundingClientRect().top - node.getBoundingClientRect().top
        : undefined;
    }, anchor.key);
  await host.update({
    props: { liveMessages: messagesWithAnchors(120), detachedStatus: true, width: 380 },
  });
  await expect.poll(() => viewport.evaluate((n) => n.scrollTop)).toBeCloseTo(before, 0);
  await expect.poll(anchorTop).toBeCloseTo(anchor.top, 0);
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
    await input.fill(
      shape === 'one-history-block' ? ' Reasoning target-90-end ' : 'Reasoning target-90-end',
    );
    await expect(host.getByText('Reasoning target-90-end', { exact: true })).toBeInViewport();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const ranges = CSS.highlights?.get('current-search-result') as
            Iterable<Range> | undefined;
          return ranges ? Array.from(ranges)[0]?.toString() : undefined;
        }),
      )
      .toBe('Reasoning target-90-end');
    await input.press('Escape');
  });
}

test('focus pins a row until blur, and manual expansion survives eviction', async ({
  mount,
  page,
}, testInfo) => {
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
  const editor = host.getByTestId('message-input').locator('.tiptap-editor');
  await expect(editor).toBeEditable();
  await editor.focus();
  await expect(editor).toBeFocused();
  await expect(group).toHaveCount(0);
  await viewport.evaluate((n, top) => {
    n.scrollTop = top;
  }, position);
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  await expect(host.getByText('Hidden tool marker-90-end.', { exact: true })).toBeVisible();
  await testInfo.attach('expanded-row-after-eviction', {
    body: await host.screenshot(),
    contentType: 'image/png',
  });
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
      const root = node as HTMLElement & { samples?: number[]; beforeResizeDelivery?: number[] };
      root.samples = [];
      root.beforeResizeDelivery = [];
      const probe = document.createElement('div');
      probe.setAttribute('aria-hidden', 'true');
      probe.style.cssText =
        'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;contain:strict';
      document.body.append(probe);
      let pendingFrame = false;
      // Created after the mounted follower, this observer samples its post-layout
      // correction. A timer can instead read the next update before its frame.
      const observer = new ResizeObserver(() => {
        if (!pendingFrame) return;
        pendingFrame = false;
        root.samples!.push(root.scrollHeight - root.clientHeight - root.scrollTop);
        if (root.samples!.length < 40) requestAnimationFrame(sample);
        else {
          observer.disconnect();
          probe.remove();
        }
      });
      observer.observe(probe);
      const sample = () => {
        root.beforeResizeDelivery!.push(root.scrollHeight - root.clientHeight - root.scrollTop);
        pendingFrame = true;
        probe.style.width = `${1 + (root.beforeResizeDelivery!.length % 2)}px`;
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
    await info.attach('before-resize-delivery', {
      body: JSON.stringify(
        await viewport.evaluate(
          (n) => (n as HTMLElement & { beforeResizeDelivery: number[] }).beforeResizeDelivery,
        ),
      ),
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
  const anchor = await viewport.evaluate((node) => {
    const clip = node.getBoundingClientRect();
    const row = [...node.querySelectorAll('[data-operational-disclosure-row]')].find((row) => {
      const rect = row.getBoundingClientRect();
      return rect.top >= clip.top && rect.bottom <= clip.bottom;
    })!;
    return {
      key: row
        .closest('[data-operational-window-key]')!
        .getAttribute('data-operational-window-key')!,
      top: row.getBoundingClientRect().top,
    };
  });
  const anchorTop = () =>
    viewport.evaluate((node, key) => {
      const row = [...node.querySelectorAll('[data-operational-window-key]')].find(
        (row) => row.getAttribute('data-operational-window-key') === key,
      );
      return row?.querySelector('[data-operational-disclosure-row]')?.getBoundingClientRect().top;
    }, anchor.key);
  await host.update({
    props: { liveMessages: live(140), liveStreaming: true, height: 600, width: 380 },
  });
  await expect.poll(() => viewport.evaluate((n) => n.scrollTop)).toBeCloseTo(before, 0);
  await host.update({
    props: { liveMessages: live(140, false), liveStreaming: false, height: 600, width: 380 },
  });
  await expect.poll(() => viewport.evaluate((n) => n.scrollTop)).toBeCloseTo(before, 0);
  await expect.poll(anchorTop).toBeCloseTo(anchor.top, 0);
  await host.update({
    props: { liveMessages: live(140, false), liveStreaming: false, height: 540, width: 500 },
  });
  await expect.poll(anchorTop).toBeCloseTo(anchor.top, 0);
  await expect.poll(distance).toBeGreaterThan(100);
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

for (const motion of ['reduce', 'no-preference'] as const) {
  for (const following of [true, false]) {
    test(`batched ${following ? 'followed' : 'offscreen'} tools retain natural tail geometry through replay with ${motion} motion`, async ({
      mount,
      page,
    }, info) => {
      await page.emulateMedia({ reducedMotion: motion });
      const initial = messages(80);
      initial[1].isStreaming = true;
      const host = await mount(ChatPanelOperationalGeometryHost, {
        props: { liveMessages: initial, liveStreaming: true },
      });
      const viewport = host.getByTestId('chat-transcript-scroll-viewport');
      await expect
        .poll(() =>
          viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop),
        )
        .toBeLessThanOrEqual(2);
      if (!following)
        await viewport.evaluate((node) => {
          node.dispatchEvent(new WheelEvent('wheel', { deltaY: -1000 }));
          node.scrollTop = 700;
          node.dispatchEvent(new Event('scroll'));
        });
      await page.evaluate(async () => {
        for (let frame = 0; frame < 8; frame++) await new Promise(requestAnimationFrame);
      });
      await info.attach('existing-entrance-animations-before-append', {
        body: JSON.stringify(
          await viewport.evaluate((node) =>
            node
              .getAnimations({ subtree: true })
              .filter(
                (animation) =>
                  animation.playState === 'running' &&
                  animation.effect?.getComputedTiming().iterations !== Infinity,
              )
              .map((animation) => ({
                name: animation instanceof CSSAnimation ? animation.animationName : null,
                currentTime: animation.currentTime,
                duration: animation.effect?.getComputedTiming().duration,
              })),
          ),
        ),
        contentType: 'application/json',
      });
      // Existing history must finish its own entrance before it becomes the
      // anchor for measuring a later append. Observe every frame of the append.
      await expect
        .poll(() =>
          viewport.evaluate(
            (node) =>
              node
                .getAnimations({ subtree: true })
                .filter(
                  (animation) =>
                    animation.playState === 'running' &&
                    animation.effect?.getComputedTiming().iterations !== Infinity,
                ).length,
          ),
        )
        .toBe(0);
      const before = await viewport.evaluate((node) => node.scrollHeight);
      const initialTop = await viewport.evaluate((node) => node.scrollTop);
      await viewport.evaluate((node) => {
        const clip = node.getBoundingClientRect();
        const anchor = [...node.querySelectorAll('[data-operational-disclosure-row]')].find(
          (row) => {
            const rect = row.getBoundingClientRect();
            return rect.top >= clip.top && rect.bottom <= clip.bottom;
          },
        );
        if (!anchor) throw new Error('Expected a visible existing history anchor');
        const key = anchor
          .closest('[data-operational-window-key]')!
          .getAttribute('data-operational-window-key');
        const anchorTop = anchor.getBoundingClientRect().top;
        const scrollTop = node.scrollTop;
        const root = node as HTMLElement & {
          batchSamples: { distance: number; topDrift: number; anchorDrift: number | null }[];
          batchSampling: boolean;
        };
        root.batchSamples = [];
        root.batchSampling = true;
        const sample = () => {
          // Sample after ResizeObserver delivery, as in the disclosure/resize test.
          setTimeout(() => {
            if (!root.batchSampling) return;
            const current = [...node.querySelectorAll('[data-operational-window-key]')]
              .find((row) => row.getAttribute('data-operational-window-key') === key)
              ?.querySelector('[data-operational-disclosure-row]');
            root.batchSamples.push({
              distance: node.scrollHeight - node.clientHeight - node.scrollTop,
              topDrift: node.scrollTop - scrollTop,
              anchorDrift: current ? current.getBoundingClientRect().top - anchorTop : null,
            });
            requestAnimationFrame(sample);
          }, 0);
        };
        requestAnimationFrame(sample);
      });
      const updated = structuredClone(initial);
      updated[1].contentBlocks!.push(
        ...Array.from({ length: 160 }, (_, index): ContentBlock => ({
          type: 'tool_use',
          id: `batch-${index}`,
          name: 'view',
          input: { path: `file-${index}.ts` },
        })),
      );
      await host.update({ props: { liveMessages: updated, liveStreaming: true } });
      const postAppendStart = await viewport.evaluate(
        (node) => (node as HTMLElement & { batchSamples: unknown[] }).batchSamples.length,
      );
      await expect
        .poll(() =>
          viewport.evaluate(
            (node) => (node as HTMLElement & { batchSamples: unknown[] }).batchSamples.length,
          ),
        )
        .toBeGreaterThanOrEqual(postAppendStart + 60);
      const samples = await viewport.evaluate((node) => {
        const root = node as HTMLElement & {
          batchSamples: { distance: number; topDrift: number; anchorDrift: number | null }[];
          batchSampling: boolean;
        };
        root.batchSampling = false;
        return root.batchSamples;
      });
      await info.attach('batch-completed-frame-geometry', {
        body: JSON.stringify(samples),
        contentType: 'application/json',
      });
      await info.attach('batch-post-append-marker', {
        body: JSON.stringify({ postAppendStart, totalSamples: samples.length }),
        contentType: 'application/json',
      });
      expect(samples.length - postAppendStart).toBeGreaterThanOrEqual(60);
      if (following) {
        expect(Math.max(...samples.map((sample) => Math.abs(sample.distance)))).toBeLessThanOrEqual(
          2,
        );
      } else {
        expect(samples.every((sample) => sample.anchorDrift !== null)).toBe(true);
        expect(Math.max(...samples.map((sample) => Math.abs(sample.topDrift)))).toBeLessThanOrEqual(
          2,
        );
        expect(
          Math.max(...samples.map((sample) => Math.abs(sample.anchorDrift!))),
        ).toBeLessThanOrEqual(2);
      }
      // Deferred tools must reserve their complete natural summaries, even
      // before they have ever mounted or their tool-entry transition has run.
      await expect
        .poll(() => viewport.evaluate((node) => node.scrollHeight))
        .toBeGreaterThanOrEqual(before + 160 * 28 - 2);
      await expect
        .poll(() =>
          viewport.evaluate(
            (node, { follows, top }) =>
              follows
                ? node.scrollHeight - node.clientHeight - node.scrollTop
                : Math.abs(node.scrollTop - top),
            { follows: following, top: initialTop },
          ),
        )
        .toBeLessThanOrEqual(2);
      await viewport.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
        node.dispatchEvent(new Event('scroll'));
      });
      await expect(host.locator('[data-tool-use-id="batch-159"]')).toBeInViewport();
      await host.update({ props: { liveMessages: [], liveStreaming: true } });
      await host.update({ props: { liveMessages: updated, liveStreaming: true } });
      await expect
        .poll(() => viewport.evaluate((node) => node.scrollHeight))
        .toBeGreaterThanOrEqual(before + 160 * 28 - 2);
      await viewport.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
        node.dispatchEvent(new Event('scroll'));
      });
      await expect(host.locator('[data-tool-use-id="batch-159"]')).toBeInViewport();
    });
  }
}

test('watched reasoning search retains the body until the actual scrollport reveals it', async ({
  mount,
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const watched = messages(0);
  watched[0].id = 'watched-user';
  watched[1].id = 'watched-assistant';
  watched[1].contentBlocks = [
    { type: 'text', id: 'watched-open', text: '<group:Prepping>Scale inspection.' },
    ...Array.from({ length: 99 }, (_, i): ContentBlock => ({
      type: 'thinking',
      id: `watched-row-${i}`,
      text: `**Scale reasoning ${i}**\n\nDetails needle-watched-${i}.`,
    })),
    { type: 'text', id: 'watched-close', text: '</group:Prepping>' },
    { type: 'text', id: 'watched-end', text: 'End of completed inspection.' },
  ];
  const host = await mount(ChatPanelOperationalGeometryHost, {
    props: {
      liveMessages: messages(0),
      alternateMessages: watched,
      watchedAgent: true,
      detachedStatus: true,
      height: 700,
      width: 600,
    },
  });
  await host
    .getByTestId('scale-agent-subscriptions')
    .getByRole('button', { name: /Alternate agent/ })
    .first()
    .click();
  await expect(host.locator('[data-message-id="watched-assistant"]')).toBeVisible();
  const viewport = host.getByTestId('chat-transcript-scroll-viewport').filter({ visible: true });
  await viewport.click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('ControlOrMeta+f');
  const input = host.getByRole('search', { name: 'Find in panel' }).getByRole('textbox');
  await expect(input).toBeFocused();
  const focusRetained = await input.evaluate(async (node) => {
    const samples: boolean[] = [];
    for (let frame = 0; frame < 60; frame++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      samples.push(document.activeElement === node);
    }
    return samples;
  });
  await info.attach('watched-search-focus-after-navigation', {
    body: JSON.stringify(focusRetained),
    contentType: 'application/json',
  });
  expect(focusRetained).toEqual(Array(60).fill(true));
  for (const index of [50, 80]) {
    const query = `needle-watched-${index}.`;
    await input.fill(query);
    const body = host.getByText(`Details ${query}`, { exact: true });
    await expect(body).toBeInViewport();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const ranges = CSS.highlights?.get('current-search-result') as
            Iterable<Range> | undefined;
          return ranges ? Array.from(ranges)[0]?.toString() : undefined;
        }),
      )
      .toBe(query);
    const key = await body.evaluate((node) =>
      node.closest('[data-operational-window-key]')!.getAttribute('data-operational-window-key')!,
    );
    const visible = await viewport.evaluate(async (node, expectedKey) => {
      const samples: boolean[] = [];
      for (let frame = 0; frame < 60; frame++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
        const row = [...node.querySelectorAll('[data-operational-window-key]')].find(
          (candidate) => candidate.getAttribute('data-operational-window-key') === expectedKey,
        );
        const box = row?.getBoundingClientRect();
        const clip = node.getBoundingClientRect();
        samples.push(!!box && box.top >= clip.top && box.bottom <= clip.bottom);
      }
      return samples;
    }, key);
    await info.attach(`watched-target-${index}-after-navigation`, {
      body: JSON.stringify(visible),
      contentType: 'application/json',
    });
    expect(visible).toEqual(Array(60).fill(true));
  }
});

test('query deep link scrolls to an offscreen user message', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const host = await mount(ChatPanelOperationalGeometryHost, {
    props: { liveMessages: messages(), detachedStatus: true },
  });
  const viewport = host.getByTestId('chat-transcript-scroll-viewport');
  await expect
    .poll(() => viewport.evaluate((n) => n.scrollHeight - n.clientHeight - n.scrollTop))
    .toBeLessThanOrEqual(2);
  const user = host.locator('[data-message-id="interaction-user"]');
  await expect(user).not.toBeInViewport();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('chat:open-message', {
        detail: {
          agentId: 'chat-panel-operational-agent',
          messageId: 'interaction-user',
          query: 'interaction history',
          requestId: 'user-query-link',
        },
      }),
    ),
  );
  await expect(user).toBeInViewport();
  expect(
    await page.evaluate(() =>
      Array.from((CSS.highlights?.get('deep-open-match') as Iterable<Range>) ?? [], (r) =>
        r.toString(),
      ).join(' '),
    ),
  ).toContain('interaction history');
});

for (const kind of ['text', 'thinking', 'completed-thinking'] as const) {
  test(`search materializes an offscreen live group ${kind} child`, async ({ mount, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const source = messages();
    source[1].isStreaming = true;
    const tool: ContentBlock = {
      type: 'tool_use',
      id: 'live-tool',
      name: 'view',
      input: { path: 'src/example.ts' },
    };
    const needle: ContentBlock = {
      type: kind === 'text' ? 'text' : 'thinking',
      id: 'live-needle',
      text: 'live-search-unique-needle',
    };
    source[1].contentBlocks!.push(
      { type: 'text', id: 'live-open', text: '<group:Live inspection>' },
      ...(kind === 'completed-thinking' ? [needle, tool] : [tool, needle]),
    );
    const host = await mount(ChatPanelOperationalGeometryHost, {
      props: { liveMessages: source, liveStreaming: true, detachedStatus: true },
    });
    const viewport = host.getByTestId('chat-transcript-scroll-viewport');
    await expect
      .poll(() => viewport.evaluate((n) => n.scrollHeight - n.clientHeight - n.scrollTop))
      .toBeLessThanOrEqual(2);
    await viewport.hover();
    await page.mouse.wheel(0, -100000);
    await expect.poll(() => viewport.evaluate((n) => n.scrollTop)).toBeLessThan(2);
    await expect(host.getByText('live-search-unique-needle', { exact: true })).toHaveCount(0);
    await viewport.click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('ControlOrMeta+f');
    const search = host.getByRole('search', { name: 'Find in panel' });
    await search.getByRole('textbox').fill('live-search-unique-needle');
    await expect(search).toContainText('1 / 1');
    await expect(host.getByText('live-search-unique-needle', { exact: true })).toBeInViewport();
    await expect
      .poll(() =>
        page.evaluate(() =>
          Array.from((CSS.highlights?.get('current-search-result') as Iterable<Range>) ?? [], (r) =>
            r.toString(),
          ).join(' '),
        ),
      )
      .toBe('live-search-unique-needle');
    await search.getByRole('textbox').press('Escape');
    if (kind === 'completed-thinking') {
      await expect(host.getByText('live-search-unique-needle', { exact: true })).toHaveCount(0);
    } else {
      await expect(host.getByText('live-search-unique-needle', { exact: true })).toBeInViewport();
    }
  });
}
