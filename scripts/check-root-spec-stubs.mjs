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
// A stub map is an object literal in a root spec whose string-keyed properties hold module
// code, at least one of them with an `export`. Its build entries are the existing `src/…`
// or `/src/…` code files the spec names. This gate walks the import graph from those
// entries (and from the stubs' own imports), the way the spec's plugin replaces modules:
// an import is stubbed when its specifier is the key, or the same path once a tsconfig
// alias is expanded; a relative import reaches the real module. It reports:
//   (a) a stub that does not export a value name a reachable importer needs (type-only
//       imports and imports used only as types are ignored);
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

const CODE_EXTENSIONS = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.svelte']);
const ENTRY_PATTERN = /^\/?src\/[^\s*?{}[\]!$`'"\\]+$/;
const SVELTE_SCRIPT_PATTERN = /(<script\b[^>]*>)([\s\S]*?)<\/script>/g;
const SVELTE_NON_MARKUP_PATTERN = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g;
const IDENTIFIER_PATTERN = /[A-Za-z_$][\w$]*/g;

const normalize = (value) => value.split(path.sep).join('/');

const isStringLike = (node) =>
  node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));

const parse = (fileName, text) =>
  ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const lineOf = (node) =>
  node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;

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
      (ts.canHaveModifiers(statement) &&
        (ts.getModifiers(statement) ?? []).some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        )),
  );
}

/** Stub maps in a spec: `{ node, stubs: [{ id, code, line }] }`. */
function findStubMaps(sourceFile) {
  const maps = [];
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const stubs = [];
      for (const property of node.properties) {
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

/** Does a changed file feed this gate? True for a root spec that defines a stub map. */
export function isRootSpecStubInput(file, root) {
  if (!isRootSpec(file)) return false;
  const absolute = path.join(root, file);
  if (!isFile(absolute)) return false;
  return findStubMaps(parse(absolute, fs.readFileSync(absolute, 'utf8'))).length > 0;
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

/** Imports of a source file; a Svelte component's markup counts as using its imports. */
function readModule(absolute, cache) {
  if (cache.has(absolute)) return cache.get(absolute);
  let imports = [];
  try {
    const text = fs.readFileSync(absolute, 'utf8');
    if (absolute.endsWith('.svelte')) {
      const markup = new Set(text.replace(SVELTE_NON_MARKUP_PATTERN, '').match(IDENTIFIER_PATTERN));
      for (const match of text.matchAll(SVELTE_SCRIPT_PATTERN)) {
        const offset = text.slice(0, match.index + match[1].length).split('\n').length - 1;
        for (const entry of collectImports(parse(`${absolute}.ts`, match[2]), markup)) {
          imports.push({ ...entry, line: entry.line + offset });
        }
      }
    } else {
      imports = collectImports(parse(absolute, text));
    }
  } catch {
    imports = [];
  }
  cache.set(absolute, imports);
  return imports;
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

/** Walk from `entries`, recording each import a stub replaces; stubs are not descended. */
function walkGraph({ root, spec, entries, stubs, aliases, cache }) {
  const keyOf = new Map(stubs.map((stub) => [stub, expandAlias(stub.id, aliases)]));
  const stubFor = (specifier) => {
    const expanded = expandAlias(specifier, aliases);
    return stubs.find(
      (stub) => stub.id === specifier || (expanded !== null && keyOf.get(stub) === expanded),
    );
  };
  const queue = entries.map((file) => ({ file, imports: () => readModule(file, cache) }));
  const seen = new Set(entries);
  while (queue.length) {
    const { file, imports } = queue.shift();
    for (const entry of imports()) {
      const stub = stubFor(entry.specifier);
      if (stub) {
        stub.uses.push({ importer: file, ...entry });
        if (!seen.has(stub)) {
          seen.add(stub);
          // A stub's own imports (a mock component) join the graph, attributed to the spec.
          queue.push({ file: spec, imports: () => collectImports(parse('stub.mjs', stub.code)) });
        }
        continue;
      }
      const resolved = resolveImport(file, entry.specifier, root, aliases);
      if (
        resolved &&
        !seen.has(resolved) &&
        resolved.startsWith(root + path.sep) &&
        !resolved.includes(`${path.sep}node_modules${path.sep}`) &&
        CODE_EXTENSIONS.has(path.extname(resolved))
      ) {
        seen.add(resolved);
        queue.push({ file: resolved, imports: () => readModule(resolved, cache) });
      }
    }
  }
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
    const entries = collectEntries(sourceFile, root);
    for (const map of maps) {
      // A path the spec names only to match and replace it (`id === resolve('src/…')`) is
      // not mounted.
      const replaced = new Set(map.stubs.map((stub) => resolveSpecifier(root, stub.id, aliases)));
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
      const stubs = map.stubs.map((stub) => ({ ...stub, uses: [] }));
      walkGraph({ root, spec: absoluteFile, entries: mapEntries, stubs, aliases, cache });
      const entryList = mapEntries.map(relative).join(', ');
      for (const stub of stubs) {
        if (stub.uses.length === 0) {
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
          const importer = use.importer === absoluteFile ? file : relative(use.importer);
          findings.push({
            key: `${file}: ${stub.id} <- ${importer}`,
            file,
            line: stub.line,
            message: `stub '${stub.id}' does not export ${missing.join(', ')}, which ${importer}:${use.line} imports`,
          });
        }
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
