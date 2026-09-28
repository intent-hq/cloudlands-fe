import type { AgentMessage } from '$shared/types';
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
    contentBlocks: Array.from({ length: rows }, (_, i) => ({
      type: 'thinking' as const,
      id: `${prefix}-row-${i}`,
      text: `Scale reasoning ${i}\n\nDetails needle-${prefix}-${i}.`,
    })),
  },
];

test.beforeEach(async ({ page }) => instrument(page));
test.afterEach(async ({ page }, info) => {
  const probe = await page.evaluate(() => ({
    frames: window.rowScaleProbe.frames,
    longtasks: window.rowScaleProbe.longtasks,
  }));
  await info.attach('physical-mounts-and-longtasks', {
    body: JSON.stringify(probe),
    contentType: 'application/json',
  });
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
    const watched = host
      .getByTestId('scale-agent-subscriptions')
      .locator('[data-agent-id="chat-panel-operational-agent-alternate"]');
    await expect(watched).toBeVisible();
    await expect(host.locator('[data-message-id="watched-assistant"]')).toHaveCount(0);
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
      for (const sample of samples.slice(1))
        expect(sample.mounted - sample.visible).toBeLessThanOrEqual(26);
      await info.attach('watched-opening-samples', {
        body: JSON.stringify({ rows, samples }),
        contentType: 'application/json',
      });
    } finally {
      await finish(info);
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
        return r.top >= box.top && r.bottom <= box.bottom;
      },
    );
    if (!row) throw new Error('Missing history anchor');
    return { key: row.dataset.operationalWindowKey, top: row.getBoundingClientRect().top };
  });
  const older = Array.from({ length: 99 }, (_, index) => transcript(50, `older-${index}`)).flat();
  const finish = await timeline(page);
  try {
    const samples = [await snapshot(page, 'before-prepend')];
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
    expect(anchors.every((offset) => offset !== null && Math.abs(offset) <= 2)).toBe(true);
    expect(samples[1].mounted - samples[1].visible).toBeLessThanOrEqual(26);
    await viewport.click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('ControlOrMeta+f');
    await host
      .getByRole('search', { name: 'Find in panel' })
      .getByRole('textbox')
      .fill('needle-older-0-25.');
    await expect(host.getByText('Details needle-older-0-25.', { exact: true })).toBeVisible();
  } finally {
    await finish(info);
  }
});
