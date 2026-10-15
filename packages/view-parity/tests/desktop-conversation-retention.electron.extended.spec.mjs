import { test, expect, chromium } from '@playwright/test';
import { readFile, writeFile, readlink, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

for (const kind of ['source', 'candidate']) {
  test(`${kind} Electron conversation retains authored draft across pane switch and reload`, async ({
    browserName,
  }, info) => {
    expect(browserName).toBe('chromium');
    test.setTimeout(120000);
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
    const browser = await chromium.connectOverCDP(app.cdp);
    const page = browser
      .contexts()[0]
      .pages()
      .find((p) => p.url().startsWith(app.base));
    expect(page).toBeTruthy();
    const errors = await observeErrors(page);
    const source = kind === 'source';
    const input = page
      .locator(
        source
          ? '[data-testid="message-input"] [contenteditable="true"]:visible'
          : '.desktop-conversation textarea:visible',
      )
      .first();
    const rows = page.locator(
      source ? '[data-testid="agent-list-item"]' : '[data-agent-panel-row]',
    );
    const value = () =>
      input.evaluate((e) =>
        e instanceof window.HTMLTextAreaElement ? e.value : e.textContent === '' ? '' : e.innerText,
      );
    const draft = `Retained ${kind} draft café Ω.\nSecond authored line.`;
    const result = { kind, beforeIds: before.messages.map((m) => m.id), draft, stages: [], errors };
    async function openRows() {
      if (!(await rows.count()))
        await page
          .getByRole('button', { name: /^Agents/ })
          .first()
          .click();
      await expect(rows.filter({ hasText: 'Design review' })).toBeVisible({ timeout: 30000 });
    }
    async function stage(name) {
      result.stages.push({
        name,
        url: page.url(),
        value: await value(),
        geometry: await input.boundingBox(),
        panels: await page.locator('.desktop-panel,.panel[data-panel-id]').count(),
      });
    }
    try {
      await openRows();
      await rows.filter({ hasText: 'Design review' }).click();
      await expect(input).toBeEnabled({ timeout: 30000 });
      expect(await value()).toBe('');
      await input.click();
      await page.keyboard.insertText(draft.split('\n')[0]);
      await page.keyboard.press('Shift+Enter');
      await page.keyboard.insertText(draft.split('\n')[1]);
      await expect.poll(value).toBe(draft);
      await stage('authored');
      await rows.filter({ hasText: 'Implementation notes' }).click();
      await expect(input).toBeEnabled({ timeout: 30000 });
      await expect.poll(value).toBe('');
      await rows.filter({ hasText: 'Design review' }).click();
      await expect.poll(value).toBe(draft);
      await stage('reopened');
      await page.reload();
      await expect(input).toBeEnabled({ timeout: 30000 });
      await expect.poll(value, { timeout: 30000 }).toBe(draft);
      await stage('reloaded');
      await openRows();
      await input.click();
      await page.mouse.move(1100, 250);
      await page.evaluate(() => document.fonts.ready);
      const geometry = await input.boundingBox();
      const png = await stableLocatorScreenshot(page, page.locator('body'), async (attempt) => {
        if (attempt.png)
          await writeFile(info.outputPath(`${kind}-retained-${attempt.attempt}.png`), attempt.png);
      });
      expect(await input.boundingBox()).toEqual(geometry);
      await writeFile(info.outputPath(`${kind}-retained.png`), png);
      // Clear only the draft authored by this case, through the public editor.
      expect(await value()).toBe(draft);
      await input.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await expect.poll(value).toBe('');
      await rows.filter({ hasText: 'Implementation notes' }).click();
      await rows.filter({ hasText: 'Design review' }).click();
      await expect.poll(value).toBe('');
      result.after = read();
      expect(result.after).toEqual(before);
      expect(errors).toEqual([]);
    } finally {
      await writeFile(info.outputPath('retention-receipt.json'), JSON.stringify(result, null, 2));
      await browser.close();
    }
  });
}
