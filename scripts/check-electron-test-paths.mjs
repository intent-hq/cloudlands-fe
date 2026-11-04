import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Electron suite helpers (`test/electron*.ts`, `test/fixtures/**/*.ts`) run only in the
// merge queue's test-electron job, so a pull request never resolves the source paths they
// name. cloudlands-fe#4050 renamed src/features/backend/main/connections-store to
// desktop-connections-store with a green PR; the queue then rejected it because the
// fixtures still pointed at the old module (fix: 925d482).
//
// `tsconfig.electron-tests.json` type-checks these files, which catches a stale static or
// `import()` path. This gate covers what tsc cannot see, because the paths are runtime
// strings:
//   (a) repository path literals — a string such as 'src/main/dock-window.ts' or
//       'test/fixtures/browser-lifetime' (passed to `resolve()`, used as a build entry,
//       ...) must name an existing file or directory, optionally without its extension;
//   (b) Vite `resolveId` stubs — each source-module matcher in a `resolveId(id)` hook
//       (`id === './x'`, `id.endsWith('/x')`, `/re/.test(id)`) must match an import that
//       is reachable from the build entries named in the same function, and when the
//       stub's `load()` returns literal code, that code must export every value the
//       intercepted import needs. A renamed module either leaves the stub matching
//       nothing or makes it intercept a different module whose importers need other
//       names — the cloudlands-fe#4050 dock fixture's `endsWith('/connections-store')`
//       silently started replacing `./connections-store` inside
//       desktop-connections-store.ts.
// Matchers combined with another condition (`importer.endsWith(...) && id === ...`) only
// need to match something; virtual ids (`id === 'fixture-renderer'`) are not checked.
export const SCRIPT_PATH = 'scripts/check-electron-test-paths.mjs';
export const TSCONFIG_PATH = 'tsconfig.electron-tests.json';
export const SCAN_PATTERNS = Object.freeze(['test/electron*.ts', 'test/fixtures/**/*.ts']);
export const INCIDENTS = Object.freeze(['https://github.com/intent-hq/cloudlands-fe/pull/4050']);

// Documented exceptions: finding key (printed with each finding) → one-line justification.
// An entry that no longer matches a finding is reported as stale and must be removed.
export const ALLOWLIST = Object.freeze({});

export const REMEDIATION_HINT = [
  'Electron helpers run only in the merge queue, so update them with the source they name:',
  'point the path, `resolveId` matcher, or stub exports at the module as it is now.',
  `A stale helper path passed PR CI on cloudlands-fe#4050 (${INCIDENTS[0]}) and failed the queue.`,
  `A deliberate exception is an ALLOWLIST entry in ${SCRIPT_PATH} with a one-line justification.`,
].join('\n');

/** Files whose change can break this gate's input: the helpers and their tsconfig. */
export function isElectronTestPathInput(file) {
  return file === TSCONFIG_PATH || SCAN_PATTERNS.some((pattern) => path.matchesGlob(file, pattern));
}

const REPO_PATH_PATTERN = /^(?:\.\/)?(?:src|test)\/[^\s*?{}[\]!$`'"\\]+$/;
const CODE_EXTENSIONS = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.svelte']);
const RESOLVE_EXTENSIONS = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.svelte', '.json'];
const SVELTE_SCRIPT_PATTERN = /<script\b[^>]*>([\s\S]*?)<\/script>/g;

const normalize = (value) => value.split(path.sep).join('/');

function isFile(absolute) {
  try {
    return fs.statSync(absolute).isFile();
  } catch {
    return false;
  }
}

/** Repo-relative paths of the scanned helpers, sorted. */
export function collectHelperFiles(root) {
  const files = new Set();
  for (const pattern of SCAN_PATTERNS) {
    for (const match of fs.globSync(pattern, { cwd: root })) {
      if (isFile(path.join(root, match))) files.add(normalize(match));
    }
  }
  return [...files].sort();
}

/** `$alias` → absolute target, from tsconfig.json `compilerOptions.paths`. */
export function readAliases(root) {
  const configPath = path.join(root, 'tsconfig.json');
  const aliases = new Map();
  if (!fs.existsSync(configPath)) return aliases;
  const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
  for (const [key, targets] of Object.entries(config?.compilerOptions?.paths ?? {})) {
    if (!Array.isArray(targets) || targets.length === 0) continue;
    const name = key.replace(/\/\*$/, '');
    if (!aliases.has(name)) aliases.set(name, path.resolve(root, targets[0].replace(/\/\*$/, '')));
  }
  return aliases;
}

function probe(base) {
  const candidates = [base];
  for (const extension of RESOLVE_EXTENSIONS) candidates.push(base + extension);
  if (/\.[cm]?js$/.test(base)) candidates.push(base.replace(/js$/, 'ts'));
  for (const extension of RESOLVE_EXTENSIONS) candidates.push(path.join(base, `index${extension}`));
  return candidates.find(isFile) ?? null;
}

/** Resolve an import specifier the way the fixtures' Vite builds would, or null. */
export function resolveSpecifier(fromFile, specifier, aliases) {
  const bare = specifier.replace(/[?#].*$/, '');
  if (bare.startsWith('.')) return probe(path.resolve(path.dirname(fromFile), bare));
  if (path.isAbsolute(bare)) return probe(bare);
  for (const [name, target] of aliases) {
    if (bare === name) return probe(target);
    if (bare.startsWith(`${name}/`)) return probe(path.join(target, bare.slice(name.length + 1)));
  }
  return null;
}

/** Does an absolute path name something on disk (extension optional)? */
export function pathExists(absolute) {
  return fs.existsSync(absolute) || RESOLVE_EXTENSIONS.some((ext) => isFile(absolute + ext));
}

function parse(fileName, text) {
  const extension = path.extname(fileName);
  const kind =
    extension === '.js' || extension === '.mjs' || extension === '.cjs'
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
}

const lineOf = (node) =>
  node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;

const isStringLike = (node) =>
  node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));

function isTypeOnlyContext(node) {
  return (
    ts.isTypeNode(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isImportDeclaration(node) ||
    (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined)
  );
}

/** Identifier texts used outside type positions — an import used only as a type is elided. */
function valueIdentifiers(sourceFile) {
  const names = new Set();
  const visit = (node) => {
    if (isTypeOnlyContext(node)) return;
    if (ts.isIdentifier(node)) names.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

/**
 * Imports of one module: `{ specifier, names, line }`, where `names` is the set of value
 * exports the import needs from the target, or null when it cannot be known statically.
 */
export function collectImports(sourceFile) {
  const imports = [];
  const used = valueIdentifiers(sourceFile);
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && isStringLike(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (!clause?.isTypeOnly) {
        const names = new Set();
        let known = true;
        if (clause?.name && used.has(clause.name.text)) names.add('default');
        const bindings = clause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) known = false;
        else if (bindings) {
          for (const element of bindings.elements) {
            if (element.isTypeOnly || !used.has(element.name.text)) continue;
            names.add((element.propertyName ?? element.name).text);
          }
        }
        const elided = clause !== undefined && known && names.size === 0;
        if (!elided)
          imports.push({
            specifier: node.moduleSpecifier.text,
            names: known ? names : null,
            line: lineOf(node),
          });
      }
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      isStringLike(node.moduleSpecifier)
    ) {
      if (!node.isTypeOnly) {
        let names = new Set();
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const element of node.exportClause.elements) {
            if (!element.isTypeOnly) names.add((element.propertyName ?? element.name).text);
          }
        } else if (node.exportClause) names = null;
        imports.push({ specifier: node.moduleSpecifier.text, names, line: lineOf(node) });
      }
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      isStringLike(node.arguments[0])
    ) {
      imports.push({ specifier: node.arguments[0].text, names: null, line: lineOf(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return imports;
}

/** Exported value names of stub module code, or null when they cannot be read statically. */
export function stubExports(code) {
  const sourceFile = parse('stub.mjs', code);
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) return null;
      for (const element of statement.exportClause.elements) names.add(element.name.text);
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      names.add('default');
      continue;
    }
    const modifiers = ts.canHaveModifiers(statement) ? (ts.getModifiers(statement) ?? []) : [];
    if (!modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
      names.add('default');
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
        else return null;
      }
    } else if (statement.name && ts.isIdentifier(statement.name)) {
      names.add(statement.name.text);
    }
  }
  return names;
}

function propertyName(node) {
  if (!node.name) return null;
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) return node.name.text;
  return null;
}

/** `resolveId` / `load` functions declared as methods or function-valued properties. */
function hookFunction(member, name) {
  if (propertyName(member) !== name) return null;
  if (ts.isMethodDeclaration(member)) return member;
  if (
    ts.isPropertyAssignment(member) &&
    (ts.isFunctionExpression(member.initializer) || ts.isArrowFunction(member.initializer))
  )
    return member.initializer;
  return null;
}

const firstParameterName = (fn) => {
  const parameter = fn.parameters[0];
  return parameter && ts.isIdentifier(parameter.name) ? parameter.name.text : null;
};

const isEquality = (kind) =>
  kind === ts.SyntaxKind.EqualsEqualsEqualsToken || kind === ts.SyntaxKind.EqualsEqualsToken;

function returnedLiteral(statement) {
  let found;
  const visit = (node) => {
    if (found !== undefined || ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) {
      const expression = node.expression;
      if (isStringLike(expression)) found = { text: expression.text, exact: true };
      else if (ts.isTemplateExpression(expression)) found = { text: null, exact: false };
      else found = { text: null, exact: false };
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(statement);
  return found;
}

/** The `if (...) return <value>` the matcher guards, as `{ text, exact }`, if any. */
function guardedReturn(matcherNode, boundary) {
  for (let node = matcherNode; node && node !== boundary; node = node.parent) {
    if (ts.isIfStatement(node.parent) && node.parent.expression === node) {
      return returnedLiteral(node.parent.thenStatement);
    }
    if (ts.isConditionalExpression(node.parent) && node.parent.condition === node) {
      const branch = node.parent.whenTrue;
      return isStringLike(branch) ? { text: branch.text, exact: true } : undefined;
    }
  }
  return undefined;
}

function isConditional(matcherNode, boundary) {
  for (let node = matcherNode; node && node !== boundary; node = node.parent) {
    const parent = node.parent;
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    )
      return true;
    if (ts.isIfStatement(parent) || ts.isReturnStatement(parent)) return false;
  }
  return false;
}

function regexFromLiteral(text) {
  const close = text.lastIndexOf('/');
  try {
    return new RegExp(text.slice(1, close), text.slice(close + 1));
  } catch {
    return null;
  }
}

/** Source-module matchers in one `resolveId` hook. */
function collectMatchers(fn) {
  const id = firstParameterName(fn);
  if (!id || !fn.body) return [];
  const isId = (node) => node && ts.isIdentifier(node) && node.text === id;
  const matchers = [];
  const add = (node, label, test, checked) => {
    if (!checked) return;
    const target = guardedReturn(node, fn);
    matchers.push({
      label,
      test,
      line: lineOf(node),
      conditional: isConditional(node, fn),
      stubId: target?.exact ? target.text : null,
      uses: [],
    });
  };
  const visit = (node) => {
    if (ts.isBinaryExpression(node) && isEquality(node.operatorToken.kind)) {
      const literal = isId(node.left) ? node.right : isId(node.right) ? node.left : null;
      if (isStringLike(literal)) {
        const value = literal.text;
        add(node, `=== '${value}'`, (s) => s === value, /^[./$]/.test(value));
      }
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      isId(node.expression.expression) &&
      isStringLike(node.arguments[0])
    ) {
      const method = node.expression.name.text;
      const value = node.arguments[0].text;
      if (method === 'endsWith' || method === 'startsWith' || method === 'includes') {
        add(node, `.${method}('${value}')`, (s) => s[method](value), true);
      }
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'test' &&
      node.expression.expression.kind === ts.SyntaxKind.RegularExpressionLiteral &&
      isId(node.arguments[0])
    ) {
      const text = node.expression.expression.getText();
      const regex = regexFromLiteral(text);
      if (regex) add(node, `${text}.test()`, (s) => regex.test(s), true);
    }
    ts.forEachChild(node, visit);
  };
  visit(fn.body);
  return matchers;
}

/** Literal code returned by `load(id)` for each `id === '<virtual id>'` branch. */
function collectLoadedCode(fn) {
  const id = firstParameterName(fn);
  const loaded = new Map();
  if (!id || !fn.body) return loaded;
  const visit = (node) => {
    if (
      ts.isBinaryExpression(node) &&
      isEquality(node.operatorToken.kind) &&
      ts.isIdentifier(node.left) &&
      node.left.text === id &&
      isStringLike(node.right)
    ) {
      const target = guardedReturn(node, fn);
      if (target) loaded.set(node.right.text, target.exact ? target.text : null);
    }
    ts.forEachChild(node, visit);
  };
  visit(fn.body);
  return loaded;
}

function nearestFunction(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionLike(current) && current.body) return current;
  }
  return node.getSourceFile();
}

const PATH_FUNCTIONS = new Set(['join', 'resolve']);

function calleeName(call) {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

const isImportMeta = (node, property) =>
  ts.isPropertyAccessExpression(node) &&
  ts.isMetaProperty(node.expression) &&
  node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
  node.name.text === property;

/**
 * Statically evaluate a path expression to an absolute path, or null when it depends on
 * runtime state (a temp dir, a parameter). The fixtures run with the package root as cwd.
 */
function evaluatePath(node, context, depth = 0) {
  if (!node || depth > 8) return null;
  const { root, file, checker } = context;
  if (isStringLike(node)) return node.text;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node))
    return evaluatePath(node.expression, context, depth + 1);
  if (isImportMeta(node, 'dirname')) return path.dirname(file);
  if (isImportMeta(node, 'filename')) return file;
  if (ts.isIdentifier(node)) {
    if (node.text === '__dirname') return path.dirname(file);
    if (node.text === '__filename') return file;
    const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
    if (
      declaration &&
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer &&
      ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const
    )
      return evaluatePath(declaration.initializer, context, depth + 1);
    return null;
  }
  if (!ts.isCallExpression(node)) return null;
  const name = calleeName(node);
  if (name === 'cwd' && node.arguments.length === 0) return root;
  if (name === 'fileURLToPath' && isImportMeta(node.arguments[0], 'url')) return file;
  if (name === 'dirname' && node.arguments.length === 1) {
    const inner = evaluatePath(node.arguments[0], context, depth + 1);
    return inner === null ? null : path.dirname(inner);
  }
  if (!PATH_FUNCTIONS.has(name)) return null;
  const parts = node.arguments.map((argument) => evaluatePath(argument, context, depth + 1));
  if (parts.some((part) => part === null)) return null;
  return name === 'resolve'
    ? path.resolve(root, ...parts)
    : path.resolve(root, path.join(...parts));
}

/**
 * Repository paths named inside `scope`: `{ node, text, absolute }` for each repo path
 * literal whose full path expression evaluates under the package root. Object keys and
 * paths joined onto a runtime directory (a temp scaffold) are not repository paths.
 */
function repoPathReferences(scope, context) {
  const references = [];
  const visit = (node) => {
    if (
      isStringLike(node) &&
      REPO_PATH_PATTERN.test(node.text) &&
      !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)
    ) {
      const call = node.parent;
      const inPathCall =
        ts.isCallExpression(call) &&
        PATH_FUNCTIONS.has(calleeName(call)) &&
        call.arguments.includes(node);
      const absolute = inPathCall
        ? evaluatePath(call, context)
        : path.resolve(context.root, node.text);
      if (absolute !== null && absolute.startsWith(context.root + path.sep)) {
        references.push({ node, text: node.text, absolute });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return references;
}

function readModule(absolute, cache) {
  if (cache.has(absolute)) return cache.get(absolute);
  let imports = [];
  try {
    const text = fs.readFileSync(absolute, 'utf8');
    if (absolute.endsWith('.svelte')) {
      for (const [, script] of text.matchAll(SVELTE_SCRIPT_PATTERN)) {
        imports.push(...collectImports(parse(`${absolute}.ts`, script)));
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

/**
 * Walk the import graph from `entries`, recording each import a matcher intercepts. An
 * unconditional stub replaces the module, so the walk does not descend into it.
 */
function walkGraph({ root, entries, matchers, aliases, cache }) {
  const queue = [...entries];
  const seen = new Set(queue);
  while (queue.length) {
    const file = queue.shift();
    for (const entry of readModule(file, cache)) {
      const hits = matchers.filter((matcher) => matcher.test(entry.specifier));
      for (const matcher of hits) matcher.uses.push({ importer: file, ...entry });
      if (hits.some((matcher) => !matcher.conditional && matcher.stubId)) continue;
      const resolved = resolveSpecifier(file, entry.specifier, aliases);
      if (
        resolved &&
        !seen.has(resolved) &&
        resolved.startsWith(root + path.sep) &&
        !resolved.includes(`${path.sep}node_modules${path.sep}`) &&
        CODE_EXTENSIONS.has(path.extname(resolved))
      ) {
        seen.add(resolved);
        queue.push(resolved);
      }
    }
  }
}

/**
 * Findings for the given helper files: `{ key, file, line, message }`. `key` is the
 * ALLOWLIST key for the finding.
 */
export function checkElectronTestPaths(root, files = collectHelperFiles(root)) {
  const findings = [];
  const aliases = readAliases(root);
  const cache = new Map();
  const relative = (absolute) => normalize(path.relative(root, absolute));
  const program = ts.createProgram(
    files.map((file) => path.join(root, file)),
    { allowJs: true, noLib: true, noResolve: true, types: [] },
  );
  const checker = program.getTypeChecker();
  for (const file of files) {
    const absoluteFile = path.join(root, file);
    const sourceFile = program.getSourceFile(absoluteFile);
    if (!sourceFile) continue;
    const context = { root, file: absoluteFile, checker };

    for (const reference of repoPathReferences(sourceFile, context)) {
      if (pathExists(reference.absolute)) continue;
      const shown = relative(reference.absolute);
      findings.push({
        key: `${file}: ${shown}`,
        file,
        line: lineOf(reference.node),
        message: `'${reference.text}' names ${shown}, which does not exist`,
      });
    }

    const plugins = [];
    const visit = (node) => {
      if (ts.isObjectLiteralExpression(node)) {
        const resolveId = node.properties.map((m) => hookFunction(m, 'resolveId')).find(Boolean);
        if (resolveId) {
          const load = node.properties.map((m) => hookFunction(m, 'load')).find(Boolean);
          plugins.push({ node, resolveId, load });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    for (const plugin of plugins) {
      const matchers = collectMatchers(plugin.resolveId);
      if (matchers.length === 0) continue;
      const loaded = plugin.load ? collectLoadedCode(plugin.load) : new Map();
      const scope = nearestFunction(plugin.node);
      const entries = [
        ...new Set(
          repoPathReferences(scope, context)
            .map((reference) => reference.absolute)
            .filter((absolute) => isFile(absolute) && CODE_EXTENSIONS.has(path.extname(absolute))),
        ),
      ];
      if (entries.length === 0) {
        findings.push({
          key: `${file}: resolveId entries`,
          file,
          line: lineOf(plugin.resolveId),
          message:
            'no build entry found for this resolveId plugin; name the entry file as a ' +
            "'src/…' literal in the same function so its stubs can be checked",
        });
        continue;
      }
      walkGraph({ root, entries, matchers, aliases, cache });
      const entryList = entries.map(relative).join(', ');
      for (const matcher of matchers) {
        if (matcher.uses.length === 0) {
          findings.push({
            key: `${file}: ${matcher.label}`,
            file,
            line: matcher.line,
            message: `resolveId stub ${matcher.label} matches no import reachable from ${entryList}`,
          });
          continue;
        }
        if (matcher.conditional || !matcher.stubId || !loaded.has(matcher.stubId)) continue;
        const code = loaded.get(matcher.stubId);
        const exported = code === null ? null : stubExports(code);
        if (!exported) continue;
        for (const use of matcher.uses) {
          const missing = use.names ? [...use.names].filter((name) => !exported.has(name)) : [];
          if (missing.length === 0) continue;
          findings.push({
            key: `${file}: ${matcher.label} <- ${relative(use.importer)}`,
            file,
            line: matcher.line,
            message:
              `resolveId stub ${matcher.label} intercepts '${use.specifier}' in ` +
              `${relative(use.importer)}:${use.line}, which needs ${missing.join(', ')} — ` +
              `not exported by the stub module`,
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
  const files = collectHelperFiles(root);
  const { hits, stale } = applyAllowlist(checkElectronTestPaths(root, files));
  if (hits.length || stale.length) {
    const lines = [];
    if (hits.length) {
      lines.push(`Stale source path${hits.length === 1 ? '' : 's'} in Electron test helpers:`);
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
    `electron-test-paths: ${files.length} Electron helper files name only existing source paths.`,
  );
}
