// @verify-changed-triggers: src/**, test/**, tests/**, e2e/**, playwright/**, scripts/**, package.json

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.resolve('scripts/check-geometry-snapshots.mjs');
const roots: string[] = [];

function check(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), 'geometry-ban-'));
  roots.push(root);
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
}

afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('blanket geometry snapshot ban', () => {
  it.each([
    ['src/__geometry__/button.json', '{}'],
    ['fixtures/button.geometry.json', '{}'],
    ['src/catalog/geometry-snapshot.ts', 'export {};'],
    ['src/button.ct.spec.ts', 'defineGeometrySnapshotSuite({ scene: "button" });'],
    [
      'src/button.ct.spec.ts',
      'import { defineGeometrySnapshotSuite as suite } from "./helper"; suite({});',
    ],
    ['playwright/index.ts', 'import * as snapshots from "../catalog/geometry-snapshot.js";'],
    ['scripts/update.mjs', 'const update = process.env.SANDBOX_GEOMETRY_UPDATE;'],
    [
      'scripts/update.mjs',
      'const update = process.env["SANDBOX_GEOMETRY_UPDATE_ALLOW_NON_LINUX"];',
    ],
    ['package.json', JSON.stringify({ scripts: { 'sandbox:geometry:update': 'node update.mjs' } })],
    [
      'package.json',
      JSON.stringify({ scripts: { update: 'SANDBOX_GEOMETRY_UPDATE=1 pnpm test:ct' } }),
    ],
  ])('rejects retired machinery in %s', (file, content) => {
    const result = check({ [file]: content });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(file);
  });

  it('allows behavioral geometry tests, manual probes, screenshots, and archived report data', () => {
    const result = check({
      'src/panel.geometry.ct.spec.ts':
        'const box = await control.boundingBox(); expect(box.width).toBeGreaterThan(0);',
      'scripts/probe.mjs': 'const geometry = collectGeometry(page); await page.screenshot();',
      'scripts/report.test.ts':
        'const oldRun = "geometry-snapshot.ts defineGeometrySnapshotSuite SANDBOX_GEOMETRY_UPDATE";',
      'package.json': JSON.stringify({ scripts: { 'sandbox:probe': 'node scripts/probe.mjs' } }),
      '.gitignore': '.demo-artifacts/\n',
      '.demo-artifacts/__geometry__/manual.geometry.json': '{}',
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it.each([
    'const box = await control.boundingBox(); expect(box.width).toBe(160);',
    'const box = control.getBoundingClientRect().toJSON(); expect(box.width).toBe(160);',
    'const boxes = await controls.evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect())); const widths = boxes.map(box => box.width); expect(widths).toEqual([160, 160]);',
    'const box = await control.boundingBox(); expect(box.width / box.height).toBe(2);',
    'const box = await control.boundingBox(); const ratio = box.width / box.height; expect(ratio).toBe(2);',
    'const box = await control.boundingBox(); expect(box.width === 160).toBe(true);',
    'const box = await control.boundingBox(); expect(Math.abs(box.width - 160)).toBeLessThanOrEqual(1);',
    'const a = await first.boundingBox(); const b = await second.boundingBox(); expect(b.x - a.x).toBe(8);',
    'const box = await control.boundingBox(); (expect(box.width))["toBe"](160);',
    'const box = await control.boundingBox(); expect(box["height"]).toBeCloseTo(32, 1);',
    'const box = await control.boundingBox(); const expected = 160; expect(box.width).toEqual(expected);',
    'const { width } = await control.boundingBox(); expect(width).toBe(160);',
    'const measure = () => control.getBoundingClientRect().height; expect(measure()).toBe(32);',
    'function measure() { return control.getBoundingClientRect().height; } expect(measure()).toBe(32);',
    'const widths = await controls.evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().width)); expect(widths).toEqual([160, 160]);',
    'await expect.poll(() => control.evaluate(n => n.clientWidth)).toBe(160);',
    'const box = await control.boundingBox(); expect(box).toEqual({ width: 160, height: 32 });',
    'const box = await control.boundingBox(); expect(box).toMatchInlineSnapshot(`{ "width": 160 }`);',
    'const box = await control.boundingBox(); expect(box).toMatchSnapshot();',
    'const box = await control.boundingBox(); expect(box.width).toEqual(generatedBaseline.width);',
    'import expected from "./measurements.json"; const box = await control.boundingBox(); expect(box).toEqual(expected);',
    'import { sizes } from "./tokens"; const box = await control.boundingBox(); expect(box.width).toBe(sizes.tab);',
    'const expected = JSON.parse(fs.readFileSync("./measurements.json", "utf8")); const box = await control.boundingBox(); expect(box).toEqual(expected);',
    'const style = getComputedStyle(control); expect(style.width).toBe("160px");',
    'const style = getComputedStyle(control); expect(style).toMatchObject({ height: "28px" });',
  ])('rejects inline or generated DOM appearance baselines: %s', (content) => {
    const result = check({ 'src/control.test.ts': content });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('src/control.test.ts');
  });

  it.each(['fixtures/layout-baselines/button.json', 'fixtures/dom_baselines/button.json'])(
    'rejects renamed baseline stores in %s',
    (file) => {
      const result = check({ [file]: '{ "width": 160 }' });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(file);
    },
  );

  it('preserves behavioral measurements and explicit algorithm contracts', () => {
    const result = check({
      'src/control.test.ts': [
        'const box = await control.boundingBox();',
        'const container = await parent.boundingBox();',
        'expect(box.right).toBeLessThanOrEqual(container.right);',
        'expect(box.width).toBeGreaterThanOrEqual(24);',
        'expect(box.width).toBeCloseTo(container.width, 1);',
        'const baseline = await parent.boundingBox(); expect(box.width).toBeCloseTo(baseline.width, 1);',
        'expect(box.height).toBe(0);',
        'expect(boxes.length).toBe(3);',
        'const rows = await controls.evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect()));',
        'expect(rows.length).toBe(3);',
        'expect(resize({ width: 200 }, 2)).toEqual({ width: 400 });',
        'expect(messageCount).toBe(3);',
        'expect(statusText).toMatchInlineSnapshot("ready");',
        'expect(scroller.scrollTop).toBe(480);',
        'const beforePan = await image.boundingBox(); const afterPan = await image.boundingBox();',
        'expect([afterPan.x - beforePan.x, afterPan.y - beforePan.y]).toEqual([50, 30]);',
        'expect(Math.abs(afterPan.width - beforePan.width - 80)).toBeLessThanOrEqual(1);',
        'const color = await control.evaluate(n => { const style = getComputedStyle(n); return parseColor(style.color); });',
        'expect(color).toEqual([255, 255, 255]);',
        'const metrics = await image.evaluate(n => ({ width: n.naturalWidth, box: n.getBoundingClientRect() }));',
        'expect(metrics.width).toBe(640);',
        'const summary = await control.evaluate(n => ({ count: n.children.length, box: n.getBoundingClientRect() }));',
        'expect(summary).toMatchObject({ count: 3 });',
        'const { width: intrinsicWidth } = metrics; expect(intrinsicWidth).toBe(640);',
        'expect(box.width / box.height).toBeCloseTo(metrics.width / image.naturalHeight, 1);',
      ].join('\n'),
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it('does not use a live measurement from a different test as a constant baseline oracle', () => {
    const result = check({
      'src/control.test.ts': [
        'test("live", async () => { const expected = await parent.boundingBox(); expect(expected.width).toBeGreaterThan(0); });',
        'test("fixed", async () => { const expected = 160; const box = await control.boundingBox(); expect(box.width).toBe(expected); });',
      ].join('\n'),
    });
    expect(result.status, result.stderr).toBe(1);
  });
});
