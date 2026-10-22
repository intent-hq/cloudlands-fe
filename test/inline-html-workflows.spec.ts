import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { test } from './root-browser-fixtures';
import { createServer, type ViteDevServer } from 'vite';
import { copyFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { viteHarnessCacheDir } from './vite-harness-cache.mjs';
import { workflowClampDemo } from './fixtures/inline-html-workflow-demo';

let server: ViteDevServer | undefined;
let baseUrl = process.env.UI_PREVIEW_BASE_URL ?? '';
const artifacts = resolve('../../.intent/artifacts/inline-html/workflows');
const appPolicy = readFileSync(resolve('src/app.html'), 'utf8').match(
  /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
)![1];
test.describe.configure({ timeout: 120_000 });
test.use({ trace: 'on' });
test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => console.error(error.message));
});
test.beforeAll(async () => {
  if (baseUrl) return;
  server = await createServer({
    cacheDir: viteHarnessCacheDir('inline-html-workflows'),
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  baseUrl = server.resolvedUrls?.local[0]?.replace(/\/$/, '') ?? '';
});
test.afterAll(async () => server?.close());

type Inspection = {
  files: { scope: [string, string]; content: string }[];
  requests: { method: string; workspaceId: string; path: string }[];
};
async function inspect(page: Page): Promise<Inspection> {
  return page.evaluate(() => (window as any).workflowHost.inspect());
}
async function fault(page: Page, read: boolean, write: boolean) {
  await page.evaluate(([r, w]) => (window as any).workflowHost.fault(r, w), [read, write]);
}
async function open(
  page: Page,
  readFailure = false,
  theme: 'light' | 'dark' = 'light',
  width = 1024,
  mode: 'persistent' | 'local-only' | 'remote-root' = 'persistent',
  viewers: 1 | 2 = 1,
) {
  await page.setViewportSize({ width: width * viewers + (viewers - 1) * 16, height: 1100 });
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.goto(`${baseUrl}/src/app.html`);
  await page.evaluate((policy) => {
    if (document.querySelector('meta[http-equiv="Content-Security-Policy"]')) return;
    const meta = document.createElement('meta');
    meta.httpEquiv = 'Content-Security-Policy';
    meta.content = policy;
    document.head.prepend(meta);
  }, appPolicy);
  await page.addStyleTag({ url: `${baseUrl}/src/app.css` });
  await page.evaluate(
    async (props) => {
      Object.assign(globalThis, { process: { env: { NODE_ENV: 'test' } } });
      const [{ mount }, { default: Host }] = await Promise.all([
        import('/@id/svelte'),
        import('/test/fixtures/InlineHtmlWorkflowHost.svelte'),
      ]);
      document.body.style.margin = '0';
      document.body.replaceChildren();
      Object.assign(window, {
        workflowHost: mount(Host, { target: document.body, props }),
      });
    },
    { width, height: 1080, theme, readFailure, mode, viewers },
  );
  await expect(page.locator('[data-inline-html]').first()).toBeVisible({ timeout: 90_000 });
  if (!readFailure)
    await expect(page.locator('[data-inline-html]').first()).toHaveAttribute(
      'data-inline-html-status',
      'ready',
    );
}
function frame(page: Page | Locator) {
  return page
    .locator('[data-inline-html] > div.relative > iframe')
    .contentFrame()
    .locator('iframe')
    .contentFrame();
}
const number = (page: Page, field: string) =>
  frame(page).locator(`[data-workflow-number="${field}"]`);
async function edit(page: Page, field: string, value: string) {
  await number(page, field).fill(value);
  await number(page, field).press('Tab');
}
async function savedState(page: Page) {
  const file = (await inspect(page)).files.find((file) => file.scope[1].endsWith('/state.json'));
  return file ? JSON.parse(file.content) : null;
}
async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  await mkdir(artifacts, { recursive: true });
  await copyFile(path, resolve(artifacts, `${name}.png`));
  await info.attach(name, { path, contentType: 'image/png' });
}

type Dimensions = { thickness: number; opening: number; rearClearance: number };
async function visibleConfiguration(view: Locator, dimensions: Dimensions, clearance: string) {
  for (const [field, value] of Object.entries(dimensions))
    await expect(frame(view).locator(`[data-workflow-number="${field}"]`)).toHaveValue(
      String(value),
    );
  await expect(frame(view).locator('[data-workflow-clearance]')).toHaveText(clearance);
}
async function editViewer(view: Locator, field: string, value: string) {
  const input = frame(view).locator(`[data-workflow-number="${field}"]`);
  await input.fill(value);
  await input.press('Tab');
}
async function draftConfiguration(view: Locator) {
  const text =
    (await view.getByTestId('message-input').locator('.tiptap-editor').textContent()) ?? '';
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  return JSON.parse(text.slice(start, end + 1).replaceAll('\u00a0', ' '));
}

for (const mode of ['local-only', 'remote-root'] as const) {
  test(`saves and restores scenarios without a local workspace root (${mode})`, async ({
    page,
  }, info) => {
    await open(page, false, 'light', 900, mode);
    const view = page.locator('[data-workflow-viewer="primary"]');
    await editViewer(view, 'thickness', '74');
    await visibleConfiguration(
      view,
      { thickness: 74, opening: 60, rearClearance: 40 },
      '14 mm over',
    );
    await view.getByRole('button', { name: 'Save scenario', exact: true }).click();
    const name = view.getByRole('textbox', { name: 'Scenario name' });
    await name.fill('Thick desk');
    await name.press('Tab');
    await editViewer(view, 'thickness', '20');
    await editViewer(view, 'opening', '90');
    await visibleConfiguration(
      view,
      { thickness: 20, opening: 90, rearClearance: 40 },
      '70 mm clearance',
    );
    await capture(page, info, `${mode}-scenario-divergence`);
    await view.getByRole('button', { name: 'Restore', exact: true }).click();
    await visibleConfiguration(
      view,
      { thickness: 74, opening: 60, rearClearance: 40 },
      '14 mm over',
    );
    await expect(name).toHaveValue('Thick desk');
    await expect(view.getByRole('button', { name: 'Export JSON', exact: true })).toHaveCount(0);
    if (mode === 'remote-root') {
      await view.getByRole('button', { name: 'Use this configuration', exact: true }).click();
      await expect
        .poll(() => draftConfiguration(view))
        .toEqual({
          inputs: {
            'Desk thickness (mm)': 74,
            'Clamp opening (mm)': 60,
            'Rear clearance (mm)': 40,
          },
          results: { 'Opening clearance (mm)': -14, Fit: 'Opening too small' },
        });
      const messages = JSON.parse(
        (await page.getByTestId('stored-messages').textContent()) ?? '[]',
      );
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('assistant');
    }
    await visibleConfiguration(
      view,
      { thickness: 74, opening: 60, rearClearance: 40 },
      '14 mm over',
    );
    expect(await inspect(page)).toEqual({ files: [], requests: [] });
    await capture(page, info, `${mode}-scenario-restored`);
  });
}

test('uses each simultaneous viewer’s visible configuration for save, draft handoff and export', async ({
  page,
}, info) => {
  await open(page, false, 'light', 760, 'persistent', 2);
  const primary = page.locator('[data-workflow-viewer="primary"]');
  const secondary = page.locator('[data-workflow-viewer="secondary"]');
  await expect(secondary.locator('[data-inline-html]')).toHaveAttribute(
    'data-inline-html-status',
    'ready',
  );
  const a = { thickness: 42, opening: 60, rearClearance: 40 };
  const b = { thickness: 74, opening: 80, rearClearance: 25 };
  await editViewer(primary, 'thickness', '42');
  await editViewer(secondary, 'thickness', '74');
  await editViewer(secondary, 'opening', '80');
  await editViewer(secondary, 'rearClearance', '25');
  const stableInputs = async () => {
    await visibleConfiguration(primary, a, '18 mm clearance');
    await visibleConfiguration(secondary, b, '6 mm clearance');
  };
  await stableInputs();
  await capture(page, info, 'simultaneous-viewers-divergence');
  await primary.getByRole('button', { name: 'Reload', exact: true }).click();

  const expected = [
    {
      view: primary,
      state: a,
      inputs: { 'Desk thickness (mm)': 42, 'Clamp opening (mm)': 60, 'Rear clearance (mm)': 40 },
      results: { 'Opening clearance (mm)': 18, Fit: 'Fits opening' },
    },
    {
      view: secondary,
      state: b,
      inputs: { 'Desk thickness (mm)': 74, 'Clamp opening (mm)': 80, 'Rear clearance (mm)': 25 },
      results: { 'Opening clearance (mm)': 6, Fit: 'Fits opening' },
    },
  ];
  for (const [index, config] of expected.entries()) {
    await config.view.getByRole('button', { name: 'Save scenario', exact: true }).click();
    await expect
      .poll(async () => (await savedState(page))?.scenarios[index]?.snapshot)
      .toMatchObject({
        state: config.state,
        inputs: config.inputs,
        results: config.results,
      });
    await stableInputs();
    const editor = config.view.getByTestId('message-input').locator('.tiptap-editor');
    const peer = expected[1 - index].view.getByTestId('message-input').locator('.tiptap-editor');
    await editor.press('ControlOrMeta+a');
    await page.keyboard.insertText(`Keep viewer ${index + 1}'s question.`);
    const peerDraft = await peer.textContent();
    await config.view.getByRole('button', { name: 'Use this configuration', exact: true }).click();
    await expect(editor).toContainText(`Keep viewer ${index + 1}'s question.`);
    await expect
      .poll(() => draftConfiguration(config.view))
      .toEqual({ inputs: config.inputs, results: config.results });
    await expect(peer).toHaveText(peerDraft ?? '');
    await stableInputs();
    const exportsBefore = (await inspect(page)).requests.filter(
      (request) =>
        request.method === 'write' && request.path.startsWith('.intent/artifacts/visuals/'),
    ).length;
    await config.view.getByRole('button', { name: 'Export JSON', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await inspect(page)).requests.filter(
            (request) =>
              request.method === 'write' && request.path.startsWith('.intent/artifacts/visuals/'),
          ).length,
      )
      .toBe(exportsBefore + 1);
    const exported = (await inspect(page)).files.find((file) =>
      file.scope[1].startsWith('.intent/artifacts/visuals/'),
    )!;
    const data = JSON.parse(exported.content);
    expect(data.record.current).toMatchObject({
      state: config.state,
      inputs: config.inputs,
      results: config.results,
    });
    expect(data.source).toBe(`${workflowClampDemo}\n`);
    await info.attach(`viewer-${index + 1}-export`, {
      body: exported.content,
      contentType: 'application/json',
    });
    await stableInputs();
    await capture(page, info, `simultaneous-viewer-${index + 1}-handoff`);
  }
  const files = (await inspect(page)).files;
  expect(files.filter((file) => file.scope[1].endsWith('/state.json'))).toHaveLength(1);
  expect(
    files.filter((file) => file.scope[1].startsWith('.intent/artifacts/visuals/')),
  ).toHaveLength(1);
  const messages = JSON.parse((await page.getByTestId('stored-messages').textContent()) ?? '[]');
  expect(messages).toHaveLength(1);
  expect(messages[0].role).toBe('assistant');
});

test('restores edited inputs and named alternatives after reopening, then exports the selected configuration', async ({
  page,
}, info) => {
  await open(page);
  await expect(frame(page).locator('[data-workflow-clearance]')).toHaveText('32 mm clearance');
  await edit(page, 'thickness', '42');
  await expect(frame(page).locator('[data-workflow-clearance]')).toHaveText('18 mm clearance');
  await page.getByRole('button', { name: 'Save scenario', exact: true }).click();
  await page.getByRole('textbox', { name: 'Scenario name' }).first().fill('Desk A');
  await page.getByRole('textbox', { name: 'Scenario name' }).first().press('Tab');
  await edit(page, 'opening', '80');
  await page.getByRole('button', { name: 'Save scenario', exact: true }).click();
  await page.getByRole('textbox', { name: 'Scenario name' }).nth(1).fill('Arm B');
  await page.getByRole('textbox', { name: 'Scenario name' }).nth(1).press('Tab');
  await expect
    .poll(async () => (await savedState(page))?.scenarios.map((entry: any) => entry.name))
    .toEqual(['Desk A', 'Arm B']);
  await capture(page, info, 'light-comparison');

  await open(page);
  await expect(number(page, 'thickness')).toHaveValue('42');
  await expect(number(page, 'opening')).toHaveValue('80');
  await expect(frame(page).locator('[data-workflow-clearance]')).toHaveText('38 mm clearance');
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Scenario name' }).first()).toHaveValue('Desk A');
  await page.getByRole('button', { name: 'Restore', exact: true }).first().click();
  await expect(number(page, 'opening')).toHaveValue('60');
  await expect(frame(page).locator('[data-workflow-clearance]')).toHaveText('18 mm clearance');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await inspect(page)).files.filter((file) =>
          file.scope[1].startsWith('.intent/artifacts/visuals/'),
        ).length,
    )
    .toBe(1);
  const exported = (await inspect(page)).files.find((file) =>
    file.scope[1].startsWith('.intent/artifacts/visuals/'),
  )!;
  const data = JSON.parse(exported.content);
  expect(data.record.current.state).toEqual({ thickness: 42, opening: 60, rearClearance: 40 });
  expect(data.record.scenarios.map((entry: any) => entry.snapshot.state.opening)).toEqual([60, 80]);
  expect(data.source).toBe(`${workflowClampDemo}\n`);
  await edit(page, 'thickness', '17');
  await frame(page)
    .locator('input[type="file"]')
    .setInputFiles({
      name: 'saved-configuration.json',
      mimeType: 'application/json',
      buffer: Buffer.from(exported.content),
    });
  await expect(number(page, 'thickness')).toHaveValue('42');
  await expect(frame(page).locator('[data-workflow-clearance]')).toHaveText('18 mm clearance');
  await page.getByRole('button', { name: 'Remove', exact: true }).nth(1).click();
  await expect.poll(async () => (await savedState(page))?.scenarios.length).toBe(1);
  expect(
    (await inspect(page)).requests.every(
      (request) => request.workspaceId === 'chat-panel-composer-geometry',
    ),
  ).toBe(true);
});

test('appends computed inputs and results to the existing draft without sending', async ({
  page,
}, info) => {
  await open(page);
  const editor = page.getByTestId('message-input').locator('.tiptap-editor');
  await expect(editor).toHaveText('Please compare this with the other arm.');
  await editor.press('ControlOrMeta+a');
  await page.keyboard.insertText('Keep my question and compare these dimensions.');
  await edit(page, 'thickness', '74');
  await expect(frame(page).locator('[data-workflow-clearance]')).toHaveText('14 mm over');
  await page.getByRole('button', { name: 'Use this configuration', exact: true }).click();
  await expect(editor).toContainText('Keep my question and compare these dimensions.');
  await expect(editor).toContainText('"inputs"');
  await expect(editor).toContainText('"results"');
  await expect(editor).toContainText('74');
  await expect(editor).toContainText('-14');
  const conversation = JSON.parse(
    (await page.getByTestId('stored-messages').textContent()) ?? '[]',
  );
  expect(conversation).toHaveLength(1);
  expect(conversation[0].role).toBe('assistant');
  await expect
    .poll(async () =>
      JSON.parse((await page.getByTestId('composer-draft-requests').textContent()) ?? '[]').some(
        (request: any) =>
          request.method === 'drafts.set' && request.params.text.includes('"results"'),
      ),
    )
    .toBe(true);
  await capture(page, info, 'configuration-in-draft');
});

test('supports dragging, keyboard editing and explicit validated CSV import', async ({
  page,
}, info) => {
  await open(page, false, 'dark', 720);
  const handle = frame(page).locator('[data-workflow-drag]');
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2 + 35, { steps: 8 });
  await page.mouse.up();
  const dragged = Number(await number(page, 'thickness').inputValue());
  expect(dragged).toBeGreaterThan(28);
  await handle.focus();
  await handle.press('ArrowUp');
  expect(Number(await number(page, 'thickness').inputValue())).toBeGreaterThan(dragged);
  await frame(page)
    .locator('input[type="file"]')
    .setInputFiles({
      name: 'invalid.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"thickness":"oops"}'),
    });
  await expect(frame(page).locator('[data-workflow-error]')).not.toHaveText('');
  await frame(page)
    .locator('input[type="file"]')
    .setInputFiles({
      name: 'desk.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('thickness,opening,rearClearance\n40,90,30\n'),
    });
  await expect(number(page, 'thickness')).toHaveValue('40');
  await expect(number(page, 'opening')).toHaveValue('90');
  await expect(frame(page).locator('[data-workflow-clearance]')).toHaveText('50 mm clearance');
  await expect
    .poll(async () => (await savedState(page))?.current.state)
    .toEqual({ thickness: 40, opening: 90, rearClearance: 30 });
  await capture(page, info, 'dark-direct-editing');
  await page.setViewportSize({ width: 360, height: 900 });
  await page.evaluate(() => (window as any).workflowHost.update({ width: 360, height: 880 }));
  await capture(page, info, 'narrow-direct-editing');
});

test('rejects malformed and oversized authored data and forged frame messages', async ({
  page,
}) => {
  await open(page);
  const results = await frame(page)
    .locator('body')
    .evaluate(() => {
      const api = (window as any).intentVisual;
      const good = { state: {}, title: 'Untrusted replacement', inputs: {}, results: {} };
      const cycle: any = {};
      cycle.self = cycle;
      window.top!.postMessage({ type: 'snapshot', channel: 'stale-channel', snapshot: good }, '*');
      window.parent.postMessage(
        { type: 'snapshot', channel: 'stale-channel', snapshot: good },
        '*',
      );
      return [
        api.publish({ ...good, state: cycle }),
        api.publish({ ...good, state: 'x'.repeat(70_000) }),
        api.publish({ ...good, state: { number: NaN } }),
        api.publish({ ...good, path: '../other-workspace.json' }),
        api.publish({ ...good, title: '' }),
      ];
    });
  expect(results).toEqual([false, false, false, false, false]);
  await expect
    .poll(async () => (await savedState(page))?.current.title)
    .toBe('Desk clamp dimensions');
  expect(
    (await inspect(page)).requests
      .filter((request) => request.method === 'write')
      .every((request) => /^\.intent\/visuals\/[a-f0-9]{64}\/state\.json$/.test(request.path)),
  ).toBe(true);
});

test('retries failed reads, saves and exports while retaining current edits', async ({
  page,
}, info) => {
  await open(page, true);
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await fault(page, false, false);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('[data-inline-html]')).toHaveAttribute(
    'data-inline-html-status',
    'ready',
  );
  await fault(page, false, true);
  await edit(page, 'thickness', '36');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(number(page, 'thickness')).toHaveValue('36');
  await capture(page, info, 'save-error-retains-edits');
  await fault(page, false, false);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect.poll(async () => (await savedState(page))?.current.state.thickness).toBe(36);
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(number(page, 'thickness')).toHaveValue('36');
  await fault(page, false, true);
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  await expect(page.locator('[data-inline-html]')).toContainText('Could not export');
  expect(
    (await inspect(page)).files.some((file) =>
      file.scope[1].startsWith('.intent/artifacts/visuals/'),
    ),
  ).toBe(false);
  await fault(page, false, false);
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await inspect(page)).files.filter((file) =>
          file.scope[1].startsWith('.intent/artifacts/visuals/'),
        ).length,
    )
    .toBe(1);
});
