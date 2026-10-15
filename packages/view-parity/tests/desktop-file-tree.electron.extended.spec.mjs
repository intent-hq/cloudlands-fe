import { test, expect, chromium } from '@playwright/test';
import { readFile, writeFile, readlink, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

// Read-only genuine Electron/daemon fixture. No injected domain state or responses.
test('desktop Files tree opens existing text with source keyboard and retained workspace state', async ({
  browserName,
}, info) => {
  test.setTimeout(120000);
  expect(browserName).toBe('chromium');
  const f = JSON.parse(await readFile(process.env.OWNED_DESKTOP_TREE_FIXTURE, 'utf8'));
  const app = f.apps.find((a) => a.kind === 'candidate');
  expect(Date.parse(f.expiresAt) - Date.now()).toBeGreaterThan(300000);
  expect((await stat(`/proc/${app.mainPid}`)).uid).toBe(process.getuid());
  expect(await readlink(`/proc/${app.mainPid}/cwd`)).toBe(app.checkout);
  expect(await readlink(`/proc/${app.mainPid}/exe`)).toBe(app.executable);
  expect(await readFile(`/proc/${app.mainPid}/cmdline`, 'utf8')).toContain(app.processTitle);
  for (const [path, hash] of Object.entries(f.productHashes))
    expect(
      createHash('sha256')
        .update(await readFile(`${app.checkout}/${path}`))
        .digest('hex'),
    ).toBe(hash);
  const rpc = (method, params) =>
    JSON.parse(
      execFileSync('python3', [f.rpcHelper, 'rpc', method, JSON.stringify(params)], {
        encoding: 'utf8',
      }),
    ).result;
  const verify = async () => {
    for (const [path, hash] of Object.entries(f.files))
      expect(
        createHash('sha256')
          .update(await readFile(`${f.repo}/${path}`))
          .digest('hex'),
      ).toBe(hash);
    expect(
      execFileSync('git', ['-C', f.repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    ).toBe(f.head);
    expect(
      createHash('sha256')
        .update(await readFile(`${f.repo}/.git/index`))
        .digest('hex'),
    ).toBe(f.indexSha256);
    expect(execFileSync('git', ['-C', f.repo, 'status', '--porcelain'], { encoding: 'utf8' })).toBe(
      '',
    );
    expect(rpc('note.get', { workspaceId: f.workspaceId, noteId: f.noteBefore.note.id })).toEqual(
      f.noteBefore,
    );
  };
  await verify();
  const browser = await chromium.connectOverCDP(app.cdp);
  const page = browser
    .contexts()[0]
    .pages()
    .find((p) => p.url().startsWith(app.base));
  page.setDefaultTimeout(15000);
  const errors = await observeErrors(page),
    receipt = { errors, steps: [], events: [], pins: f.productHashes };
  const canonical = () =>
    page.evaluate(async (ws) => {
      const url = performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .find((n) => new URL(n).pathname.endsWith('/src/store/index.ts'));
      if (!url) throw Error('Mounted Store provenance unavailable');
      const { store } = await import(url);
      return {
        explorer: store.state.fileExplorer.byWorkspaceId[ws],
        layout: store.state.panelLayout.byWorkspaceId[ws],
        operations: store.state.files.saveOperations,
        generation: store.state.daemonHealth.connectionGeneration,
      };
    }, f.workspaceId);
  const card = () => page.locator('[data-desktop-files]:visible');
  const tree = () => card().getByRole('tree');
  const row = (name) => tree().getByRole('button', { name, exact: true });
  const capture = async (name) => {
    await page.mouse.move(700, 20);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => a.playState !== 'running'),
    );
    const frames = [];
    const png = await stableLocatorScreenshot(page, page.locator('body'), async (frame) => {
      frames.push({ ...frame, png: frame.png?.length });
      if (frame.png) await writeFile(info.outputPath(`${name}-${frame.attempt}.png`), frame.png);
    });
    await writeFile(info.outputPath(`${name}.png`), png);
    receipt.steps.push({
      name,
      canonical: await canonical(),
      frames,
      geometry: await card().evaluate((e) => ({
        card: e.getBoundingClientRect().toJSON(),
        tree: e.querySelector('[role=tree]')?.getBoundingClientRect().toJSON(),
        scroll: e.querySelector('[role=tree]')?.scrollTop,
      })),
    });
  };
  await page.exposeBinding('__desktopTreeObservedInput', (_s, event) => receipt.events.push(event));
  await page.evaluate(() => {
    const observe = (e) => {
      if (
        e.target instanceof Element &&
        e.target.closest('[data-desktop-files],.desktop-sidebar-dock,.desktop-workspace-tabs')
      )
        window.__desktopTreeObservedInput({ type: e.type, key: e.key, trusted: e.isTrusted });
    };
    ['click', 'keydown', 'input'].forEach((type) => window.addEventListener(type, observe, true));
    window.__desktopTreeRemoveObserver = () =>
      ['click', 'keydown', 'input'].forEach((type) =>
        window.removeEventListener(type, observe, true),
      );
  });
  try {
    await page.getByTestId('desktop-app-ready').waitFor();
    for (
      let closed = 0;
      closed < 8 && (await page.locator('[data-desktop-file]:visible').count());
      closed++
    )
      await page.getByTestId('panel-close-button').filter({ visible: true }).last().click();
    if (!(await card().count()))
      await page.getByRole('button', { name: 'Files', exact: true }).last().click();
    const collapse = card().getByRole('button', { name: 'Collapse all', exact: true });
    if (await collapse.count()) await collapse.click();
    await expect(row('src')).toHaveAttribute('aria-expanded', 'false');
    await capture('closed');
    await row('src').click();
    await row('main.ts').click();
    await expect(page.locator('[data-desktop-file="src/main.ts"]:visible')).toContainText(
      'Main café 雪',
    );
    await tree().press('Enter');
    await expect(page.getByRole('dialog')).toContainText('Rename');
    await page.keyboard.press('Escape');
    await tree().press('Space');
    await expect(page.locator('[data-desktop-file="src/main.ts"]:visible')).toContainText(
      'Main café 雪',
    );
    // Canonical navigation reuses an already open file; choose the unopened sibling.
    await tree().press('ArrowUp');
    await tree().press('Control+Enter');
    await expect(page.locator('.desktop-panel:visible')).toHaveCount(2);
    await tree()
      .getByRole('button', { name: /^packages(?:\/core(?:\/utils)?)?$/ })
      .click();
    await expect(row('packages/core/utils')).toHaveAttribute('aria-expanded', 'true');
    await row('format.ts').click();
    await expect(page.locator('[data-desktop-file]:visible').last()).toContainText('format');
    await card().getByRole('button', { name: 'Search files...', exact: true }).click();
    const input = card().getByRole('searchbox');
    await input.pressSequentially('index.ts');
    await expect(card().locator('[data-file-path]')).toHaveCount(2);
    await input.press('ArrowDown');
    await input.press('Enter');
    await expect(page.locator('[data-desktop-file]:visible').last()).toContainText('export');
    await input.press('Control+a');
    await input.pressSequentially('case-');
    await expect(card().locator('[data-file-path]')).toHaveCount(40);
    for (let index = 0; index < 30; index++) await input.press('ArrowDown');
    const revealed = await card().locator('[data-search-selected=true]').boundingBox();
    const viewport = await card().locator('.desktop-files-search-results').boundingBox();
    expect(revealed.y).toBeGreaterThanOrEqual(viewport.y);
    expect(revealed.y + revealed.height).toBeLessThanOrEqual(viewport.y + viewport.height);
    await expect(input).toBeFocused();
    await input.press('Escape');
    await row('src').click();
    if ((await row('src').getAttribute('aria-expanded')) !== 'true') await row('src').click();
    await row('examples').click();
    await tree().press('End');
    const scrolled = await tree().evaluate((e) => e.scrollTop);
    expect(scrolled).toBeGreaterThan(0);
    const before = (await canonical()).explorer.expandedPaths;
    await page.getByRole('button', { name: 'Context', exact: true }).last().click();
    await page.getByRole('button', { name: 'Files', exact: true }).last().click();
    expect((await canonical()).explorer.expandedPaths).toEqual(before);
    expect(await tree().evaluate((e) => e.scrollTop)).toBe(scrolled);
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByRole('button', { name: f.secondary.workspace.title, exact: false }).click();
    await page.getByRole('tab', { name: 'Atlas file tree', exact: false }).click();
    expect((await canonical()).explorer.expandedPaths).toEqual(before);
    expect(await tree().evaluate((e) => e.scrollTop)).toBe(scrolled);
    await card().getByRole('button', { name: 'Collapse all', exact: true }).click();
    await row('src').click();
    await row('main.ts').click();
    await page.mouse.click(1200, 74);
    await capture('open');
    await page.evaluate(() => window.__desktopTreeRemoveObserver?.());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('desktop-app-ready').waitFor();
    if (!(await card().count()))
      await page.getByRole('button', { name: 'Files', exact: true }).last().click();
    await expect(row('main.ts')).toBeVisible();
    await expect(page.locator('[data-desktop-file="src/main.ts"]:visible')).toContainText(
      'Main café 雪',
    );
    await capture('reloaded');
    expect(Object.keys((await canonical()).operations?.map ?? {})).toHaveLength(0);
    await verify();
    expect(receipt.events.some((e) => e.type === 'keydown' && e.trusted)).toBe(true);
    expect(receipt.events.some((e) => e.type === 'click' && e.trusted)).toBe(true);
    expect(errors).toEqual([]);
    receipt.outcome = 'passed';
  } catch (error) {
    receipt.outcome = 'failed';
    receipt.error = String(error);
    throw error;
  } finally {
    await page.evaluate(() => window.__desktopTreeRemoveObserver?.()).catch(() => {});
    await writeFile(info.outputPath('native-tree-evidence.json'), JSON.stringify(receipt, null, 2));
    await browser.close();
  }
});
