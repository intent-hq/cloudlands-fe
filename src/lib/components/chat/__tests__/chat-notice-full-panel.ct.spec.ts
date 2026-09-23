import { expect, test } from '../../../../test/ct-test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import ChatPanelComposerGeometryHost from './ChatPanelComposerGeometryHost.svelte';

test.setTimeout(120_000);

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
    await page.evaluate(() => document.fonts.ready);
    const scroll = component.getByTestId('chat-transcript-inner').locator('..');
    await scroll.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect
      .poll(() => scroll.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
      .toBeLessThanOrEqual(1);

    const prose = component
      .locator('[data-message-id="follow-up-assistant"] [data-assistant-prose] p')
      .last();
    const texts = [
      prose,
      ...(await notice.locator('[data-chat-notice-label], [data-chat-notice-reason]').all()),
    ];
    const geometry = await Promise.all(
      texts.map((text) =>
        text.evaluate((node) => {
          const style = getComputedStyle(node);
          return {
            left: node.getBoundingClientRect().left,
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
          };
        }),
      ),
    );
    for (const text of geometry.slice(1)) {
      expect(text.left).toBeCloseTo(geometry[0].left, 1);
      expect(text.fontSize).toBe(geometry[0].fontSize);
      expect(text.lineHeight).toBe(geometry[0].lineHeight);
    }
    const noticeBox = (await notice.boundingBox())!;
    const composerBox = (await component.getByTestId('chat-composer-shell').boundingBox())!;
    const proseBox = (await prose.boundingBox())!;
    expect(noticeBox.y).toBeGreaterThanOrEqual(proseBox.y + proseBox.height);
    expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(composerBox.y);

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
