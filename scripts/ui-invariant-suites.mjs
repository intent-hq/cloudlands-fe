import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Single source of truth for `pnpm run test:ui-invariants` membership. A suite
// joins the gate by carrying `// @ui-invariant` in its leading comment lines;
// a suite that consumes the UI component inventory or a `*.meta.ts` caller
// ledger must carry either that marker or `// @ui-invariant-exempt: <reason>`.
// cloudlands-fe#2260 shipped the gate as a hand-listed package.json script and
// missed three qualifying suites until review.
export const UI_INVARIANT_MARKER = '@ui-invariant';
export const UI_INVARIANT_EXEMPT_MARKER = '@ui-invariant-exempt:';
export const UI_INVARIANT_SCAN_ROOTS = ['scripts', 'src'];

const TEST_FILE = /\.test\.(?:ts|mts|js|mjs)$/;
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'build']);
const HEADER_LINE = /^\s*(?:\/\/|\/\*|\*)/;
const GATE_MARKER = new RegExp(`${UI_INVARIANT_MARKER}(?![\\w-])`);
const INVENTORY_CONSUMER = /\bbuildUiComponentInventory\b/;
const META_IMPORT = /\bfrom\s+['"][^'"]*\.meta(?:\.[cm]?[jt]s)?['"]/;
const CALLERS = /\bcallers\b/;

const normalize = (value) => value.split(path.sep).join('/');

export function readHeaderMarker(content) {
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (!HEADER_LINE.test(line)) break;
    const exempt = line.indexOf(UI_INVARIANT_EXEMPT_MARKER);
    if (exempt !== -1) {
      const reason = line
        .slice(exempt + UI_INVARIANT_EXEMPT_MARKER.length)
        .replace(/\*\/\s*$/, '')
        .trim();
      return { kind: 'exempt', reason };
    }
    if (GATE_MARKER.test(line)) return { kind: 'gate' };
  }
  return { kind: null };
}

export function requiresUiInvariantMarker(content) {
  return INVENTORY_CONSUMER.test(content) || (META_IMPORT.test(content) && CALLERS.test(content));
}

export function inspectUiInvariantSuites(files) {
  const suites = [];
  const exempt = [];
  const violations = [];
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const { path: filePath, content } of sorted) {
    const marker = readHeaderMarker(content);
    if (marker.kind === 'gate') {
      suites.push(filePath);
    } else if (marker.kind === 'exempt') {
      if (marker.reason) exempt.push({ path: filePath, reason: marker.reason });
      else violations.push(`${filePath}: \`${UI_INVARIANT_EXEMPT_MARKER}\` requires a reason`);
    } else if (requiresUiInvariantMarker(content)) {
      violations.push(
        `${filePath}: consumes the UI component inventory or a *.meta caller ledger without a header marker; add \`// ${UI_INVARIANT_MARKER}\` to run it in test:ui-invariants or \`// ${UI_INVARIANT_EXEMPT_MARKER} <reason>\` to opt out`,
      );
    }
  }
  return { suites, exempt, violations, auditedFiles: sorted.map((file) => file.path) };
}

export function collectTestFiles(root = process.cwd()) {
  const files = [];
  const walk = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) walk(absolute);
      } else if (TEST_FILE.test(entry.name)) {
        files.push({
          path: normalize(path.relative(root, absolute)),
          content: fs.readFileSync(absolute, 'utf8'),
        });
      }
    }
  };
  for (const scanRoot of UI_INVARIANT_SCAN_ROOTS) walk(path.join(root, scanRoot));
  return files;
}

export function listUiInvariantSuites(root = process.cwd()) {
  return inspectUiInvariantSuites(collectTestFiles(root));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const mode = args.includes('--list') ? 'list' : args.includes('--check') ? 'check' : 'run';
  const vitestArgs = args.filter((arg) => arg !== '--list' && arg !== '--check');
  const result = listUiInvariantSuites();
  if (result.violations.length) {
    console.error(
      [
        'UI invariant suite marker violations:',
        ...result.violations.map((item) => `- ${item}`),
      ].join('\n'),
    );
    process.exit(1);
  }
  if (!result.suites.length) {
    console.error(`No test file carries \`// ${UI_INVARIANT_MARKER}\`; nothing to run.`);
    process.exit(1);
  }
  if (mode === 'list') {
    console.log(result.suites.join('\n'));
  } else if (mode === 'check') {
    console.log(
      `UI invariant suite markers valid: ${result.suites.length} suites, ${result.exempt.length} exempt, ${result.auditedFiles.length} test files audited.`,
    );
  } else {
    const vitest = spawnSync(
      process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
      ['exec', 'vitest', 'run', '--config', 'vitest.config.ts', ...result.suites, ...vitestArgs],
      { stdio: 'inherit' },
    );
    process.exit(vitest.status ?? 1);
  }
}
