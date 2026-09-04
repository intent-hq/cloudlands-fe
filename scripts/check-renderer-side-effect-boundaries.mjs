import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const APPROVED_MIDDLEWARE = new Map([
  ['src/store/utils/store-guard-middleware.ts', 'createStoreGuardMiddleware'],
  ['src/store/renderer/middlewares/batch.ts', 'createBatchingMiddleware'],
  [
    'src/store/renderer/middlewares/state-reference-checks.ts',
    'createReferenceChangeDetectorMiddleware',
  ],
  [
    'src/store/renderer/middlewares/structured-clone-checker.ts',
    'createStructuredCloneCheckerMiddleware',
  ],
]);

const APPROVED_BRIDGE_REGISTRATIONS = new Map([
  ['src/lib/electron-bridge.ts', { addMockIpcListener: 2 }],
  ['src/store/renderer/seeders/active-streams-bridge-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/agent-ipc-bridge-seeder.ts', { registerMockIpcHandler: 2 }],
  ['src/store/renderer/seeders/auto-update-bridge-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/backend-status-bridge-seeder.ts', { registerMockIpcHandler: 5 }],
  ['src/store/renderer/seeders/browser-ipc-bridge-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/connections-bridge-seeder.ts', { registerMockIpcHandler: 12 }],
  ['src/store/renderer/seeders/file-bridge-seeder.ts', { registerMockIpcHandler: 12 }],
  ['src/store/renderer/seeders/git-bridge-seeder.ts', { registerMockIpcHandler: 9 }],
  ['src/store/renderer/seeders/host-bridge-seeder.ts', { registerMockIpcHandler: 16 }],
  ['src/store/renderer/seeders/integrations-bridge-seeder.ts', { registerMockIpcHandler: 26 }],
  [
    'src/store/renderer/seeders/language-preference-bridge-seeder.ts',
    { registerMockIpcHandler: 1 },
  ],
  ['src/store/renderer/seeders/misc-ui-events-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/model-catalog-bridge-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/native-dialog-bridge-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/notification-bridge-seeder.ts', { registerMockIpcHandler: 2 }],
  ['src/store/renderer/seeders/panel-layout-bridge-seeder.ts', { registerMockIpcHandler: 2 }],
  ['src/store/renderer/seeders/pi-mcp-bridge-seeder.ts', { registerMockIpcHandler: 2 }],
  ['src/store/renderer/seeders/provider-status-bridge-seeder.ts', { registerMockIpcHandler: 6 }],
  ['src/store/renderer/seeders/quit-confirmation-bridge-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/release-notes-bridge-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/renderer-log-bridge-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/repo-config-bridge-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/settings-legacy-bridge-seeder.ts', { registerMockIpcHandler: 7 }],
  ['src/store/renderer/seeders/shell-reveal-bridge-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/terminals-scripts-seeder.ts', { registerMockIpcHandler: 2 }],
  ['src/store/renderer/seeders/user-activity-bridge-seeder.ts', { registerMockIpcHandler: 1 }],
  ['src/store/renderer/seeders/voice-local-bridge-seeder.ts', { registerMockIpcHandler: 3 }],
  ['src/store/renderer/seeders/window-state-bridge-seeder.ts', { registerMockIpcHandler: 6 }],
  [
    'src/store/renderer/seeders/workspace-summaries-bridge-seeder.ts',
    { registerMockIpcHandler: 2 },
  ],
  ['src/store/renderer/seeders/workspaces-seeder.ts', { registerMockIpcHandler: 7 }],
  [
    'src/store/renderer/slices/notifications/sagas/notifications-saga.ts',
    { addMockIpcListener: 1 },
  ],
]);

const IPC_ROUTER_PATH = 'src/shared/ipc-mock-router.ts';
const IPC_REGISTRARS = new Set(['registerMockIpcHandler', 'addMockIpcListener']);
const REGISTRY_PATH = 'src/store/renderer/middleware.ts';
const CONFIGURED_STORE_PATH = 'src/store/renderer/configured-store.ts';
const MIDDLEWARE_REGISTRY_ORIGIN = 'MiddlewareRegistry';
const REGISTRY_BUILDER = 'buildMiddleware';

function normalize(filePath) {
  return filePath.split(path.sep).join('/').replace(/^\.\//, '');
}

function isRendererSource(filePath) {
  return (
    (filePath.startsWith('src/features/') && !filePath.includes('/main/')) ||
    filePath.startsWith('src/lib/') ||
    filePath.startsWith('src/routes/') ||
    filePath.startsWith('src/store/renderer/') ||
    filePath.startsWith('src/store/utils/')
  );
}

export function findRendererSideEffectBoundaryViolations(files) {
  const sources = new Map(
    files
      .filter((file) => file.path.endsWith('.ts'))
      .map((file) => {
        const filePath = normalize(file.path);
        return [
          filePath,
          {
            ...file,
            path: filePath,
            source: ts.createSourceFile(filePath, file.content, ts.ScriptTarget.Latest, true),
          },
        ];
      }),
  );
  const violations = [];
  for (const { path: filePath, source } of sources.values()) {
    const diagnostic = source.parseDiagnostics[0];
    if (diagnostic) {
      const line = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1;
      violations.push(`${filePath}:${line}: TypeScript parse failure`);
    }
  }
  const moduleCandidates = (fromPath, specifier) => {
    let base;
    if (specifier.startsWith('.')) base = normalize(path.join(path.dirname(fromPath), specifier));
    else {
      const alias = /^\$(lib|store|features|shared)(?:\/(.*))?$/.exec(specifier);
      if (!alias) return [];
      base = `src/${alias[1]}/${alias[2] ?? ''}`.replace(/\/$/, '');
    }
    const extensionless = base.replace(/\.(?:[cm]?js|[cm]?ts|tsx)$/, '');
    return [...new Set([base, extensionless, `${extensionless}.ts`, `${extensionless}/index.ts`])];
  };
  const resolveModule = (fromPath, specifier) => {
    return moduleCandidates(fromPath, specifier).find((candidate) => sources.has(candidate));
  };
  const directOrigin = (fromPath, specifier, exportedName) => {
    if (specifier === '@augmentcode/themis/types' && exportedName === 'StoreMiddleware') {
      return 'StoreMiddleware';
    }
    if (specifier === '@augmentcode/themis/svelte-store' && exportedName === 'Store') {
      return 'Store';
    }
    const isRouter =
      specifier === '$shared/ipc-mock-router' || specifier === IPC_ROUTER_PATH.replace(/\.ts$/, '');
    if (isRouter && IPC_REGISTRARS.has(exportedName)) return exportedName;
    for (const candidate of moduleCandidates(fromPath, specifier)) {
      if (candidate === REGISTRY_PATH && exportedName === 'middleware') {
        return MIDDLEWARE_REGISTRY_ORIGIN;
      }
      if (APPROVED_MIDDLEWARE.get(candidate) === exportedName) {
        return `middleware:${candidate}#${exportedName}`;
      }
      if (candidate === IPC_ROUTER_PATH && IPC_REGISTRARS.has(exportedName)) return exportedName;
    }
    return undefined;
  };
  const originFromModule = (fromPath, specifier, exportedName, seen) => {
    const direct = directOrigin(fromPath, specifier, exportedName);
    if (direct) return direct;
    const target = resolveModule(fromPath, specifier);
    if (target === IPC_ROUTER_PATH && IPC_REGISTRARS.has(exportedName)) return exportedName;
    return target ? exportedOrigin(target, exportedName, seen) : undefined;
  };
  const resolveTypeOrigin = (filePath, typeNode, seen = new Set()) => {
    if (!typeNode || !ts.isTypeReferenceNode(typeNode)) return undefined;
    const typeName = typeNode.typeName;
    if (ts.isIdentifier(typeName)) {
      return bindingOrigin(filePath, typeName.text, seen);
    }
    if (ts.isQualifiedName(typeName) && ts.isIdentifier(typeName.left)) {
      const source = sources.get(filePath)?.source;
      for (const statement of source?.statements ?? []) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
          continue;
        const bindings = statement.importClause?.namedBindings;
        if (
          bindings &&
          ts.isNamespaceImport(bindings) &&
          bindings.name.text === typeName.left.text
        ) {
          return originFromModule(
            filePath,
            statement.moduleSpecifier.text,
            typeName.right.text,
            seen,
          );
        }
      }
    }
    return undefined;
  };
  const parameterOrigin = (filePath, localName, referenceNode, seen) => {
    let current = referenceNode.parent;
    while (current) {
      if (
        (ts.isFunctionDeclaration(current) ||
          ts.isFunctionExpression(current) ||
          ts.isArrowFunction(current) ||
          ts.isMethodDeclaration(current) ||
          ts.isConstructorDeclaration(current)) &&
        current.parameters
      ) {
        const param = current.parameters.find(
          (p) => ts.isIdentifier(p.name) && p.name.text === localName,
        );
        if (param) {
          return resolveTypeOrigin(filePath, param.type, seen) === 'Store'
            ? 'StoreInstance'
            : undefined;
        }
      }
      current = current.parent;
    }
    return undefined;
  };
  const bindingOrigin = (filePath, localName, seen = new Set(), referenceNode) => {
    const key = `${filePath}#local:${localName}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const source = sources.get(filePath)?.source;
    if (!source) return undefined;
    if (referenceNode) {
      const fromParameter = parameterOrigin(filePath, localName, referenceNode, seen);
      if (fromParameter) return fromParameter;
    }
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const clause = statement.importClause;
        const specifier = statement.moduleSpecifier.text;
        if (clause?.name?.text === localName) {
          return originFromModule(filePath, specifier, 'default', seen);
        }
        const bindings = clause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          const element = bindings.elements.find((item) => item.name.text === localName);
          if (element) {
            return originFromModule(
              filePath,
              specifier,
              element.propertyName?.text ?? element.name.text,
              seen,
            );
          }
        }
      }
      if (ts.isClassDeclaration(statement) && statement.name?.text === localName) {
        const baseClass = statement.heritageClauses
          ?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
          ?.types.at(0)?.expression;
        return expressionOrigin(filePath, baseClass, seen) === 'Store' ? 'Store' : undefined;
      }
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === localName) {
          return expressionOrigin(filePath, declaration.initializer, seen);
        }
      }
    }
    return undefined;
  };
  const expressionOrigin = (filePath, expression, seen = new Set()) => {
    if (!expression) return undefined;
    if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)) {
      return expressionOrigin(filePath, expression.expression, seen);
    }
    if (ts.isIdentifier(expression))
      return bindingOrigin(filePath, expression.text, seen, expression);
    if (ts.isNewExpression(expression)) {
      return expressionOrigin(filePath, expression.expression, seen) === 'Store'
        ? 'StoreInstance'
        : undefined;
    }
    if (!ts.isPropertyAccessExpression(expression) || !ts.isIdentifier(expression.expression)) {
      return undefined;
    }
    const source = sources.get(filePath)?.source;
    for (const statement of source?.statements ?? []) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
        continue;
      const bindings = statement.importClause?.namedBindings;
      if (
        bindings &&
        ts.isNamespaceImport(bindings) &&
        bindings.name.text === expression.expression.text
      ) {
        return originFromModule(
          filePath,
          statement.moduleSpecifier.text,
          expression.name.text,
          seen,
        );
      }
    }
    return undefined;
  };
  const exportedOrigin = (filePath, exportedName, seen = new Set()) => {
    const key = `${filePath}#export:${exportedName}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const source = sources.get(filePath)?.source;
    if (!source) return undefined;
    for (const statement of source.statements) {
      const isExported = statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      );
      if (
        isExported &&
        ts.isFunctionDeclaration(statement) &&
        statement.name?.text === exportedName
      ) {
        return exportedName;
      }
      if (isExported && ts.isVariableStatement(statement)) {
        const declaration = statement.declarationList.declarations.find(
          (item) => ts.isIdentifier(item.name) && item.name.text === exportedName,
        );
        if (declaration)
          return expressionOrigin(filePath, declaration.initializer, seen) ?? exportedName;
      }
      if (!ts.isExportDeclaration(statement)) continue;
      const specifier =
        statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : undefined;
      if (!statement.exportClause && specifier) {
        const origin = originFromModule(filePath, specifier, exportedName, seen);
        if (origin) return origin;
      }
      if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
      const element = statement.exportClause.elements.find(
        (item) => item.name.text === exportedName,
      );
      if (!element) continue;
      const originalName = element.propertyName?.text ?? element.name.text;
      return specifier
        ? originFromModule(filePath, specifier, originalName, seen)
        : bindingOrigin(filePath, originalName, seen);
    }
    return bindingOrigin(filePath, exportedName, seen);
  };
  const visit = (node, callback) => {
    callback(node);
    ts.forEachChild(node, (child) => visit(child, callback));
  };

  for (const file of sources.values()) {
    const filePath = file.path;
    if (!filePath.endsWith('.ts') || filePath.includes('.test.') || filePath.includes('/test/'))
      continue;
    const storeMiddlewareNames = new Set();
    const storeMiddlewareNamespaces = new Set();
    const storeConstructorNames = new Set();
    const storeConstructorNamespaces = new Set();
    const namespaceImports = new Map();
    for (const statement of file.source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
        continue;
      const specifier = statement.moduleSpecifier.text;
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const item of bindings.elements) {
          const importedName = item.propertyName?.text ?? item.name.text;
          const origin = originFromModule(filePath, specifier, importedName, new Set());
          if (origin === 'StoreMiddleware') storeMiddlewareNames.add(item.name.text);
          if (origin === 'Store') storeConstructorNames.add(item.name.text);
        }
      } else if (bindings && ts.isNamespaceImport(bindings)) {
        namespaceImports.set(bindings.name.text, specifier);
        if (specifier === '@augmentcode/themis/types') {
          storeMiddlewareNamespaces.add(bindings.name.text);
        }
        if (specifier === '@augmentcode/themis/svelte-store') {
          storeConstructorNamespaces.add(bindings.name.text);
        }
      }
    }
    const typeUsesStoreMiddleware = (typeNode) => {
      let found = false;
      if (!typeNode) return false;
      visit(typeNode, (node) => {
        if (ts.isTypeReferenceNode(node)) {
          if (ts.isIdentifier(node.typeName) && storeMiddlewareNames.has(node.typeName.text))
            found = true;
          if (
            ts.isQualifiedName(node.typeName) &&
            ts.isIdentifier(node.typeName.left) &&
            (storeMiddlewareNamespaces.has(node.typeName.left.text) ||
              originFromModule(
                filePath,
                namespaceImports.get(node.typeName.left.text) ?? '',
                node.typeName.right.text,
                new Set(),
              ) === 'StoreMiddleware')
          )
            found = true;
        }
      });
      return found;
    };

    if (
      (storeMiddlewareNames.size > 0 || storeMiddlewareNamespaces.size > 0) &&
      !APPROVED_MIDDLEWARE.has(filePath) &&
      ![CONFIGURED_STORE_PATH, REGISTRY_PATH].includes(filePath)
    ) {
      violations.push(
        `${filePath}: StoreMiddleware is restricted to approved infrastructure middleware`,
      );
    }

    const registryCalls = [];
    const bridgeCalls = { registerMockIpcHandler: 0, addMockIpcListener: 0 };
    let configuredRegistryConsumptions = 0;
    visit(file.source, (node) => {
      let factoryName;
      let returnType;
      if (ts.isFunctionDeclaration(node) && node.name) {
        factoryName = node.name.text;
        returnType = node.type;
      } else if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) {
        factoryName = node.name.text;
        returnType = node.type ?? node.initializer.type;
      }
      if (factoryName) {
        const typedFactory = typeUsesStoreMiddleware(returnType);
        const conventionalFactory =
          /^create[A-Za-z0-9_]*ReduxBridge$/.test(factoryName) ||
          (/^create[A-Za-z0-9_]*Middleware$/.test(factoryName) && isRendererSource(filePath));
        const serviceFactory = /^create[A-Za-z0-9_]*Service$/.test(factoryName) && typedFactory;
        const approvedRegistryBuilder =
          filePath === REGISTRY_PATH && factoryName === REGISTRY_BUILDER;
        if (
          (conventionalFactory || typedFactory || serviceFactory) &&
          APPROVED_MIDDLEWARE.get(filePath) !== factoryName &&
          !approvedRegistryBuilder
        ) {
          violations.push(`${filePath}: unapproved side-effect factory ${factoryName}`);
        }
      }
      if (ts.isCallExpression(node)) {
        const registrar = expressionOrigin(filePath, node.expression);
        if (registrar && IPC_REGISTRARS.has(registrar)) {
          bridgeCalls[registrar] += 1;
          if (!APPROVED_BRIDGE_REGISTRATIONS.has(filePath)) {
            violations.push(
              `${filePath}: new renderer IPC bridge registration requires architecture review`,
            );
          }
        }
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'addMiddleware' &&
          expressionOrigin(filePath, node.expression.expression) === 'StoreInstance'
        ) {
          violations.push(`${filePath}: direct Store middleware registration is not allowed`);
        }
        if (filePath === REGISTRY_PATH) {
          const origin = expressionOrigin(filePath, node.expression);
          const approvedCall = typeof origin === 'string' && origin.startsWith('middleware:');
          const topLevelCall =
            ts.isIdentifier(node.expression) && ts.isExpressionStatement(node.parent);
          const typedArrayElement =
            ts.isArrayLiteralExpression(node.parent) &&
            ts.isVariableDeclaration(node.parent.parent) &&
            typeUsesStoreMiddleware(node.parent.parent.type);
          const typedArrayPush =
            ts.isCallExpression(node.parent) &&
            ts.isPropertyAccessExpression(node.parent.expression) &&
            node.parent.expression.name.text === 'push' &&
            ts.isIdentifier(node.parent.expression.expression) &&
            storeMiddlewareNames.size > 0;
          if (approvedCall || topLevelCall || typedArrayElement || typedArrayPush) {
            registryCalls.push(origin ?? '<unapproved>');
          }
        }
      }
      if (ts.isNewExpression(node)) {
        const constructorOrigin = expressionOrigin(filePath, node.expression);
        const directStore =
          constructorOrigin === 'Store' ||
          (ts.isIdentifier(node.expression) && storeConstructorNames.has(node.expression.text)) ||
          (ts.isPropertyAccessExpression(node.expression) &&
            ts.isIdentifier(node.expression.expression) &&
            storeConstructorNamespaces.has(node.expression.expression.text) &&
            node.expression.name.text === 'Store');
        if (directStore && (node.arguments?.length ?? 0) > 1) {
          const consumesConfiguredRegistry =
            filePath === CONFIGURED_STORE_PATH &&
            (node.arguments?.length ?? 0) >= 2 &&
            expressionOrigin(filePath, node.arguments[1]) === MIDDLEWARE_REGISTRY_ORIGIN;
          if (consumesConfiguredRegistry) configuredRegistryConsumptions += 1;
          else violations.push(`${filePath}: direct Store middleware registration is not allowed`);
        }
      }
    });

    if (filePath === CONFIGURED_STORE_PATH && configuredRegistryConsumptions !== 1) {
      violations.push(
        `${filePath}: configured Store must consume the central middleware registry exactly once`,
      );
    }

    const approvedBridgeCalls = APPROVED_BRIDGE_REGISTRATIONS.get(filePath);
    if (
      approvedBridgeCalls &&
      [...IPC_REGISTRARS].some(
        (registrar) => bridgeCalls[registrar] !== (approvedBridgeCalls[registrar] ?? 0),
      )
    ) {
      violations.push(`${filePath}: reviewed renderer IPC bridge registrations changed`);
    }

    if (filePath === REGISTRY_PATH) {
      const expected = [...APPROVED_MIDDLEWARE]
        .map(([approvedPath, factory]) => `middleware:${approvedPath}#${factory}`)
        .sort();
      if (
        registryCalls.length !== expected.length ||
        registryCalls
          .slice()
          .sort()
          .some((name, i) => name !== expected[i])
      ) {
        violations.push(
          `${filePath}: registry must contain exactly the four approved middleware factories`,
        );
      }
    }
  }
  return violations;
}

function collectTypeScriptFiles(rootDir) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.name.endsWith('.ts')) {
        files.push({
          path: normalize(path.relative(process.cwd(), absolute)),
          content: fs.readFileSync(absolute, 'utf8'),
        });
      }
    }
  };
  visit(rootDir);
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const violations = findRendererSideEffectBoundaryViolations(
    collectTypeScriptFiles(path.resolve('src')),
  );
  if (violations.length > 0) {
    console.error(
      ['Renderer side-effect boundary violations:', ...violations.map((v) => `- ${v}`)].join('\n'),
    );
    process.exit(1);
  }
  console.log('Renderer side-effect boundaries valid.');
}
