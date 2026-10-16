#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CT_TEST_DIR, isCtSpec, normalizeCtPath } from '../playwright/ct-spec-pattern.mjs';

// The one list of repo-relative paths whose change requires the full Playwright
// component suite: the stylesheet/token contract that `playwright/index.ts`
// mounts (`src/app.css` imports `$lib/styles/*.css`), the CT harness itself, and
// the mount-harness helpers `playwright/index.ts` imports directly (the rest of
// `src/lib/component-catalog/` is ordinary component code), and the dependency
// manifests (a Playwright/Svelte/Tailwind bump is a CT-contract change).
// `scripts/verify-changed.mjs` selects the local `ct-full` check from it
// and the `pull_request` workflow decides whether to run `test-ct` from the same
// list, via `node scripts/ct-contract-paths.mjs --diff <base> <head>`.
// cloudlands-fe#2441 rewrote `tokens.css`, `app.css` and `run-ct-tests.mjs` with
// no CT run and was ejected from the merge queue with 40 CT failures.
//
// The workflow's `ct_required` additionally covers the specs
// `playwright-ct.config.ts` discovers via the shared `isCtSpec` classifier.
// Those are NOT contract paths: `verify:changed` keeps selecting the narrower
// `ct-related` lane for them locally.
// Hosted selection also covers direct local imports from discovered CT specs
// (see ctSpecDependencies below). Keep those out of the global contract list:
// a fixture edit should still select only related tests in verify:changed.
export const CT_CONTRACT_FILES = Object.freeze([
  'src/app.css',
  'playwright-ct.config.ts',
  'scripts/run-ct-tests.mjs',
  'scripts/ct-browser.mjs',
  'scripts/playwright-os-deps-lib.mjs',
  'patches/playwright-core@1.58.2.patch',
  'src/test/ct-test.ts',
  'src/lib/component-catalog/capture-stability.ts',
  'src/lib/component-catalog/preview-definition.ts',
  // Every edit is a trigger, including script-only changes such as dist:all.
  'package.json',
  'pnpm-lock.yaml',
]);
export const CT_CONTRACT_DIRECTORIES = Object.freeze(['src/lib/styles/', 'playwright/']);
export const CT_CONTRACT_PATHS = Object.freeze([
  ...CT_CONTRACT_FILES,
  ...CT_CONTRACT_DIRECTORIES.map((directory) => `${directory}**`),
]);

const OUTPUT_KEY = 'ct_required';

export function isCtContractPath(file) {
  const path = normalizeCtPath(file);
  return (
    CT_CONTRACT_FILES.includes(path) ||
    CT_CONTRACT_DIRECTORIES.some((directory) => path.startsWith(directory))
  );
}

export function ctRequired(files, dependencies = new Set()) {
  return files.some(
    (file) => isCtContractPath(file) || isCtSpec(file) || dependencies.has(normalizeCtPath(file)),
  );
}

// Deliberately bounded to ONE import edge from each CT spec. This covers hosts,
// previews and data/helpers regardless of their naming/location, including
// production modules imported directly, without walking the application graph.
// Like local findRelatedCtTests, scan literal import/from specifiers (including
// side-effect imports, re-exports and literal dynamic imports). Relative paths
// and the four frontend aliases support explicit paths, extensionless modules
// and directory indexes. Candidate paths are conservative, not a Vite resolver:
// type imports can over-select. Computed imports, globs, require calls
// and unknown $ aliases or escaped literals fail safe. Query/fragment suffixes
// are ignored for path matching; transitive dependencies are outside this rule.
const IMPORT_ALIASES = {
  '$features/': 'src/features/',
  '$lib/': 'src/lib/',
  '$shared/': 'src/shared/',
  '$store/': 'src/store/',
};
const IMPORT_EXTENSIONS = ['.svelte', '.ts', '.tsx', '.js', '.mjs'];

// This is a bounded lexical scan, not a JS/TS parser or a module resolver.
// Only code tokens can introduce imports: strings/comments/regexes are consumed
// atomically, and template expressions are scanned separately from template text.
// Any incomplete or ambiguous lexical analysis throws into main's CT fallback.
function ctImportSpecifiers(source, file) {
  const tokens = [];
  let cursor = 0;
  const push = (kind, text, controlClose = false) => tokens.push({ kind, text, controlClose });
  const fail = () => {
    throw new Error(
      `unsupported CT dependency syntax in ${file}: incomplete or ambiguous lexical input`,
    );
  };
  const controlKeywords = new Set(['if', 'while', 'for', 'with', 'switch', 'catch']);
  const regexKeywords = new Set([
    'return',
    'throw',
    'case',
    'delete',
    'void',
    'typeof',
    'yield',
    'await',
    'in',
    'of',
    'instanceof',
    'else',
    'do',
    'new',
  ]);
  const regexPreceders = new Set('([,:;=!?&|+-*%<>~^{/');

  function scanString(quote) {
    const start = cursor++;
    while (cursor < source.length) {
      const char = source[cursor++];
      if (char === '\\') {
        if (source[cursor] === '\r' && source[cursor + 1] === '\n') cursor++;
        cursor++;
      } else if (char === quote) {
        push('string', source.slice(start, cursor));
        return;
      } else if (char === '\n' || char === '\r') fail();
    }
    fail();
  }

  function scanRegex() {
    cursor++;
    let inClass = false;
    while (cursor < source.length) {
      const char = source[cursor++];
      if (char === '\\') cursor++;
      else if (/\r|\n|\u2028|\u2029/.test(char)) fail();
      else if (char === '[') inClass = true;
      else if (char === ']') inClass = false;
      else if (char === '/' && !inClass) {
        while (cursor < source.length && /[a-z]/i.test(source[cursor])) cursor++;
        push('regex', '');
        return;
      }
    }
    fail();
  }

  function scanTemplate() {
    push('template', '`');
    cursor++;
    while (cursor < source.length) {
      const char = source[cursor++];
      if (char === '\\') cursor++;
      else if (char === '`') {
        push('template', '`');
        return;
      } else if (char === '$' && source[cursor] === '{') {
        cursor++;
        // Token barriers keep template text out of import argument matching.
        push('punctuation', '(');
        scanCode(true);
        push('punctuation', ')');
      }
    }
    fail();
  }

  function scanCode(inTemplate = false) {
    let braces = 0;
    const parens = [];
    while (cursor < source.length) {
      const char = source[cursor];
      const next = source[cursor + 1];
      const previous = tokens.at(-1);
      if (/\s/.test(char)) cursor++;
      else if (char === '/' && next === '/') {
        while (cursor < source.length && !/[\r\n\u2028\u2029]/.test(source[cursor])) cursor++;
      } else if (char === '/' && next === '*') {
        const end = source.indexOf('*/', cursor + 2);
        if (end === -1) fail();
        cursor = end + 2;
      } else if (char === "'" || char === '"') scanString(char);
      else if (char === '`') scanTemplate();
      else if (/[\p{ID_Start}_$]/u.test(char)) {
        const start = cursor++;
        while (cursor < source.length && /[\p{ID_Continue}$\u200c\u200d]/u.test(source[cursor]))
          cursor++;
        push('word', source.slice(start, cursor));
      } else if (/[0-9]/.test(char)) {
        const start = cursor++;
        while (cursor < source.length && /[\w.]/.test(source[cursor])) cursor++;
        push('number', source.slice(start, cursor));
      } else if (char === '/') {
        // After a closing brace this small scanner cannot tell an object-valued
        // division from a new regex statement. Never silently discard imports.
        if (previous?.text === '}') fail();
        if (
          !previous ||
          previous.controlClose ||
          (previous.kind === 'word' &&
            regexKeywords.has(previous.text) &&
            tokens.at(-2)?.text !== '.') ||
          (previous.kind === 'punctuation' && regexPreceders.has(previous.text))
        )
          scanRegex();
        else {
          push('punctuation', '/');
          cursor++;
        }
      } else if (char === '\\') fail();
      else {
        if (char === '}' && inTemplate && braces === 0) {
          cursor++;
          if (parens.length) fail();
          return;
        }
        if (char === '{') braces++;
        else if (char === '}') braces--;
        if (char === '(')
          parens.push(previous?.kind === 'word' && controlKeywords.has(previous.text));
        const controlClose = char === ')' ? parens.pop() : false;
        if ((char === '+' || char === '-') && next === char) {
          push('punctuation', char + char);
          cursor += 2;
        } else {
          // TS's postfix non-null assertion still ends an expression: the next
          // slash is division, unlike the unary negation operator before a regex.
          const postfix =
            char === '!' &&
            previous &&
            (['string', 'number', 'regex', 'template', 'postfix'].includes(previous.kind) ||
              (previous.kind === 'word' && !regexKeywords.has(previous.text)) ||
              [')', ']', '++', '--'].includes(previous.text));
          push(postfix ? 'postfix' : 'punctuation', char, controlClose);
          cursor++;
        }
      }
    }
    if (inTemplate || braces !== 0 || parens.length) fail();
  }

  scanCode();
  const specifiers = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind !== 'word' || tokens[i - 1]?.text === '.') continue;
    const next = tokens[i + 1];
    if (token.text === 'require' && next?.text === '(') fail();
    if (token.text === 'import') {
      if (next?.text === '(') {
        if (tokens[i + 2]?.kind !== 'string' || ![')', ','].includes(tokens[i + 3]?.text)) fail();
        specifiers.push(tokens[i + 2].text);
      } else if (
        next?.text === '.' &&
        tokens[i + 2]?.text === 'meta' &&
        tokens[i + 3]?.text === '.' &&
        tokens[i + 4]?.text.startsWith('glob')
      )
        fail();
      else if (next?.kind === 'string') specifiers.push(next.text);
    } else if (token.text === 'from' && next?.kind === 'string') specifiers.push(next.text);
  }
  return specifiers;
}

function ctSpecDependencies(base, head) {
  const gitOptions = { stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 };
  const specs = new Map();
  // Read the requested Git trees, never the checkout: deleted/renamed fixtures
  // must remain visible, and callers need not have either revision checked out.
  for (const ref of new Set([base, head])) {
    const tree = execFileSync('git', ['ls-tree', '-r', '-z', ref, '--', CT_TEST_DIR], {
      ...gitOptions,
      encoding: 'utf8',
    });
    for (const entry of tree.split('\0').filter(Boolean)) {
      const tab = entry.indexOf('\t');
      const file = entry.slice(tab + 1);
      if (!isCtSpec(file)) continue;
      const [mode, type, oid] = entry.slice(0, tab).split(' ');
      if (type !== 'blob' || !mode.startsWith('100')) {
        throw new Error(`cannot read CT spec ${ref}:${file}`);
      }
      specs.set(`${oid}:${file}`, { oid, file });
    }
  }
  if (!specs.size) return new Set();

  // One batch avoids spawning a process per spec. Use byte lengths from Git's
  // headers so Unicode source and embedded newlines cannot corrupt framing.
  const oids = [...new Set([...specs.values()].map(({ oid }) => oid))];
  const batch = execFileSync('git', ['cat-file', '--batch'], {
    ...gitOptions,
    input: `${oids.join('\n')}\n`,
  });
  const sources = new Map();
  let offset = 0;
  for (const oid of oids) {
    const newline = batch.indexOf(10, offset);
    const header = batch.subarray(offset, newline).toString('utf8').split(' ');
    const size = Number(header[2]);
    if (
      newline < offset ||
      header[0] !== oid ||
      header[1] !== 'blob' ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      batch[newline + 1 + size] !== 10
    )
      throw new Error(`cannot read CT spec blob ${oid}`);
    offset = newline + 1;
    sources.set(oid, batch.subarray(offset, offset + size).toString('utf8'));
    offset += size + 1;
  }

  const dependencies = new Set();
  for (const { oid, file } of specs.values()) {
    for (const literal of ctImportSpecifiers(sources.get(oid), file)) {
      // Do not silently treat an encoded JS string as a literal filesystem path.
      // Resolving escapes needs a JS string decoder; fail safe until supported.
      if (literal.includes('\\')) {
        throw new Error(`unsupported CT dependency escape in ${file}: ${literal}`);
      }
      // Vite's ?raw/?inline (and other query/fragment forms) read the same file.
      const specifier = literal.slice(1, -1).split(/[?#]/, 1)[0];
      const alias = Object.entries(IMPORT_ALIASES).find(([prefix]) => specifier.startsWith(prefix));
      if (specifier.startsWith('$') && !alias) {
        throw new Error(`unsupported CT dependency alias in ${file}: ${specifier}`);
      }
      if (!specifier.startsWith('.') && !alias) continue;
      const target = alias
        ? posix.join(alias[1], specifier.slice(alias[0].length))
        : posix.join(posix.dirname(file), specifier);
      if (target.startsWith('../')) continue;
      dependencies.add(target);
      if (!IMPORT_EXTENSIONS.includes(posix.extname(target))) {
        for (const extension of IMPORT_EXTENSIONS) {
          dependencies.add(`${target}${extension}`);
          dependencies.add(`${target}/index${extension}`);
        }
      }
    }
  }
  return dependencies;
}

// `-z` keeps paths verbatim (no `core.quotePath` escaping of non-ASCII names) and
// `--no-renames` reports a rename as delete + add, so a contract file moved out of
// the list still surfaces on its old path.
export function changedFiles(base, head, { cwd = process.cwd() } = {}) {
  return execFileSync(
    'git',
    ['diff', '--name-only', '-z', '--no-renames', '--diff-filter=ACMD', base, head],
    {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    },
  )
    .split('\0')
    .filter(Boolean);
}

export function parseArgs(argv) {
  if (argv[0] !== '--diff') throw new Error(`usage: ct-contract-paths.mjs --diff <base> <head>`);
  const [base, head, ...rest] = argv.slice(1);
  if (!base || !head || rest.length)
    throw new Error(`usage: ct-contract-paths.mjs --diff <base> <head>`);
  return { base, head };
}

// Prints exactly one `ct_required=true|false` line and always exits 0: a failure
// to compute relevance must run CT, never skip it.
export function main(
  argv,
  {
    diff = changedFiles,
    dependencies = ctSpecDependencies,
    log = console.log,
    warn = console.error,
  } = {},
) {
  let required = true;
  try {
    const { base, head } = parseArgs(argv);
    const files = diff(base, head);
    required =
      ctRequired(files) || (files.length > 0 && ctRequired(files, dependencies(base, head)));
  } catch (error) {
    warn(
      `ct-contract-paths: ${error instanceof Error ? error.message : error}; requiring CT (fail-safe)`,
    );
  }
  log(`${OUTPUT_KEY}=${required}`);
  return 0;
}

const isDirectRun =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isDirectRun) process.exitCode = main(process.argv.slice(2));
