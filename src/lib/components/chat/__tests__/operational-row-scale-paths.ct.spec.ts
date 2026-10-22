import type { AgentMessage, ContentBlock } from '$shared/types';
import { expect, test } from '../../../../test/ct-test';
import ChatPanelOperationalGeometryHost from './ChatPanelOperationalGeometryHost.svelte';
import { frames, instrument, snapshot, timeline } from './operational-row-scale-probe';

test.use({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
test.setTimeout(120_000);

const transcript = (rows: number, prefix = 'scale'): AgentMessage[] => [
  {
    id: `${prefix}-user`,
    role: 'user',
    timestamp: '2026-09-28T10:00:00Z',
    contentBlocks: [{ type: 'text', text: 'Inspect the scale fixture' }],
  },
  {
    id: `${prefix}-assistant`,
    role: 'assistant',
    timestamp: '2026-09-28T10:00:01Z',
    // The named group is searchable; top-level thinking is intentionally not.
    // Count its summary in the requested total, alongside its reasoning rows.
    contentBlocks:
      rows === 0
        ? []
        : [
            { type: 'text', id: `${prefix}-open`, text: '<group:Prepping>Scale inspection.' },
            ...Array.from({ length: rows - 1 }, (_, i): ContentBlock => ({
              type: 'thinking',
              id: `${prefix}-row-${i}`,
              text: `**Scale reasoning ${i}**\n\nDetails needle-${prefix}-${i}.`,
            })),
            { type: 'text', id: `${prefix}-close`, text: '</group:Prepping>' },
            { type: 'text', id: `${prefix}-end`, text: 'End of completed inspection.' },
          ],
  },
];

test.beforeEach(async ({ page }) => instrument(page));
test.afterEach(async ({ page }, info) => {
  const navigation = await page.evaluate(
    () =>
      (window as Window & { __interactionNavigationTrace?: unknown[] })
        .__interactionNavigationTrace,
  );
  if (navigation)
    await info.attach('interaction-navigation', {
      body: JSON.stringify(navigation),
      contentType: 'application/json',
    });
  const probe = await page.evaluate(() => ({
    frames: window.rowScaleProbe.frames,
    longtasks: window.rowScaleProbe.longtasks,
  }));
  await info.attach('physical-mounts-and-longtasks', {
    body: JSON.stringify(probe),
    contentType: 'application/json',
  });
  expect(Math.max(0, ...probe.frames.map((frame) => frame.mounted))).toBeGreaterThan(0);
  expect(Math.max(0, ...probe.frames.map((frame) => frame.mounts))).toBeLessThanOrEqual(4);
});

for (const rows of [100, 1000, 5000]) {
  test(`watched agent opening ${rows} rows uses the real navigation path`, async ({
    mount,
    page,
  }, info) => {
    const host = await mount(ChatPanelOperationalGeometryHost, {
      props: {
        liveMessages: transcript(0, 'watcher'),
        alternateMessages: transcript(rows, 'watched'),
        watchedAgent: true,
        detachedStatus: true,
        height: 700,
        width: 600,
      },
    });
    const watched = host.getByTestId('scale-agent-subscriptions').getByTestId('agent-list-item');
    await expect(watched).toBeVisible();
    await expect(host.locator('[data-message-id="watched-assistant"]')).toHaveCount(0);
    const navigationCheckpoints = Array.from({ length: 3 }, (_, cycle) =>
      [Math.floor(rows * 0.8), Math.floor(rows / 2)].map((index) => ({
        index,
        label: `watched-cycle-${cycle}-${index}`,
      })),
    ).flat();
    const finish = await timeline(page);
    try {
      const samples = [await snapshot(page, 'before-watched-click')];
      await watched
        .getByRole('button', { name: /Alternate agent/ })
        .first()
        .click();
      await expect(host.locator('[data-message-id="watched-assistant"]')).toBeVisible();
      await frames(page);
      samples.push(await snapshot(page, 'watched-open'));
      const viewport = host
        .getByTestId('chat-transcript-scroll-viewport')
        .filter({ visible: true });
      await viewport.click({ position: { x: 4, y: 4 } });
      await page.keyboard.press('ControlOrMeta+f');
      const input = host.getByRole('search', { name: 'Find in panel' }).getByRole('textbox');
      await input.fill(`needle-watched-${Math.floor(rows / 2)}.`);
      await expect(
        host.getByText(`Details needle-watched-${Math.floor(rows / 2)}.`, { exact: true }),
      ).toBeVisible();
      await frames(page);
      samples.push(await snapshot(page, 'watched-search-disclosure'));
      expect(samples[2].mounted).toBeGreaterThan(1);
      for (const { index, label } of navigationCheckpoints) {
        await input.fill(`needle-watched-${index}.`);
        await expect(
          host.getByText(`Details needle-watched-${index}.`, { exact: true }),
        ).toBeInViewport();
        await frames(page);
        samples.push(await snapshot(page, label));
      }
      // This optional collection is an observer-lifetime diagnostic, not a
      // production timing sample. Weak probe references must not keep rows alive.
      if (process.env.ROW_OBSERVER_GC === '1') {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('HeapProfiler.collectGarbage');
        await cdp.detach();
        samples.push(await snapshot(page, 'watched-after-diagnostic-gc'));
      }
      for (const sample of samples.slice(1)) {
        expect(sample.mounted).toBeGreaterThan(0);
        expect(sample.mounted - sample.visible).toBeLessThanOrEqual(26);
      }
      if (rows === 5000)
        await info.attach('watched-agent-search', {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
      await host.unmount();
      await frames(page, 2);
      const destroyed = await snapshot(page, 'watched-destroyed');
      samples.push(destroyed);
      expect(destroyed.unmatchedRegistrations).toBe(0);
      expect(destroyed.rowObserved).toBe(0);
      expect(destroyed.windowObserved).toBe(0);
      await info.attach('watched-opening-samples', {
        body: JSON.stringify({ rows, samples }),
        contentType: 'application/json',
      });
    } finally {
      await finish(info, [
        'before-watched-click',
        'watched-open',
        'watched-search-disclosure',
        ...navigationCheckpoints.map(({ label }) => label),
        ...(process.env.ROW_OBSERVER_GC === '1' ? ['watched-after-diagnostic-gc'] : []),
        'watched-destroyed',
      ]);
    }
  });
}

test('two-message forced history remains anchored after 200-message prepend', async ({
  mount,
  page,
}, info) => {
  const tail = transcript(50, 'tail');
  const host = await mount(ChatPanelOperationalGeometryHost, {
    props: {
      liveMessages: tail,
      liveStreaming: true,
      detachedStatus: true,
      height: 700,
      width: 600,
    },
  });
  const viewport = host.getByTestId('chat-transcript-scroll-viewport');
  const disclosure = host.getByTestId('response-group-disclosure');
  if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollHeight - node.clientHeight))
    .toBeGreaterThan(400);
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeLessThanOrEqual(2);
  await frames(page);
  // Enter real user history mode before prepending; record a canonical visible row.
  await viewport.hover();
  await page.mouse.wheel(0, -400);
  await frames(page);
  const anchor = await viewport.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const row = [...node.querySelectorAll<HTMLElement>('[data-operational-window-key]')].find(
      (row) => {
        const r = row.getBoundingClientRect();
        return (
          row.querySelector('[data-chat-operational-row]') !== null &&
          !row.dataset.operationalWindowKey?.includes('group-header') &&
          r.top >= box.top &&
          r.bottom <= box.bottom
        );
      },
    );
    if (!row) throw new Error('Missing history anchor');
    return { key: row.dataset.operationalWindowKey, top: row.getBoundingClientRect().top };
  });
  const older = Array.from({ length: 99 }, (_, index) => transcript(50, `older-${index}`)).flat();
  const finish = await timeline(page);
  try {
    const samples = [await snapshot(page, 'before-prepend')];
    expect(samples[0].mounted).toBeGreaterThan(1);
    const firstPrependFrame = await page.evaluate(() => window.rowScaleProbe.frames.length);
    await host.update({
      props: {
        liveMessages: [...older, ...tail],
        liveStreaming: true,
        detachedStatus: true,
        height: 700,
        width: 600,
      },
    });
    const anchors = await viewport.evaluate(async (node, expected) => {
      const offsets: (number | null)[] = [];
      for (let frame = 0; frame < 60; frame++) {
        await new Promise(requestAnimationFrame);
        const row = [...node.querySelectorAll<HTMLElement>('[data-operational-window-key]')].find(
          (row) => row.dataset.operationalWindowKey === expected.key,
        );
        offsets.push(row ? row.getBoundingClientRect().top - expected.top : null);
      }
      return offsets;
    }, anchor);
    samples.push(await snapshot(page, 'after-prepend'));
    await info.attach('history-prepend-anchor', {
      body: JSON.stringify({ messages: 200, rows: 5000, anchor, anchors, samples }),
      contentType: 'application/json',
    });
    const controls = await page.evaluate(
      (start) => window.rowScaleProbe.frames.slice(start),
      firstPrependFrame,
    );
    await info.attach('history-parent-controls', {
      body: JSON.stringify(controls),
      contentType: 'application/json',
    });
    expect(anchors.every((offset) => offset !== null && Math.abs(offset) <= 2)).toBe(true);
    expect(samples[1].mounted).toBeGreaterThan(0);
    expect(samples[1].mounted - samples[1].visible).toBeLessThanOrEqual(26);
    await viewport.click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('ControlOrMeta+f');
    await host
      .getByRole('search', { name: 'Find in panel' })
      .getByRole('textbox')
      .fill('needle-older-0-25.');
    await expect(host.getByText('Details needle-older-0-25.', { exact: true })).toBeVisible();
    await info.attach('history-search-observations', {
      body: JSON.stringify(await snapshot(page, 'history-search')),
      contentType: 'application/json',
    });
    await host.unmount();
    await frames(page, 2);
    const destroyed = await snapshot(page, 'history-destroyed');
    await info.attach('history-destroyed-observations', {
      body: JSON.stringify(destroyed),
      contentType: 'application/json',
    });
    expect(destroyed.unmatchedRegistrations).toBe(0);
    expect(destroyed.rowObserved).toBe(0);
    expect(destroyed.windowObserved).toBe(0);
    expect(controls.reduce((sum, frame) => sum + frame.actionBars, 0)).toBe(198);
    expect(Math.max(...controls.map((frame) => frame.actionBars))).toBeLessThanOrEqual(4);
    expect(Math.max(...controls.map((frame) => frame.tooltips))).toBeLessThanOrEqual(24);
  } finally {
    await finish(info, ['before-prepend', 'after-prepend', 'history-search', 'history-destroyed']);
  }
});
