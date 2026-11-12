import fs from 'node:fs';
import { createRequire, isBuiltin } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { initSync, parse as parseCommonJs } from 'cjs-module-lexer';
import ts from 'typescript';

initSync();

// electron-builder drops devDependencies from the packaged node_modules, so a
// main-process import of one (svelte reached the main process in
// cloudlands-fe#654) crashes the packaged app at startup. This walks the
// built import graph from the main-process entry points and fails on any
// import the packaged app cannot resolve: a package outside `dependencies`, an
// alias the ESM import fixer left behind, a relative file that was not built,
// or a named import Node's ESM loader cannot find in a CommonJS package
// (`import { utils } from 'ssh2'` type-checked, then crashed the packaged app
// at startup). It reads the graph from `dist`, so a renamed module cannot drop out
// of the scan the way a hand-picked module list did (intent-hq/intent#8971).
// Run after `pnpm run build:main`.
export const ENTRY_POINTS = Object.freeze(['dist/main/index.js']);

// Provided by the Electron runtime, not node_modules.
export const RUNTIME_PROVIDED = Object.freeze(['electron']);

// Documented exceptions: '<file> -> <specifier>' → one-line justification.
// An entry that matches no import is reported as stale.
export const ALLOWLIST = Object.freeze({});

const PARSED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const REQUIRE_EXTENSIONS = ['', '.js', '.json', '.node', '/index.js'];

const toRepoPath = (root, absolute) => path.relative(root, absolute).split(path.sep).join('/');

function isFile(absolute) {
  try {
    return fs.statSync(absolute).isFile();
  } catch {
    return false;
  }
}

/** npm package name of a bare specifier, or null for builtins and paths. */
export function packageNameOf(specifier) {
  if (/^(?:\.{1,2}(?:\/|$)|\/|file:)/.test(specifier) || isBuiltin(specifier)) return null;
  const [first, second] = specifier.split('/');
  return first.startsWith('@') && second ? `${first}/${second}` : first;
}

const literalText = (node) =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;

/** Names an `import { a }` or `export { a } from` declaration needs from its module. */
function namedBindingsOf(node) {
  const bindings = ts.isImportDeclaration(node)
    ? node.importClause?.namedBindings
    : node.exportClause;
  if (!bindings || !(ts.isNamedImports(bindings) || ts.isNamedExports(bindings))) return [];
  return bindings.elements
    .map((element) => (element.propertyName ?? element.name).text)
    .filter((name) => name !== 'default');
}

/** Static imports, re-exports, literal `import()`, and literal `require()` calls. */
function collectImports(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const imports = [];
  const add = (node, specifier, kind, names = []) => {
    if (specifier === null) return;
    const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    imports.push({ specifier, kind, line, names });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node, literalText(node.moduleSpecifier), 'import', namedBindingsOf(node));
    } else if (ts.isCallExpression(node)) {
      const [argument] = node.arguments;
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        add(node, literalText(argument), 'import');
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        add(node, literalText(argument), 'require');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
}

function resolveRelative(fromFile, specifier, kind) {
  const target = path.resolve(path.dirname(fromFile), specifier.replace(/[?#].*$/, ''));
  if (kind === 'import') return isFile(target) ? target : null;
  return REQUIRE_EXTENSIONS.map((suffix) => target + suffix).find(isFile) ?? null;
}

const ESM_CONDITIONS = new Set(['node', 'import', 'module-sync', 'default']);

function findUp(fromDir, relative) {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, relative);
    if (isFile(candidate)) return candidate;
    if (path.dirname(dir) === dir) return null;
  }
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function exportsTarget(target) {
  if (typeof target === 'string') return target;
  if (Array.isArray(target)) {
    for (const item of target) {
      const resolved = exportsTarget(item);
      if (resolved !== null) return resolved;
    }
    return null;
  }
  if (target && typeof target === 'object') {
    for (const [condition, value] of Object.entries(target)) {
      if (!ESM_CONDITIONS.has(condition)) continue;
      const resolved = exportsTarget(value);
      if (resolved !== null) return resolved;
    }
  }
  return null;
}

/** The file Node's ESM loader runs for `subpath` ('.' or './x') of a package. */
function resolvePackageFile(packageDir, manifest, subpath) {
  const { exports } = manifest;
  if (exports === undefined || exports === null) {
    if (subpath !== '.') return [path.join(packageDir, subpath)].find(isFile) ?? null;
    const main = path.join(packageDir, manifest.main ?? 'index.js');
    return [main, `${main}.js`, path.join(main, 'index.js')].find(isFile) ?? null;
  }
  const sugar =
    typeof exports === 'string' ||
    Array.isArray(exports) ||
    !Object.keys(exports).every((key) => key.startsWith('.'));
  const map = sugar ? { '.': exports } : exports;
  let target = Object.hasOwn(map, subpath) ? exportsTarget(map[subpath]) : null;
  if (target === null) {
    let bestPrefix = -1;
    for (const [key, value] of Object.entries(map)) {
      const star = key.indexOf('*');
      if (star === -1 || star <= bestPrefix) continue;
      const [prefix, suffix] = [key.slice(0, star), key.slice(star + 1)];
      if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
      const resolved = exportsTarget(value);
      if (resolved === null) continue;
      bestPrefix = star;
      target = resolved.replaceAll(
        '*',
        subpath.slice(prefix.length, subpath.length - suffix.length),
      );
    }
  }
  return target === null ? null : ([path.join(packageDir, target)].find(isFile) ?? null);
}

const COMMONJS_WRAPPER_PARAMS = ['exports', 'require', 'module', '__filename', '__dirname'];

/** Whether Node loads `file` as CommonJS (its type, then its syntax, decides). */
function isCommonJs(file) {
  const extension = path.extname(file);
  if (extension === '.cjs') return true;
  if (extension !== '.js') return false;
  const manifest = findUp(path.dirname(file), 'package.json');
  const type = manifest === null ? undefined : readJson(manifest).type;
  if (type === 'module') return false;
  if (type === 'commonjs') return true;
  try {
    vm.compileFunction(fs.readFileSync(file, 'utf8'), COMMONJS_WRAPPER_PARAMS);
    return true;
  } catch {
    return false;
  }
}

/** Named exports Node's ESM loader sees in a CommonJS file, following reexports. */
function commonJsExportNames(file, cache) {
  if (!cache.has(file)) {
    const names = new Set();
    collectCommonJsExportNames(file, names, new Set());
    cache.set(file, names);
  }
  return cache.get(file);
}

function collectCommonJsExportNames(file, names, seen) {
  if (seen.has(file)) return;
  seen.add(file);
  const { exports, reexports } = parseCommonJs(fs.readFileSync(file, 'utf8'), file);
  for (const name of exports) names.add(name);
  for (const specifier of reexports) {
    let target;
    try {
      target = createRequire(file).resolve(specifier);
    } catch {
      continue;
    }
    if (isCommonJs(target)) collectCommonJsExportNames(target, names, seen);
  }
}

/**
 * The names in `names` that Node's ESM loader cannot find when `fromFile`
 * imports `specifier` from a CommonJS package, or [] when the package is ESM
 * or is not installed under `root`.
 */
function missingCommonJsNames(root, fromFile, specifier, packageName, names, cache) {
  const manifestFile = findUp(
    path.dirname(fromFile),
    path.join('node_modules', packageName, 'package.json'),
  );
  if (manifestFile === null || !manifestFile.startsWith(root + path.sep)) return { missing: [] };
  const subpath = `.${specifier.slice(packageName.length)}`;
  const target = resolvePackageFile(path.dirname(manifestFile), readJson(manifestFile), subpath);
  if (target === null || !isCommonJs(target)) return { missing: [] };
  const available = commonJsExportNames(target, cache);
  return { missing: names.filter((name) => !available.has(name)), target };
}

function namedExportFinding({ root, file, specifier, packageName, names, cache }) {
  if (names.length === 0) return null;
  const { missing, target } = missingCommonJsNames(
    root,
    file,
    specifier,
    packageName,
    names,
    cache,
  );
  if (missing.length === 0) return null;
  return {
    kind: 'missing-named-export',
    packageName,
    names: missing,
    module: toRepoPath(root, target),
  };
}

/**
 * Walk the import graph from `entries` (repo-relative) under `root`.
 * Returns the visited files in breadth-first order and the findings.
 */
export function scanMainRuntimeImports({
  root,
  entries = ENTRY_POINTS,
  dependencies,
  allowlist = ALLOWLIST,
}) {
  const allowed = new Set([...dependencies, ...RUNTIME_PROVIDED]);
  const parents = new Map();
  const queue = [];
  const findings = [];
  const usedAllowlist = new Set();
  const commonJsExports = new Map();

  const chainOf = (file) => {
    const chain = [];
    for (let current = file; current !== null; current = parents.get(current)) {
      chain.unshift(toRepoPath(root, current));
    }
    return chain;
  };

  for (const entry of entries) {
    const absolute = path.join(root, entry);
    if (!isFile(absolute)) {
      findings.push({ kind: 'missing-entry', file: entry });
    } else if (!parents.has(absolute)) {
      parents.set(absolute, null);
      queue.push(absolute);
    }
  }

  for (let index = 0; index < queue.length; index += 1) {
    const file = queue[index];
    if (!PARSED_EXTENSIONS.has(path.extname(file))) continue;
    for (const { specifier, kind, line, names } of collectImports(
      file,
      fs.readFileSync(file, 'utf8'),
    )) {
      const repoFile = toRepoPath(root, file);
      const key = `${repoFile} -> ${specifier}`;
      const base = { file: repoFile, specifier, line, chain: chainOf(file) };
      if (/^\.{1,2}(?:\/|$)/.test(specifier)) {
        const target = resolveRelative(file, specifier, kind);
        if (target === null) {
          findings.push({ kind: 'missing-module', key, ...base });
        } else if (!parents.has(target)) {
          parents.set(target, file);
          queue.push(target);
        }
        continue;
      }
      const packageName = packageNameOf(specifier);
      if (packageName === null || RUNTIME_PROVIDED.includes(packageName)) continue;
      const finding = allowed.has(packageName)
        ? namedExportFinding({ root, file, specifier, packageName, names, cache: commonJsExports })
        : { kind: 'not-a-runtime-dependency', packageName };
      if (finding === null) continue;
      if (Object.hasOwn(allowlist, key)) {
        usedAllowlist.add(key);
        continue;
      }
      findings.push({ ...finding, key, ...base });
    }
  }

  for (const key of Object.keys(allowlist)) {
    if (!usedAllowlist.has(key)) findings.push({ kind: 'stale-allowlist', key });
  }

  return { visited: queue.map((file) => toRepoPath(root, file)), findings };
}

export function formatFinding(finding) {
  switch (finding.kind) {
    case 'missing-entry':
      return `${finding.file}: entry point not found; run \`pnpm run build:main\` first, or update ENTRY_POINTS.`;
    case 'stale-allowlist':
      return `ALLOWLIST entry '${finding.key}' matches no import; remove it.`;
    case 'missing-named-export':
      return `${finding.file}:${finding.line} imports { ${finding.names.join(', ')} } from '${finding.specifier}', but Node's ESM loader cannot find ${finding.names.length === 1 ? 'that name' : 'those names'} in the CommonJS module ${finding.module}, so the app crashes at startup. Use a default import and destructure it.\n    via ${finding.chain.join(' -> ')}`;
    case 'missing-module':
      return `${finding.file}:${finding.line} imports '${finding.specifier}', which was not built.\n    via ${finding.chain.join(' -> ')}`;
    default:
      return `${finding.file}:${finding.line} imports '${finding.specifier}', but ${finding.packageName} is not in package.json dependencies, so the packaged app cannot load it.\n    via ${finding.chain.join(' -> ')}`;
  }
}

function main() {
  const root = process.cwd();
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const dependencies = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ];
  const { visited, findings } = scanMainRuntimeImports({ root, dependencies });
  if (findings.length > 0) {
    for (const finding of findings) console.error(`✗ ${formatFinding(finding)}`);
    console.error(
      [
        '',
        `Main-process code must import only runtime dependencies (${findings.length} problem(s)).`,
        'Move the package to dependencies, or keep the import out of the main-process graph.',
        'For a CommonJS package, import its default export and destructure the names.',
        `A deliberate exception is an ALLOWLIST entry in scripts/verify-main-runtime-imports.mjs.`,
      ].join('\n'),
    );
    process.exit(1);
  }
  console.log(`✓ ${visited.length} main-process modules import only runtime dependencies.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
