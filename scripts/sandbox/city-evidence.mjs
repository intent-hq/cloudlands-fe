#!/usr/bin/env node
// Run after implementation is complete, against an already running sandbox:
// node scripts/sandbox/city-evidence.mjs --base-url http://127.0.0.1:6024 --out .demo-artifacts/city
// Optional --case <exact-name[,exact-name]> repeats affected scenarios only.
// --skip-case <substring> excludes a group. No server is started here.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { buildSandboxUrl } from './runner.mjs';

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
}
const baseUrl = option('--base-url', process.env.CITY_BASE_URL);
if (!baseUrl) throw new Error('Pass --base-url for the existing sandbox server.');
const output = path.resolve(option('--out', '.demo-artifacts/city'));
const filter = option('--case', '');
const skip = option('--skip-case', '');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
const results = [];
const suiteStartedAt = new Date().toISOString();

async function scenario(name, action, { width = 1440, motion = 'reduced' } = {}) {
  if (filter && !filter.split(',').includes(name)) return;
  if (skip && name.includes(skip)) return;
  const context = await browser.newContext({
    viewport: { width, height: 960 },
    reducedMotion: motion === 'reduced' ? 'reduce' : 'no-preference',
  });
  if (name === 'scale-two-hundred') {
    await context.addInitScript(() => {
      window.__cityEvidenceDraws = 0;
      for (const type of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
        if (!type) continue;
        for (const method of [
          'drawArrays',
          'drawElements',
          'drawArraysInstanced',
          'drawElementsInstanced',
        ]) {
          const original = type.prototype[method];
          if (!original) continue;
          type.prototype[method] = function (...values) {
            window.__cityEvidenceDraws += 1;
            return original.apply(this, values);
          };
        }
      }
    });
  }
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const result = {
    name,
    startedAt: new Date().toISOString(),
    width,
    motion,
    status: 'passed',
    errors,
  };
  const shot = async (suffix = '') => {
    const filename = `${name}${suffix}.png`;
    if (await page.locator('[data-city-ready="true"]').count()) {
      await expect(page.locator('[data-city]')).toHaveAttribute('data-city-moving', 'false');
    }
    await page.screenshot({ path: path.join(output, filename), fullPage: true });
    (result.screenshots ??= []).push(filename);
  };
  const open = async (state = 'showcase', scene = 'home-city') => {
    const url = buildSandboxUrl(baseUrl, { scene, state, width, motion, theme: 'light' });
    result.url = url;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await expect(page.locator('[data-preview-ready="true"]')).toBeVisible({ timeout: 120_000 });
    if (scene === 'home-city') {
      await expect(page.locator('[data-city-ready="true"]')).toBeAttached({ timeout: 60_000 });
      await expect(page.locator('canvas[data-city-canvas]')).toBeVisible();
    }
  };
  try {
    await action({ page, open, shot, result });
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    await shot();
  } catch (error) {
    result.status = 'failed';
    result.error = error.stack ?? String(error);
    await shot('-failure').catch(() => {});
    process.exitCode = 1;
  } finally {
    result.finishedAt = new Date().toISOString();
    result.trace = `${name}.zip`;
    await context.tracing.stop({ path: path.join(output, result.trace) });
    await context.close();
    results.push(result);
    await writeFile(
      path.join(output, 'results.json'),
      JSON.stringify(
        {
          suiteStartedAt,
          command: process.argv,
          baseUrl,
          results,
        },
        null,
        2,
      ),
    );
    console.log(
      `${result.status}: ${name}${result.error ? ` — ${result.error.split('\n')[0]}` : ''}`,
    );
  }
}

const plots = (page) =>
  page.locator('[data-city-plot]').evaluateAll((nodes) =>
    nodes
      .map((node) => ({
        id: node.getAttribute('data-city-plot'),
        x: node.getAttribute('data-city-x'),
        z: node.getAttribute('data-city-z'),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
const selection = (page) =>
  page.locator('[data-city-selected]').first().getAttribute('data-city-selected');
const projection = (page) =>
  page
    .locator('[data-city-plot]')
    .first()
    .evaluate((node) => [node.style.left, node.style.top]);
const settled = (page) =>
  expect(page.locator('[data-city]')).toHaveAttribute('data-city-moving', 'false');
const blur = (page) =>
  page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });

try {
  await scenario('before-home-list', async ({ page, open }) => {
    await open('populated', 'home');
    await expect(
      page.getByText('Review the new onboarding flow', { exact: true }).first(),
    ).toBeVisible();
  });
  await scenario('after-home-city', async ({ page, open }) => {
    await open('city', 'home');
    await expect(page.locator('[data-city-ready="true"]')).toBeAttached({ timeout: 60_000 });
    await expect(page.locator('[data-city-building]')).toHaveCount(10);
  });
  await scenario('home-metric-provenance', async ({ page, open, shot }) => {
    await open('city-provenance', 'home');
    await expect(page.locator('[data-city-ready="true"]')).toBeAttached({ timeout: 60_000 });
    await blur(page);
    await page.keyboard.press('n');
    const inspector = page.locator('[data-city-selected]');
    await expect(inspector.locator('.city-metric')).toContainText('17 files changed');
    await expect(inspector.locator('.city-additions')).toHaveText('+101');
    await expect(inspector.locator('.city-deletions')).toHaveText('−9');
    await expect(inspector.locator('.city-metric-source')).toContainText('Pull request');
    await expect(inspector.locator('.city-metric-source')).not.toContainText('main');
    await expect(inspector.locator('.city-metric-source')).not.toContainText('unrelated-base');
    await shot('-pull-request');
    await page.keyboard.press('n');
    await expect(inspector.locator('.city-metric')).toContainText('81 files changed');
    await expect(inspector.locator('.city-metric-source')).toContainText(
      'Uncommitted changes · compared with HEAD',
    );
    await expect(inspector.locator('.city-additions, .city-deletions')).toHaveCount(0);
    await shot('-working-tree');
    await page.keyboard.press('n');
    await expect(inspector.locator('.city-metric')).toHaveText('Change size unavailable');
    await expect(inspector.locator('.city-additions, .city-deletions')).toHaveCount(0);
  });
  await scenario('empty-to-populated', async ({ page, open }) => {
    await open('empty-populate');
    await page.locator('canvas[data-city-canvas]').evaluate((canvas) => {
      canvas.dataset.originalInstance = 'true';
    });
    await blur(page);
    for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'])
      await page.keyboard.press(key);
    await page.getByRole('button', { name: 'Populate city', exact: true }).click();
    await expect(page.locator('[data-city-plot]')).toHaveCount(2);
    await expect(page.locator('canvas[data-city-canvas]')).toHaveAttribute(
      'data-original-instance',
      'true',
    );
    await settled(page);
    for (const value of await projection(page)) assert.ok(Number.isFinite(parseFloat(value)));
    await expect(page.locator('[data-city]')).toHaveAttribute('data-city-zoom', '1');
    await blur(page);
    await page.keyboard.press('n');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-city-opened]')).toHaveText('city-workspace-001');
  });
  await scenario('persisted-reservations', async ({ page, open }) => {
    await open('reserved-layout');
    await expect(page.locator('[data-city-reservations]')).toHaveText('2002');
    const active = page.locator('[data-city-plot="city-workspace-001"]');
    await expect(active).toHaveAttribute('data-city-x', '172.5');
    await expect(active).toHaveAttribute('data-city-z', '240');
    await page.getByRole('button', { name: 'Populate city', exact: true }).click();
    await expect(page.locator('[data-city-reservations]')).toHaveText('2003');
    await page.getByRole('button', { name: 'Reload saved layout', exact: true }).click();
    await expect(page.locator('[data-city-ready="true"]')).toBeAttached();
    await expect(page.locator('[data-city-reservations]')).toHaveText('2003');
    await expect(active).toHaveAttribute('data-city-x', '172.5');
    await expect(active).toHaveAttribute('data-city-z', '240');
    await expect(page.locator('[data-city-plot]')).toHaveCount(2);
    await blur(page);
    await page.keyboard.press('n');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-city-opened]')).toHaveText('city-workspace-001');
  });
  for (const [state, count] of Object.entries({
    empty: 0,
    one: 1,
    two: 2,
    three: 3,
    twelve: 12,
    thirteen: 13,
    fifty: 50,
    hundred: 100,
    'two-hundred': 200,
    'many-repositories': 200,
    skewed: 200,
    showcase: 10,
    'no-repository': 3,
    'long-titles': 10,
  })) {
    await scenario(`scale-${state}`, async ({ page, open, shot, result }) => {
      await open(state);
      await expect(page.locator('[data-city-building]')).toHaveCount(count);
      const positions = await plots(page);
      assert.equal(new Set(positions.map((plot) => plot.id)).size, count, 'Unique building IDs');
      for (const plot of positions) {
        assert.notEqual(plot.x, null, 'Stable x is exposed');
        assert.notEqual(plot.z, null, 'Stable z is exposed');
        assert.ok(Number.isFinite(Number(plot.x)) && Number.isFinite(Number(plot.z)));
      }
      assert.equal(
        new Set(positions.map((plot) => `${plot.x}:${plot.z}`)).size,
        count,
        'No overlapping plots',
      );
      result.plots = positions;
      if (state === 'two-hundred') {
        await settled(page);
        await shot('-overview');
        result.rendererAtRest = await page.locator('[data-city]').evaluate(async (root) => {
          const before = window.__cityEvidenceDraws;
          for (let index = 0; index < 12; index += 1) {
            await new Promise((resolve) => requestAnimationFrame(resolve));
          }
          return {
            buildings: root.querySelectorAll('[data-city-plot]').length,
            drawCalls: Number(root.getAttribute('data-city-draws')),
            triangles: Number(root.getAttribute('data-city-triangles')),
            moving: root.getAttribute('data-city-moving'),
            observedFrames: 12,
            additionalDraws: window.__cityEvidenceDraws - before,
          };
        });
        assert.equal(
          result.rendererAtRest.additionalDraws,
          0,
          'No GPU redraws while the city is at rest',
        );
        assert.equal(result.rendererAtRest.moving, 'false');
        assert.ok(
          result.rendererAtRest.triangles <= 1_000_000,
          'Overview stays within the geometry budget',
        );
      }
      if (count) {
        await page.getByRole('button', { name: 'Workspace index', exact: true }).click();
        await expect(page.locator('[data-city-index-building]')).toHaveCount(count);
        const last = page.locator('[data-city-index-building]').last();
        const lastId = await last.getAttribute('data-city-index-building');
        await last.click();
        await expect(page.locator('[data-city-selected]')).toHaveAttribute(
          'data-city-selected',
          lastId,
        );
        if (state === 'two-hundred') {
          await settled(page);
          await shot('-focused');
          result.rendererFocused = await page.locator('[data-city]').evaluate(async (root) => {
            const before = window.__cityEvidenceDraws;
            for (let index = 0; index < 12; index += 1) {
              await new Promise((resolve) => requestAnimationFrame(resolve));
            }
            return {
              selectedId: root
                .querySelector('[data-city-selected]')
                ?.getAttribute('data-city-selected'),
              drawCalls: Number(root.getAttribute('data-city-draws')),
              triangles: Number(root.getAttribute('data-city-triangles')),
              moving: root.getAttribute('data-city-moving'),
              observedFrames: 12,
              additionalDraws: window.__cityEvidenceDraws - before,
            };
          });
          assert.equal(result.rendererFocused.selectedId, lastId);
          assert.ok(
            result.rendererFocused.triangles <= 1_250_000,
            'Focused city stays within the geometry budget',
          );
          assert.equal(
            result.rendererFocused.additionalDraws,
            0,
            'Focused city stops drawing at rest',
          );
          assert.ok(
            result.rendererFocused.triangles > result.rendererAtRest.triangles,
            'Selection restores detailed building geometry',
          );
        }
        await page.keyboard.press('Home');
        await blur(page);
        await page.keyboard.press('n');
        await expect(page.locator('[data-city-selected]').first()).toHaveAttribute(
          'data-city-selected',
          /city-workspace-/,
        );
        await page.keyboard.press('Enter');
        await expect(page.locator('[data-city-opened]')).toHaveText(/city-workspace-/);
      }
    });
  }
  await scenario('search-and-stable-plots', async ({ page, open, shot }) => {
    await open();
    const initial = await plots(page);
    const search = page.getByRole('searchbox', { name: 'Search city workspaces' });
    await search.fill('Design system');
    await expect(page.locator('[data-city-plot][data-city-match="true"]')).toHaveCount(1);
    await expect(page.locator('[data-city-plot][data-city-match="false"]')).toHaveCount(9);
    assert.deepEqual(await plots(page), initial, 'Search preserves plot coordinates');
    await shot('-matching');
    await search.fill('no-such-workspace');
    await expect(page.locator('[data-city-plot][data-city-match="true"]')).toHaveCount(0);
    await shot('-zero');
    await page.getByRole('button', { name: 'Clear search', exact: true }).first().click();
    await expect(search).toHaveValue('');
    await expect(page.locator('[data-city-plot][data-city-match="true"]')).toHaveCount(10);
    await blur(page);
    for (let index = 0; index < 4; index += 1) await page.keyboard.press('n');
    await expect(page.locator('[data-city-selected] .city-metric')).toContainText(
      'Change size unavailable',
    );
    await page.getByRole('button', { name: 'Update metrics', exact: true }).click();
    await expect(page.locator('[data-city-selected] .city-metric')).toContainText(
      '250 files changed',
    );
    await expect(page.locator('[data-city-status]')).toHaveAttribute('data-status', 'complete');
    assert.deepEqual(
      await plots(page),
      initial,
      'Status and metric updates preserve plot coordinates',
    );
  });
  await scenario('keyboard-and-typing', async ({ page, open, shot }) => {
    await open();
    await blur(page);
    await page.keyboard.press('n');
    await expect(page.locator('[data-city-selected]')).toHaveCount(1);
    const first = await selection(page);
    assert.ok(first);
    await page.keyboard.press('n');
    await expect.poll(() => selection(page)).not.toBe(first);
    await page.keyboard.press('Shift+n');
    await expect.poll(() => selection(page)).toBe(first);
    await page.keyboard.press('f');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-city-opened]')).toHaveText(first);
    await page.keyboard.press('/');
    const search = page.getByRole('searchbox', { name: 'Search city workspaces' });
    await expect(search).toBeFocused();
    await search.pressSequentially('nf0/?+-');
    await expect(search).toHaveValue('nf0/?+-');
    await expect(search).toBeFocused();
    await expect(page.locator('[data-city-opened]')).toHaveText(first);
    await search.fill('');
    await blur(page);
    await page.keyboard.press('Home');
    await settled(page);
    await expect(page.locator('[data-city]')).toHaveAttribute('data-city-zoom', '1');
    const overviewProjection = await projection(page);
    await page.keyboard.press('+');
    await expect
      .poll(async () => Number(await page.locator('[data-city]').getAttribute('data-city-zoom')))
      .toBeGreaterThan(1);
    await settled(page);
    await page.keyboard.press('-');
    await expect
      .poll(async () => Number(await page.locator('[data-city]').getAttribute('data-city-zoom')))
      .toBeCloseTo(1);
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      const before = await projection(page);
      await page.keyboard.press(key);
      await expect.poll(() => projection(page)).not.toEqual(before);
      await settled(page);
    }
    await page.keyboard.press('0');
    await expect.poll(() => projection(page)).toEqual(overviewProjection);
    await settled(page);
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'City shortcuts' })).toBeVisible();
    await shot('-help');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });
  await scenario('metrics-unknown-zero-extreme', async ({ page, open, shot }) => {
    await open('metrics');
    await blur(page);
    for (const [suffix, metric] of [
      ['unknown', 'Change size unavailable'],
      ['zero', '0 files changed'],
      ['extreme', '1,000,000 files changed'],
    ]) {
      await page.keyboard.press('n');
      await expect(page.locator('[data-city-selected] .city-metric')).toContainText(metric);
      if (suffix !== 'unknown')
        await expect(page.locator('[data-city-selected]')).toContainText(
          'Uncommitted changes · compared with HEAD',
        );
      await shot(`-${suffix}`);
    }
  });
  await scenario('selection-removal-and-remount', async ({ page, open }) => {
    await open();
    await blur(page);
    await page.keyboard.press('n');
    await page.getByRole('button', { name: 'Remove first', exact: true }).click();
    await expect(page.locator('[data-city-building="city-workspace-001"]')).toHaveCount(0);
    await expect(page.locator('[data-city-selected="city-workspace-001"]')).toHaveCount(0);
    const positions = await plots(page);
    for (let index = 0; index < 3; index += 1) {
      await page.getByRole('button', { name: 'Remount city', exact: true }).click();
      await expect(page.locator('[data-city-ready="true"]')).toBeAttached();
      await expect(page.locator('canvas[data-city-canvas]')).toHaveCount(1);
      assert.deepEqual(await plots(page), positions, 'Retained layout survives remount');
      await blur(page);
      await page.keyboard.press('n');
      await page.keyboard.press('Enter');
      await expect(page.locator('[data-city-opened]')).toHaveText(/city-workspace-/);
    }
  });
  await scenario(
    'narrow-reduced-motion',
    async ({ page, open }) => {
      await open('long-titles');
      const indexToggle = page.getByRole('button', { name: 'Workspace index', exact: true });
      await expect(indexToggle.locator('svg')).toBeVisible();
      await indexToggle.click();
      await expect(page.locator('[data-city-index-building]')).toHaveCount(10);
      await page.locator('[data-city-index-building]').last().click();
      await expect(page.locator('[data-city-selected]')).toHaveCount(1);
      const box = await page.locator('[data-city]').boundingBox();
      assert.ok(box && box.width <= 390 && box.width > 0, 'City fits the narrow viewport');
      await blur(page);
      for (let index = 0; index < 12; index += 1) await page.keyboard.press('n');
      await page.keyboard.press('Enter');
      await expect(page.locator('[data-city-opened]')).toHaveText(/city-workspace-/);
    },
    { width: 390 },
  );
  await scenario(
    'pointer-drag',
    async ({ page, open }) => {
      await open();
      const canvas = await page.locator('canvas[data-city-canvas]').boundingBox();
      assert.ok(canvas);
      await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
      await page.mouse.down();
      await page.mouse.move(canvas.x + canvas.width / 2 + 110, canvas.y + canvas.height / 2 + 70, {
        steps: 8,
      });
      await page.mouse.up();
      await expect(page.locator('[data-city-opened]')).toHaveText('');
      await expect(page.locator('[data-city-selected]')).toHaveCount(0);
    },
    { motion: 'full' },
  );
  await scenario('gpu-context-loss', async ({ page, open, shot }) => {
    await open();
    const lost = await page.locator('canvas[data-city-canvas]').evaluate((canvas) => {
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      const extension = gl?.getExtension('WEBGL_lose_context');
      if (!extension) return false;
      extension.loseContext();
      return true;
    });
    assert.ok(lost, 'Browser supports real WebGL context loss');
    await expect(page.locator('[data-city]').getByRole('status')).toContainText(
      'The 3D view is unavailable',
    );
    await expect(page.locator('[data-city-index-building]')).toHaveCount(10);
    await shot('-fallback');
    await page.locator('[data-city]').getByRole('button', { name: /list/i }).first().click();
    await expect(page.locator('[data-city-list-requested]')).toHaveText('true');
    await page.getByRole('button', { name: 'Remount city', exact: true }).click();
    await expect(page.locator('[data-city-ready="true"]')).toBeAttached();
    await expect(page.locator('canvas[data-city-canvas]')).toHaveCount(1);
  });
} finally {
  await browser.close();
}
console.log(`Evidence: ${output}`);
