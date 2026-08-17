#!/usr/bin/env node
// check-selector-active-workspace-hygiene.mjs — Active-workspace architecture gate.

import { readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();
const SEARCH_DIR = resolve(ROOT, process.argv[2] ?? 'src');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.svelte-kit', '.git']);
const ACTIVE_SELECTOR = /^select(?:Active|Current)Workspace(?:Id)?$/;
const ACTIVE_WORKSPACE_SELECTOR_OWNER =
  'src/store/renderer/slices/workspace/workspace-selectors.ts';
const SELECTOR_CHANNEL_HELPERS = new Set([
  'createChannelFromSelector',
  'takeEveryFromSelector',
  'takeLatestFromSelector',
  'takeLeadingFromSelector',
]);
const RED = '\x1b[0;31m';
const YELLOW = '\x1b[0;33m';
const CYAN = '\x1b[0;36m';
const NC = '\x1b[0m';

const normalize = (value) => value.split(sep).join('/').replace(/^\.\//, '');

function isProductionSource(path) {
  const normalized = normalize(path);
  return (
    /\.(?:[cm]?[jt]s|[jt]sx)$/.test(normalized) &&
    !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalized) &&
    !normalized.includes('/__tests__/') &&
    !normalized.endsWith('.d.ts')
  );
}

function isRendererSource(path) {
  if (!path.startsWith('src/')) return true;
  return (
    (path.startsWith('src/features/') && !path.includes('/main/')) ||
    path.startsWith('src/lib/') ||
    path.startsWith('src/routes/') ||
    path.startsWith('src/store/renderer/') ||
    path.startsWith('src/store/utils/')
  );
}

function isSagaSource(path) {
  return (
    /(?:^|\/)sagas\/.*\.[cm]?[jt]sx?$/.test(path) ||
    /(?:^|\/)[^/]*-saga\.[cm]?[jt]sx?$/.test(path) ||
    path === 'src/store/renderer/sagas.ts'
  );
}

function logicalPath(absPath) {
  const fromRoot = relative(ROOT, absPath);
  if (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot)) {
    return normalize(fromRoot);
  }
  return normalize(relative(SEARCH_DIR, absPath));
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(full);
    } else if (entry.isFile() && isProductionSource(full)) {
      yield full;
    }
  }
}

function moduleCandidates(fromPath, specifier) {
  let base;
  if (specifier.startsWith('.')) {
    base = normalize(join(dirname(fromPath), specifier));
  } else {
    const alias = /^\$(lib|store|features|shared)(?:\/(.*))?$/.exec(specifier);
    if (!alias) return [];
    base = `src/${alias[1]}/${alias[2] ?? ''}`.replace(/\/$/, '');
  }
  const extensionless = base.replace(/\.(?:[cm]?[jt]s|[jt]sx)$/, '');
  return [
    ...new Set([
      base,
      extensionless,
      `${extensionless}.ts`,
      `${extensionless}.tsx`,
      `${extensionless}.js`,
      `${extensionless}/index.ts`,
      `${extensionless}/index.tsx`,
    ]),
  ];
}

function importsFor(source) {
  const imports = new Map();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (statement.importClause?.name) {
      imports.set(statement.importClause.name.text, {
        imported: 'default',
        source: statement.moduleSpecifier.text,
        node: statement.importClause.name,
        typeOnly: statement.importClause.isTypeOnly,
      });
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const item of bindings.elements) {
      imports.set(item.name.text, {
        imported: item.propertyName?.text ?? item.name.text,
        source: statement.moduleSpecifier.text,
        node: item,
        typeOnly: statement.importClause?.isTypeOnly || item.isTypeOnly,
      });
    }
  }
  return imports;
}

function namespaceImportsFor(source) {
  const imports = new Map();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      imports.set(bindings.name.text, statement.moduleSpecifier.text);
    }
  }
  return imports;
}

function declarationsFor(source) {
  const declarations = new Map();
  const addBindings = (name) => {
    if (ts.isIdentifier(name)) {
      declarations.set(name.text, name.parent);
      return;
    }
    for (const element of name.elements) {
      if (!ts.isOmittedExpression(element)) addBindings(element.name);
    }
  };
  for (const statement of source.statements) {
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name
    ) {
      declarations.set(statement.name.text, statement);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, declaration);
        else addBindings(declaration.name);
      }
    }
  }
  return declarations;
}

function bindingIdentifiers(name, result = []) {
  if (ts.isIdentifier(name)) {
    result.push(name);
    return result;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) bindingIdentifiers(element.name, result);
  }
  return result;
}

function declarationScope(declaration) {
  let current = declaration.parent;
  const bindingContainer = declaration.parent?.parent;
  if (
    ts.isParameter(declaration) ||
    (bindingContainer !== undefined && ts.isParameter(bindingContainer))
  ) {
    while (current && !ts.isFunctionLike(current)) current = current.parent;
    return current;
  }
  while (current && !ts.isBlock(current) && !ts.isSourceFile(current)) current = current.parent;
  return current;
}

const lexicalBindingsCache = new WeakMap();

function lexicalBindingsFor(source) {
  const cached = lexicalBindingsCache.get(source);
  if (cached) return cached;
  const bindings = new Map();
  const visit = (node) => {
    let names = [];
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      names = bindingIdentifiers(node.name);
    } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      names = [node.name];
    }
    for (const name of names) {
      const declaration = ts.isBindingElement(name.parent) ? name.parent : node;
      const scope = declarationScope(declaration);
      if (!scope) continue;
      const entries = bindings.get(name.text) ?? [];
      entries.push({ declaration, name, scope, span: scope.end - scope.pos });
      bindings.set(name.text, entries);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  lexicalBindingsCache.set(source, bindings);
  return bindings;
}

function lexicalDeclarationFor(source, identifier) {
  const candidates = (lexicalBindingsFor(source).get(identifier.text) ?? []).filter(
    ({ name, scope }) =>
      name !== identifier && scope.pos <= identifier.pos && identifier.end <= scope.end,
  );
  candidates.sort((left, right) => left.span - right.span);
  return candidates[0]?.declaration;
}

function resolveModule(sources, fromPath, specifier) {
  return moduleCandidates(fromPath, specifier).find((candidate) => sources.has(candidate));
}

function staticPropertyName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && node.argumentExpression) {
    const argument = unwrapExpression(node.argumentExpression);
    if (ts.isStringLiteralLike(argument)) return argument.text;
  }
  return undefined;
}

function propertyOwner(node) {
  return ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
    ? node.expression
    : undefined;
}

function propertyNameText(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  if (ts.isComputedPropertyName(node) && ts.isStringLiteralLike(node.expression)) {
    return node.expression.text;
  }
  return undefined;
}

function resolvesToWorkspaceSlice(source, node, seen = new Set()) {
  const candidate = unwrapExpression(node);
  if (staticPropertyName(candidate) === 'workspace') return true;
  if (!ts.isIdentifier(candidate)) return false;
  if (candidate.text === 'workspace') return true;
  const declaration = lexicalDeclarationFor(source, candidate);
  if (!declaration || seen.has(declaration)) return false;
  const nextSeen = new Set(seen).add(declaration);
  return (
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer !== undefined &&
    resolvesToWorkspaceSlice(source, declaration.initializer, nextSeen)
  );
}

function isRawActiveWorkspaceRead(source, node) {
  if (staticPropertyName(node) !== 'activeWorkspaceId') return false;
  const workspace = propertyOwner(node);
  return workspace !== undefined && resolvesToWorkspaceSlice(source, workspace);
}

function propertyPath(node) {
  const names = [];
  let current = unwrapExpression(node);
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    const name = staticPropertyName(current);
    if (name === undefined) return [];
    names.unshift(name);
    current = unwrapExpression(propertyOwner(current));
  }
  return names;
}

function bindingPatternContainsActiveWorkspaceId(pattern, prefix = []) {
  if (!ts.isObjectBindingPattern(pattern)) return false;
  for (const element of pattern.elements) {
    if (ts.isOmittedExpression(element)) continue;
    const propertyName = propertyNameText(element.propertyName ?? element.name);
    if (propertyName === undefined) continue;
    const path = [...prefix, propertyName];
    if (path.at(-2) === 'workspace' && path.at(-1) === 'activeWorkspaceId') return true;
    if (bindingPatternContainsActiveWorkspaceId(element.name, path)) return true;
  }
  return false;
}

function isDestructuredRawActiveWorkspaceRead(node) {
  if (
    (!ts.isVariableDeclaration(node) && !ts.isParameter(node)) ||
    !ts.isObjectBindingPattern(node.name)
  ) {
    return false;
  }
  const initializer = node.initializer ? unwrapExpression(node.initializer) : undefined;
  return bindingPatternContainsActiveWorkspaceId(
    node.name,
    initializer ? propertyPath(initializer) : [],
  );
}

function isCanonicalDestructuredActiveWorkspaceRead(filePath, node) {
  if (filePath !== ACTIVE_WORKSPACE_SELECTOR_OWNER) return false;
  let current = node.parent;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      if (ACTIVE_SELECTOR.test(current.name.text)) return true;
    }
    current = current.parent;
  }
  return false;
}

function isCanonicalActiveWorkspaceSelectorRead(filePath, source, node) {
  if (filePath !== ACTIVE_WORKSPACE_SELECTOR_OWNER || !isRawActiveWorkspaceRead(source, node)) {
    return false;
  }
  let current = node.parent;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      if (ACTIVE_SELECTOR.test(current.name.text)) return true;
    }
    current = current.parent;
  }
  return false;
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function callName(expression) {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) return unwrapped.text;
  if (ts.isPropertyAccessExpression(unwrapped)) return unwrapped.name.text;
  return undefined;
}

function createForbiddenResolver(sources) {
  const symbolMemo = new Map();
  const exportMemo = new Map();
  const propertyMemo = new Map();

  function expressionIsForbidden(filePath, expression, seen = new Set()) {
    const candidate = unwrapExpression(expression);
    if (ts.isIdentifier(candidate)) return symbolIsForbidden(filePath, candidate, seen);
    if (ts.isConditionalExpression(candidate)) {
      return (
        expressionIsForbidden(filePath, candidate.whenTrue, seen) ||
        expressionIsForbidden(filePath, candidate.whenFalse, seen)
      );
    }
    if (
      ts.isArrowFunction(candidate) ||
      ts.isFunctionExpression(candidate) ||
      ts.isClassExpression(candidate)
    ) {
      return declarationIsForbidden(filePath, candidate, seen);
    }
    const propertyName = staticPropertyName(candidate);
    if (propertyName === undefined) return false;
    return propertyIsForbidden(filePath, propertyOwner(candidate), propertyName, seen);
  }

  function propertyIsForbidden(filePath, owner, propertyName, seen = new Set()) {
    return expressionPathIsForbidden(filePath, owner, [propertyName], seen);
  }

  function expressionPathIsForbidden(filePath, expression, path, seen = new Set()) {
    if (path.length === 0) return expressionIsForbidden(filePath, expression, seen);
    const candidate = unwrapExpression(expression);
    if (ts.isConditionalExpression(candidate)) {
      return (
        expressionPathIsForbidden(filePath, candidate.whenTrue, path, seen) ||
        expressionPathIsForbidden(filePath, candidate.whenFalse, path, seen)
      );
    }
    if (ts.isPropertyAccessExpression(candidate) || ts.isElementAccessExpression(candidate)) {
      const nestedPropertyName = staticPropertyName(candidate);
      const nestedOwner = propertyOwner(candidate);
      return nestedPropertyName !== undefined && nestedOwner !== undefined
        ? expressionPathIsForbidden(filePath, nestedOwner, [nestedPropertyName, ...path], seen)
        : false;
    }
    if (path.length === 1 && (path[0] === 'select' || path[0] === 'effect')) {
      return expressionIsForbidden(filePath, candidate, seen);
    }
    const record = sources.get(filePath);
    if (!record) return false;
    const namespaces = namespaceImportsFor(record.source);
    if (ts.isIdentifier(candidate) && namespaces.has(candidate.text)) {
      const target = resolveModule(sources, filePath, namespaces.get(candidate.text));
      return target ? exportPathIsForbidden(target, path, seen) : false;
    }
    if (ts.isIdentifier(candidate)) {
      return symbolPathIsForbidden(filePath, candidate, path, seen);
    }
    if (ts.isObjectLiteralExpression(candidate)) {
      return objectPathIsForbidden(filePath, candidate, path, seen);
    }
    if (ts.isClassExpression(candidate)) {
      return classPathIsForbidden(filePath, candidate, path, seen);
    }
    return false;
  }

  function objectPathIsForbidden(filePath, object, path, seen) {
    const [propertyName, ...rest] = path;
    const property = object.properties.find(
      (candidate) => candidate.name && propertyNameText(candidate.name) === propertyName,
    );
    if (!property) return false;
    if (rest.length > 0) {
      return ts.isPropertyAssignment(property)
        ? expressionPathIsForbidden(filePath, property.initializer, rest, seen)
        : false;
    }
    if (ts.isPropertyAssignment(property)) {
      return (
        expressionIsForbidden(filePath, property.initializer, seen) ||
        declarationIsForbidden(filePath, property, seen)
      );
    }
    if (ts.isShorthandPropertyAssignment(property)) {
      return symbolIsForbidden(filePath, property.name, seen);
    }
    return declarationIsForbidden(filePath, property, seen);
  }

  function classPathIsForbidden(filePath, declaration, path, seen) {
    const [propertyName, ...rest] = path;
    const member = declaration.members.find(
      (candidate) => candidate.name && propertyNameText(candidate.name) === propertyName,
    );
    if (!member) return false;
    if (rest.length > 0 && ts.isPropertyDeclaration(member) && member.initializer) {
      return expressionPathIsForbidden(filePath, member.initializer, rest, seen);
    }
    return rest.length === 0 && declarationIsForbidden(filePath, member, seen);
  }

  function bindingRoot(declaration) {
    const path = [];
    let current = declaration;
    while (ts.isBindingElement(current)) {
      const propertyName = propertyNameText(current.propertyName ?? current.name);
      if (propertyName === undefined) return undefined;
      path.unshift(propertyName);
      const container = current.parent?.parent;
      if (ts.isBindingElement(container)) current = container;
      else if (ts.isVariableDeclaration(container) || ts.isParameter(container)) {
        return { declaration: container, path };
      } else return undefined;
    }
    return undefined;
  }

  function symbolPathIsForbidden(filePath, identifier, path, seen = new Set()) {
    const localName = identifier.text;
    const declaration = lexicalDeclarationFor(identifier.getSourceFile(), identifier);
    const key = `${filePath}#local:${localName}@${declaration?.pos ?? identifier.pos}.${path.join('.')}`;
    if (propertyMemo.has(key)) return propertyMemo.get(key);
    if (seen.has(key)) return false;
    const nextSeen = new Set(seen).add(key);
    const record = sources.get(filePath);
    if (!record) return false;
    let forbidden = false;
    if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
      forbidden = expressionPathIsForbidden(filePath, declaration.initializer, path, nextSeen);
    } else if (declaration && ts.isBindingElement(declaration)) {
      const root = bindingRoot(declaration);
      if (root?.declaration.initializer) {
        forbidden = expressionPathIsForbidden(
          filePath,
          root.declaration.initializer,
          [...root.path, ...path],
          nextSeen,
        );
      }
    } else if (declaration && ts.isClassDeclaration(declaration)) {
      forbidden = classPathIsForbidden(filePath, declaration, path, nextSeen);
    } else {
      const imported = importsFor(record.source).get(localName);
      if (!imported || imported.typeOnly) {
        propertyMemo.set(key, false);
        return false;
      }
      const target = resolveModule(sources, filePath, imported.source);
      forbidden = target
        ? exportPathIsForbidden(target, [imported.imported, ...path], nextSeen)
        : false;
    }
    propertyMemo.set(key, forbidden);
    return forbidden;
  }

  function declarationIsForbidden(filePath, declaration, seen) {
    if (ts.isBindingElement(declaration)) {
      const root = bindingRoot(declaration);
      if (root?.declaration.initializer) {
        return expressionPathIsForbidden(filePath, root.declaration.initializer, root.path, seen);
      }
    }
    let forbidden = false;
    const record = sources.get(filePath);
    const visit = (node) => {
      if (forbidden) return;
      if (
        record &&
        isRawActiveWorkspaceRead(record.source, node) &&
        !isCanonicalActiveWorkspaceSelectorRead(filePath, record.source, node)
      ) {
        forbidden = true;
        return;
      }
      if (
        isDestructuredRawActiveWorkspaceRead(node) &&
        !isCanonicalDestructuredActiveWorkspaceRead(filePath, node)
      ) {
        forbidden = true;
        return;
      }
      if (ts.isCallExpression(node)) {
        const method = callName(node.expression);
        const expression = unwrapExpression(node.expression);
        if (
          (method === 'select' || method === 'effect') &&
          ts.isPropertyAccessExpression(expression) &&
          expressionIsForbidden(filePath, expression.expression, seen)
        ) {
          forbidden = true;
          return;
        }
        if (
          SELECTOR_CHANNEL_HELPERS.has(method) &&
          node.arguments[0] &&
          expressionIsForbidden(filePath, node.arguments[0], seen)
        ) {
          forbidden = true;
          return;
        }
        if (expressionIsForbidden(filePath, node.expression, seen)) {
          forbidden = true;
          return;
        }
        if (node.arguments.some((argument) => expressionIsForbidden(filePath, argument, seen))) {
          forbidden = true;
          return;
        }
      }
      ts.forEachChild(node, visit);
    };
    if (
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer &&
      expressionIsForbidden(filePath, declaration.initializer, seen)
    ) {
      return true;
    }
    visit(declaration);
    return forbidden;
  }

  function symbolIsForbidden(filePath, identifier, seen = new Set()) {
    const localName = identifier.text;
    const declaration = lexicalDeclarationFor(identifier.getSourceFile(), identifier);
    const key = `${filePath}#local:${localName}@${declaration?.pos ?? identifier.pos}`;
    if (symbolMemo.has(key)) return symbolMemo.get(key);
    if (seen.has(key)) return false;
    const nextSeen = new Set(seen).add(key);
    const record = sources.get(filePath);
    if (!record) return false;
    let forbidden = false;
    if (declaration && ts.isBindingElement(declaration)) {
      forbidden = symbolPathIsForbidden(filePath, identifier, [], nextSeen);
    } else if (declaration) {
      forbidden = ACTIVE_SELECTOR.test(localName)
        ? true
        : declarationIsForbidden(filePath, declaration, nextSeen);
    } else {
      const imported = importsFor(record.source).get(localName);
      if (!imported || imported.typeOnly) {
        symbolMemo.set(key, false);
        return false;
      }
      if (ACTIVE_SELECTOR.test(imported.imported)) forbidden = true;
      else {
        const target = resolveModule(sources, filePath, imported.source);
        forbidden = target ? exportIsForbidden(target, imported.imported, nextSeen) : false;
      }
    }
    symbolMemo.set(key, forbidden);
    return forbidden;
  }

  function exportIsForbidden(filePath, exportName, seen = new Set()) {
    return exportPathIsForbidden(filePath, [exportName], seen);
  }

  function exportSymbolPathIsForbidden(filePath, localName, path, seen) {
    const record = sources.get(filePath);
    if (!record) return false;
    const declaration = declarationsFor(record.source).get(localName);
    if (!declaration) return false;
    if (path.length === 0) return declarationIsForbidden(filePath, declaration, seen);
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      return expressionPathIsForbidden(filePath, declaration.initializer, path, seen);
    }
    if (ts.isClassDeclaration(declaration)) {
      return classPathIsForbidden(filePath, declaration, path, seen);
    }
    return false;
  }

  function exportPathIsForbidden(filePath, path, seen = new Set()) {
    if (path.length === 0) return false;
    const [exportName, ...rest] = path;
    const key = `${filePath}#export:${path.join('.')}`;
    if (exportMemo.has(key)) return exportMemo.get(key);
    if (seen.has(key)) return false;
    if (rest.length === 0 && ACTIVE_SELECTOR.test(exportName)) return true;
    const nextSeen = new Set(seen).add(key);
    const record = sources.get(filePath);
    if (!record) return false;
    for (const statement of record.source.statements) {
      if (exportName === 'default') {
        if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
          const forbidden =
            rest.length > 0
              ? expressionPathIsForbidden(filePath, statement.expression, rest, nextSeen)
              : expressionIsForbidden(filePath, statement.expression, nextSeen);
          exportMemo.set(key, forbidden);
          return forbidden;
        }
        if (
          (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
          statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
        ) {
          const forbidden =
            rest.length > 0 && ts.isClassDeclaration(statement)
              ? classPathIsForbidden(filePath, statement, rest, nextSeen)
              : rest.length === 0 && declarationIsForbidden(filePath, statement, nextSeen);
          exportMemo.set(key, forbidden);
          return forbidden;
        }
      }
      if (!ts.isExportDeclaration(statement)) continue;
      const specifier =
        statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : undefined;
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        const item = statement.exportClause.elements.find(
          (entry) => entry.name.text === exportName,
        );
        if (!item) continue;
        const importedName = item.propertyName?.text ?? item.name.text;
        const target = specifier ? resolveModule(sources, filePath, specifier) : undefined;
        const forbidden = target
          ? exportPathIsForbidden(target, [importedName, ...rest], nextSeen)
          : exportSymbolPathIsForbidden(filePath, importedName, rest, nextSeen);
        exportMemo.set(key, forbidden);
        return forbidden;
      }
      if (
        statement.exportClause &&
        ts.isNamespaceExport(statement.exportClause) &&
        statement.exportClause.name.text === exportName &&
        specifier
      ) {
        const target = resolveModule(sources, filePath, specifier);
        const forbidden = target ? exportPathIsForbidden(target, rest, nextSeen) : false;
        exportMemo.set(key, forbidden);
        return forbidden;
      }
      if (!statement.exportClause && specifier) {
        const target = resolveModule(sources, filePath, specifier);
        if (target && exportPathIsForbidden(target, path, nextSeen)) {
          exportMemo.set(key, true);
          return true;
        }
      }
    }
    const forbidden = exportSymbolPathIsForbidden(filePath, exportName, rest, nextSeen);
    exportMemo.set(key, forbidden);
    return forbidden;
  }

  return { expressionIsForbidden };
}

function sourceLine(source, node) {
  return node.getText(source).replace(/\s+/g, ' ').slice(0, 180);
}

function lineAt(source, node) {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function activeSelectorAliases(source) {
  const aliases = new Set();
  for (const [local, imported] of importsFor(source)) {
    if (!imported.typeOnly && ACTIVE_SELECTOR.test(imported.imported)) aliases.add(local);
  }
  return aliases;
}

function expressionIsDirectActiveSelector(source, expression, aliases) {
  const candidate = unwrapExpression(expression);
  if (ts.isIdentifier(candidate)) {
    return aliases.has(candidate.text) || ACTIVE_SELECTOR.test(candidate.text);
  }
  if (!ts.isPropertyAccessExpression(candidate)) return false;
  const namespaces = namespaceImportsFor(source);
  return (
    ts.isIdentifier(candidate.expression) &&
    namespaces.has(candidate.expression.text) &&
    ACTIVE_SELECTOR.test(candidate.name.text)
  );
}

function inspectNonComponent(filePath, source, resolver) {
  const violations = [];
  const aliases = activeSelectorAliases(source);
  for (const imported of importsFor(source).values()) {
    if (!imported.typeOnly && ACTIVE_SELECTOR.test(imported.imported)) {
      violations.push({
        kind: 'non-component active selector import',
        node: imported.node,
        snippet: `${imported.imported} from ${imported.source}`,
      });
    }
  }
  const visit = (node) => {
    if (
      (isRawActiveWorkspaceRead(source, node) &&
        !isCanonicalActiveWorkspaceSelectorRead(filePath, source, node)) ||
      (isDestructuredRawActiveWorkspaceRead(node) &&
        !isCanonicalDestructuredActiveWorkspaceRead(filePath, node))
    ) {
      violations.push({
        kind: 'non-component raw active-workspace state read',
        node,
        snippet: sourceLine(source, node),
      });
    }
    if (ts.isCallExpression(node)) {
      const expression = unwrapExpression(node.expression);
      if (
        ts.isPropertyAccessExpression(expression) &&
        (expression.name.text === 'select' || expression.name.text === 'effect') &&
        expressionIsDirectActiveSelector(source, expression.expression, aliases)
      ) {
        violations.push({
          kind: `non-component selector.${expression.name.text}`,
          node,
          snippet: sourceLine(source, node),
        });
      } else if (expressionIsDirectActiveSelector(source, expression, aliases)) {
        violations.push({
          kind: 'non-component direct selector call',
          node,
          snippet: sourceLine(source, node),
        });
      } else if (resolver.expressionIsForbidden(filePath, expression)) {
        violations.push({
          kind: 'non-component transitive active-workspace dependency',
          node,
          snippet: sourceLine(source, node),
        });
      }
    } else if (
      ts.isPropertyAccessExpression(node) &&
      expressionIsDirectActiveSelector(source, node, aliases)
    ) {
      violations.push({
        kind: 'non-component namespace selector use',
        node,
        snippet: sourceLine(source, node),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations.map((violation) => ({ ...violation, filePath }));
}

function inspectSaga(filePath, source, resolver) {
  const violations = [];
  const visit = (node) => {
    if (
      (isRawActiveWorkspaceRead(source, node) &&
        !isCanonicalActiveWorkspaceSelectorRead(filePath, source, node)) ||
      (isDestructuredRawActiveWorkspaceRead(node) &&
        !isCanonicalDestructuredActiveWorkspaceRead(filePath, node))
    ) {
      violations.push({
        kind: 'saga raw active-workspace state read',
        node,
        snippet: sourceLine(source, node),
      });
    }
    if (ts.isCallExpression(node)) {
      const method = callName(node.expression);
      if (
        SELECTOR_CHANNEL_HELPERS.has(method) &&
        node.arguments[0] &&
        resolver.expressionIsForbidden(filePath, node.arguments[0])
      ) {
        violations.push({
          kind: 'saga selector channel',
          node,
          snippet: sourceLine(source, node),
        });
      } else {
        const expression = unwrapExpression(node.expression);
        if (
          ts.isPropertyAccessExpression(expression) &&
          (expression.name.text === 'select' || expression.name.text === 'effect') &&
          resolver.expressionIsForbidden(filePath, expression.expression)
        ) {
          violations.push({
            kind: `saga selector.${expression.name.text}`,
            node,
            snippet: sourceLine(source, node),
          });
        } else if (resolver.expressionIsForbidden(filePath, expression)) {
          violations.push({
            kind: 'saga transitive active-workspace dependency',
            node,
            snippet: sourceLine(source, node),
          });
        } else if (
          node.arguments.some((argument) => resolver.expressionIsForbidden(filePath, argument))
        ) {
          violations.push({
            kind: 'saga effect active-workspace dependency',
            node,
            snippet: sourceLine(source, node),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations.map((violation) => ({ ...violation, filePath }));
}

function containsGenerator(source) {
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (ts.isFunctionLike(node) && node.asteriskToken) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

async function main() {
  let isDir = false;
  try {
    isDir = (await stat(SEARCH_DIR)).isDirectory();
  } catch {
    /* ignore */
  }
  if (!isDir) {
    console.error(`${RED}Search directory not found: ${SEARCH_DIR}${NC}`);
    process.exit(2);
  }

  const sources = new Map();
  for await (const file of walk(SEARCH_DIR)) {
    const path = logicalPath(file);
    const content = readFileSync(file, 'utf8');
    sources.set(path, {
      path,
      content,
      source: ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true),
    });
  }

  console.log(`${CYAN}=== selector active-workspace hygiene gate ===${NC}`);
  console.log(`Scanning: ${relative(ROOT, SEARCH_DIR) || '.'}/  (renderer production sources)`);

  const resolver = createForbiddenResolver(sources);
  const violations = [];
  for (const { path, source } of sources.values()) {
    if (!isRendererSource(path)) continue;
    const diagnostic = source.parseDiagnostics[0];
    if (diagnostic) {
      violations.push({
        filePath: path,
        kind: 'TypeScript parse failure',
        node: source,
        snippet: diagnostic.messageText.toString(),
      });
      continue;
    }
    violations.push(...inspectNonComponent(path, source, resolver));
    if (isSagaSource(path) || containsGenerator(source)) {
      violations.push(...inspectSaga(path, source, resolver));
    }
  }

  const unique = new Map();
  for (const violation of violations) {
    const line = lineAt(sources.get(violation.filePath).source, violation.node);
    unique.set(`${violation.filePath}:${line}:${violation.kind}`, { ...violation, line });
  }

  console.log('');
  if (unique.size > 0) {
    console.log(`${RED}[selector active-workspace hygiene]${NC} — ${unique.size} violation(s):`);
    console.log('  Renderer sagas must receive workspaceId through explicit typed context.');
    console.log('  Only Svelte/component code may call active/current workspace selectors.');
    console.log(
      '  Pass workspaceId as a selector argument instead of reading active workspace state.',
    );
    for (const violation of unique.values()) {
      console.log(
        `  ${YELLOW}${violation.filePath}:${violation.line}${NC}  [${violation.kind}] ${violation.snippet}`,
      );
    }
    console.log('');
    console.log(`${RED}✗ Found ${unique.size} selector active-workspace violation(s).${NC}`);
    process.exit(1);
  }
  console.log(`${CYAN}✓ No selector active-workspace violations found.${NC}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
