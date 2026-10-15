import { test, expect, chromium } from '@playwright/test';
import { readFile, writeFile, readlink, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

for (const kind of ['source', 'candidate']) {
  test(`${kind} Electron persisted tool rows expand and survive pane navigation without mutation`, async ({
    browserName,
  }, info) => {
    test.setTimeout(120000);
    expect(browserName).toBe('chromium');
    const f = JSON.parse(await readFile(process.env.OWNED_DESKTOP_TOOLS_FIXTURE, 'utf8'));
    const app = f.apps.find((item) => item.kind === kind);
    expect(Date.parse(f.expiresAt) - Date.now()).toBeGreaterThan(300000);
    expect((await stat(`/proc/${app.mainPid}`)).uid).toBe(process.getuid());
    expect(await readlink(`/proc/${app.mainPid}/cwd`)).toBe(app.checkout);
    expect(await readlink(`/proc/${app.mainPid}/exe`)).toBe(app.executable);
    expect(await readFile(`/proc/${app.mainPid}/cmdline`, 'utf8')).toContain(app.processTitle);
    const rpc = (method, params) =>
      JSON.parse(
        execFileSync('python3', [f.rpcHelper, 'rpc', method, JSON.stringify(params)], {
          encoding: 'utf8',
        }),
      ).result;
    const read = () =>
      rpc('agent.getConversation', { workspaceId: f.workspaceId, agentId: f.agentId });
    const before = read();
    expect(before).toEqual(f.canonical);
    expect(before.turnInFlight).toBe(false);
    const noteBefore = rpc('note.get', { workspaceId: f.workspaceId, noteId: f.note.id });
    const git = (...args) =>
      execFileSync('git', ['-C', f.repositoryPath, ...args], { encoding: 'utf8' });
    expect(git('rev-parse', 'HEAD').trim()).toBe(f.head);
    expect(git('ls-files', '--stage')).toBe(f.index);
    const browser = await chromium.connectOverCDP(app.cdp);
    const page = browser
      .contexts()[0]
      .pages()
      .find((p) => p.url().startsWith(app.base));
    page.setDefaultTimeout(15000);
    const errors = await observeErrors(page);
    const viewport = page.locator(
      '[data-testid=chat-transcript-scroll-viewport],[data-testid=desktop-transcript]',
    );
    const disclosures = page.locator('[data-testid=tool-call-disclosure]');
    const result = { kind, before, noteBefore, errors, captures: [], interactions: [] };
    const panelGeometry = () =>
      page.locator('.panel[data-panel-id],.desktop-panel').first().boundingBox();
    async function wheel(delta) {
      const box = await viewport.boundingBox();
      // Stay outside nested preformatted output scrollers. No DOM scroll injection.
      await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2);
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(120);
    }
    async function reveal(row) {
      for (let i = 0; i < 15; i++) {
        const view = await viewport.boundingBox(),
          box = await row.boundingBox();
        if (box && box.y >= view.y + 8 && box.y + box.height <= view.y + view.height - 8)
          return box;
        await wheel(box && box.y < view.y ? -350 : 350);
      }
      throw new Error('Tool row did not become visible through native transcript scrolling');
    }
    async function toggle(row, keyboard) {
      await reveal(row);
      await expect
        .poll(async () => {
          const before = await row.boundingBox();
          await page.waitForTimeout(100);
          return JSON.stringify(await row.boundingBox()) === JSON.stringify(before);
        })
        .toBe(true);
      const box = await reveal(row);
      const was = await row.getAttribute('aria-expanded');
      await page.mouse.click(box.x + box.width - 100, box.y + box.height / 2);
      await expect(row).toHaveAttribute('aria-expanded', String(was !== 'true'));
      if (keyboard) {
        await page.keyboard.press(keyboard);
        await expect(row).toHaveAttribute('aria-expanded', was);
        await expect(row).toBeFocused();
      }
    }
    async function capture(state) {
      await wheel(5000);
      await page.mouse.click(1200, 74);
      await page.mouse.move(700, 20);
      await page.evaluate(() => document.fonts.ready);
      const geometry = await panelGeometry();
      const attempts = [];
      const png = await stableLocatorScreenshot(page, page.locator('body'), async (attempt) => {
        if (attempt.png)
          await writeFile(info.outputPath(`${kind}-${state}-${attempt.attempt}.png`), attempt.png);
        attempts.push({ ...attempt, png: attempt.png?.length });
      });
      await writeFile(info.outputPath(`${kind}-${state}.png`), png);
      expect(await panelGeometry()).toEqual(geometry);
      result.captures.push({
        state,
        geometry,
        attempts,
        rows: await disclosures.evaluateAll((rows) =>
          rows.map((row) => ({
            id: row.getAttribute('data-tool-call-id'),
            expanded: row.getAttribute('aria-expanded'),
            text: row.textContent,
            rect: row.getBoundingClientRect().toJSON(),
          })),
        ),
      });
    }
    try {
      await expect(disclosures).toHaveCount(3);
      const toast = page.getByRole('button', { name: 'Close notification', exact: true });
      if (await toast.count()) await toast.click();
      const agentRows = page.locator(
        kind === 'source' ? '[data-testid=agent-list-item]' : '[data-agent-panel-row]',
      );
      if (!(await agentRows.count()))
        await page
          .getByRole('button', { name: /^Agents/ })
          .first()
          .click();
      await expect(agentRows.first()).toBeVisible();
      const initialPanel = await panelGeometry();
      for (let i = 0; i < 3; i++)
        if ((await disclosures.nth(i).getAttribute('aria-expanded')) === 'true')
          await toggle(disclosures.nth(i));
      await capture('collapsed');
      await toggle(disclosures.first(), 'Enter');
      await toggle(disclosures.first(), 'Space');
      for (let i = 0; i < 3; i++) await toggle(disclosures.nth(i));
      await expect(page.locator('[data-tool-detail-section]')).toHaveCount(4);
      const pre = page.locator('[data-tool-detail-section] pre');
      const text = await pre.allTextContents();
      expect(text[0]).toBe(JSON.stringify({ exit_code: 0 }, null, 2));
      const second = before.messages[3].contentBlocks;
      // The pinned source sanitizer folds whitespace in string values; no fixture secret keys.
      const presented = (value) =>
        JSON.stringify(
          JSON.parse(
            JSON.stringify(value, (_key, item) =>
              typeof item === 'string' ? item.replace(/\s+/g, ' ').trim() : item,
            ),
          ),
          null,
          2,
        );
      expect(text[2]).toBe(presented(second.find((block) => block.type === 'tool_use').input));
      expect(text[3]).toBe(presented(second.find((block) => block.type === 'tool_result').output));
      expect(await panelGeometry()).toEqual(initialPanel);
      await capture('expanded');
      const scrollBefore = await viewport.evaluate((element) => element.scrollTop);
      if (kind === 'source') {
        // The reference Context owner does not expose this newly created note.
        // Keep that recorded failure separate; exercise its real split/focus lifetime.
        await page.mouse.click(1200, 74);
        await page.keyboard.press('Control+Backslash');
        await expect(page.locator('.panel[data-panel-id]')).toHaveCount(2);
        const empty = page.locator('.panel[data-panel-id][data-empty-panel-shell="true"]');
        await expect(empty).toHaveCount(1);
        const emptyBox = await empty.boundingBox();
        await page.mouse.click(emptyBox.x + emptyBox.width / 2, emptyBox.y + 60);
        for (let i = 0; i < 3; i++)
          await expect(disclosures.nth(i)).toHaveAttribute('aria-expanded', 'true');
        await page.keyboard.press('Control+w');
        await expect(page.locator('.panel[data-panel-id]')).toHaveCount(1);
        result.interactions.push({
          splitFocusRejoin: true,
          notePanePrerequisite:
            'reference Context list empty; original note activation timeout retained',
        });
      } else {
        await page.getByRole('button', { name: 'Context', exact: true }).click();
        await page.getByRole('button', { name: f.note.title, exact: true }).click();
        await expect(page.getByText(f.note.content, { exact: true })).toBeVisible();
        await page
          .getByRole('button', { name: /^Agents/ })
          .first()
          .click();
        await page
          .locator('[data-agent-panel-row]')
          .filter({ hasText: 'Repository review' })
          .click();
        await expect(disclosures).toHaveCount(3);
        for (let i = 0; i < 3; i++)
          await expect(disclosures.nth(i)).toHaveAttribute('aria-expanded', 'true');
        await expect
          .poll(() => viewport.evaluate((element) => element.scrollTop))
          .toBe(scrollBefore);
        result.interactions.push({ paneReturnScroll: scrollBefore, expandedRetained: true });
      }
      // Source cold-reload readiness is an independently retained baseline failure.
      // Candidate reload is measured here without weakening the console guard.
      if (kind === 'candidate') {
        await page.reload();
        await expect(disclosures).toHaveCount(3, { timeout: 30000 });
        expect(await page.locator('[data-testid=tool-call-file-link]').innerText()).toBe(
          "greeting.txt'",
        );
        result.interactions.push({ reloaded: true });
      }
      expect(read()).toEqual(before);
      expect(rpc('note.get', { workspaceId: f.workspaceId, noteId: f.note.id })).toEqual(
        noteBefore,
      );
      expect(git('rev-parse', 'HEAD').trim()).toBe(f.head);
      expect(git('ls-files', '--stage')).toBe(f.index);
      for (const [path, expected] of Object.entries(f.expectedFiles))
        expect(
          createHash('sha256')
            .update(await readFile(`${f.repositoryPath}/${path}`))
            .digest('hex'),
        ).toBe(expected.sha256);
      expect(errors).toEqual([]);
    } finally {
      await writeFile(
        info.outputPath('tool-presentation-receipt.json'),
        JSON.stringify(result, null, 2),
      );
      await browser.close();
    }
  });
}
