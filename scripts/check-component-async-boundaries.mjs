import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import typescriptParser from '@typescript-eslint/parser';
import { parseForESLint } from 'svelte-eslint-parser';
import ts from 'typescript';

const REVIEWED_PROMISE_CONSUMERS = new Map([
  ['src/features/daemon-status/DaemonStoppedOverlay.svelte#openConnectionRequested', 1],
  ['src/features/hud/components/HudBackendMenu.svelte#openConnectionRequested', 1],
  ['src/features/layout/tab-types/BrowserTabType.svelte#navigateBrowserTabRequested', 1],
  ['src/features/onboarding/messages/ClaudeLoginButton.svelte#claudeLoginRequested', 1],
  ['src/lib/components/layout/panel-system/PanelLayout.svelte#renameAgentSessionRequested', 2],
  ['src/lib/components/tiptap/TaskAgentStatus.svelte#restoreAgentSessionRequested', 1],
  ['src/lib/components/workspace/NoteCodeChangesCard.svelte#restoreAgentSessionRequested', 1],
  ['src/lib/components/workspace/NoteMetadataBar.svelte#restoreAgentSessionRequested', 1],
  ['src/lib/components/workspace/NoteWithComments.svelte#coordinateExternalNoteUpdate', 1],
  ['src/lib/components/workspace/SpecWritingOnboarding.svelte#stopAgentSessionRequested', 1],
]);

const REVIEWED_DISPATCH_SELECTOR_READS = new Map([
  [
    'src/lib/components/chat/input/ModelPicker.svelte#loadProviderModelsRequested#selectProviderModelsClearEpoch',
    1,
  ],
]);

const EXCLUDED_COMPONENT_PARTS = [
  '/__tests__/',
  '/component-catalog/',
  '/generated/',
  '/main/',
  '/tests/',
];

const normalize = (filePath) => filePath.split(path.sep).join('/').replace(/^\.\//, '');

const unwrap = (node) => {
  let current = node;
  while (
    current &&
    ['ChainExpression', 'TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression'].includes(
      current.type,
    )
  ) {
    current = current.expression;
  }
  return current;
};

const propertyName = (node) => {
  const current = unwrap(node);
  if (current?.type !== 'MemberExpression') return null;
  const property = unwrap(current.property);
  if (!current.computed && property?.type === 'Identifier') return property.name;
  return property?.type === 'Literal' && typeof property.value === 'string' ? property.value : null;
};

const calledName = (node) => {
  const current = unwrap(node);
  if (current?.type !== 'CallExpression') return null;
  const callee = unwrap(current.callee);
  if (callee?.type === 'Identifier') return callee.name;
  const owner = unwrap(callee?.object);
  return propertyName(callee) === 'select' && owner?.type === 'Identifier' ? owner.name : null;
};

const isModuleScriptElement = (node) =>
  node.startTag?.attributes?.some(
    (attribute) =>
      attribute.type === 'SvelteAttribute' &&
      (attribute.key?.name === 'module' ||
        (attribute.key?.name === 'context' &&
          attribute.value?.some(
            (value) => value.type === 'SvelteLiteral' && value.value === 'module',
          ))),
  ) ?? false;

const isComponentInstanceNode = (node) => {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === 'SvelteScriptElement') return !isModuleScriptElement(current);
  }
  return true;
};

const isProductionComponent = (filePath) =>
  filePath.endsWith('.svelte') &&
  (filePath.startsWith('src/features/') ||
    filePath.startsWith('src/lib/') ||
    filePath.startsWith('src/routes/')) &&
  !EXCLUDED_COMPONENT_PARTS.some((part) => filePath.includes(part)) &&
  !filePath.includes('/routes/(app)/test-') &&
  !filePath.includes('/routes/observability/');

function collectAsyncActionExportNames(files) {
  const names = new Set();
  for (const file of files) {
    if (!/\.[cm]?ts$/.test(file.path) || /(?:\.test\.|\.spec\.|\/tests?\/)/.test(file.path)) {
      continue;
    }
    const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
    const factories = new Set();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
        continue;
      }
      if (!statement.moduleSpecifier.text.includes('/utils/store/create-action')) continue;
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      for (const item of bindings.elements) {
        if ((item.propertyName?.text ?? item.name.text) === 'createAsyncAction') {
          factories.add(item.name.text);
        }
      }
    }
    for (const statement of source.statements) {
      if (
        !ts.isVariableStatement(statement) ||
        !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        continue;
      }
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          ts.isCallExpression(declaration.initializer) &&
          ts.isIdentifier(declaration.initializer.expression) &&
          factories.has(declaration.initializer.expression.text)
        ) {
          names.add(declaration.name.text);
        }
      }
    }
  }
  return names;
}

function parseComponent(file, asyncActionExports) {
  const { ast, visitorKeys } = parseForESLint(file.content, {
    filePath: file.path,
    parser: typescriptParser,
  });
  const importedActions = new Map();
  const bindings = new Map();
  const nodes = [];
  const visit = (node) => {
    nodes.push(node);
    for (const key of visitorKeys[node.type] ?? []) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach((entry) => entry && visit(entry));
      else if (child) visit(child);
    }
  };
  visit(ast);

  for (const node of nodes) {
    if (node.type !== 'ImportDeclaration' || !/^\$store\//.test(node.source.value)) continue;
    for (const specifier of node.specifiers) {
      if (specifier.type !== 'ImportSpecifier' || specifier.importKind === 'type') continue;
      const imported = specifier.imported.name ?? specifier.imported.value;
      if (asyncActionExports.has(imported)) importedActions.set(specifier.local.name, imported);
    }
  }

  const actionCreator = (expression) => {
    const current = unwrap(expression);
    if (current?.type === 'Identifier') return bindings.get(current.name) ?? null;
    if (current?.type !== 'CallExpression') return null;
    const callee = unwrap(current.callee);
    if (callee?.type === 'Identifier' && importedActions.has(callee.name)) {
      return importedActions.get(callee.name);
    }
    if (propertyName(callee) === 'dispatch') return actionCreator(current.arguments[0]);
    return null;
  };

  for (const node of nodes) {
    if (node.type !== 'VariableDeclarator' || node.id.type !== 'Identifier' || !node.init) continue;
    const creator = actionCreator(node.init);
    if (creator) bindings.set(node.id.name, creator);
  }
  return { ast, visitorKeys, nodes, actionCreator };
}

const ownCall = (node, visitorKeys, predicate, root = true) => {
  if (predicate(node)) return node;
  if (!root && /(?:Function|ArrowFunction)/.test(node.type)) return null;
  for (const key of visitorKeys[node.type] ?? []) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const entry of child) {
        const match = entry && ownCall(entry, visitorKeys, predicate, false);
        if (match) return match;
      }
    } else if (child) {
      const match = ownCall(child, visitorKeys, predicate, false);
      if (match) return match;
    }
  }
  return null;
};

export function findComponentAsyncBoundaryViolations(files) {
  const normalized = files.map((file) => ({ ...file, path: normalize(file.path) }));
  const asyncActionExports = collectAsyncActionExportNames(normalized);
  const violations = [];
  for (const file of normalized.filter((entry) => isProductionComponent(entry.path))) {
    let parsed;
    try {
      parsed = parseComponent(file, asyncActionExports);
    } catch {
      violations.push(`${file.path}:1: Svelte parse failure`);
      continue;
    }
    const { ast, visitorKeys, nodes, actionCreator } = parsed;
    const reviewedPromiseCounts = new Map();
    const reviewedSelectorCounts = new Map();
    for (const node of nodes) {
      if (
        node.type !== 'MemberExpression' ||
        propertyName(node) !== 'promise' ||
        !isComponentInstanceNode(node)
      ) {
        continue;
      }
      const creator = actionCreator(node.object);
      if (!creator) continue;
      const reviewedKey = `${file.path}#${creator}`;
      const reviewedCount = (reviewedPromiseCounts.get(reviewedKey) ?? 0) + 1;
      reviewedPromiseCounts.set(reviewedKey, reviewedCount);
      if (reviewedCount <= (REVIEWED_PROMISE_CONSUMERS.get(reviewedKey) ?? 0)) continue;
      violations.push(
        `${file.path}:${node.loc.start.line}: component consumes ${creator}.promise; dispatch the request and observe request-correlated reducer state through a selector`,
      );
    }

    for (const block of nodes.filter(
      (node) =>
        (node.type === 'Program' || node.type === 'BlockStatement') &&
        isComponentInstanceNode(node),
    )) {
      for (let index = 0; index < block.body.length - 1; index += 1) {
        const dispatch = ownCall(
          block.body[index],
          visitorKeys,
          (node) =>
            node.type === 'CallExpression' &&
            propertyName(node.callee) === 'dispatch' &&
            Boolean(actionCreator(node.arguments[0])),
        );
        if (!dispatch) continue;
        const selector = ownCall(
          block.body[index + 1],
          visitorKeys,
          (node) =>
            node.type === 'CallExpression' &&
            propertyName(node.callee) === 'select' &&
            node.arguments.some((argument) => propertyName(argument) === 'state'),
        );
        if (!selector) continue;
        const creator = actionCreator(dispatch.arguments[0]);
        const selectorName = calledName(selector);
        const reviewedKey = `${file.path}#${creator}#${selectorName}`;
        const reviewedCount = (reviewedSelectorCounts.get(reviewedKey) ?? 0) + 1;
        reviewedSelectorCounts.set(reviewedKey, reviewedCount);
        if (reviewedCount <= (REVIEWED_DISPATCH_SELECTOR_READS.get(reviewedKey) ?? 0)) continue;
        violations.push(
          `${file.path}:${selector.loc.start.line}: selector read immediately follows async dispatch of ${creator}; observe request-correlated selector settlement instead`,
        );
      }
    }
    void ast;
  }
  return violations;
}

export function collectComponentAsyncBoundaryFiles(rootDir) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (/\.(?:[cm]?ts|svelte)$/.test(entry.name)) {
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
  const violations = findComponentAsyncBoundaryViolations(
    collectComponentAsyncBoundaryFiles(path.resolve('src')),
  );
  if (violations.length) {
    console.error(
      ['Component async boundary violations:', ...violations.map((v) => `- ${v}`)].join('\n'),
    );
    process.exit(1);
  }
  console.log('Component async boundaries valid.');
}
