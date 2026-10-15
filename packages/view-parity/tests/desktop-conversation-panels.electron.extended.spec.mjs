import { test, expect, chromium } from '@playwright/test';
import { readFile, writeFile, readlink, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

test('candidate conversation panes preserve drafts through split, resize, focus and reopen', async ({
  browserName,
}, info) => {
  expect(browserName).toBe('chromium');
  const f = JSON.parse(await readFile(process.env.OWNED_DESKTOP_CHAT_FIXTURE, 'utf8'));
  const app = f.apps.find((a) => a.kind === 'candidate');
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
  const errors = await observeErrors(page),
    steps = [],
    captures = [];
  const scope = page.locator(`[data-retained-workspace="${f.workspaceId}"]`);
  const panels = scope.locator('.desktop-panel[data-panel-id]');
  const snapshot = () =>
    page.evaluate(async (id) => {
      // Observe the exact mounted Vite module, including its HMR identity. Never initialize another Store.
      const entry = performance
        .getEntriesByType('resource')
        .find((e) => e.name.includes('/src/store/index.ts?'));
      if (!entry) throw new Error('Mounted Store module identity is unavailable');
      const { store } = await import(entry.name);
      return {
        layout: store.state.panelLayout.byWorkspaceId[id],
        persisted: Object.fromEntries(
          Object.entries(window.localStorage).filter(([k]) => k.includes(`panel-layout-${id}`)),
        ),
      };
    }, f.workspaceId);
  const record = async (step) => {
    const state = await snapshot();
    steps.push({ step, state });
    return state;
  };
  const capture = async (name) => {
    await page.mouse.move(1500, 20);
    await page.evaluate(() => document.fonts.ready);
    const geometry = () =>
      panels.evaluateAll((es) =>
        es.map((e) => ({ id: e.dataset.panelId, rect: e.getBoundingClientRect().toJSON() })),
      );
    const initial = await geometry();
    const png = await stableLocatorScreenshot(page, page.locator('body'), async (a) => {
      if (a.png) await writeFile(info.outputPath(`${name}-${a.attempt}.png`), a.png);
    });
    expect(await geometry()).toEqual(initial);
    await writeFile(info.outputPath(`${name}.png`), png);
    captures.push({ name, geometry: initial });
  };
  try {
    const rows = scope.locator('[data-agent-panel-row]');
    // Reuse known tabs through public close/open, because adjacent-open focuses an already open tab.
    await rows.filter({ hasText: 'Implementation notes' }).click();
    await expect(scope.locator('.desktop-panel-picker:visible')).toHaveText('Implementation notes');
    await scope.getByTestId('panel-close-button').click();
    await rows.filter({ hasText: 'Design review' }).click();
    const main = scope.locator(`.desktop-conversation[data-agent-id="${f.agentId}"]`);
    const input = main.locator('textarea:visible');
    await expect(input).toBeVisible({ timeout: 30000 });
    const retainedDraft = await input.inputValue();
    expect(['', 'Retained split draft café Ω']).toContain(retainedDraft);
    if (retainedDraft) {
      await input.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
    }
    await expect(input).toHaveValue('');
    await expect(panels).toHaveCount(1);
    const initial = await record('initial');
    const draft = 'Retained split draft café Ω';
    await input.click();
    await page.keyboard.type(draft);
    await expect(input).toHaveValue(draft);
    const retained = await main.elementHandle();
    await rows.filter({ hasText: 'Implementation notes' }).click({ modifiers: ['Control'] });
    await expect(panels).toHaveCount(2);
    const split = await record('split');
    const ids = Object.keys(split.layout.panels);
    await input.click();
    await page.keyboard.press('Control+Shift+]');
    await expect.poll(async () => (await snapshot()).layout.focusedPanelId).toBe(ids[1]);
    await page.keyboard.press('Control+Shift+[');
    await expect.poll(async () => (await snapshot()).layout.focusedPanelId).toBe(ids[0]);
    await expect(input).toHaveValue(draft);
    expect(await retained.evaluate((e) => e.isConnected)).toBe(true);
    const divider = scope.locator('.desktop-resize-handle.horizontal').first();
    const bounds = await divider.boundingBox();
    const width = (await panels.first().boundingBox()).width;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 200);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 - 60, bounds.y + 200, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(async () => Math.abs((await panels.first().boundingBox()).width - width))
      .toBeGreaterThan(20);
    await record('resized');
    await capture('split-draft');
    // Header X closes a tab; canonical reopen restores it into the surviving panel.
    const rightId = await panels.nth(1).getAttribute('data-panel-id');
    await scope.locator(`[data-panel-id="${rightId}"] [data-testid="panel-close-button"]`).click();
    await expect(panels).toHaveCount(1);
    await expect(input).toHaveValue(draft);
    await record('closed');
    await page.keyboard.press('Control+Shift+T');
    await expect
      .poll(async () =>
        Object.values((await snapshot()).layout.panels)
          .flatMap((p) => p.tabs)
          .some((t) => t.title === 'Implementation notes'),
      )
      .toBe(true);
    await record('reopened');
    await rows.filter({ hasText: 'Design review' }).click();
    await expect(input).toBeVisible();
    await expect(input).toHaveValue(draft);
    expect(await retained.evaluate((e) => e.isConnected)).toBe(true);
    await input.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await expect(input).toHaveValue('');
    await capture('restored');
    await record('final');
    expect(read()).toEqual(before);
    expect(errors).toEqual([]);
    expect(
      Object.values(initial.layout.panels)
        .flatMap((p) => p.tabs)
        .every((t) =>
          Object.values(steps.at(-1).state.layout.panels).some((p) =>
            p.tabs.some((n) => n.id === t.id),
          ),
        ),
    ).toBe(true);
  } finally {
    await writeFile(
      info.outputPath('panes-receipt.json'),
      JSON.stringify({ steps, captures, errors }, null, 2),
    );
    await browser.close();
  }
});
