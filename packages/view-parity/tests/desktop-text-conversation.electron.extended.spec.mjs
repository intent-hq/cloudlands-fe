import { test, expect, chromium } from '@playwright/test';
import { readFile, writeFile, readlink, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

// Real Electron, separate owned profiles, real provider. Setup never runs inside this journey.
test('source and React desktop text Send/Stop preserve ordinary input and canonical history', async ({
  browserName,
}, info) => {
  expect(browserName).toBe('chromium');
  test.setTimeout(240000);
  const path = process.env.OWNED_DESKTOP_CHAT_FIXTURE;
  if (!path) throw new Error('Requires an owned desktop chat fixture manifest');
  const f = JSON.parse(await readFile(path, 'utf8'));
  expect(Date.parse(f.expiresAt) - Date.now()).toBeGreaterThan(300000);
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
  const initial = read();
  expect(initial.turnInFlight).toBe(false);
  expect(initial.messages.map((m) => m.id)).toEqual(f.initialMessageIds);
  const receipts = [],
    captures = [];
  for (const app of f.apps) {
    expect(new URL(app.cdp).hostname).toBe('127.0.0.1');
    expect((await stat(`/proc/${app.mainPid}`)).uid).toBe(process.getuid());
    expect(await readlink(`/proc/${app.mainPid}/cwd`)).toBe(app.checkout);
    expect(await readlink(`/proc/${app.mainPid}/exe`)).toBe(app.executable);
    expect(await readFile(`/proc/${app.mainPid}/cmdline`, 'utf8')).toContain(app.processTitle);
    const browser = await chromium.connectOverCDP(app.cdp);
    const main = await browser.newBrowserCDPSession();
    expect(
      (await main.send('SystemInfo.getProcessInfo')).processInfo.find((p) => p.type === 'browser')
        .id,
    ).toBe(app.mainPid);
    await main.detach();
    const page = browser
      .contexts()[0]
      .pages()
      .find((p) => p.url().startsWith(app.base));
    expect(page).toBeTruthy();
    page.setDefaultTimeout(20000);
    const errors = await observeErrors(page);
    const source = app.kind === 'source';
    const input = page
      .locator(
        source
          ? '[data-testid="message-input"] [contenteditable="true"]'
          : '.desktop-conversation textarea',
      )
      .first();
    const stop = page.locator(
      source
        ? '[data-testid="composer-submit-button"][data-mode="stop"]'
        : '.desktop-composer-submit[aria-label="Stop streaming"]',
    );
    const body = page.locator(source ? '.assistant-message' : '[data-message-role="assistant"]');
    const content = () =>
      input.evaluate((e) => (e instanceof window.HTMLTextAreaElement ? e.value : e.innerText));
    const geometry = () =>
      page.evaluate(() => ({
        viewport: { width: window.innerWidth, height: window.innerHeight },
        panels: [...document.querySelectorAll('.desktop-panel,.panel[data-panel-id]')].map((e) => ({
          id: e.getAttribute('data-panel-id'),
          rect: e.getBoundingClientRect().toJSON(),
        })),
        input: document
          .querySelector('[data-testid="message-input"],.desktop-text-composer')
          ?.getBoundingClientRect()
          .toJSON(),
        focus: document.activeElement?.tagName,
      }));
    const capture = async (name) => {
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(1100, 250);
      const before = await geometry(),
        attempts = [];
      const png = await stableLocatorScreenshot(page, page.locator('body'), async (attempt) => {
        if (attempt.png)
          await writeFile(
            info.outputPath(`${app.kind}-${name}-${attempt.attempt}.png`),
            attempt.png,
          );
        attempts.push({ ...attempt, png: attempt.png?.length });
      });
      const after = await geometry();
      expect(after).toEqual(before);
      await writeFile(info.outputPath(`${app.kind}-${name}.png`), png);
      captures.push({ app: app.kind, name, before, after, attempts });
    };
    let submitted = false;
    try {
      await page.reload();
      await expect(body.filter({ hasText: f.existingReply }).first()).toBeVisible({
        timeout: 30000,
      });
      const notification = page.getByRole('button', { name: 'Close notification', exact: true });
      if (await notification.count()) await notification.click();
      if (source && !(await page.getByTestId('agent-list-item').count()))
        await page
          .getByRole('button', { name: /^Agents/ })
          .first()
          .click();
      await expect(input).toBeEnabled();
      expect(await page.evaluate(() => !!window.electronAPI)).toBe(true);
      await input.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      const draft = `Desktop ${app.kind} draft: café Ω.\nSecond line stays authored.`;
      await page.keyboard.insertText(draft.split('\n')[0]);
      await page.keyboard.press('Shift+Enter');
      await page.keyboard.insertText(draft.split('\n')[1]);
      await expect.poll(content).toBe(draft);
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.insertText('!');
      await expect.poll(content).toBe(draft.slice(0, -1) + '!' + draft.slice(-1));
      await capture('draft');
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      const prompt = `Desktop ${app.kind} Stop verification Ω. Reply with 1000 numbered lines, each saying only desktop response. Do not use tools or change any files.`;
      await page.keyboard.insertText(prompt);
      await expect.poll(content).toBe(prompt);
      const before = read();
      expect(before.turnInFlight).toBe(false);
      await page.keyboard.press('Enter');
      submitted = true;
      await expect(stop).toBeVisible();
      await expect
        .poll(
          async () =>
            body.evaluateAll(
              (elements, priorIds) =>
                elements.some((element) => {
                  const id = element.closest('[data-message-id]')?.getAttribute('data-message-id');
                  return (
                    id &&
                    !priorIds.includes(id) &&
                    element.textContent?.includes('desktop response')
                  );
                }),
              before.messages.map((message) => message.id),
            ),
          { timeout: 90000 },
        )
        .toBe(true);
      // Live output changes naturally: these are temporal observations, not a frozen raster claim.
      const active = { geometry: await geometry(), text: await body.last().innerText() };
      await page.screenshot({ path: info.outputPath(`${app.kind}-active-observation.png`) });
      await stop.click();
      await expect(stop).toHaveCount(0, { timeout: 30000 });
      await expect.poll(() => read().turnInFlight, { timeout: 30000 }).toBe(false);
      const after = read();
      expect(after.messages).toHaveLength(before.messages.length + 2);
      const [sent, response] = after.messages.slice(-2);
      expect(sent.role).toBe('user');
      expect(sent.contentBlocks.map((b) => b.text ?? '').join('')).toBe(prompt);
      expect(response.role).toBe('assistant');
      expect(response.metadata?.interrupted).toBe(true);
      expect(
        response.contentBlocks.some(
          (b) => b.type === 'text' && b.text.includes('desktop response'),
        ),
      ).toBe(true);
      await expect(page.getByTestId('stopped-indicator').last()).toBeVisible();
      await input.click();
      await capture('stopped');
      receipts.push({
        app: app.kind,
        prompt,
        active,
        beforeIds: before.messages.map((m) => m.id),
        sent,
        response,
        errors,
      });
      expect(errors).toEqual([]);
    } finally {
      // Finish only this test's own pending turn if an assertion interrupted Stop.
      if (submitted && (await stop.isVisible().catch(() => false))) await stop.click();
      await writeFile(
        info.outputPath('desktop-chat-receipt.json'),
        JSON.stringify({ initial, receipts, captures }, null, 2),
      );
      await browser.close();
    }
  }
});
