import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const retiredIdentifiers = new Set([
  'defineGeometrySnapshotSuite',
  'SANDBOX_GEOMETRY_UPDATE',
  'SANDBOX_GEOMETRY_UPDATE_ALLOW_NON_LINUX',
]);
const retiredModule = /(?:^|\/)geometry-snapshot(?:\.[cm]?[jt]s)?$/;

function sourceViolations(file, content) {
  if (!/defineGeometrySnapshotSuite|SANDBOX_GEOMETRY_UPDATE|geometry-snapshot/.test(content))
    return [];
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const hits = [];
  function visit(node) {
    const retiredIdentifier = ts.isIdentifier(node) && retiredIdentifiers.has(node.text);
    const retiredString =
      ts.isStringLiteral(node) &&
      ((ts.isElementAccessExpression(node.parent) && retiredIdentifiers.has(node.text)) ||
        ((ts.isImportDeclaration(node.parent) ||
          ts.isExportDeclaration(node.parent) ||
          ts.isCallExpression(node.parent)) &&
          retiredModule.test(node.text)));
    if (retiredIdentifier || retiredString) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      hits.push(`${file}:${line + 1}: retired geometry snapshot API or regeneration hook`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return hits;
}

function checkGeometrySnapshots(root) {
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  ).split('\0');
  const hits = [];
  for (const file of new Set(files.filter(Boolean))) {
    const absolute = path.join(root, file);
    if (!existsSync(absolute)) continue;
    if (
      /(?:^|\/)__geometry__\/|\.geometry\.json$|(?:^|\/)geometry-snapshot\.[cm]?[jt]s$/.test(file)
    ) {
      hits.push(`${file}: saved geometry baselines and snapshot helpers are prohibited`);
      continue;
    }
    if (/\.[cm]?[jt]sx?$/.test(file)) {
      hits.push(...sourceViolations(file, readFileSync(absolute, 'utf8')));
    }
    if (path.basename(file) === 'package.json') {
      const { scripts = {} } = JSON.parse(readFileSync(absolute, 'utf8'));
      for (const [name, command] of Object.entries(scripts)) {
        if (
          name === 'sandbox:geometry:update' ||
          /SANDBOX_GEOMETRY_UPDATE|sandbox:geometry:update|--grep\s+['"]geometry snapshot/.test(
            command,
          )
        ) {
          hits.push(`${file}: ${name} restores geometry snapshot regeneration`);
        }
      }
    }
  }
  return hits;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const hits = checkGeometrySnapshots(process.cwd());
  if (hits.length) {
    console.error(hits.join('\n'));
    console.error(
      'Remove blanket geometry snapshots. Test named behavior and use manual screenshots/probes.',
    );
    process.exitCode = 1;
  } else {
    console.log('Geometry snapshot ban passed: no retired baselines, APIs, or regeneration hooks.');
  }
}
