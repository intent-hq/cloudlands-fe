import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { isCtSpec } from '../playwright/ct-spec-pattern.mjs';
import { isIgnoredRootSpec, isRootSpec } from '../playwright/root-spec-pattern.mjs';

const forbiddenNames = new Set([
  'toHaveScreenshot',
  'toMatchImageSnapshot',
  'toMatchImage',
  'matchImageSnapshot',
  'maxDiffPixels',
  'maxDiffPixelRatio',
]);
const comparisonPackage =
  /^(?:pixelmatch|looks-same|resemblejs|ssim\.js|(?:jest|playwright|vitest)-image-snapshot)(?:\/|$)/;
const imageExtension = /\.(?:png|jpe?g|gif|webp|bmp|tiff?|svg)$/i;
const baselineDirectory =
  /(?:^|\/)(?:[^/]+-snapshots|__(?:image_)?snapshots__|(?:image|screenshot|visual)[-_]baselines|goldens?)(?:\/|$)/i;
const testFile = /\.(?:test|spec)\.[cm]?[jt]sx?$/i;
const testDirectory = /(?:^|\/)(?:test|tests|__tests__|e2e|playwright)(?:\/|$)/;

function unwrap(node) {
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
}

function memberName(node) {
  node = unwrap(node);
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node)) {
    const argument = unwrap(node.argumentExpression);
    if (ts.isStringLiteralLike(argument)) return argument.text;
  }
  return undefined;
}

function sourceViolations(file, content) {
  if (
    !/toHaveScreenshot|toMatch(?:Image|Snapshot)|matchImageSnapshot|maxDiffPixel|pixelmatch|looks-same|resemblejs|ssim|image-snapshot|\b(?:raw|equals|getImageData|ImageDecoder|toBitmap)\b/.test(
      content,
    )
  )
    return [];
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const testing = testFile.test(file) || testDirectory.test(file);
  const textSnapshots =
    testFile.test(file) &&
    !isCtSpec(file) &&
    !isRootSpec(file) &&
    !isIgnoredRootSpec(file) &&
    !/^(?:test|playwright|e2e)\//.test(file) &&
    !/\bscreenshot\s*\(/.test(content);
  const hits = new Set();
  const imageBuffers = new Set();
  function collectBuffers(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (/\bscreenshot\s*\(/.test(node.initializer.getText(source)))
        imageBuffers.add(node.name.text);
    }
    ts.forEachChild(node, collectBuffers);
  }
  collectBuffers(source);
  function report(node, reason) {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    hits.add(`${file}:${line + 1}: ${reason}`);
  }
  function visit(node) {
    const name = ts.isIdentifier(node) ? node.text : memberName(node);
    if (forbiddenNames.has(name))
      report(node, `pixel comparison API or option ${name} is forbidden`);
    if (ts.isStringLiteralLike(node)) {
      const parent = node.parent;
      if (
        (ts.isImportDeclaration(parent) ||
          ts.isExportDeclaration(parent) ||
          ts.isCallExpression(parent)) &&
        comparisonPackage.test(node.text)
      )
        report(node, 'image comparison dependencies are forbidden');
      if (
        ts.isPropertyAssignment(parent) &&
        parent.name === node &&
        forbiddenNames.has(node.text)
      ) {
        report(node, `pixel comparison API or option ${node.text} is forbidden`);
      }
    }
    if (ts.isCallExpression(node)) {
      const method = memberName(node.expression);
      if (
        method === 'toMatchSnapshot' &&
        (!textSnapshots ||
          node.arguments.some(
            (argument) => ts.isStringLiteralLike(argument) && imageExtension.test(argument.text),
          ))
      )
        report(node, 'image/browser snapshots are forbidden');
      if (testing && method === 'raw' && /\bsharp\b/.test(content)) {
        report(node, 'decoding raw image pixels in tests is forbidden');
      }
      if (testing && method === 'toBitmap')
        report(node, 'decoding raw image pixels in tests is forbidden');
      if (testing && method === 'getImageData') {
        const colorConversion =
          /\bfillStyle\b/.test(content) &&
          node.arguments.length === 4 &&
          node.arguments.every(
            (argument, index) =>
              ts.isNumericLiteral(argument) && Number(argument.text) === (index < 2 ? 0 : 1),
          );
        if (!colorConversion || /\bdrawImage\s*\(/.test(content)) {
          report(node, 'sampling rendered image pixels in tests is forbidden');
        }
      }
      const expression = unwrap(node.expression);
      if (testing && method === 'equals' && ts.isPropertyAccessExpression(expression)) {
        const buffers = [unwrap(expression.expression), ...node.arguments.map(unwrap)];
        if (buffers.some((buffer) => ts.isIdentifier(buffer) && imageBuffers.has(buffer.text))) {
          report(node, 'comparing screenshot buffers in tests is forbidden');
        }
      }
    }
    if (testing && name === 'ImageDecoder')
      report(node, 'decoding reference image frames in tests is forbidden');
    ts.forEachChild(node, visit);
  }
  visit(source);
  return [...hits];
}

function checkPixelComparisons(root) {
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    },
  ).split('\0');
  const hits = [];
  for (const file of new Set(files.filter(Boolean))) {
    const absolute = path.join(root, file);
    if (!existsSync(absolute)) continue;
    if (imageExtension.test(file) && baselineDirectory.test(file)) {
      hits.push(`${file}: stored image comparison baselines are forbidden`);
    }
    if (/\.[cm]?[jt]sx?$/.test(file)) {
      hits.push(...sourceViolations(file, readFileSync(absolute, 'utf8')));
    }
    if (path.basename(file) === 'package.json') {
      const manifest = JSON.parse(readFileSync(absolute, 'utf8'));
      for (const group of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        for (const name of Object.keys(manifest[group] ?? {})) {
          if (comparisonPackage.test(name))
            hits.push(`${file}: image comparison dependency ${name} is forbidden`);
        }
      }
      for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
        if (
          /--update-snapshots(?:\b|=)|--updateSnapshot\b/.test(command) &&
          /playwright|test:ct/.test(command)
        ) {
          hits.push(`${file}: ${name} restores image baseline regeneration`);
        }
      }
    }
  }
  return hits;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const hits = checkPixelComparisons(process.cwd());
  if (hits.length) {
    console.error(hits.join('\n'));
    console.error(
      'Remove pixel comparisons. Test behavior and use screenshots only for manual review. No exemptions.',
    );
    process.exitCode = 1;
  } else {
    console.log(
      'Pixel comparison ban passed: no image snapshots, baselines, or comparison machinery.',
    );
  }
}
