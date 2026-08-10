import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const ROOT_SAGAS = 'src/store/renderer/sagas.ts';
const SAGA_SOURCE = /^src\/store\/renderer\/slices\/.+\/sagas\/.+\.ts$/;
const WATCHERS = new Set(['takeEvery', 'takeLatest', 'takeLeading']);
const EFFECTS = new Set([...WATCHERS, 'take', 'fork', 'spawn', 'call', 'put', 'cancel']);

const normalize = (value) => value.split(path.sep).join('/').replace(/^\.\//, '');
const visit = (node, callback) => {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
};
const lineFor = (source, node) =>
  source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
const isFunction = (node) =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node);

function moduleCandidates(fromPath, specifier) {
  let base;
  if (specifier.startsWith('.')) base = normalize(path.join(path.dirname(fromPath), specifier));
  else {
    const alias = /^\$(lib|store|features|shared)(?:\/(.*))?$/.exec(specifier);
    if (!alias) return [];
    base = `src/${alias[1]}/${alias[2] ?? ''}`;
  }
  const extensionless = base.replace(/\.(?:[cm]?js|[cm]?ts|tsx)$/, '');
  return [...new Set([base, extensionless, `${extensionless}.ts`, `${extensionless}/index.ts`])];
}

function importsFor(source) {
  const imports = new Map();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const specifier = statement.moduleSpecifier.text;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const item of bindings.elements) {
      imports.set(item.name.text, {
        imported: item.propertyName?.text ?? item.name.text,
        specifier,
      });
    }
  }
  return imports;
}

function localArray(source, expression) {
  if (ts.isArrayLiteralExpression(expression)) return expression.elements;
  if (!ts.isIdentifier(expression)) return [];
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === expression.text &&
        declaration.initializer &&
        ts.isArrayLiteralExpression(declaration.initializer)
      ) {
        return declaration.initializer.elements;
      }
    }
  }
  return [];
}

function enclosingFunction(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (isFunction(current)) return current;
  }
  return undefined;
}

function declarationFor(source, call) {
  for (let current = call.parent; current && current !== source; current = current.parent) {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) return current;
    if (isFunction(current)) return undefined;
  }
  return undefined;
}

function containsIdentifier(node, name) {
  let found = false;
  visit(node, (child) => {
    if (ts.isIdentifier(child) && child.text === name) found = true;
  });
  return found;
}

export function inspectSagaWatcherOwnership(files) {
  const sources = new Map(
    files
      .filter((file) => file.path.endsWith('.ts') && !file.path.includes('.test.'))
      .map((file) => {
        const filePath = normalize(file.path);
        return [
          filePath,
          ts.createSourceFile(filePath, file.content, ts.ScriptTarget.Latest, true),
        ];
      }),
  );
  const violations = [];
  const audited = new Set([...sources.keys()].filter((filePath) => SAGA_SOURCE.test(filePath)));
  const root = sources.get(ROOT_SAGAS);
  const rootSagas = [];
  if (!root) violations.push(`${ROOT_SAGAS}: root saga registry is missing`);
  else {
    const imports = importsFor(root);
    for (const statement of root.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'sagas') continue;
        let array = declaration.initializer;
        while (array && (ts.isAsExpression(array) || ts.isSatisfiesExpression(array)))
          array = array.expression;
        if (!array || !ts.isArrayLiteralExpression(array)) continue;
        for (const element of array.elements) {
          if (!ts.isIdentifier(element)) continue;
          rootSagas.push(element.text);
          const binding = imports.get(element.text);
          const target =
            binding && moduleCandidates(ROOT_SAGAS, binding.specifier).find((p) => sources.has(p));
          if (target) audited.add(target);
          else if (!binding && element.text !== 'hardwareConsoleSaga') {
            violations.push(
              `${ROOT_SAGAS}:${lineFor(root, element)}: unresolved root saga ${element.text}`,
            );
          }
        }
      }
    }
    for (const name of new Set(rootSagas)) {
      if (rootSagas.filter((item) => item === name).length > 1)
        violations.push(`${ROOT_SAGAS}: duplicate root saga registration ${name}`);
    }
  }

  const watcherOwners = new Set();
  for (const filePath of audited) {
    const source = sources.get(filePath);
    if (!source) continue;
    const diagnostic = source.parseDiagnostics[0];
    if (diagnostic) {
      violations.push(`${filePath}:${lineFor(source, diagnostic)}: TypeScript parse failure`);
      continue;
    }
    const imports = importsFor(source);
    const effectNames = new Map();
    for (const [local, binding] of imports) {
      if (
        (binding.specifier === 'typed-redux-saga' || binding.specifier === 'redux-saga/effects') &&
        EFFECTS.has(binding.imported)
      )
        effectNames.set(local, binding.imported);
    }
    const typeDeclarations = new Map();
    visit(source, (node) => {
      if ((ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.name)
        typeDeclarations.set(node.name.text, node.getText(source));
    });
    const expandType = (text) => {
      let expanded = text;
      for (let pass = 0; pass < 3; pass++) {
        for (const [name, declaration] of typeDeclarations) {
          if (new RegExp(`\\b${name}\\b`).test(expanded) && !expanded.includes(declaration))
            expanded += ` ${declaration}`;
        }
      }
      return expanded;
    };
    const forkResults = new Set();
    visit(source, (node) => {
      if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return;
      const effect = effectNames.get(node.expression.text);
      if (!effect) return;
      const first = node.arguments[0];
      if (
        (effect === 'take' || WATCHERS.has(effect)) &&
        first &&
        ts.isStringLiteral(first) &&
        first.text === '*'
      )
        violations.push(
          `${filePath}:${lineFor(source, node)}: wildcard Redux watcher ${effect}("*")`,
        );

      if (effect === 'fork' || effect === 'spawn') {
        const declaration = declarationFor(source, node);
        if (declaration) forkResults.add(declaration.name.text);
      }

      const actions = first ? localArray(source, first) : [];
      if (effect === 'take' && actions.length > 1) {
        const declaration = declarationFor(source, node);
        const owner = enclosingFunction(node);
        if (declaration && owner) {
          let routesByType = false;
          visit(owner, (child) => {
            if (
              ts.isPropertyAccessExpression(child) &&
              child.name.text === 'type' &&
              ts.isIdentifier(child.expression) &&
              child.expression.text === declaration.name.text
            )
              routesByType = true;
          });
          if (routesByType)
            violations.push(
              `${filePath}:${lineFor(source, node)}: manual multi-action Redux router`,
            );
        }
      }

      if (WATCHERS.has(effect) && first) {
        const watched = actions.length > 0 ? actions : [first];
        for (const action of watched) {
          if (!ts.isIdentifier(action)) continue;
          const binding = imports.get(action.text);
          if (!binding || binding.specifier.includes('typed-redux-saga')) continue;
          const origin = `${binding.specifier}#${binding.imported}`;
          watcherOwners.add(origin);
        }

        const worker = node.arguments[1];
        if (actions.length > 1 && worker && ts.isIdentifier(worker)) {
          const declaration = source.statements.find(
            (statement) =>
              ts.isFunctionDeclaration(statement) && statement.name?.text === worker.text,
          );
          if (declaration) {
            const actionTypes = new Set();
            let effectCalls = 0;
            visit(declaration, (child) => {
              if (
                ts.isPropertyAccessExpression(child) &&
                child.name.text === 'type' &&
                ts.isIdentifier(child.expression) &&
                imports.has(child.expression.text)
              )
                actionTypes.add(child.expression.text);
              if (
                ts.isCallExpression(child) &&
                ts.isIdentifier(child.expression) &&
                effectNames.has(child.expression.text)
              )
                effectCalls++;
            });
            if (actionTypes.size > 1 && effectCalls > 1)
              violations.push(
                `${filePath}:${lineFor(source, declaration)}: shared action.type execution dispatcher`,
              );
          }
        }
      }
    });

    visit(source, (node) => {
      if (
        !ts.isNewExpression(node) ||
        !ts.isIdentifier(node.expression) ||
        !['Map', 'Set'].includes(node.expression.text)
      )
        return;
      const fn = enclosingFunction(node);
      const declaration =
        node.parent && ts.isVariableDeclaration(node.parent) ? node.parent : undefined;
      if (!fn || !fn.asteriskToken || !declaration || !ts.isIdentifier(declaration.name)) return;
      const name = declaration.name.text;
      const typeText = expandType(
        `${declaration.type?.getText(source) ?? ''} ${node.typeArguments?.map((arg) => arg.getText(source)).join(' ') ?? ''}`,
      );
      const externalResource = /(EventChannel|Channel<|subscriptionId|unsubscribe|dispose)/i.test(
        typeText,
      );
      const executionType = /\b(Task|SagaTask|WorkerSlot|TrackedTask)\b/i.test(typeText);
      const executionName =
        /(^|_)(running|workers?|slots?|debounce|fetch|restore|history)(_|$)/i.test(name);
      let storesFork = false;
      visit(fn, (child) => {
        if (
          ts.isCallExpression(child) &&
          ts.isPropertyAccessExpression(child.expression) &&
          ts.isIdentifier(child.expression.expression) &&
          child.expression.expression.text === name &&
          ['set', 'add'].includes(child.expression.name.text)
        ) {
          storesFork ||= child.arguments.some((argument) =>
            [...forkResults].some((result) => containsIdentifier(argument, result)),
          );
        }
      });
      if (!externalResource && (executionType || executionName || storesFork))
        violations.push(
          `${filePath}:${lineFor(source, node)}: saga-local execution registry ${name}`,
        );
    });
  }
  return {
    violations,
    auditedFiles: [...audited].sort(),
    rootSagas,
    watcherCount: watcherOwners.size,
  };
}

function collectFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(absolute));
    else if (entry.name.endsWith('.ts'))
      files.push({
        path: normalize(path.relative(process.cwd(), absolute)),
        content: fs.readFileSync(absolute, 'utf8'),
      });
  }
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = inspectSagaWatcherOwnership(collectFiles(path.resolve('src')));
  if (result.violations.length) {
    console.error(
      ['Saga watcher ownership violations:', ...result.violations.map((item) => `- ${item}`)].join(
        '\n',
      ),
    );
    process.exit(1);
  }
  console.log(
    `Saga watcher ownership valid: ${result.rootSagas.length} roots, ${result.auditedFiles.length} source files, ${result.watcherCount} action owners.`,
  );
}
