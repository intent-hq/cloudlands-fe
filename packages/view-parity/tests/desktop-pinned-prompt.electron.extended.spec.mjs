import { test, expect, chromium } from '@playwright/test';
import { readFile, writeFile, readlink, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

for (const kind of ['source', 'candidate']) {
  test(`${kind} pinned prompt navigates to its real turn and releases on pane switch`, async ({
    browserName,
  }, info) => {
    expect(browserName).toBe('chromium');
    const f = JSON.parse(await readFile(process.env.OWNED_DESKTOP_CHAT_FIXTURE, 'utf8'));
    const app = f.apps.find((item) => item.kind === kind);
    expect(app).toBeTruthy();
    expect(Date.parse(f.expiresAt) - Date.now()).toBeGreaterThan(300000);
    expect((await stat(`/proc/${app.mainPid}`)).uid).toBe(process.getuid());
    expect(await readlink(`/proc/${app.mainPid}/cwd`)).toBe(app.checkout);
    expect(await readlink(`/proc/${app.mainPid}/exe`)).toBe(app.executable);
    expect(await readFile(`/proc/${app.mainPid}/cmdline`, 'utf8')).toContain(app.processTitle);
    const read = () =>
      JSON.parse(
        execFileSync(
          'python3',
          [
            f.rpcHelper,
            'rpc',
            'agent.getConversation',
            JSON.stringify({ workspaceId: f.workspaceId, agentId: f.agentId }),
          ],
          { encoding: 'utf8' },
        ),
      ).result;
    const before = read();
    expect(before.turnInFlight).toBe(false);
    const user = before.messages.findLast((m) => m.role === 'user');
    const prompt = user.contentBlocks.map((b) => b.text ?? '').join('');
    const browser = await chromium.connectOverCDP(app.cdp);
    const page = browser
      .contexts()[0]
      .pages()
      .find((p) => p.url().startsWith(app.base));
    const errors = await observeErrors(page);
    const source = kind === 'source';
    const rows = page.locator(
      source ? '[data-testid="agent-list-item"]' : '[data-agent-panel-row]',
    );
    const viewport = page.locator(
      source
        ? '[data-testid="chat-transcript-scroll-viewport"]:visible'
        : '.desktop-transcript-scroll:visible',
    );
    const pinned = page.getByTestId('pinned-user-prompt').filter({ visible: true });
    const result = { kind, userId: user.id, prompt, errors };
    try {
      if (!(await rows.count()))
        await page
          .getByRole('button', { name: /^Agents/ })
          .first()
          .click();
      await rows.filter({ hasText: 'Design review' }).click();
      await viewport.waitFor({ timeout: 30000 });
      await viewport.hover();
      await page.mouse.wheel(0, 30000);
      await expect(pinned).toBeVisible({ timeout: 30000 });
      await expect(
        page.getByTestId('pinned-user-prompt-text').filter({ visible: true }),
      ).toHaveText(prompt);
      result.pinned = await pinned.boundingBox();
      await pinned.focus();
      await page.keyboard.press('Enter');
      const original = page.locator(`[data-message-id="${user.id}"]:visible`);
      await expect
        .poll(async () => {
          const v = await viewport.boundingBox(),
            r = await original.boundingBox();
          return Math.abs(r.y - v.y);
        })
        .toBeLessThanOrEqual(1);
      await expect(pinned).toHaveCount(0);
      result.landed = {
        viewport: await viewport.boundingBox(),
        message: await original.boundingBox(),
      };
      await rows.filter({ hasText: 'Implementation notes' }).click();
      await expect(pinned).toHaveCount(0);
      await rows.filter({ hasText: 'Design review' }).click();
      // The retained prior pane can remain visible until canonical tab selection settles.
      await expect(original).toBeVisible({ timeout: 30000 });
      await viewport.hover();
      await page.mouse.wheel(0, 30000);
      await expect(pinned).toBeVisible();
      await expect(
        page.getByTestId('pinned-user-prompt-text').filter({ visible: true }),
      ).toHaveText(prompt);
      const input = page
        .locator(
          source
            ? '[data-testid="message-input"] [contenteditable=true]:visible'
            : '.desktop-conversation textarea:visible',
        )
        .first();
      await input.click();
      await page.mouse.move(1100, 250);
      await page.evaluate(() => document.fonts.ready);
      const beforeGeometry = {
        panel: await viewport.boundingBox(),
        pinned: await pinned.boundingBox(),
        input: await input.boundingBox(),
      };
      const png = await stableLocatorScreenshot(page, page.locator('body'), async (a) => {
        if (a.png) await writeFile(info.outputPath(`${kind}-pinned-${a.attempt}.png`), a.png);
      });
      expect({
        panel: await viewport.boundingBox(),
        pinned: await pinned.boundingBox(),
        input: await input.boundingBox(),
      }).toEqual(beforeGeometry);
      result.geometry = beforeGeometry;
      await writeFile(info.outputPath(`${kind}-pinned.png`), png);
      result.after = read();
      expect(result.after).toEqual(before);
      expect(errors).toEqual([]);
    } finally {
      await writeFile(info.outputPath('pinned-receipt.json'), JSON.stringify(result, null, 2));
      await browser.close();
    }
  });
}
