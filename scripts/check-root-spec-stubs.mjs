import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { isRootSpec, ROOT_TEST_DIR } from '../playwright/root-spec-pattern.mjs';
import {
  collectImports,
  readAliases,
  resolveSpecifier,
  stubExports,
} from './check-electron-test-paths.mjs';

// Root Playwright specs (`test/**/*.spec.ts`) run only in the nightly browser suite, never
// in PR CI. A spec that mounts a real component can replace some of its modules with
// hand-written virtual modules (`'$store/…/tab-state-slice': 'export const …'`). When the
// component graph starts importing a new name from a stubbed module, the stub no longer
// provides it and the page fails with "does not provide an export named …" — a day after
// merge. The tab strip geometry spec broke this way twice (intent-hq/intent#8750/#8751,
// fixed by cloudlands-fe#4282; intent-hq/intent#9311/#9312, fixed by cloudlands-fe#4607).
//
// A stub map is an object literal bound to a variable that a Vite `load` hook in the spec
// reads, whose string keys hold module code (at least one with an `export`). Its entries
// are the existing `src/…` / `/src/…` code files the spec names, except those it names
// only to replace. The gate walks the import graph from the entries (and from the stubs'
// own imports) the way the spec's plugin resolves modules, assuming its `resolveId`:
//   - first applies literal redirects (`if (source === '<id>' || source === resolve(…))
//     return resolve(…)`), which shadow any stub for the same id;
//   - then serves a stub when the specifier is its key, or the same path once a tsconfig
//     alias is expanded (Vite's alias plugin runs first); relative imports reach the real
//     module.
// Svelte compiles `<script lang="ts">` itself, so a component keeps every import not
// marked `type`; TypeScript modules drop value imports used only as types. It reports:
//   (a) a stub that does not export a value name a reachable importer needs, directly or
//       through `export *` barrels;
//   (b) a stub that replaces no reachable import (dead code that hides the next drift);
//   (c) a stub map with no entry to walk from.
export const SCRIPT_PATH = 'scripts/check-root-spec-stubs.mjs';
export const INCIDENTS = Object.freeze([
  'https://github.com/intent-hq/intent/issues/9311',
  'https://github.com/intent-hq/intent/issues/8750',
]);

// Documented exceptions: finding key (printed with each finding) → one-line justification.
// An entry that no longer matches a finding is reported as stale and must be removed.
export const ALLOWLIST = Object.freeze({});

export const REMEDIATION_HINT = [
  'Root Playwright specs run only nightly, so update their virtual-module stubs with the',
  'source they replace: export every name the mounted component graph imports, and delete',
  `stubs nothing imports. Stale stubs broke the nightly twice (${INCIDENTS.join(', ')}).`,
  `A deliberate exception is an ALLOWLIST entry in ${SCRIPT_PATH} with a one-line justification.`,
].join('\n');

// Inputs besides root specs: alias resolution and spec discovery.
const CONFIG_INPUTS = new Set(['tsconfig.json', 'playwright/root-spec-pattern.mjs']);
const CODE_EXTENSIONS = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.svelte']);
const ENTRY_PATTERN = /^\/?src\/[^\s*?{}[\]!$`'"\\]+$/;
const SVELTE_SCRIPT_PATTERN = /(<script\b(?:[^>"']|"[^"]*"|'[^']*')*>)([\s\S]*?)<\/script>/g;
const IDENTIFIER_PATTERN = /[A-Za-z_$][\w$]*/g;
const PATH_FUNCTIONS = new Set(['join', 'resolve']);

const normalize = (value) => value.split(path.sep).join('/');

const isStringLike = (node) =>
  node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));

const parse = (fileName, text) =>
  ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const lineOf = (node) =>
  node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;

const hasModifier = (node, kind) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);

function isFile(absolute) {
  try {
    return fs.statSync(absolute).isFile();
  } catch {
    return false;
  }
}

/** Repo-relative paths of the root Playwright specs `playwright.config.ts` discovers. */
export function collectRootSpecs(root) {
  return fs
    .globSync(`${ROOT_TEST_DIR}/**/*.spec.ts`, { cwd: root })
    .map(normalize)
    .filter((file) => isRootSpec(file) && isFile(path.join(root, file)))
    .sort();
}

function hasExport(code) {
  return parse('stub.mjs', code).statements.some(
    (statement) =>
      ts.isExportDeclaration(statement) ||
      ts.isExportAssignment(statement) ||
      hasModifier(statement, ts.SyntaxKind.ExportKeyword),
  );
}

function hookName(node) {
  if (!node.name || !(ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) return null;
  if (ts.isMethodDeclaration(node)) return node.name.text;
  if (
    ts.isPropertyAssignment(node) &&
    (ts.isFunctionExpression(node.initializer) || ts.isArrowFunction(node.initializer))
  )
    return node.name.text;
  return null;
}

/** `resolveId` / `load` hook functions declared anywhere in the spec. */
function collectHooks(sourceFile) {
  const hooks = { resolveId: [], load: [] };
  const visit = (node) => {
    const name = hookName(node);
    if (name === 'resolveId' || name === 'load') {
      hooks[name].push(ts.isMethodDeclaration(node) ? node : node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return hooks;
}

function identifiersIn(nodes) {
  const names = new Set();
  const visit = (node) => {
    if (ts.isIdentifier(node)) names.add(node.text);
    ts.forEachChild(node, visit);
  };
  nodes.forEach(visit);
  return names;
}

/** Stub maps in a spec: `{ node, stubs: [{ id, code, line }] }`. */
function findStubMaps(sourceFile) {
  const loaded = identifiersIn(collectHooks(sourceFile).load);
  const maps = [];
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      loaded.has(node.name.text) &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      const stubs = [];
      for (const property of node.initializer.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          ts.isStringLiteral(property.name) &&
          isStringLike(property.initializer)
        ) {
          stubs.push({
            id: property.name.text,
            code: property.initializer.text,
            line: lineOf(property),
          });
        }
      }
      if (stubs.some((stub) => hasExport(stub.code))) maps.push({ node, stubs });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return maps;
}

/** Does a changed file feed this gate? A root spec that defines a stub map, or its config. */
export function isRootSpecStubInput(file, root) {
  if (CONFIG_INPUTS.has(file)) return true;
  if (!isRootSpec(file)) return false;
  const absolute = path.join(root, file);
  if (!isFile(absolute)) return false;
  return findStubMaps(parse(absolute, fs.readFileSync(absolute, 'utf8'))).length > 0;
}

/** A static path expression (`'x'`, `resolve(process.cwd(), 'x')`) as an absolute path. */
function evaluatePath(node, root) {
  if (isStringLike(node)) return node.text;
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'cwd' &&
    node.arguments.length === 0
  )
    return root;
  if (!ts.isCallExpression(node)) return null;
  const callee = node.expression;
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : null;
  if (!PATH_FUNCTIONS.has(name)) return null;
  const parts = node.arguments.map((argument) => evaluatePath(argument, root));
  return parts.some((part) => part === null) ? null : path.resolve(root, ...parts);
}

function returnedExpression(statement) {
  if (ts.isReturnStatement(statement)) return statement.expression;
  if (ts.isBlock(statement) && statement.statements.length === 1)
    return returnedExpression(statement.statements[0]);
  return undefined;
}

/**
 * Literal redirects in the spec's `resolveId` hooks: `{ ids, paths, target }` for each
 * `if (source === '<id>' || source === resolve(…)) return resolve(…)`.
 */
function collectRedirects(sourceFile, root) {
  const redirects = [];
  for (const hook of collectHooks(sourceFile).resolveId) {
    const parameter = hook.parameters[0];
    if (!parameter || !ts.isIdentifier(parameter.name) || !hook.body) continue;
    const source = parameter.name.text;
    const visit = (node) => {
      if (ts.isIfStatement(node)) {
        const returned = returnedExpression(node.thenStatement);
        const target = returned ? evaluatePath(returned, root) : null;
        const ids = new Set();
        const paths = new Set();
        const collect = (condition) => {
          if (ts.isParenthesizedExpression(condition)) return collect(condition.expression);
          if (!ts.isBinaryExpression(condition)) return false;
          const operator = condition.operatorToken.kind;
          if (operator === ts.SyntaxKind.BarBarToken)
            return collect(condition.left) && collect(condition.right);
          if (operator !== ts.SyntaxKind.EqualsEqualsEqualsToken) return false;
          const other =
            ts.isIdentifier(condition.left) && condition.left.text === source
              ? condition.right
              : ts.isIdentifier(condition.right) && condition.right.text === source
                ? condition.left
                : null;
          if (!other) return false;
          if (isStringLike(other)) ids.add(other.text);
          else {
            const absolute = evaluatePath(other, root);
            if (absolute === null) return false;
            paths.add(absolute);
          }
          return true;
        };
        if (target && path.isAbsolute(target) && collect(node.expression)) {
          redirects.push({ ids, paths, target });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(hook.body);
  }
  return redirects;
}

/** Existing `src/…` code files named by string literals in the spec (object keys excluded). */
function collectEntries(sourceFile, root) {
  const entries = new Set();
  const visit = (node) => {
    if (
      isStringLike(node) &&
      ENTRY_PATTERN.test(node.text) &&
      !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)
    ) {
      const absolute = path.join(root, node.text);
      if (CODE_EXTENSIONS.has(path.extname(absolute)) && isFile(absolute)) entries.add(absolute);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...entries];
}

/** Value names a module exports itself, and whether it has `export *` (resolved by the walk). */
function ownExports(sourceFile) {
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly || !statement.exportClause) continue;
      if (ts.isNamespaceExport(statement.exportClause)) names.add(statement.exportClause.name.text);
      else for (const element of statement.exportClause.elements) names.add(element.name.text);
    } else if (ts.isExportAssignment(statement)) {
      names.add('default');
    } else if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) names.add('default');
      else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
        }
      } else if (statement.name && ts.isIdentifier(statement.name)) {
        names.add(statement.name.text);
      }
    }
  }
  return names;
}

/** `{ imports, exports }` of a source file; a Svelte component keeps every value import. */
function readModule(absolute, cache) {
  if (cache.has(absolute)) return cache.get(absolute);
  const module = { imports: [], exports: new Set() };
  try {
    const text = fs.readFileSync(absolute, 'utf8');
    if (absolute.endsWith('.svelte')) {
      module.exports.add('default');
      const everything = new Set(text.match(IDENTIFIER_PATTERN));
      for (const match of text.matchAll(SVELTE_SCRIPT_PATTERN)) {
        const offset = text.slice(0, match.index + match[1].length).split('\n').length - 1;
        const script = parse(`${absolute}.ts`, match[2]);
        for (const entry of collectImports(script, everything)) {
          module.imports.push({ ...entry, line: entry.line + offset });
        }
        if (/\bmodule\b|context=["']module["']/.test(match[1])) {
          for (const name of ownExports(script)) module.exports.add(name);
        }
      }
    } else {
      const sourceFile = parse(absolute, text);
      module.imports = collectImports(sourceFile);
      module.exports = ownExports(sourceFile);
    }
  } catch {
    // An unreadable module contributes nothing.
  }
  cache.set(absolute, module);
  return module;
}

/** `$alias/x` → absolute path (no extension probing, as Vite's alias plugin does). */
function expandAlias(specifier, aliases) {
  if (path.isAbsolute(specifier)) return specifier;
  for (const [name, target] of aliases) {
    if (specifier === name) return target;
    if (specifier.startsWith(`${name}/`))
      return path.join(target, specifier.slice(name.length + 1));
  }
  return null;
}

function resolveImport(fromFile, specifier, root, aliases) {
  const resolved = resolveSpecifier(fromFile, specifier, aliases);
  if (resolved || !specifier.startsWith('/')) return resolved;
  return resolveSpecifier(fromFile, path.join(root, specifier), aliases);
}

const isSourceModule = (resolved, root) =>
  resolved &&
  resolved.startsWith(root + path.sep) &&
  !resolved.includes(`${path.sep}node_modules${path.sep}`) &&
  CODE_EXTENSIONS.has(path.extname(resolved));

/**
 * Walk from `entries` the way the spec's plugin resolves imports. Records on each stub the
 * imports it serves (`uses`) and the `export *` that forward it (`stars`), and returns the
 * graph's edges between source files for re-export propagation.
 */
function walkGraph({ root, spec, entries, stubs, redirects, aliases, cache }) {
  const keyOf = new Map(stubs.map((stub) => [stub, expandAlias(stub.id, aliases)]));
  const target = (specifier, importer) => {
    const expanded = expandAlias(specifier, aliases);
    const redirect = redirects.find(
      (candidate) =>
        candidate.ids.has(specifier) || (expanded !== null && candidate.paths.has(expanded)),
    );
    if (redirect) return { file: redirect.target };
    const stub = stubs.find(
      (candidate) =>
        candidate.id === specifier || (expanded !== null && keyOf.get(candidate) === expanded),
    );
    if (stub) return { stub };
    return { file: resolveImport(importer, specifier, root, aliases) };
  };
  const edges = [];
  const queue = entries.map((file) => ({ file, imports: readModule(file, cache).imports }));
  const seen = new Set(entries);
  while (queue.length) {
    const { file, imports } = queue.shift();
    for (const entry of imports) {
      const resolved = target(entry.specifier, file);
      if (resolved.stub) {
        const { stub } = resolved;
        (entry.star ? stub.stars : stub.uses).push({ importer: file, ...entry });
        if (!seen.has(stub)) {
          seen.add(stub);
          // A stub's own imports (a mock component) join the graph, attributed to the spec.
          queue.push({ file: spec, imports: collectImports(parse('stub.mjs', stub.code)) });
        }
        continue;
      }
      if (!isSourceModule(resolved.file, root)) continue;
      edges.push({ importer: file, target: resolved.file, ...entry });
      if (!seen.has(resolved.file)) {
        seen.add(resolved.file);
        queue.push({ file: resolved.file, imports: readModule(resolved.file, cache).imports });
      }
    }
  }
  return edges;
}

/**
 * Names asked of each `export *` that forwards a stub and that neither the forwarding
 * module nor its other sources export: `{ stub, importer, line, missing }`.
 */
function starShortfalls(stubs, edges, cache) {
  const requested = new Map();
  const requestedOf = (file, visiting = new Set()) => {
    if (requested.has(file)) return requested.get(file);
    if (visiting.has(file)) return new Set();
    visiting.add(file);
    const names = new Set();
    for (const edge of edges) {
      if (edge.target !== file) continue;
      if (edge.star) for (const name of requestedOf(edge.importer, visiting)) names.add(name);
      else if (edge.names) for (const name of edge.names) names.add(name);
    }
    requested.set(file, names);
    return names;
  };
  const exportedOf = (file, visiting = new Set()) => {
    if (visiting.has(file)) return new Set();
    visiting.add(file);
    const names = new Set(readModule(file, cache).exports);
    for (const edge of edges) {
      if (edge.importer !== file || !edge.star) continue;
      for (const name of exportedOf(edge.target, visiting)) if (name !== 'default') names.add(name);
    }
    for (const stub of stubs) {
      if (!stub.stars.some((star) => star.importer === file)) continue;
      const exported = stubExports(stub.code);
      if (!exported) return null;
      for (const name of exported) if (name !== 'default') names.add(name);
    }
    return names;
  };
  const shortfalls = [];
  for (const stub of stubs) {
    for (const star of stub.stars) {
      const exported = exportedOf(star.importer);
      if (!exported) continue;
      const missing = [...requestedOf(star.importer)].filter(
        (name) => name !== 'default' && !exported.has(name),
      );
      if (missing.length)
        shortfalls.push({ stub, importer: star.importer, line: star.line, missing });
    }
  }
  return shortfalls;
}

/** Findings for the given root specs: `{ key, file, line, message }`. */
export function checkRootSpecStubs(root, files = collectRootSpecs(root)) {
  const findings = [];
  const aliases = readAliases(root);
  const cache = new Map();
  const relative = (absolute) => normalize(path.relative(root, absolute));
  for (const file of files) {
    const absoluteFile = path.join(root, file);
    const sourceFile = parse(absoluteFile, fs.readFileSync(absoluteFile, 'utf8'));
    const maps = findStubMaps(sourceFile);
    if (maps.length === 0) continue;
    const redirects = collectRedirects(sourceFile, root);
    const entries = collectEntries(sourceFile, root);
    const shown = (absolute) => (absolute === absoluteFile ? file : relative(absolute));
    for (const map of maps) {
      // A path the spec names only to match and replace it (`id === resolve('src/…')`) is
      // not mounted; a redirect target is reached through the import it replaces.
      const replaced = new Set([
        ...map.stubs.map((stub) => resolveSpecifier(root, stub.id, aliases)),
        ...redirects.flatMap((redirect) => [...redirect.paths, redirect.target]),
      ]);
      const mapEntries = entries.filter((entry) => !replaced.has(entry));
      if (mapEntries.length === 0) {
        findings.push({
          key: `${file}: entries`,
          file,
          line: lineOf(map.node),
          message:
            'no mounted entry found for these virtual-module stubs; name the component as a ' +
            "'src/…' or '/src/…' literal in this spec so its stubs can be checked",
        });
        continue;
      }
      const stubs = map.stubs.map((stub) => ({ ...stub, uses: [], stars: [] }));
      const edges = walkGraph({
        root,
        spec: absoluteFile,
        entries: mapEntries,
        stubs,
        redirects,
        aliases,
        cache,
      });
      const entryList = mapEntries.map(relative).join(', ');
      for (const stub of stubs) {
        if (stub.uses.length === 0 && stub.stars.length === 0) {
          findings.push({
            key: `${file}: ${stub.id}`,
            file,
            line: stub.line,
            message: `stub '${stub.id}' replaces no import reachable from ${entryList}`,
          });
          continue;
        }
        const exported = stubExports(stub.code);
        if (!exported) continue;
        for (const use of stub.uses) {
          const missing = use.names ? [...use.names].filter((name) => !exported.has(name)) : [];
          if (missing.length === 0) continue;
          const importer = shown(use.importer);
          findings.push({
            key: `${file}: ${stub.id} <- ${importer}`,
            file,
            line: stub.line,
            message: `stub '${stub.id}' does not export ${missing.join(', ')}, which ${importer}:${use.line} imports`,
          });
        }
      }
      for (const { stub, importer, line, missing } of starShortfalls(stubs, edges, cache)) {
        findings.push({
          key: `${file}: ${stub.id} <- ${shown(importer)}`,
          file,
          line: stub.line,
          message: `stub '${stub.id}' does not export ${missing.join(', ')}, which ${shown(importer)}:${line} re-exports with export *`,
        });
      }
    }
  }
  const unique = new Map(findings.map((finding) => [`${finding.key}|${finding.message}`, finding]));
  return [...unique.values()];
}

/** Split findings into reported hits and stale ALLOWLIST keys. */
export function applyAllowlist(findings, allowlist = ALLOWLIST) {
  const keys = new Set(findings.map((finding) => finding.key));
  return {
    hits: findings.filter((finding) => !Object.hasOwn(allowlist, finding.key)),
    stale: Object.keys(allowlist).filter((key) => !keys.has(key)),
  };
}

export const formatFinding = (finding) =>
  `${finding.file}:${finding.line}: ${finding.message}  [key: ${finding.key}]`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.cwd();
  const files = collectRootSpecs(root);
  const { hits, stale } = applyAllowlist(checkRootSpecStubs(root, files));
  if (hits.length || stale.length) {
    const lines = [];
    if (hits.length) {
      lines.push(
        `Stale virtual-module stub${hits.length === 1 ? '' : 's'} in root Playwright specs:`,
      );
      lines.push(...hits.map((hit) => `  ${formatFinding(hit)}`), '', REMEDIATION_HINT);
    }
    if (stale.length) {
      lines.push(
        `Stale ALLOWLIST ${stale.length === 1 ? 'entry' : 'entries'} in ${SCRIPT_PATH}:`,
        ...stale.map((key) => `  ${key}`),
      );
    }
    console.error(lines.join('\n'));
    process.exit(1);
  }
  console.log(
    `root-spec-stubs: ${files.length} root specs' virtual-module stubs match their importers.`,
  );
}
