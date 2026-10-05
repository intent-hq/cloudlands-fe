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
    ...(name.startsWith('motion-')
      ? { recordVideo: { dir: output, size: { width: 1440, height: 960 } }, hasTouch: true }
      : {}),
  });
  if (name === 'scale-two-hundred' || name.startsWith('motion-')) {
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
  const shot = async (suffix = '', waitForRest = true) => {
    const filename = `${name}${suffix}.png`;
    if (waitForRest && (await page.locator('[data-city-ready="true"]').count())) {
      await expect(page.locator('[data-city]')).toHaveAttribute('data-city-moving', 'false');
    }
    await page.screenshot({ path: path.join(output, filename), fullPage: true });
    (result.screenshots ??= []).push(filename);
  };
  const open = async (state = 'showcase', scene = 'home-city', previewWidth = width) => {
    await page.setViewportSize({ width: previewWidth, height: 960 });
    const url = buildSandboxUrl(baseUrl, {
      scene,
      state,
      width: previewWidth,
      motion,
      theme: 'light',
    });
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
    const video = page.video();
    await context.close();
    if (video) {
      result.video = `${name}.webm`;
      await video.saveAs(path.join(output, result.video));
    }
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

const cameraAngles = (page) =>
  page.locator('[data-city]').evaluate((root) => ({
    yaw: Number(root.getAttribute('data-city-yaw')),
    elevation: Number(root.getAttribute('data-city-elevation')),
  }));
const angleDistance = (actual, expected) =>
  Math.max(
    Math.abs(Math.atan2(Math.sin(actual.yaw - expected.yaw), Math.cos(actual.yaw - expected.yaw))),
    Math.abs(actual.elevation - expected.elevation),
  );
const expectAngles = (page, expected) =>
  expect.poll(async () => angleDistance(await cameraAngles(page), expected)).toBeLessThan(0.0001);
const clouds = (page) =>
  page
    .locator('.city-atmosphere, .city-near-clouds')
    .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).transform));
async function idleDraws(page) {
  await settled(page);
  const draws = await page.evaluate(async () => {
    const start = window.__cityEvidenceDraws;
    for (let index = 0; index < 12; index += 1)
      await new Promise((resolve) => requestAnimationFrame(resolve));
    return window.__cityEvidenceDraws - start;
  });
  assert.equal(draws, 0, 'Camera and clouds stop scheduling GPU draws at rest');
  return draws;
}
async function canvasPoint(page) {
  const box = await page.locator('canvas[data-city-canvas]').boundingBox();
  assert.ok(box);
  return { x: box.x + box.width * 0.5, y: box.y + box.height * 0.45 };
}
async function dragCamera(page, { button = 'left', shift = false, release = true } = {}) {
  const point = await canvasPoint(page);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(point.x, point.y);
  await page.mouse.down({ button });
  await page.mouse.move(point.x + 130, point.y + 45, { steps: 12 });
  if (release) await page.mouse.up({ button });
  if (shift) await page.keyboard.up('Shift');
}
async function cloudCoverage(page) {
  const covered = await page.locator('[data-city]').evaluate((root) => {
    const viewport = root.getBoundingClientRect();
    return [...root.querySelectorAll('.city-atmosphere, .city-near-clouds')].map((node) => {
      const box = node.getBoundingClientRect();
      return (
        box.left <= viewport.left + 1 &&
        box.right >= viewport.right - 1 &&
        box.top <= viewport.top + 1 &&
        box.bottom >= viewport.bottom - 1
      );
    });
  });
  assert.equal(covered.length, 2);
  assert.ok(covered.every(Boolean), 'Both cloud layers cover the viewport at zoom extremes');
}

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

  await scenario(
    'motion-drag-parallax',
    async ({ page, open, shot, result }) => {
      await open();
      await settled(page);
      const angles = await cameraAngles(page),
        initialClouds = await clouds(page),
        initialProjection = await projection(page);
      await shot('-before');
      await dragCamera(page, { release: false });
      await expect.poll(() => cameraAngles(page)).not.toEqual(angles);
      await expect.poll(() => clouds(page)).not.toEqual(initialClouds);
      assert.notDeepEqual(await projection(page), initialProjection, 'Plain drag rotates the city');
      const rotated = await cameraAngles(page);
      assert.ok(
        Math.abs(rotated.yaw - angles.yaw) > 0.3 &&
          Math.abs(rotated.elevation - angles.elevation) > 0.05,
        'Plain drag deliberately changes both rotation and tilt',
      );
      const depths = await page
        .locator('.city-atmosphere, .city-near-clouds')
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            const matrix = new window.DOMMatrix(getComputedStyle(node).transform);
            return { x: matrix.m41, y: matrix.m42 };
          }),
        );
      assert.ok(
        Math.abs(depths[1].x) > Math.abs(depths[0].x),
        'Near clouds move more than distant clouds',
      );
      assert.ok(depths[1].x * depths[0].x > 0, 'Cloud layers follow the same camera movement');
      await shot('-during', false);
      await page.mouse.up();
      await settled(page);
      await expectAngles(page, rotated);
      await expect(page.locator('[data-city-selected]')).toHaveCount(0);
      await expect(page.locator('[data-city-opened]')).toHaveText('');
      await shot('-after');
      const label = page.locator('[data-city-building][aria-hidden="false"]').first();
      const id = await label.getAttribute('data-city-building');
      await label.click();
      await expect(page.locator('[data-city-selected]')).toHaveAttribute('data-city-selected', id);
      result.idleDraws = await idleDraws(page);
    },
    { motion: 'full' },
  );
  await scenario(
    'motion-orbit-keyboard',
    async ({ page, open, shot, result }) => {
      await open();
      await settled(page);
      const original = await cameraAngles(page);
      await dragCamera(page);
      await settled(page);
      const rotated = await cameraAngles(page);
      assert.notDeepEqual(rotated, original, 'Plain drag keeps the chosen angle');
      for (const control of [{ shift: true }, { button: 'right' }, { button: 'middle' }]) {
        const beforePan = await projection(page);
        const beforeClouds = await clouds(page);
        await dragCamera(page, control);
        await expect.poll(() => projection(page)).not.toEqual(beforePan);
        await expect.poll(() => clouds(page)).not.toEqual(beforeClouds);
        await expectAngles(page, rotated);
        await expect(page.locator('[data-city-selected]')).toHaveCount(0);
      }
      await blur(page);
      for (const key of ['q', 'e', 'Shift+ArrowLeft', 'Shift+ArrowUp']) {
        const before = await cameraAngles(page);
        await page.keyboard.press(key);
        await expect.poll(() => cameraAngles(page)).not.toEqual(before);
        await settled(page);
      }
      const chosen = await cameraAngles(page);
      for (const key of ['n', 'f']) {
        await page.keyboard.press(key);
        await settled(page);
        await expectAngles(page, chosen);
      }
      const beforePan = await projection(page);
      await page.keyboard.press('ArrowLeft');
      await expect.poll(() => projection(page)).not.toEqual(beforePan);
      await expectAngles(page, chosen);
      await shot('-orbited');
      const search = page.getByRole('searchbox', { name: 'Search city workspaces' });
      await search.fill('');
      await search.pressSequentially('qer');
      await expect(search).toHaveValue('qer');
      await expectAngles(page, chosen);
      await search.fill('');
      await blur(page);
      for (let turn = 0; turn < 55; turn += 1) await page.keyboard.press('e');
      await settled(page);
      await page.keyboard.press('r');
      await settled(page);
      await expectAngles(page, original);
      await page.keyboard.press('e');
      await settled(page);
      await page.keyboard.press('0');
      await settled(page);
      await expectAngles(page, original);
      await expect(page.locator('[data-city]')).toHaveAttribute('data-city-zoom', '1');
      result.idleDraws = await idleDraws(page);
      await open('one');
      await settled(page);
      const roof = await page.locator('[data-city-plot]').evaluate((node) => {
        const viewport = node.closest('[data-city]').getBoundingClientRect();
        return {
          x: viewport.left + parseFloat(node.style.left),
          y: viewport.top + parseFloat(node.style.top) + 45,
        };
      });
      assert.ok(
        await page.evaluate(
          ({ x, y }) => document.elementFromPoint(x, y)?.matches('canvas[data-city-canvas]'),
          roof,
        ),
        'Select the building through its canvas, not its label',
      );
      await page.mouse.click(roof.x, roof.y, { button: 'right' });
      await page.mouse.click(roof.x, roof.y, { button: 'middle' });
      await page.keyboard.down('Shift');
      await page.mouse.click(roof.x, roof.y);
      await page.keyboard.up('Shift');
      await expect(page.locator('[data-city-selected]')).toHaveCount(0);
      const beforeClick = await cameraAngles(page);
      await page.mouse.move(roof.x, roof.y);
      await page.mouse.down();
      await page.mouse.move(roof.x + 2, roof.y + 1);
      await page.mouse.up();
      await expect(page.locator('[data-city-selected]')).toHaveAttribute(
        'data-city-selected',
        'city-workspace-001',
      );
      await settled(page);
      await expectAngles(page, beforeClick);
      await shot('-canvas-selection');
      await open('city', 'home');
      await expect(page.locator('[data-city-ready="true"]')).toBeAttached();
      await shot('-home');
    },
    { motion: 'full' },
  );
  await scenario(
    'motion-trackpad',
    async ({ page, open, shot, result }) => {
      await open();
      await settled(page);
      const point = await canvasPoint(page);
      await page.mouse.move(point.x, point.y);
      const original = await cameraAngles(page);
      const zoom = await page.locator('[data-city]').getAttribute('data-city-zoom');
      const sky = await clouds(page);
      await shot('-before');
      const panBy = async (dx, dy, action) => {
        const before = (await projection(page)).map(parseFloat);
        await action();
        await expect
          .poll(async () => {
            const after = (await projection(page)).map(parseFloat);
            return Math.max(
              Math.abs(after[0] - before[0] + dx),
              Math.abs(after[1] - before[1] + dy),
            );
          })
          .toBeLessThan(0.5);
        await expect(page.locator('[data-city]')).toHaveAttribute('data-city-zoom', zoom);
        await expectAngles(page, original);
        await settled(page);
      };
      for (const [dx, dy] of [
        [48.5, 32.25],
        [0, 64],
        [-72, 0],
      ]) {
        await panBy(dx, dy, () => page.mouse.wheel(dx, dy));
      }
      for (const selector of [
        '[data-city-building][aria-hidden="false"]',
        '[data-city-repository]',
      ]) {
        await page.locator(selector).first().hover();
        await panBy(12, -18, () => page.mouse.wheel(12, -18));
      }
      await page.mouse.move(point.x, point.y);
      await expect.poll(() => clouds(page)).not.toEqual(sky);
      const wheel = (values) =>
        page.locator('canvas[data-city-canvas]').dispatchEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: point.x,
          clientY: point.y,
          ...values,
        });
      await panBy(32, 48, () => wheel({ deltaX: 2, deltaY: 3, deltaMode: 1 }));
      const height = await page
        .locator('canvas[data-city-canvas]')
        .evaluate((node) => node.clientHeight);
      await panBy(height * 0.03, -height * 0.04, () =>
        wheel({ deltaX: 0.03, deltaY: -0.04, deltaMode: 2 }),
      );
      await page.keyboard.down('Shift');
      await panBy(40, 0, () => page.mouse.wheel(0, 40));
      await page.keyboard.up('Shift');
      await shot('-panned');
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -24);
      await page.keyboard.up('Control');
      await expect
        .poll(async () => Number(await page.locator('[data-city]').getAttribute('data-city-zoom')))
        .toBeGreaterThan(Number(zoom));
      await expectAngles(page, original);
      await settled(page);
      await shot('-pinched');
      const stopped = await projection(page);
      await wheel({ deltaY: 0 });
      assert.deepEqual(
        await projection(page),
        stopped,
        'Zero wheel input leaves the camera unchanged',
      );
      result.idleDraws = await idleDraws(page);
    },
    { motion: 'full' },
  );
  await scenario(
    'motion-label-gestures',
    async ({ page, open, shot, result }) => {
      await open();
      await settled(page);
      const reset = async () => {
        await page.locator('.city-viewport').focus();
        await page.keyboard.press('0');
        await settled(page);
      };
      const viewportScroll = () =>
        page
          .locator('[data-city], .city-labels')
          .evaluateAll((nodes) => nodes.map((node) => [node.scrollLeft, node.scrollTop]));
      for (const selector of [
        '[data-city-building][aria-hidden="false"]',
        '[data-city-repository]',
      ]) {
        for (const button of ['left', 'right']) {
          await reset();
          const label = page.locator(selector).first();
          const box = await label.boundingBox();
          assert.ok(box);
          const before = await cameraAngles(page);
          const beforePan = await projection(page);
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down({ button });
          await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 25, {
            steps: 8,
          });
          await page.mouse.up({ button });
          if (button === 'left') {
            await expect.poll(() => cameraAngles(page)).not.toEqual(before);
          } else {
            await expect.poll(() => projection(page)).not.toEqual(beforePan);
            await expectAngles(page, before);
          }
          await expect(page.locator('[data-city-selected]')).toHaveCount(0);
          await expect(page.locator('[data-city]')).toHaveAttribute('data-city-zoom', '1');
        }
      }
      await reset();
      const label = page.locator('[data-city-building][aria-hidden="false"]').first();
      const id = await label.getAttribute('data-city-building');
      await label.tap();
      await expect(page.locator('[data-city-selected]')).toHaveAttribute('data-city-selected', id);
      await settled(page);
      await reset();
      await label.focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('[data-city-selected]')).toHaveAttribute('data-city-selected', id);
      await settled(page);
      await reset();
      const repository = page.locator('[data-city-repository]').first();
      await repository.click();
      await expect(page.locator('[data-city]')).not.toHaveAttribute('data-city-zoom', '1');
      await settled(page);
      await shot('-repository');
      await reset();
      const beforePanel = await projection(page);
      await page.getByRole('button', { name: 'Workspace index', exact: true }).click();
      await page.locator('[data-city-index-building]').first().hover();
      const indexScroll = () =>
        page.locator('.city-index-items').evaluate((node) => node.scrollTop);
      const beforeScroll = await indexScroll();
      await page.mouse.wheel(0, 64);
      await expect.poll(indexScroll).toBeGreaterThan(beforeScroll);
      await settled(page);
      assert.deepEqual(
        await projection(page),
        beforePanel,
        'Index scrolling leaves the camera still',
      );
      assert.deepEqual(
        await viewportScroll(),
        [
          [0, 0],
          [0, 0],
        ],
        'Focusing labels and scrolling the index never scroll the scene or its labels',
      );
      result.idleDraws = await idleDraws(page);
    },
    { motion: 'full' },
  );
  await scenario(
    'motion-touch-cleanup',
    async ({ page, open, shot, result }) => {
      await open();
      await settled(page);
      const cdp = await page.context().newCDPSession(page);
      const point = await canvasPoint(page);
      const touch = (type, points) =>
        cdp.send('Input.dispatchTouchEvent', {
          type,
          touchPoints: points.map(([id, x, y]) => ({ id, x, y, radiusX: 4, radiusY: 4, force: 1 })),
        });
      const before = await cameraAngles(page);
      await touch('touchStart', [[1, point.x - 60, point.y]]);
      await touch('touchMove', [[1, point.x, point.y + 20]]);
      await expect.poll(() => cameraAngles(page)).not.toEqual(before);
      const singleFinger = await cameraAngles(page);
      await touch('touchStart', [
        [1, point.x, point.y + 20],
        [2, point.x + 80, point.y + 20],
      ]);
      await touch('touchEnd', []);
      await settled(page);
      await expectAngles(page, singleFinger);
      await shot('-orbit-handoff');
      const zoom = await page.locator('[data-city]').getAttribute('data-city-zoom');
      await touch('touchStart', [
        [1, point.x - 60, point.y],
        [2, point.x + 60, point.y],
      ]);
      await touch('touchMove', [
        [1, point.x - 85, point.y - 35],
        [2, point.x + 105, point.y + 45],
      ]);
      await expect.poll(() => cameraAngles(page)).not.toEqual(singleFinger);
      await expect(page.locator('[data-city]')).not.toHaveAttribute('data-city-zoom', zoom);
      await shot('-two-fingers', false);
      await touch('touchMove', [[1, point.x - 85, point.y - 35]]);
      const handoff = await projection(page);
      const handoffAngle = await cameraAngles(page);
      await touch('touchMove', [[1, point.x - 45, point.y - 15]]);
      await expect.poll(() => projection(page)).not.toEqual(handoff);
      await expect.poll(() => cameraAngles(page)).not.toEqual(handoffAngle);
      await touch('touchCancel', []);
      await settled(page);
      const released = await projection(page);
      await page.mouse.move(point.x + 200, point.y + 100);
      assert.deepEqual(await projection(page), released, 'Cancelled gesture cannot keep panning');
      await dragCamera(page, { release: false });
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await page.mouse.up();
      await settled(page);
      await expect(page.locator('[data-city-selected]')).toHaveCount(0);
      result.idleDraws = await idleDraws(page);
      await cdp.detach();
    },
    { motion: 'full' },
  );
  await scenario(
    'motion-reduced-and-edges',
    async ({ page, open, shot, result }) => {
      await open();
      await settled(page);
      const original = await cameraAngles(page);
      await blur(page);
      for (const elevation of ['Shift+ArrowUp', 'Shift+ArrowDown']) {
        for (let index = 0; index < 22; index += 1) await page.keyboard.press(elevation);
        await settled(page);
        for (const key of ['+', '-']) {
          for (let index = 0; index < 24; index += 1) await page.keyboard.press(key);
          await settled(page);
          await cloudCoverage(page);
          const transforms = await clouds(page);
          assert.ok(
            transforms.some(
              (value) => value !== 'none' && !/^matrix\(1, 0, 0, 1, 0, 0\)$/.test(value),
            ),
            'Full-motion cloud overscan is exercised',
          );
          await shot(
            `-full-${elevation.endsWith('Up') ? 'high' : 'low'}-${key === '+' ? 'near' : 'far'}`,
          );
        }
      }
      await page.keyboard.press('Home');
      await settled(page);
      await dragCamera(page, { release: false });
      await expect.poll(() => cameraAngles(page)).not.toEqual(original);
      const chosen = await cameraAngles(page);
      await page.evaluate(() => {
        document.documentElement.classList.remove('catalog-full-motion');
        document.documentElement.classList.add('catalog-reduced-motion');
      });
      await expectAngles(page, chosen);
      await page.mouse.up();
      await settled(page);
      const identities = await page
        .locator('.city-atmosphere, .city-near-clouds')
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            const transform = getComputedStyle(node).transform;
            return transform === 'none' || new window.DOMMatrix(transform).isIdentity;
          }),
        );
      assert.ok(
        identities.length === 2 && identities.every(Boolean),
        'Reduced motion freezes cloud transforms',
      );
      await blur(page);
      await dragCamera(page);
      await settled(page);
      assert.notDeepEqual(
        await cameraAngles(page),
        chosen,
        'Reduced motion retains direct drag rotation',
      );
      await page.keyboard.press('e');
      await settled(page);
      assert.notDeepEqual(
        await cameraAngles(page),
        original,
        'Reduced motion still allows direct orbit',
      );
      for (const key of ['+', '-']) {
        for (let index = 0; index < 24; index += 1) await page.keyboard.press(key);
        await settled(page);
        await cloudCoverage(page);
        await shot(key === '+' ? '-near' : '-far');
      }
      result.idleDraws = await idleDraws(page);
      await open('showcase', 'home-city', 390);
      await expect(
        page.getByRole('button', { name: 'Workspace index', exact: true }),
      ).toBeVisible();
      await blur(page);
      for (let step = 0; step < 5; step += 1) await page.keyboard.press('e');
      await settled(page);
      const narrowAngle = await cameraAngles(page);
      await page.getByRole('button', { name: 'studio · 4 workspaces', exact: true }).click();
      await settled(page);
      await expectAngles(page, narrowAngle);
      const repositoryFits = await page.locator('[data-city]').evaluate((root) => {
        const viewport = root.querySelector('.city-viewport').getBoundingClientRect();
        return ['001', '004', '007', '010'].every((suffix) => {
          const plot = root.querySelector(`[data-city-plot="city-workspace-${suffix}"]`);
          const x = parseFloat(plot.style.left),
            y = parseFloat(plot.style.top);
          return (
            Number.isFinite(x) &&
            Number.isFinite(y) &&
            x >= 0 &&
            x <= viewport.width &&
            y >= 0 &&
            y <= viewport.height
          );
        });
      });
      assert.ok(repositoryFits, 'Repository focus fits its projected buildings after narrow orbit');
      await shot('-narrow');
      await blur(page);
      await page.keyboard.press('?');
      const help = page.getByRole('dialog');
      await expect(help).toBeVisible();
      assert.ok(
        await help.evaluate((node) => node.scrollWidth <= node.clientWidth),
        'Control help fits a narrow viewport',
      );
      await shot('-narrow-help');
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
