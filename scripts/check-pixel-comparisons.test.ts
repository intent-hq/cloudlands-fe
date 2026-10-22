// @vitest-environment node
// @verify-changed-triggers: src/**, test/**, tests/**, e2e/**, playwright/**, scripts/**, package.json, playwright*.ts
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.resolve('scripts/check-pixel-comparisons.mjs');
const roots: string[] = [];

function check(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), 'pixel-ban-'));
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

describe('pixel comparison ban', () => {
  it.each([
    ['src/button.ct.spec.ts', 'await expect(component).toHaveScreenshot("button.png");'],
    ['test/button.spec.ts', 'expect(await palettePng()).toMatchSnapshot("palette.png");'],
    ['tests/manual/button.ts', 'expect(page)["toHaveScreenshot"]();'],
    ['src/test/helpers.ts', '(expect(page)[(`toHaveScreenshot`)])();'],
    ['src/button.test.ts', 'expect(image).toMatchImageSnapshot();'],
    ['src/button.test.ts', 'expect(image).toMatchSnapshot("button.png");'],
    ['test/helpers.ts', 'expect(image).toMatchSnapshot(); // snapshot-font-ok: loaded'],
    ['src/image.test.ts', 'expect(await page.screenshot()).toMatchSnapshot();'],
    [
      'playwright-ct.config.ts',
      'export default { expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } } };',
    ],
    ['playwright.config.ts', 'export default { expect: { "toHaveScreenshot": {} } };'],
    ['test/helpers.ts', 'const { toHaveScreenshot: compare } = expect(page); compare();'],
    ['test/helpers.ts', 'import compare from "pixelmatch"; compare(a, b);'],
    ['scripts/helpers.ts', 'const compare = require("looks-same");'],
    ['src/button.test.ts', 'import sharp from "sharp"; sharp(image).raw().toBuffer();'],
    ['test/helpers.ts', 'context.getImageData(5, 5, 1, 1);'],
    ['test/helpers.ts', 'context.getImageData(0, 0, 1, 1);'],
    ['test/helpers.ts', 'context.drawImage(image, 0, 0); context.getImageData(0, 0, 1, 1);'],
    ['test/helpers.ts', 'const decoder = new ImageDecoder({ data, type: "image/gif" });'],
    ['test/helpers.ts', 'const before = await page.screenshot(); after.equals(before);'],
    ['test/button.spec.ts-snapshots/button.png', 'baseline'],
    ['src/__snapshots__/button.webp', 'baseline'],
    ['fixtures/goldens/button.svg', '<svg/>'],
    ['package.json', JSON.stringify({ devDependencies: { pixelmatch: '1.0.0' } })],
    ['package.json', JSON.stringify({ scripts: { update: 'playwright test --update-snapshots' } })],
  ])('rejects prohibited comparisons or machinery in %s', (file, content) => {
    const result = check({ [file]: content });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(file);
  });

  it('allows manual screenshots, behavior checks, text snapshots, and image metadata', () => {
    const result = check({
      'scripts/shot.mjs': 'await page.screenshot({ path: "review.png" });',
      'test/layout.spec.ts': 'expect((await control.boundingBox()).width).toBeGreaterThan(0);',
      'src/reducer.test.ts': 'expect(state).toMatchSnapshot();',
      'src/__tests__/reducer.spec.ts': 'expect(state).toMatchSnapshot();',
      'scripts/icon.test.ts':
        'import sharp from "sharp"; expect(await sharp(image).metadata()).toMatchObject({ format: "png" });',
      'scripts/gate.test.ts': 'const fixture = "expect(page).toHaveScreenshot()";',
      'src/comments.ts': '// expect(page).toHaveScreenshot();\nconst label = "toHaveScreenshot";',
      'test/transport.ts':
        'const log = "screenshot"; Buffer.from(raw.toString("utf8")).equals(raw);',
      'src/contrast.ct.spec.ts':
        'context.fillStyle = cssColor; context.fillRect(0, 0, 1, 1); const rgba = context.getImageData(0, 0, 1, 1).data;',
      'test/fixtures/image.png': 'input image',
      'package.json': JSON.stringify({ scripts: { 'sandbox:shot': 'node scripts/shot.mjs' } }),
      '.gitignore': '.demo-artifacts/\n',
      '.demo-artifacts/goldens/manual.png': 'manual evidence',
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it('checks tracked files as well as untracked additions', () => {
    const result = check({ 'test/old.spec.ts': 'await expect(page).toHaveScreenshot();' });
    execFileSync('git', ['add', '.'], { cwd: roots.at(-1) });
    const tracked = spawnSync(process.execPath, [script], { cwd: roots.at(-1), encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(tracked.status).toBe(1);
    expect(tracked.stderr).toContain('test/old.spec.ts');
  });
});
