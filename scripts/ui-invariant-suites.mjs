import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Single source of truth for `pnpm run test:ui-invariants` membership. A suite
// joins the gate by carrying `// @ui-invariant` in its leading comments; a
// suite that calls the UI component inventory builder or imports a `*.meta`
// module and reads a `.callers` ledger must carry either that marker or
// `// @ui-invariant-exempt: <reason>`. cloudlands-fe#2260 shipped the gate as
// a hand-listed package.json script and missed qualifying suites until review.
export const UI_INVARIANT_MARKER = '@ui-invariant';
export const UI_INVARIANT_EXEMPT_MARKER = '@ui-invariant-exempt:';
export const UI_INVARIANT_SCAN_ROOTS = ['scripts', 'src'];

// Mirrors vitest's default include; `.ct.spec` / `.visual.spec` are the
// Playwright suites vitest.config.ts excludes.
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const PLAYWRIGHT_FILE = /\.(?:ct|visual)\.spec\.[cm]?[jt]sx?$/;
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'build']);
const GATE_MARKER = new RegExp(`${UI_INVARIANT_MARKER}(?![\\w-])`);
const INVENTORY_CALL = /\bbuildUiComponentInventory\s*\(/;
const INVENTORY_IMPORT = /\bimport\s*\{[^}]*\bbuildUiComponentInventory\b[^}]*\}/;
const META_SPECIFIER = String.raw`(['"])[^'"\n]*\.meta(?:\.[cm]?[jt]s)?\1`;
const META_IMPORT = new RegExp(String.raw`\b(?:from\s*|import\s*\(\s*)${META_SPECIFIER}`);
const CALLERS_LEDGER = /\??\.callers\b/;

const normalize = (value) => value.split(path.sep).join('/');

function stripBom(content) {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function readLineEnd(source, index) {
  const end = source.indexOf('\n', index);
  return end === -1 ? source.length : end;
}

// Returns the bodies of the comments that precede the first token, skipping a
// hashbang. Text after a closing `*/` on the same line is code, not header.
export function readLeadingComments(content) {
  const source = stripBom(content);
  const comments = [];
  let index = source.startsWith('#!') ? readLineEnd(source, 0) : 0;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1;
    } else if (source.startsWith('//', index)) {
      const end = readLineEnd(source, index);
      comments.push(source.slice(index + 2, end));
      index = end;
    } else if (source.startsWith('/*', index)) {
      const close = source.indexOf('*/', index + 2);
      const end = close === -1 ? source.length : close;
      comments.push(source.slice(index + 2, end));
      index = end + 2;
    } else {
      break;
    }
  }
  return comments;
}

export function readHeaderMarker(content) {
  for (const comment of readLeadingComments(content)) {
    for (const rawLine of comment.split(/\r?\n/)) {
      const line = rawLine.replace(/^\s*\*+/, '').trim();
      const exempt = line.indexOf(UI_INVARIANT_EXEMPT_MARKER);
      if (exempt !== -1) {
        return {
          kind: 'exempt',
          reason: line.slice(exempt + UI_INVARIANT_EXEMPT_MARKER.length).trim(),
        };
      }
      if (GATE_MARKER.test(line)) return { kind: 'gate' };
    }
  }
  return { kind: null };
}

// Blanks line and block comments while leaving string and template literal
// bodies intact, so imports keep their specifiers and comments cannot register
// as consumers.
export function stripComments(content) {
  const source = stripBom(content);
  let output = '';
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '/' && source[index + 1] === '/') {
      index = readLineEnd(source, index);
    } else if (char === '/' && source[index + 1] === '*') {
      const close = source.indexOf('*/', index + 2);
      const end = close === -1 ? source.length : close + 2;
      output += source.slice(index, end).replace(/[^\n]/g, ' ');
      index = end;
    } else if (char === '"' || char === "'" || char === '`') {
      let end = index + 1;
      while (end < source.length && source[end] !== char) {
        if (source[end] === '\\') end += 1;
        else if (char !== '`' && source[end] === '\n') break;
        end += 1;
      }
      output += source.slice(index, end + 1);
      index = end + 1;
    } else {
      output += char;
      index += 1;
    }
  }
  return output;
}

export function requiresUiInvariantMarker(content) {
  const code = stripComments(content);
  return (
    INVENTORY_CALL.test(code) ||
    INVENTORY_IMPORT.test(code) ||
    (META_IMPORT.test(code) && CALLERS_LEDGER.test(code))
  );
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
      } else if (TEST_FILE.test(entry.name) && !PLAYWRIGHT_FILE.test(entry.name)) {
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

// Runs the vitest CLI entry through the current Node binary: `.cmd` shims need
// a command interpreter on Windows, and this keeps argument boundaries intact.
export function runVitest(suites, vitestArgs, root = process.cwd()) {
  const require = createRequire(import.meta.url);
  const vitestPackage = require.resolve('vitest/package.json');
  const vitestBin = path.join(path.dirname(vitestPackage), require(vitestPackage).bin.vitest);
  const child = spawnSync(
    process.execPath,
    [vitestBin, 'run', '--config', 'vitest.config.ts', ...suites, ...vitestArgs],
    { cwd: root, stdio: 'inherit' },
  );
  if (child.error) {
    console.error(`Failed to start vitest: ${child.error.message}`);
    return 1;
  }
  return child.status ?? 1;
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
    process.exit(runVitest(result.suites, vitestArgs));
  }
}
