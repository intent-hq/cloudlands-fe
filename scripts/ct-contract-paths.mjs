#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCtSpec, normalizeCtPath } from '../playwright/ct-spec-pattern.mjs';

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
// Hosted selection also covers every local module a CT run can mount: the
// transitive import closure of discovered CT specs and the mount harness (see
// ctSpecDependencies below). Keep those out of the global contract list: a
// fixture edit should still select only related tests in verify:changed.
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

// Hosted selection follows everything a CT run can mount: the transitive local
// import closure of every discovered spec and of the mount harness
// `playwright/index.ts`, through `.preview.svelte` harnesses, hosts, fixtures
// and the production modules they render. cloudlands-fe#3876 changed
// `HomePage.svelte` and `show-workspace.ts`, two or more edges below
// `home.ct.spec.ts` -> `home.preview.svelte`. A one-edge scan skipped CT on
// the PR and in the merge queue, and main stayed broken for about 6 hours.
//
// The walk reads each requested Git tree rather than the checkout, and it
// follows edges only to files that exist in that tree. It treats these as edges:
// - literal import/from specifiers, including side-effect imports, re-exports
//   and literal dynamic imports;
// - literal `import.meta.glob` patterns, matched against the tree;
// - literal `previewScene` names, which the harness resolves to
//   `<scene>.preview.{ts,svelte}` without an import.
// `.svelte` files contribute their <script> blocks, literal `import()` calls in
// markup and style `@import`s; `.css` files contribute their `@import`s.
// Relative and root-absolute paths, the CT bundle's `$` aliases and the
// package aliases listed below resolve to explicit paths, extensionless modules
// and directory indexes. Candidates are conservative, not a Vite resolver:
// type imports and unused globbed modules can over-select. Computed imports,
// require calls, unknown `$` aliases, escaped literals and unsupported glob
// syntax fail safe. Query/fragment suffixes are ignored for path matching.
const IMPORT_ALIASES = {
  '$features/': 'src/features/',
  '$lib/': 'src/lib/',
  '$shared/': 'src/shared/',
  '$store/': 'src/store/',
  // playwright-ct.config.ts points SvelteKit's runtime at browser-safe stubs.
  '$app/': 'playwright/app-stubs/',
};
// The package-name aliases in playwright-ct.config.ts that resolve to local files.
const PACKAGE_ALIASES = [
  [
    /^@fortawesome\/(?:fontawesome-common-types|fontawesome-svg-core|free-brands-svg-icons|free-regular-svg-icons|free-solid-svg-icons)$/,
    'src/lib/icons/phosphor-icons.ts',
  ],
  [/^svelte-fa$/, 'src/lib/components/shared/icons/fa-proxy.ts'],
];
const IMPORT_EXTENSIONS = ['.svelte', '.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.json'];
// TypeScript-aware resolution lets `./x.js` name `./x.ts`.
const SCRIPT_EXTENSION_SOURCES = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'] };
const SCANNED_MODULE = /\.(?:svelte|[cm]?[jt]sx?|css)$/i;

// Every CT mount loads the harness, so its imports are part of every run.
export const CT_HARNESS_ENTRY = 'playwright/index.ts';
// The harness's lazy registry of every preview. It loads only the scene a test
// names through `previewScene`, which the walk resolves per scene instead.
export const CT_PREVIEW_REGISTRY_GLOB = '../src/**/*.preview.{ts,svelte}';

// This is a bounded lexical scan, not a JS/TS parser or a module resolver.
// Only code tokens can introduce imports: strings/comments/regexes are consumed
// atomically, and template expressions are scanned separately from template text.
// Any incomplete or ambiguous lexical analysis throws into main's CT fallback.
function moduleReferences(source, file) {
  const tokens = [];
  let cursor = 0;
  const push = (kind, text, controlClose = false) => tokens.push({ kind, text, controlClose });
  const fail = (reason = 'incomplete or ambiguous lexical input') => {
    throw new Error(`unsupported CT dependency syntax in ${file}: ${reason}`);
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
  const imports = [];
  const globs = [];
  const scenes = [];
  const literal = (token, what) => {
    if (token?.kind !== 'string') fail(`non-literal ${what}`);
    if (token.text.includes('\\')) fail(`escaped ${what} ${token.text}`);
    return token.text.slice(1, -1);
  };
  // `import type …` / `export type … from` are erased before bundling and load
  // nothing; inline `{ type X }` specifiers keep their statement's edge.
  const erasedFrom = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind !== 'word' || tokens[i - 1]?.text === '.') continue;
    const next = tokens[i + 1];
    if (token.text === 'require' && next?.text === '(') fail('require call');
    if ((token.text === 'import' || token.text === 'export') && next?.text === 'type') {
      // Locate this statement's own `from` exactly; anything else keeps its edge.
      let j = i + 2;
      if (tokens[j]?.text === '{') {
        while (j < tokens.length && tokens[j].text !== '}') j++;
        j++;
      } else if (tokens[j]?.text === '*') {
        j += tokens[j + 1]?.text === 'as' ? 3 : 1;
      } else if (token.text === 'import' && tokens[j]?.kind === 'word') j++;
      else j = -1;
      if (tokens[j]?.text === 'from' && tokens[j + 1]?.kind === 'string') erasedFrom.add(j);
    }
    if (token.text === 'import') {
      if (next?.text === '(') {
        if (![')', ','].includes(tokens[i + 3]?.text)) fail('computed dynamic import');
        imports.push(literal(tokens[i + 2], 'dynamic import'));
      } else if (next?.text === '.' && tokens[i + 2]?.text === 'meta') {
        if (tokens[i + 3]?.text !== '.' || !tokens[i + 4]?.text.startsWith('glob')) continue;
        if (tokens[i + 4].text !== 'glob') fail(`import.meta.${tokens[i + 4].text}`);
        let j = i + 5;
        if (tokens[j]?.text === '<') {
          for (let depth = 0; j < tokens.length; j++) {
            if (tokens[j].text === '<') depth++;
            else if (tokens[j].text === '>' && --depth === 0) break;
          }
          j++;
        }
        if (tokens[j++]?.text !== '(') fail('import.meta.glob without arguments');
        const patterns = [];
        if (tokens[j]?.text === '[') {
          do patterns.push(literal(tokens[++j], 'glob pattern'));
          while (tokens[++j]?.text === ',' && tokens[j + 1]?.text !== ']');
          if (tokens[j]?.text === ',') j++;
          if (tokens[j++]?.text !== ']') fail('computed glob pattern list');
        } else patterns.push(literal(tokens[j++], 'glob pattern'));
        if (![')', ','].includes(tokens[j]?.text)) fail('computed glob pattern');
        globs.push(patterns);
      } else if (next?.kind === 'string') imports.push(literal(next, 'import'));
    } else if (token.text === 'from' && next?.kind === 'string' && !erasedFrom.has(i)) {
      imports.push(literal(next, 'import'));
    } else if (token.text === 'previewScene') {
      // `hooksConfig: { previewScene: { scene: '<name>' } }` mounts a preview by
      // name. Property reads (`config.previewScene`) and optional type members
      // (`previewScene?:`) are not mounts; any other value form fails safe.
      if (next?.text === ':') {
        if (tokens[i + 2]?.text !== '{') fail('non-literal previewScene');
        let scene;
        for (let j = i + 3, depth = 1; j < tokens.length && depth > 0; j++) {
          const text = tokens[j].text;
          if (text === '{' || text === '(' || text === '[') depth++;
          else if (text === '}' || text === ')' || text === ']') depth--;
          else if (depth === 1 && text === 'scene' && tokens[j + 1]?.text === ':') {
            scene = literal(tokens[j + 2], 'previewScene scene');
          }
        }
        if (scene === undefined) fail('previewScene without a literal scene');
        scenes.push(scene);
      } else if ([',', '}'].includes(next?.text) && ['{', ','].includes(tokens[i - 1]?.text)) {
        fail('shorthand previewScene');
      }
    }
  }
  return { imports, globs, scenes };
}

const SVELTE_BLOCK = /<(script|style)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
const CSS_IMPORT = /@import\b\s*/g;
// `'x'`, `"x"`, `url('x')`, `url("x")` or unquoted `url(x)`.
const CSS_IMPORT_TARGET =
  /^(?:(['"])([^'"\r\n]*)\1|url\(\s*(?:(['"])([^'"\r\n]*)\3|([^'"()\s]+))\s*\))/;
const MARKUP_IMPORT = /\bimport\s*\(\s*(?:(['"])([^'"\\\r\n]*)\1\s*[),])?/g;

function cssImports(source, file) {
  const css = source.replace(CSS_COMMENT, ' ');
  return [...css.matchAll(CSS_IMPORT)].map((match) => {
    const target = CSS_IMPORT_TARGET.exec(css.slice(match.index + match[0].length));
    if (!target) throw new Error(`unsupported CT dependency syntax in ${file}: CSS @import`);
    return target[2] ?? target[4] ?? target[5];
  });
}

// Literal references a module can load: `{ imports, cssImports, globs, scenes }`.
export function sourceReferences(source, file) {
  if (/\.css$/i.test(file))
    return { imports: [], cssImports: cssImports(source, file), globs: [], scenes: [] };
  if (!/\.svelte$/i.test(file)) return { ...moduleReferences(source, file), cssImports: [] };
  const references = { imports: [], cssImports: [], globs: [], scenes: [] };
  const markup = source.replace(SVELTE_BLOCK, (_block, tag, body) => {
    if (tag.toLowerCase() === 'style') references.cssImports.push(...cssImports(body, file));
    else {
      const script = moduleReferences(body, file);
      references.imports.push(...script.imports);
      references.globs.push(...script.globs);
      references.scenes.push(...script.scenes);
    }
    return ' ';
  });
  // Template expressions such as `{#await import('./Lazy.svelte')}` load modules too.
  for (const match of markup.matchAll(MARKUP_IMPORT)) {
    if (match[2] === undefined) {
      throw new Error(`unsupported CT dependency syntax in ${file}: computed import in markup`);
    }
    references.imports.push(match[2]);
  }
  return references;
}

// Repo-relative candidate paths for one specifier; [] for an external package.
export function candidatePaths(file, literal, { css = false } = {}) {
  // Do not silently treat an encoded JS string as a literal filesystem path.
  if (literal.includes('\\')) {
    throw new Error(`unsupported CT dependency escape in ${file}: ${literal}`);
  }
  // Vite's ?raw/?inline (and other query/fragment forms) read the same file.
  const specifier = literal.split(/[?#]/, 1)[0];
  const packageAlias = PACKAGE_ALIASES.find(([pattern]) => pattern.test(specifier));
  if (packageAlias) return [packageAlias[1]];
  const alias = Object.entries(IMPORT_ALIASES).find(([prefix]) => specifier.startsWith(prefix));
  if (specifier.startsWith('$') && !alias) {
    throw new Error(`unsupported CT dependency alias in ${file}: ${specifier}`);
  }
  let target;
  if (alias) target = posix.join(alias[1], specifier.slice(alias[0].length));
  else if (specifier.startsWith('/')) target = posix.normalize(specifier.slice(1));
  // CSS resolves a bare `@import 'x.css'` next to the importer before packages.
  else if (specifier.startsWith('.') || css) target = posix.join(posix.dirname(file), specifier);
  else return [];
  if (target === '..' || target.startsWith('../')) return [];
  const candidates = [target];
  for (const extension of IMPORT_EXTENSIONS) {
    candidates.push(`${target}${extension}`, `${target}/index${extension}`);
  }
  const extension = posix.extname(target);
  for (const source of SCRIPT_EXTENSION_SOURCES[extension] ?? []) {
    candidates.push(`${target.slice(0, -extension.length)}${source}`);
  }
  return candidates;
}

// Vite glob syntax this walk can match exactly: `*`, `**`, `?` and `{a,b}`.
export function globMatcher(file, pattern) {
  if (pattern.startsWith('!') || /[[\]()!+@\\]/.test(pattern)) {
    throw new Error(`unsupported CT dependency glob in ${file}: ${pattern}`);
  }
  // Vite globs are relative (`./`, `../`), root-absolute (`/`) or a resolve alias.
  const alias = Object.entries(IMPORT_ALIASES).find(([prefix]) => pattern.startsWith(prefix));
  let path;
  if (alias) path = posix.join(alias[1], pattern.slice(alias[0].length));
  else if (pattern.startsWith('/')) path = posix.normalize(pattern.slice(1));
  else if (pattern.startsWith('./') || pattern.startsWith('../')) {
    path = posix.join(posix.dirname(file), pattern);
  } else throw new Error(`unsupported CT dependency glob in ${file}: ${pattern}`);
  if (path === '..' || path.startsWith('../')) return () => false;
  let source = '';
  let braces = 0;
  for (let i = 0; i < path.length; i++) {
    const char = path[i];
    if (char === '*' && path[i + 1] === '*') {
      i++;
      if (path[i + 1] === '/') {
        i++;
        source += '(?:[^/]*/)*';
      } else source += '.*';
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else if (char === '{') {
      braces++;
      source += '(?:';
    } else if (char === '}' && braces > 0) {
      braces--;
      source += ')';
    } else if (char === ',' && braces > 0) source += '|';
    else source += char.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
  if (braces) throw new Error(`unsupported CT dependency glob in ${file}: ${pattern}`);
  const matcher = new RegExp(`^${source}$`);
  return (candidate) => matcher.test(candidate);
}

const GIT_OPTIONS = { stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 * 1024 };

// Path -> blob id for every regular file in `ref`; symlinks are leaves.
function readTree(ref) {
  const tree = new Map();
  const entries = execFileSync('git', ['ls-tree', '-r', '-z', '--full-tree', ref], {
    ...GIT_OPTIONS,
    encoding: 'utf8',
  });
  for (const entry of entries.split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t');
    const [mode, type, oid] = entry.slice(0, tab).split(' ');
    if (type === 'blob') tree.set(entry.slice(tab + 1), mode.startsWith('100') ? oid : null);
  }
  return tree;
}

// One batch per call avoids spawning a process per file. Use byte lengths from
// Git's headers so Unicode source and embedded newlines cannot corrupt framing.
function readBlobs(oids, sources) {
  const missing = [...new Set(oids)].filter((oid) => !sources.has(oid));
  if (!missing.length) return;
  const batch = execFileSync('git', ['cat-file', '--batch'], {
    ...GIT_OPTIONS,
    input: `${missing.join('\n')}\n`,
  });
  let offset = 0;
  for (const oid of missing) {
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
      throw new Error(`cannot read CT dependency blob ${oid}`);
    offset = newline + 1;
    sources.set(oid, batch.subarray(offset, offset + size).toString('utf8'));
    offset += size + 1;
  }
}

// Every path a CT run on this tree can load, including unresolved candidates so
// adding a file that a specifier would now resolve to still selects CT.
function ctClosure(tree, sources) {
  const dependencies = new Set();
  const visited = new Set();
  const files = [...tree.keys()];
  let frontier = [];
  const reach = (path) => {
    dependencies.add(path);
    if (visited.has(path) || !tree.get(path) || !SCANNED_MODULE.test(path)) return;
    visited.add(path);
    frontier.push(path);
  };
  for (const path of files) if (isCtSpec(path)) reach(path);
  if (tree.has(CT_HARNESS_ENTRY)) reach(CT_HARNESS_ENTRY);
  while (frontier.length) {
    const level = frontier;
    frontier = [];
    readBlobs(
      level.map((path) => tree.get(path)),
      sources,
    );
    for (const file of level) {
      const { imports, cssImports, globs, scenes } = sourceReferences(
        sources.get(tree.get(file)),
        file,
      );
      for (const literal of imports) for (const path of candidatePaths(file, literal)) reach(path);
      for (const literal of cssImports) {
        for (const path of candidatePaths(file, literal, { css: true })) reach(path);
      }
      for (const patterns of globs) {
        if (file === CT_HARNESS_ENTRY && patterns.join() === CT_PREVIEW_REGISTRY_GLOB) continue;
        const matchers = patterns.map((pattern) => globMatcher(file, pattern));
        for (const path of files) if (matchers.some((matches) => matches(path))) reach(path);
      }
      for (const scene of scenes) {
        const suffixes = [`/${scene}.preview.ts`, `/${scene}.preview.svelte`];
        for (const path of files) {
          if (path.startsWith('src/') && suffixes.some((suffix) => path.endsWith(suffix))) {
            reach(path);
          }
        }
      }
    }
  }
  return dependencies;
}

// Union of both trees: a dependency deleted, renamed or newly imported on
// either side still counts. Callers need not have either revision checked out.
export function ctSpecDependencies(base, head) {
  const sources = new Map();
  const dependencies = new Set();
  for (const ref of new Set([base, head])) {
    for (const path of ctClosure(readTree(ref), sources)) dependencies.add(path);
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
