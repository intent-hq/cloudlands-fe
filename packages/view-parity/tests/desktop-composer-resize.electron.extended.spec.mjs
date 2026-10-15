import { test, expect, chromium } from '@playwright/test';
import { readFile, writeFile, readlink, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

for (const kind of ['source', 'candidate']) {
  test(`${kind} native composer drag and double-click restore source sizing without sending`, async ({
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
    const composer = page
      .locator(source ? '[data-testid="message-input"]:visible' : '.desktop-text-composer:visible')
      .first();
    const input = composer.locator(source ? '[contenteditable=true]' : 'textarea');
    const handle = composer.getByRole('button', {
      name: 'Resize input area (double-click to reset)',
      exact: true,
    });
    const value = () =>
      input.evaluate((e) =>
        e instanceof window.HTMLTextAreaElement ? e.value : e.textContent === '' ? '' : e.innerText,
      );
    const draft = 'Resize preserves this ordinary draft café Ω.';
    const result = { kind, stages: [], errors };
    async function stage(name) {
      result.stages.push({
        name,
        composer: await composer.boundingBox(),
        handle: await handle.boundingBox(),
        input: await input.boundingBox(),
        value: await value(),
      });
    }
    async function drag(delta) {
      const box = await handle.boundingBox();
      // The source handle straddles an overflow-clipped edge; use its visible lower half.
      const x = box.x + box.width / 2,
        y = box.y + box.height - 3;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y - delta, { steps: 6 });
      await page.mouse.up();
    }
    try {
      if (!(await rows.count()))
        await page
          .getByRole('button', { name: /^Agents/ })
          .first()
          .click();
      await rows.filter({ hasText: 'Design review' }).click();
      await expect(input).toBeEnabled({ timeout: 30000 });
      expect(await value()).toBe('');
      await input.click();
      await expect(handle).toBeVisible();
      await stage('idle');
      await page.keyboard.insertText(draft);
      await expect.poll(value).toBe(draft);
      const original = await composer.boundingBox();
      await stage('authored');
      await drag(120);
      await expect
        .poll(async () => Math.abs((await composer.boundingBox()).height - original.height - 120))
        .toBeLessThanOrEqual(1);
      expect(await value()).toBe(draft);
      await stage('expanded');
      await page.mouse.move(1100, 250);
      await page.evaluate(() => document.fonts.ready);
      const geometry = await composer.boundingBox();
      const png = await stableLocatorScreenshot(page, page.locator('body'), async (a) => {
        if (a.png) await writeFile(info.outputPath(`${kind}-resize-${a.attempt}.png`), a.png);
      });
      expect(await composer.boundingBox()).toEqual(geometry);
      await writeFile(info.outputPath(`${kind}-resize.png`), png);
      await drag(-400);
      await expect.poll(async () => (await composer.boundingBox()).height).toBe(65);
      await stage('minimum');
      await handle.dblclick({ position: { x: 24, y: 13 } });
      await expect
        .poll(async () => Math.abs((await composer.boundingBox()).height - original.height))
        .toBeLessThanOrEqual(1);
      expect(await value()).toBe(draft);
      await stage('reset');
      await input.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await expect.poll(value).toBe('');
      await stage('cleared');
      result.after = read();
      expect(result.after).toEqual(before);
      expect(errors).toEqual([]);
    } finally {
      await writeFile(info.outputPath('resize-receipt.json'), JSON.stringify(result, null, 2));
      await browser.close();
    }
  });
}
