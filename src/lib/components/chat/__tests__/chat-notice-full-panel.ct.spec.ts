import { expect, test } from '../../../../test/ct-test';
import type { Locator } from '@playwright/experimental-ct-svelte';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import ChatPanelComposerGeometryHost from './ChatPanelComposerGeometryHost.svelte';

test.setTimeout(120_000);

async function measureNotice(component: Locator) {
  // PanelLayout measures its initial width asynchronously. Separate protocol
  // calls (even Promise.all) can mix narrow prose with wide notice geometry.
  // Keep all related edges and typography in one synchronous browser read.
  return component.evaluate((root) => {
    const paragraphs = root.querySelectorAll(
      '[data-message-id="follow-up-assistant"] [data-assistant-prose] p',
    );
    const prose = paragraphs[paragraphs.length - 1];
    const notice = root.querySelector('[data-chat-notice]')!;
    const composer = root.querySelector('[data-testid="chat-composer-shell"]')!;
    const texts = [
      prose,
      ...notice.querySelectorAll('[data-chat-notice-label], [data-chat-notice-reason]'),
    ];
    const box = (node: Element) => {
      const { top, bottom } = node.getBoundingClientRect();
      return { top, bottom };
    };
    return {
      geometry: texts.map((node) => {
        const style = getComputedStyle(node);
        return {
          left: node.getBoundingClientRect().left,
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
        };
      }),
      noticeBox: box(notice),
      composerBox: box(composer),
      proseBox: box(prose),
    };
  });
}

function expectAligned(geometry: Awaited<ReturnType<typeof measureNotice>>['geometry']) {
  expect(geometry.length).toBeGreaterThanOrEqual(2);
  for (const text of geometry.slice(1)) {
    expect(text.left).toBeCloseTo(geometry[0].left, 1);
    expect(text.fontSize).toBe(geometry[0].fontSize);
    expect(text.lineHeight).toBe(geometry[0].lineHeight);
  }
}

const cases = [
  { name: 'active-blocker', followUp: 'blocker' },
  { name: 'active-discussion', followUp: 'discussion' },
  { name: 'history-blocker', historyNotice: 'blocker-report' },
  { name: 'history-discussion', historyNotice: 'discussion-request' },
  { name: 'failure', historyNotice: 'turn-failure' },
  { name: 'interruption', historyNotice: 'interruption' },
] as const;

for (const scenario of cases) {
  test(`notice matches prose in the full panel: ${scenario.name}`, async ({ mount, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 900, height: 640 });
    const component = await mount(ChatPanelComposerGeometryHost, {
      props: {
        theme: 'light',
        width: 900,
        ...('followUp' in scenario
          ? { followUp: scenario.followUp }
          : { historyNotice: scenario.historyNotice }),
      },
    });
    const notice = component.locator('[data-chat-notice]');
    await expect(notice).toBeVisible();
    await expect(component.locator('.tiptap-editor')).toBeEditable();
    await page.evaluate(() => document.fonts.ready);
    const scroll = component.getByTestId('chat-transcript-inner').locator('..');
    await scroll.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect
      .poll(() => scroll.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
      .toBeLessThanOrEqual(1);

    const { geometry, noticeBox, composerBox, proseBox } = await measureNotice(component);
    expectAligned(geometry);
    expect(noticeBox.top).toBeGreaterThanOrEqual(proseBox.bottom);
    expect(noticeBox.bottom).toBeLessThanOrEqual(composerBox.top);

    if ('historyNotice' in scenario) {
      const row = component.locator('[data-message-id="follow-up-notice"]');
      await expect(row).toHaveAttribute('data-message-role', 'system');
      await expect(row.getByTestId('message-actions')).toHaveCount(0);
    }
    const message = component.locator('[data-message-id="follow-up-assistant"]');
    const regenerate = message.getByRole('button', { name: 'Regenerate response', exact: true });
    await regenerate.focus();
    await expect(regenerate).toBeFocused();
    await expect(regenerate).toBeEnabled();
    await expect(regenerate.locator('svg')).toBeVisible();
    await expect(message.getByTestId('message-actions')).toHaveCSS('opacity', '1');
    await expect(message.getByRole('button', { name: 'Copy message', exact: false })).toBeVisible();

    const captureDir = process.env.CHAT_NOTICE_PANEL_CAPTURE_DIR;
    if (captureDir) {
      await mkdir(captureDir, { recursive: true });
      await component.screenshot({ path: join(captureDir, `${scenario.name}.png`) });
      await writeFile(join(captureDir, `${scenario.name}.json`), JSON.stringify(geometry, null, 2));
    }
  });
}

test('notice and prose stay aligned across the panel inset breakpoint', async ({
  mount,
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 900, height: 640 });
  const component = await mount(ChatPanelComposerGeometryHost, {
    props: { width: 500, followUp: 'discussion' },
  });
  await expect(component.locator('[data-chat-notice]')).toBeVisible();
  await expect(component.locator('.tiptap-editor')).toBeEditable();
  await page.evaluate(() => document.fonts.ready);
  const panelWidth = () =>
    component
      .getByTestId('chat-transcript-scroll-viewport')
      .evaluate((node) => node.getBoundingClientRect().width);
  await expect.poll(panelWidth).toBeLessThan(640);
  const narrow = await measureNotice(component);
  expect(narrow.geometry).toHaveLength(3);
  expectAligned(narrow.geometry);

  await component.update({ props: { width: 900 } });
  await expect.poll(panelWidth).toBeGreaterThan(640);
  const wide = await measureNotice(component);
  expect(wide.geometry).toHaveLength(3);
  expectAligned(wide.geometry);
  // Mixing the narrow prose sample with the wide notice recreates the false
  // mismatch. Neither coherent snapshot has an alignment defect.
  expect(wide.geometry[1].left - narrow.geometry[0].left).toBeGreaterThan(30);

  await component.update({ props: { width: 500 } });
  await expect.poll(panelWidth).toBeLessThan(640);
  const restored = await measureNotice(component);
  expectAligned(restored.geometry);
  expect(restored.geometry).toEqual(narrow.geometry);
  await testInfo.attach('responsive-notice-geometry', {
    body: JSON.stringify({ narrow, wide, restored }, null, 2),
    contentType: 'application/json',
  });
});
