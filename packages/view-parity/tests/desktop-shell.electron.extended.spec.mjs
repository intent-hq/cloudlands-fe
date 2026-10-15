import { test, expect, chromium } from '@playwright/test';
import { readFile, writeFile, readlink, stat } from 'node:fs/promises';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

// Attaches only to an explicitly owned real Electron process. Fixture setup is separate.
test('desktop workspace shell retains, resizes, closes, reopens and reloads real notes', async ({
  browserName,
}, info) => {
  expect(browserName).toBe('chromium');
  test.setTimeout(120000);
  const manifest = process.env.OWNED_DESKTOP_SHELL_FIXTURE;
  if (!manifest) throw new Error('Requires an owned Electron/daemon fixture manifest');
  const f = JSON.parse(await readFile(manifest, 'utf8'));
  expect(Date.parse(f.expiresAt) - Date.now()).toBeGreaterThan(180000);
  expect(new URL(f.cdp).hostname).toBe('127.0.0.1');
  expect((await stat(`/proc/${f.mainPid}`)).uid).toBe(process.getuid());
  expect(await readlink(`/proc/${f.mainPid}/cwd`)).toBe(f.checkout);
  const command = await readFile(`/proc/${f.mainPid}/cmdline`, 'utf8');
  expect(command).toContain('Electron [Faithful React Desktop]');
  expect(await readlink(`/proc/${f.mainPid}/exe`)).toBe(f.electronExecutable);
  const browser = await chromium.connectOverCDP(f.cdp);
  const session = await browser.newBrowserCDPSession();
  const processInfo = await session.send('SystemInfo.getProcessInfo');
  expect(processInfo.processInfo.find((p) => p.type === 'browser')?.id).toBe(f.mainPid);
  await session.detach();
  const page = browser
    .contexts()[0]
    .pages()
    .find((p) => p.url().startsWith(f.base));
  expect(page).toBeTruthy();
  page.setDefaultTimeout(15000);
  const errors = await observeErrors(page),
    receipts = [],
    captures = [];
  const scope = page.locator(`[data-retained-workspace="${f.workspaceId}"]`);
  const snapshot = () =>
    page.evaluate(async (id) => {
      const { store } = await import(new URL('/src/store/index.ts', window.location.origin).href);
      return {
        layout: store.state.panelLayout.byWorkspaceId[id],
        persisted: Object.fromEntries(
          Object.entries(window.localStorage).filter(([k]) => k.includes(`panel-layout-${id}`)),
        ),
        retained: [...document.querySelectorAll('[data-retained-workspace]')].map((e) => ({
          id: e.getAttribute('data-retained-workspace'),
          inert: e.inert,
          visible: e.checkVisibility(),
        })),
      };
    }, f.workspaceId);
  const record = async (step) => {
    const state = await snapshot();
    receipts.push({ step, state });
    return state;
  };
  const count = async (n) =>
    expect.poll(async () => Object.keys((await snapshot()).layout.panels).length).toBe(n);
  const ready = async () => {
    await expect(scope).not.toHaveAttribute('inert', { timeout: 30000 });
    await expect(scope.getByTestId('rendered-note-preview')).toHaveCount(2, { timeout: 30000 });
    await expect(scope.getByTestId('rendered-note-preview').nth(1)).toContainText(f.secondText);
  };
  const settleFocus = async () => {
    await scope.locator('.desktop-panel-picker').last().click();
    await page.keyboard.press('Escape');
    await expect
      .poll(() =>
        scope
          .locator('[data-panel-id]')
          .last()
          .evaluate((e) => e.contains(document.activeElement)),
      )
      .toBe(true);
    await page.mouse.move(1500, 20);
  };
  const capture = async (name) => {
    await page.evaluate(() => document.fonts.ready);
    const geometry = () =>
      scope.evaluate((e) => ({
        bounds: e.getBoundingClientRect().toJSON(),
        panels: [...e.querySelectorAll('[data-panel-id]')].map((p) => ({
          id: p.getAttribute('data-panel-id'),
          bounds: p.getBoundingClientRect().toJSON(),
          focus: p.contains(document.activeElement),
        })),
      }));
    const before = await geometry();
    const attempts = [];
    const png = await stableLocatorScreenshot(page, page.locator('body'), async (attempt) => {
      if (attempt.png)
        await writeFile(info.outputPath(`${name}-${attempt.attempt}.png`), attempt.png);
      attempts.push({ ...attempt, png: attempt.png?.length });
    });
    const after = await geometry();
    expect(after).toEqual(before);
    await writeFile(info.outputPath(`${name}.png`), png);
    captures.push({ name, before, after, attempts });
  };
  try {
    await page.reload();
    await ready();
    expect(await page.evaluate(() => !!window.electronAPI)).toBe(true);
    const before = await record('initial');
    expect(
      Object.values(before.layout.panels)
        .flatMap((p) => p.tabs.map((t) => t.noteId))
        .sort(),
    ).toEqual([...f.noteIds].sort());
    const first = await scope.locator('[data-panel-id]').first().elementHandle();
    await settleFocus();
    await capture('normal');
    // The source's global focus shortcut works even inside a panel's editable control.
    await page.keyboard.press('Control+Shift+[');
    await expect
      .poll(async () => (await snapshot()).layout.focusedPanelId)
      .toBe(Object.keys(before.layout.panels)[0]);
    await page.keyboard.press('Control+Shift+]');
    // Real pointer drag, canonical resize, then reverse to the original layout.
    const divider = scope.locator('.desktop-resize-handle.horizontal').first();
    const bounds = await divider.boundingBox();
    const drag = async (from, to) => {
      await page.mouse.move(from, bounds.y + 200);
      await page.mouse.down();
      await page.mouse.move(to, bounds.y + 200, { steps: 8 });
      await page.mouse.up();
    };
    await drag(bounds.x + bounds.width / 2, bounds.x + bounds.width / 2 - 80);
    await expect
      .poll(async () => (await scope.locator('[data-panel-id]').first().boundingBox()).width)
      .toBeLessThan(550);
    await record('resized');
    await drag(bounds.x + bounds.width / 2 - 80, bounds.x + bounds.width / 2);
    // Open a real empty column with the source shortcut; closing it must retain the existing DOM.
    await settleFocus();
    await page.keyboard.press('Control+Backslash');
    await count(3);
    expect(await first.evaluate((e) => e.isConnected)).toBe(true);
    await page.keyboard.press('Control+w');
    await count(2);
    expect(await first.evaluate((e) => e.isConnected)).toBe(true);
    await settleFocus();
    await page.keyboard.press('Control+w');
    await count(1);
    await record('closed-note-column');
    await page.keyboard.press('Control+Shift+T');
    await count(2);
    expect(Object.keys((await snapshot()).layout.panels).sort()).toEqual(
      Object.keys(before.layout.panels).sort(),
    );
    await record('reopened-note-column');
    await ready();
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.locator('.desktop-home-row').filter({ hasText: f.otherTitle }).click();
    await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
    await page.waitForURL(`${f.base}/workspace/${f.otherWorkspaceId}`);
    await expect(scope).toHaveAttribute('inert');
    expect(await first.evaluate((e) => e.isConnected)).toBe(true);
    await page.keyboard.press('Control+Tab');
    await page.waitForURL(`${f.base}/workspace/${f.workspaceId}`);
    await ready();
    expect(await first.evaluate((e) => e.isConnected)).toBe(true);
    await record('retained-workspace-return');
    const otherClose = page.locator(`[data-workspace-tab-close="${f.otherWorkspaceId}"]`);
    await otherClose.hover();
    await otherClose.click();
    await expect(otherClose).toHaveCount(0);
    await page.keyboard.press('Control+Shift+T');
    await page.waitForURL(`${f.base}/workspace/${f.otherWorkspaceId}`);
    await page.keyboard.press('Control+Tab');
    await page.waitForURL(`${f.base}/workspace/${f.workspaceId}`);
    await otherClose.hover();
    await otherClose.click();
    await ready();
    await record('workspace-reopened');
    // Persistence is observed at the actual canonical storage boundary, never injected.
    await expect
      .poll(async () =>
        Object.values((await snapshot()).persisted).some((raw) => {
          const saved = JSON.parse(raw);
          return (
            Object.keys(saved.panels ?? {})
              .sort()
              .join() === Object.keys(before.layout.panels).sort().join()
          );
        }),
      )
      .toBe(true);
    const saved = await record('persisted');
    await page.reload();
    await ready();
    const reloaded = await record('reloaded');
    expect(Object.keys(reloaded.layout.panels).sort()).toEqual(
      Object.keys(saved.layout.panels).sort(),
    );
    expect(reloaded.layout.root).toEqual(saved.layout.root);
    await settleFocus();
    await capture('reloaded');
    expect(errors).toEqual([]);
  } finally {
    await writeFile(
      info.outputPath('desktop-shell-receipt.json'),
      JSON.stringify({ fixture: f, receipts, captures, errors }, null, 2),
    );
    await browser.close(); // disconnect CDP; process shutdown is the owner's separately recorded final step
  }
});
