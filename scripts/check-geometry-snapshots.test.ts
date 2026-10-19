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
});
