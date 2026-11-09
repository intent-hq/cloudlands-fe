import fs from 'node:fs';
import { isBuiltin } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// electron-builder drops devDependencies from the packaged node_modules, so a
// main-process import of one (svelte reached the main process in
// cloudlands-fe#654) crashes the packaged app at startup. This walks the
// built import graph from the main-process entry points and fails on any
// import the packaged app cannot resolve: a package outside `dependencies`, an
// alias the ESM import fixer left behind, or a relative file that was not
// built. It reads the graph from `dist`, so a renamed module cannot drop out
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

/** Static imports, re-exports, literal `import()`, and literal `require()` calls. */
function collectImports(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const imports = [];
  const add = (node, specifier, kind) => {
    if (specifier === null) return;
    const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    imports.push({ specifier, kind, line });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node, literalText(node.moduleSpecifier), 'import');
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
    for (const { specifier, kind, line } of collectImports(file, fs.readFileSync(file, 'utf8'))) {
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
      if (packageName === null || allowed.has(packageName)) continue;
      if (Object.hasOwn(allowlist, key)) {
        usedAllowlist.add(key);
        continue;
      }
      findings.push({ kind: 'not-a-runtime-dependency', key, packageName, ...base });
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
        `A deliberate exception is an ALLOWLIST entry in scripts/verify-main-runtime-imports.mjs.`,
      ].join('\n'),
    );
    process.exit(1);
  }
  console.log(`✓ ${visited.length} main-process modules import only runtime dependencies.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
