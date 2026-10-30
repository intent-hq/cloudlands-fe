import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { test } from './root-browser-fixtures';
import { createServer, type ViteDevServer } from 'vite';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { viteHarnessCacheDir } from './vite-harness-cache.mjs';
import { prepareRootHarnessModules } from './root-harness-import';
import {
  INLINE_HTML_HARNESS_DOCUMENT,
  inlineHtmlHarnessDocument,
} from './inline-html-harness-document';
import { workflowClampDemo } from './fixtures/inline-html-workflow-demo';

let server: ViteDevServer | undefined;
let baseUrl = process.env.UI_PREVIEW_BASE_URL ?? '';
const artifacts = resolve('../../.intent/artifacts/inline-html/workflows');
const seasonsArtifacts = resolve('../../.intent/artifacts/inline-html/seasons-benchmark');
const appPolicy = readFileSync(resolve('src/app.html'), 'utf8').match(
  /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
)![1];
test.describe.configure({ timeout: 120_000 });
test.use({ trace: 'on' });
test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => console.error(error.message));
});
test.beforeAll(async ({}, workerInfo) => {
  if (process.env.UI_PREVIEW_BASE_URL) return;
  server = await createServer({
    cacheDir: viteHarnessCacheDir('inline-html-workflows', { workerIndex: workerInfo.workerIndex }),
    optimizeDeps: { entries: ['test/fixtures/InlineHtmlWorkflowHost.svelte'] },
    plugins: [inlineHtmlHarnessDocument()],
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
  demo: 'clamp' | 'seasons' | 'seasons-before' = 'clamp',
) {
  await page.setViewportSize({ width: width * viewers + (viewers - 1) * 16, height: 1100 });
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await prepareRootHarnessModules(
    page,
    `${baseUrl}/`,
    ['/@id/svelte', '/test/fixtures/InlineHtmlWorkflowHost.svelte'],
    { documentPath: server ? INLINE_HTML_HARNESS_DOCUMENT : undefined },
  );
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
    { width, height: 1080, theme, readFailure, mode, viewers, demo },
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
async function capture(page: Page, info: TestInfo, name: string, directory = artifacts) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  await mkdir(directory, { recursive: true });
  await copyFile(path, resolve(directory, `${name}.png`));
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

// Seasons benchmark. Expectations are independent facts about Earth's seasons
// (equinox ≈ 12 h everywhere, mirrored hemispheres, polar day and night, noon Sun
// height = 90° − |latitude − subsolar latitude|, Lambert's cosine law), never the
// fixture's own formulas.
type SeasonsSnapshot = {
  state: { day: number; latitude: number; tilt: number };
  inputs: Record<string, string | number>;
  results: Record<string, string | number>;
};
type SeasonsDate = 'mar-equinox' | 'jun-solstice' | 'sep-equinox' | 'dec-solstice';
type SeasonsInput = { date?: SeasonsDate; latitude?: number; tilt?: number };
const DAYLIGHT = 'Daylight (h)';
const HEIGHT = 'Noon Sun height (°)';
const SUNLIGHT = 'Sunlight on flat ground (% of overhead)';
const SEASON = 'Season';
const seasonsControl = (page: Page | Locator, name: 'day' | 'latitude' | 'tilt') =>
  frame(page).locator(`[data-seasons-control="${name}"]`);
async function seasonsSnapshot(page: Page): Promise<SeasonsSnapshot | undefined> {
  for (const file of (await inspect(page)).files) {
    if (!file.scope[1].endsWith('/state.json')) continue;
    const current = JSON.parse(file.content).current;
    if (current?.title === 'How seasons work') return current;
  }
  return undefined;
}
async function setSeasons(page: Page, input: SeasonsInput) {
  if (input.tilt !== undefined) await seasonsControl(page, 'tilt').fill(String(input.tilt));
  if (input.latitude !== undefined)
    await seasonsControl(page, 'latitude').fill(String(input.latitude));
  if (input.date) await frame(page).locator(`[data-seasons-date-preset="${input.date}"]`).click();
  const date = await frame(page).locator('[data-seasons-date]').textContent();
  await expect
    .poll(async () => {
      const snapshot = await seasonsSnapshot(page);
      return snapshot && [snapshot.inputs.Date, snapshot.state.latitude, snapshot.state.tilt];
    })
    .toEqual([date, input.latitude ?? expect.any(Number), input.tilt ?? expect.any(Number)]);
  return (await seasonsSnapshot(page))!;
}
function near(value: unknown, expected: number, tolerance: number, label: string) {
  expect(typeof value, label).toBe('number');
  expect(
    Math.abs((value as number) - expected),
    `${label}: ${value} ≈ ${expected}`,
  ).toBeLessThanOrEqual(tolerance);
}
const presetDates: Record<SeasonsDate, RegExp> = {
  'mar-equinox': /^Mar (19|20|21)$/,
  'jun-solstice': /^Jun (20|21|22)$/,
  'sep-equinox': /^Sep (22|23)$/,
  'dec-solstice': /^Dec (21|22)$/,
};

test('explains seasons consistently across dates, hemispheres, the equator, poles and tilt', async ({
  page,
}, info) => {
  await open(page, false, 'light', 1024, 'persistent', 1, 'seasons');
  type Results = SeasonsSnapshot['results'];
  const seen: Record<string, Results> = {};
  const cases: {
    name: string;
    input: SeasonsInput;
    shot?: boolean;
    check: (r: Results) => void;
  }[] = [
    {
      name: 'june-solstice-new-york',
      input: { date: 'jun-solstice', latitude: 40.7, tilt: 23.4 },
      shot: true,
      check: (r) => {
        near(r[DAYLIGHT], 14.95, 0.35, 'long northern summer day');
        near(r[HEIGHT], 90 - 40.7 + 23.4, 1, 'high summer Sun');
        expect(r[SEASON]).toBe('Summer');
      },
    },
    {
      name: 'june-solstice-mirrored-south',
      input: { latitude: -40.7 },
      check: (r) => {
        near(
          (r[DAYLIGHT] as number) + (seen['june-solstice-new-york'][DAYLIGHT] as number),
          24,
          0.05,
          'mirrored hemispheres share 24 h',
        );
        near(r[HEIGHT], 90 - 40.7 - 23.4, 1, 'low southern winter Sun');
        expect(r[SEASON]).toBe('Winter');
      },
    },
    {
      name: 'december-solstice-south',
      input: { date: 'dec-solstice' },
      check: (r) => {
        near(r[DAYLIGHT], seen['june-solstice-new-york'][DAYLIGHT] as number, 0.1, 'south summer');
        expect(r[SEASON]).toBe('Summer');
      },
    },
    {
      name: 'december-solstice-new-york',
      input: { latitude: 40.7 },
      check: (r) => {
        near(r[DAYLIGHT], 9.1, 0.35, 'short northern winter day');
        near(r[HEIGHT], 90 - 40.7 - 23.4, 1, 'low winter Sun');
        expect(r[SEASON]).toBe('Winter');
      },
    },
    {
      name: 'march-equinox-new-york',
      input: { date: 'mar-equinox' },
      check: (r) => {
        near(r[DAYLIGHT], 12, 0.15, 'equinox day');
        near(r[HEIGHT], 90 - 40.7, 1, 'equinox noon Sun');
      },
    },
    {
      name: 'september-equinox-sydney',
      input: { date: 'sep-equinox', latitude: -33.9 },
      check: (r) => near(r[DAYLIGHT], 12, 0.15, 'equinox day in the south'),
    },
    {
      name: 'equator-june',
      input: { date: 'jun-solstice', latitude: 0 },
      check: (r) => {
        near(r[DAYLIGHT], 12, 0.02, 'equator day');
        near(r[HEIGHT], 90 - 23.4, 1, 'equator noon Sun north of overhead');
      },
    },
    {
      name: 'equator-december',
      input: { date: 'dec-solstice' },
      check: (r) => near(r[DAYLIGHT], 12, 0.02, 'equator day'),
    },
    {
      name: 'polar-night-tromso',
      input: { latitude: 69.6 },
      shot: true,
      check: (r) => {
        expect(r[DAYLIGHT]).toBe(0);
        expect(r[HEIGHT] as number).toBeLessThan(0);
        expect(r[SUNLIGHT]).toBe(0);
      },
    },
    {
      name: 'polar-day-tromso',
      input: { date: 'jun-solstice' },
      check: (r) => expect(r[DAYLIGHT]).toBe(24),
    },
    {
      name: 'zero-tilt-new-york',
      input: { latitude: 40.7, tilt: 0 },
      shot: true,
      check: (r) => {
        near(r[DAYLIGHT], 12, 0.02, 'no tilt, no long days');
        near(r[HEIGHT], 90 - 40.7, 0.2, 'no tilt, same noon Sun all year');
        expect(r[SEASON]).toBe('No seasons');
      },
    },
    {
      name: 'zero-tilt-north-pole',
      input: { latitude: 90 },
      check: (r) => {
        expect(Number.isFinite(r[DAYLIGHT])).toBe(true);
        near(r[HEIGHT], 0, 0.2, 'Sun on the horizon at the pole');
      },
    },
    {
      name: 'extreme-tilt-moves-arctic-circle',
      input: { latitude: 50, tilt: 45 },
      check: (r) => expect(r[DAYLIGHT]).toBe(24),
    },
  ];
  const report: { name: string; inputs: unknown; results: Results }[] = [];
  for (const entry of cases) {
    const snapshot = await setSeasons(page, entry.input);
    const r = snapshot.results;
    seen[entry.name] = r;
    if (entry.input.date)
      expect(snapshot.inputs.Date, entry.name).toMatch(presetDates[entry.input.date]);
    entry.check(r);
    const height = r[HEIGHT] as number;
    near(r[SUNLIGHT], Math.max(0, 100 * Math.sin((height * Math.PI) / 180)), 1, 'cosine law');
    const text = (await frame(page).locator('body').innerText()) ?? '';
    expect(text, entry.name).not.toMatch(/NaN|Infinity|undefined/);
    const north = frame(page).locator('[data-seasons-hemisphere="north"]');
    const south = frame(page).locator('[data-seasons-hemisphere="south"]');
    const month = String(snapshot.inputs.Date).slice(0, 3);
    if (snapshot.state.tilt > 0 && (month === 'Jun' || month === 'Dec')) {
      await expect(north).toContainText(month === 'Jun' ? /summer/i : /winter/i);
      await expect(south).toContainText(month === 'Jun' ? /winter/i : /summer/i);
    }
    report.push({ name: entry.name, inputs: snapshot.inputs, results: r });
    if (entry.shot) await capture(page, info, `seasons-${entry.name}`, seasonsArtifacts);
  }
  const body = JSON.stringify(report, null, 2);
  await mkdir(seasonsArtifacts, { recursive: true });
  await writeFile(resolve(seasonsArtifacts, 'seasons-physics.json'), `${body}\n`);
  await info.attach('seasons-physics', { body, contentType: 'application/json' });
});

test('keeps seasons edits through keyboard, presets, theme, resize, reopening and draft handoff', async ({
  page,
}, info) => {
  await open(page, false, 'light', 1024, 'persistent', 1, 'seasons');
  const view = page.locator('[data-workflow-viewer="primary"]');
  const earth = frame(page).locator('[data-seasons-orbit-earth]');
  const date = frame(page).locator('[data-seasons-date]');
  await earth.focus();
  await earth.press('Home');
  await expect(date).toHaveText('Jan 1');
  await earth.press('ArrowRight');
  await expect(date).toHaveText('Jan 2');
  await expect(earth).toHaveAttribute('aria-valuetext', 'Jan 2');
  await earth.press('End');
  await expect(date).toHaveText('Dec 31');
  await earth.press('PageDown');
  await expect(date).not.toHaveText('Dec 31');
  await expect(seasonsControl(page, 'day')).toHaveValue(
    (await earth.getAttribute('aria-valuenow'))!,
  );
  await expect
    .poll(async () => (await seasonsSnapshot(page))?.inputs.Date)
    .toBe(await date.textContent());

  const place = frame(page).locator('[data-seasons-place]');
  await place.selectOption({ label: 'Sydney' });
  await expect(seasonsControl(page, 'latitude')).toHaveValue('-33.9');
  await place.selectOption({ label: 'Tromsø' });
  await expect(seasonsControl(page, 'latitude')).toHaveValue('69.6');
  await seasonsControl(page, 'latitude').fill('12.3');
  await expect(place).toHaveValue('custom');
  await place.selectOption({ label: 'London' });
  await setSeasons(page, { date: 'dec-solstice', latitude: 51.5, tilt: 23.4 });

  const paint = () =>
    frame(page)
      .locator('body')
      .evaluate(() => ({
        sun: getComputedStyle(document.querySelector('[data-seasons-sun]')!).fill,
        earth: getComputedStyle(document.querySelector('[data-seasons-earth]')!).fill,
        surface: getComputedStyle(document.body).backgroundColor,
      }));
  const light = await paint();
  await capture(page, info, 'seasons-light', seasonsArtifacts);
  const stateBefore = (await seasonsSnapshot(page))!.state;
  await seasonsControl(page, 'latitude').focus();
  await page.evaluate(() => (window as any).workflowHost.update({ theme: 'dark', width: 640 }));
  await expect.poll(async () => (await paint()).surface).not.toBe(light.surface);
  const dark = await paint();
  expect({ sun: dark.sun, earth: dark.earth }).toEqual({ sun: light.sun, earth: light.earth });
  expect((await seasonsSnapshot(page))!.state).toEqual(stateBefore);
  await expect(seasonsControl(page, 'latitude')).toHaveValue('51.5');
  await expect(seasonsControl(page, 'latitude')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(seasonsControl(page, 'latitude')).toHaveValue('51.6');
  await expect(place).toHaveValue('custom');
  await expect.poll(async () => (await seasonsSnapshot(page))?.state.latitude).toBe(51.6);
  await capture(page, info, 'seasons-dark-resized', seasonsArtifacts);

  const saved = (await seasonsSnapshot(page))!;
  await open(page, false, 'light', 1024, 'persistent', 1, 'seasons');
  await expect(seasonsControl(page, 'day')).toHaveValue(String(saved.state.day));
  await expect(seasonsControl(page, 'latitude')).toHaveValue(String(saved.state.latitude));
  await expect(seasonsControl(page, 'tilt')).toHaveValue(String(saved.state.tilt));
  await expect(frame(page).locator('[data-seasons-date]')).toHaveText(String(saved.inputs.Date));

  const editor = view.getByTestId('message-input').locator('.tiptap-editor');
  await editor.press('ControlOrMeta+a');
  await page.keyboard.insertText('Why does London get dark so early in December?');
  await view.getByRole('button', { name: 'Use this configuration', exact: true }).click();
  await expect(editor).toContainText('Why does London get dark so early in December?');
  await expect
    .poll(() => draftConfiguration(view))
    .toEqual({ inputs: saved.inputs, results: saved.results });
  const messages = JSON.parse((await page.getByTestId('stored-messages').textContent()) ?? '[]');
  expect(messages).toHaveLength(1);
  expect(messages[0].role).toBe('assistant');
  await capture(page, info, 'seasons-draft-handoff', seasonsArtifacts);
});

test('fits tall seasons content at narrow width and keeps the last control usable in a short viewport', async ({
  page,
}, info) => {
  await open(page, false, 'light', 360, 'persistent', 1, 'seasons');
  await page.setViewportSize({ width: 360, height: 2400 });
  await page.evaluate(() => (window as any).workflowHost.update({ width: 360, height: 2380 }));
  const layout = () =>
    frame(page)
      .locator('body')
      .evaluate(() => {
        const root = document.documentElement;
        const outside = (
          box: DOMRect,
          bounds: { left: number; right: number; top: number; bottom: number },
        ) =>
          box.left < bounds.left - 1 ||
          box.right > bounds.right + 1 ||
          box.top < bounds.top - 1 ||
          box.bottom > bounds.bottom + 1;
        const clippedLabels = [...document.querySelectorAll('svg text')]
          .filter((text) =>
            outside(text.getBoundingClientRect(), text.closest('svg')!.getBoundingClientRect()),
          )
          .map((text) => text.textContent);
        const bounds = { left: 0, right: root.clientWidth, top: 0, bottom: root.scrollHeight };
        const clippedControls = [
          ...document.querySelectorAll('input, select, button, output, label'),
        ]
          .filter((control) => outside(control.getBoundingClientRect(), bounds))
          .map((control) => control.textContent || control.getAttribute('aria-label'));
        return {
          content: root.scrollHeight,
          hiddenContent: root.scrollHeight - root.clientHeight,
          horizontalOverflow: root.scrollWidth - root.clientWidth,
          clippedLabels,
          clippedControls,
        };
      });
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((next) => (window as any).workflowHost.update({ theme: next }), theme);
    await expect.poll(async () => (await layout()).hiddenContent).toBeLessThanOrEqual(1);
    const measured = await layout();
    expect(measured.content).toBeGreaterThan(720);
    expect(measured.horizontalOverflow).toBeLessThanOrEqual(1);
    expect(measured.clippedLabels).toEqual([]);
    expect(measured.clippedControls).toEqual([]);
    await capture(page, info, `seasons-narrow-${theme}`, seasonsArtifacts);
  }
  await page.setViewportSize({ width: 360, height: 520 });
  await page.evaluate(() => (window as any).workflowHost.update({ height: 500, theme: 'light' }));
  const tilt = seasonsControl(page, 'tilt');
  await tilt.scrollIntoViewIfNeeded();
  await tilt.fill('0');
  await expect.poll(async () => (await seasonsSnapshot(page))?.results[SEASON]).toBe('No seasons');
  await tilt.focus();
  await tilt.press('ArrowRight');
  await expect(tilt).toHaveValue('0.1');
  await capture(page, info, 'seasons-short-viewport', seasonsArtifacts);
});

// Review evidence, not an A/B of renderers or prompts: both captures use the
// current renderer. "Before" is the original generated seasons source; "after"
// is the richer hand-authored benchmark.
test('captures the earlier generated seasons visual beside the benchmark for review', async ({
  page,
}, info) => {
  for (const theme of ['light', 'dark'] as const)
    for (const demo of ['seasons-before', 'seasons'] as const) {
      await open(page, false, theme, 1024, 'persistent', 1, demo);
      await page.setViewportSize({ width: 1024, height: 1700 });
      await page.evaluate(() => (window as any).workflowHost.update({ height: 1680 }));
      await expect(frame(page).locator('svg').first()).toBeVisible();
      await capture(
        page,
        info,
        `${demo === 'seasons' ? 'seasons-after' : 'seasons-before'}-${theme}`,
        seasonsArtifacts,
      );
    }
});
