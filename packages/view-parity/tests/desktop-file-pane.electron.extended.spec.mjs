import { test, expect, chromium } from '@playwright/test';
import { readFile, writeFile, readlink, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

async function owned() {
  const f = JSON.parse(await readFile(process.env.OWNED_DESKTOP_FILE_FIXTURE, 'utf8'));
  const app = f.apps.find((a) => a.kind === 'candidate');
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
  const browser = await chromium.connectOverCDP(app.cdp);
  const page = browser
    .contexts()[0]
    .pages()
    .find((p) => p.url().startsWith(app.base));
  page.setDefaultTimeout(15000);
  const engine = () =>
    page.evaluate(async (url) => {
      const { monaco } = await import(url);
      return {
        models: monaco.editor.getModels().map((m) => m.uri.toString()),
        editors: monaco.editor.getEditors().map((e) => ({
          uri: e.getModel()?.uri.toString(),
          position: e.getPosition(),
          selection: e.getSelection(),
          scroll: e.getScrollTop(),
          text: e.getValue(),
        })),
      };
    }, app.engine);
  const canonical = () =>
    page.evaluate(async (ws) => {
      const url = performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .find((n) => new URL(n).pathname.endsWith('/src/store/index.ts'));
      if (!url) throw Error('Mounted Store module provenance unavailable');
      const { store } = await import(url);
      return {
        files: store.state.files.byWorkspaceId[ws]?.files,
        operations: store.state.files.saveOperations,
        layout: store.state.panelLayout.byWorkspaceId[ws],
      };
    }, f.workspaceId);
  const verify = async (expected) => {
    expect(await readFile(`${f.repo}/src/example.ts`, 'utf8')).toBe(expected);
    expect(rpc('file.read', { workspaceId: f.workspaceId, path: 'src/example.ts' })).toBe(expected);
    expect(
      rpc('note.get', {
        workspaceId: f.workspaceId,
        noteId: f.noteBefore.id ?? f.noteBefore.note?.id,
      }),
    ).toEqual(f.noteBefore);
    expect(await readFile(`${f.repo}/sentinel.txt`, 'utf8')).toBe(
      f.originalFiles['sentinel.txt'].content,
    );
    expect(execFileSync('git', ['-C', f.repo, 'ls-files', '--stage'], { encoding: 'utf8' })).toBe(
      f.index,
    );
    expect(
      execFileSync('git', ['-C', f.repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    ).toBe(f.head);
    expect(
      execFileSync('git', ['-C', f.repo, 'diff', '--name-only'], { encoding: 'utf8' }).trim(),
    ).toBe('src/example.ts');
  };
  return { f, app, browser, page, engine, canonical, verify };
}

test('candidate existing text autosave, configured manual save and immediate close flush', async ({
  browserName,
}, info) => {
  test.setTimeout(90000);
  expect(browserName).toBe('chromium');
  if (process.env.OWNED_DESKTOP_FILE_WRITES !== 'owned-existing-file')
    throw Error('Explicit owned existing-file write scope required');
  const { f, browser, page, engine, canonical, verify } = await owned();
  let expected = f.startContent;
  await verify(expected);
  const errors = await observeErrors(page),
    receipt = { errors, steps: [], events: [] };
  await page.exposeBinding('__desktopFileInputEvidence', (_s, event) => receipt.events.push(event));
  await page.evaluate(() => {
    const listener = (e) => {
      if (
        e.target instanceof Element &&
        e.target.closest('[data-desktop-file],.desktop-panel-header')
      )
        window.__desktopFileInputEvidence({ type: e.type, key: e.key, trusted: e.isTrusted });
    };
    const contexts = [...document.querySelectorAll('.monaco-editor *')].flatMap((element) =>
      element.editContext ? [element.editContext] : [],
    );
    const textUpdate = (event) =>
      window.__desktopFileInputEvidence({
        type: event.type,
        trusted: event.isTrusted,
        text: event.text,
      });
    contexts.forEach((context) => context.addEventListener('textupdate', textUpdate));
    window.__desktopFileRemoveObserver = () => {
      ['keydown', 'input', 'click'].forEach((type) =>
        window.removeEventListener(type, listener, true),
      );
      contexts.forEach((context) => context.removeEventListener('textupdate', textUpdate));
    };
    ['keydown', 'input', 'click'].forEach((type) => window.addEventListener(type, listener, true));
  });
  const editor = page.locator('.monaco-editor').filter({ visible: true });
  try {
    await editor.waitFor();
    expect((await engine()).editors[0].position.lineNumber).toBe(12);
    const box = await editor.boundingBox();
    await page.mouse.click(box.x + 220, box.y + 220);
    await page.keyboard.press('Control+End');
    for (const [kind, text] of [
      ['autosave', '// React autosave café\n'],
      ['manual', '// React manual 雪\n'],
      ['close', '// React close flush\n'],
    ]) {
      await page.keyboard.insertText(text);
      expected += text;
      if (kind === 'manual') await page.keyboard.press('Control+s');
      if (kind === 'close')
        await page.getByTestId('panel-close-button').filter({ visible: true }).click();
      await expect.poll(() => readFile(`${f.repo}/src/example.ts`, 'utf8')).toBe(expected);
      await expect
        .poll(async () =>
          Object.values((await canonical()).operations?.map ?? {}).some((o) =>
            ['running', 'queued'].includes(o.status),
          ),
        )
        .toBe(false);
      receipt.steps.push({ kind, expected, canonical: await canonical(), engine: await engine() });
      await verify(expected);
    }
    expect((await engine()).models).toEqual([]);
    expect((await canonical()).files?.ids ?? []).toEqual([]);
    await page.keyboard.press('Control+Shift+t');
    await editor.waitFor();
    expect((await engine()).editors[0].text).toBe(expected);
    expect(receipt.events.some((e) => e.trusted && ['input', 'textupdate'].includes(e.type))).toBe(
      true,
    );
    expect(errors).toEqual([]);
    receipt.outcome = 'passed';
  } catch (error) {
    receipt.outcome = 'failed';
    receipt.error = String(error);
    throw error;
  } finally {
    receipt.finalDisk = await readFile(`${f.repo}/src/example.ts`, 'utf8');
    await page.evaluate(() => {
      window.__desktopFileRemoveObserver?.();
      delete window.__desktopFileRemoveObserver;
    });
    await writeFile(info.outputPath('file-write-receipt.json'), JSON.stringify(receipt, null, 2));
    await browser.close();
  }
});

test('candidate settled file retains cursor and model through panes and cleans up on close and reload', async ({
  browserName,
}, info) => {
  test.setTimeout(90000);
  expect(browserName).toBe('chromium');
  const { f, browser, page, engine, canonical, verify } = await owned();
  const expected = await readFile(`${f.repo}/src/example.ts`, 'utf8'),
    errors = await observeErrors(page),
    receipt = { errors, captures: [] };
  const editor = page.locator('.monaco-editor').filter({ visible: true });
  const capture = async (label) => {
    await expect(page.getByRole('menu')).toHaveCount(0);
    await page.waitForFunction(() =>
      document.getAnimations().every((animation) => animation.playState !== 'running'),
    );
    await page.mouse.click(1200, 74);
    await page.mouse.move(700, 20);
    await page.evaluate(() => document.fonts.ready);
    const geometry = await editor.boundingBox(),
      attempts = [];
    receipt.captures.push({ label, geometry, attempts });
    const png = await stableLocatorScreenshot(page, page.locator('body'), async (a) => {
      if (a.png) await writeFile(info.outputPath(`${label}-frame-${a.attempt}.png`), a.png);
      attempts.push({ ...a, png: a.png?.length });
    });
    expect(await editor.boundingBox()).toEqual(geometry);
    await writeFile(info.outputPath(`${label}.png`), png);
  };
  try {
    await page.keyboard.press('Escape');
    await editor.waitFor();
    await page.getByRole('button', { name: 'File reference', exact: true }).click();
    await page
      .getByTestId('rendered-note-preview')
      .getByRole('link', { name: 'Open example.ts' })
      .click();
    await editor.waitFor();
    await expect.poll(async () => (await engine()).editors[0]?.position.lineNumber).toBe(12);
    receipt.noteLink = await engine();
    const box = await editor.boundingBox();
    await page.mouse.click(box.x + 220, box.y + 200);
    await page.keyboard.press('Control+End');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Shift+Home');
    const before = await engine();
    await page.getByRole('button', { name: 'File reference', exact: true }).click();
    await expect(page.getByTestId('rendered-note-preview')).toBeVisible();
    await page.locator('.desktop-panel-picker').click();
    await page.getByRole('menuitem', { name: 'example.ts', exact: true }).click();
    await editor.waitFor();
    const after = await engine();
    expect(after.editors[0].uri).toBe(before.editors[0].uri);
    expect(after.editors[0].selection).toEqual(before.editors[0].selection);
    expect(after.editors[0].scroll).toBe(before.editors[0].scroll);
    receipt.retained = { before, after };
    await page.getByTestId('panel-actions-trigger').click();
    await page.getByRole('menuitemcheckbox', { name: 'Wrap lines', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByTestId('panel-actions-trigger').click();
    await page.getByRole('menuitemcheckbox', { name: 'Wrap lines', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByTestId('panel-actions-trigger').click();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Rename', exact: true })).toBeVisible();
    receipt.unportedAction = await page.getByRole('dialog').innerText();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await capture('settled');
    await page.reload();
    await editor.waitFor();
    expect((await engine()).editors[0].text).toBe(expected);
    expect((await engine()).models).toHaveLength(1);
    await page.getByTestId('panel-close-button').filter({ visible: true }).click();
    await expect.poll(async () => (await engine()).models.length).toBe(0);
    expect((await canonical()).files?.ids ?? []).toEqual([]);
    await page.keyboard.press('Control+Shift+t');
    await editor.waitFor();
    expect((await engine()).editors[0].text).toBe(expected);
    await verify(expected);
    expect(errors).toEqual([]);
    receipt.outcome = 'passed';
  } catch (error) {
    receipt.outcome = 'failed';
    receipt.error = String(error);
    throw error;
  } finally {
    await writeFile(
      info.outputPath('file-lifetime-receipt.json'),
      JSON.stringify(receipt, null, 2),
    );
    await browser.close();
  }
});
