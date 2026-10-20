import path from 'node:path';

// Every store selector module mocked by a test that renders the real ChatPanel
// must keep its real exports, either through a render scaffold factory (for the
// modules listed here) or by spreading the real module. A hand-listed mock misses
// the next selector ChatPanel reads and crashes the whole suite
// (cloudlands-fe#3525). Tests that mock ChatPanel itself, and modules outside
// the store slices, keep their own contracts.
const factories = new Map(
  [
    ['agent-session', 'agentSessionSelectors'],
    ['chat-state', 'chatStateSelectors'],
    ['agent-queue', 'agentQueueSelectors'],
    ['unread-tracking', 'unreadTrackingSelectors'],
    ['transient-ui', 'transientUiSelectors'],
    ['provider-catalog', 'providerCatalogSelectors'],
  ].map(([slice, factory]) => [`src/store/renderer/slices/${slice}/${slice}-selectors`, factory]),
);
const selectorModule = /^src\/store\/renderer\/slices\/[^/]+\/[^/]+-selectors$/;
// Scaffold helpers that resolve to the real exports of `importOriginal`.
const realHelpers = new Set(['factory:withReal', 'factory:withRealSelectors']);
const scaffoldPath = 'src/lib/components/chat/__tests__/mocks/chat-panel-render-scaffold';
const panelPath = 'src/lib/components/chat/ChatPanel.svelte';
const functions = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration']);

function unwrap(node) {
  while (
    node &&
    [
      'TSAsExpression',
      'TSSatisfiesExpression',
      'TSTypeAssertion',
      'TSNonNullExpression',
      'ChainExpression',
    ].includes(node.type)
  ) {
    node = node.argument ?? node.expression;
  }
  return node;
}

function literal(node) {
  if (node?.type === 'Literal') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0)
    return node.quasis[0].value.cooked;
  return null;
}

function key(node) {
  return node.computed ? literal(node.property) : node.property?.name;
}

function isViCall(node, methods) {
  return (
    node?.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    ['vi', 'vitest'].includes(node.callee.object.name) &&
    methods.includes(key(node.callee))
  );
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require real-module or shared defaults for selector mocks in real ChatPanel tests',
    },
    schema: [],
    messages: {
      sharedDefaults:
        'Copied selector mocks miss new ChatPanel imports. Return {{factory}}() from ./mocks/chat-panel-render-scaffold, spread it before stateful overrides, or spread importOriginal() to retain the real exports.',
      realDefaults:
        'Copied selector mocks miss new ChatPanel imports. Return withReal(importOriginal, values) or withRealSelectors(importOriginal, selectors) from ./mocks/chat-panel-render-scaffold, or spread await importOriginal() before the overrides, to retain the real exports.',
    },
  },
  create(context) {
    const source = context.sourceCode;
    const imports = new Set();
    const mocks = [];
    const returns = [];
    const filename = context.filename.replaceAll('\\', '/');
    const sourceRoot = filename.slice(0, filename.lastIndexOf('/src/') + 1);

    function modulePath(node) {
      node = unwrap(node);
      if (node?.type === 'ImportExpression') node = node.source;
      let value = literal(node);
      if (typeof value !== 'string') return null;
      if (value.startsWith('$store/')) value = `src/store/${value.slice(7)}`;
      else if (value.startsWith('$lib/')) value = `src/lib/${value.slice(5)}`;
      else if (value.startsWith('.'))
        value = path.posix.relative(
          sourceRoot,
          path.posix.resolve(path.posix.dirname(filename), value),
        );
      return value.replace(/\.[cm]?[jt]s$/, '');
    }

    function variable(node) {
      for (let scope = source.getScope(node); scope; scope = scope.upper) {
        if (scope.set.has(node.name)) return scope.set.get(node.name);
      }
      return null;
    }

    // The mock factory's own, never reassigned `importOriginal` parameter.
    function isImportOriginal(node, factory) {
      const firstParam = factory.params[0];
      if (node?.type !== 'Identifier' || firstParam?.type !== 'Identifier') return false;
      const binding = variable(node);
      return (
        binding !== null &&
        binding === variable(firstParam) &&
        !binding.references.some((ref) => ref.isWrite())
      );
    }

    // Follow only immutable local aliases. No execution, text matching, or
    // cross-file inference: an imported factory must come from the shared file.
    function origin(node, factory, module, seen = new Set()) {
      node = unwrap(node);
      if (!node || seen.has(node)) return null;
      seen = new Set(seen).add(node);
      // Vitest awaits a returned module promise; object spread does not.
      // Preserve that distinction through aliases until an explicit await.
      if (node.type === 'AwaitExpression') {
        const value = origin(node.argument, factory, module, seen);
        return value?.startsWith('promise:') ? value.slice(8) : value;
      }
      if (node.type === 'ImportExpression')
        return modulePath(node) === scaffoldPath ? 'promise:scaffold' : null;
      if (node.type === 'Identifier') {
        const binding = variable(node);
        if (!binding || binding.references.some((ref) => ref.isWrite() && !ref.init)) return null;
        const definition = binding.defs[0];
        if (
          definition?.type === 'ImportBinding' &&
          modulePath(definition.parent.source) === scaffoldPath
        ) {
          return definition.node.type === 'ImportNamespaceSpecifier'
            ? 'scaffold'
            : `factory:${definition.node.imported.name}`;
        }
        if (definition?.type !== 'Variable' || definition.parent.kind !== 'const') return null;
        const initial = origin(definition.node.init, factory, module, seen);
        if (definition.node.id.type === 'Identifier') return initial;
        if (initial === 'scaffold' && definition.node.id.type === 'ObjectPattern') {
          const property = definition.node.id.properties.find(
            (prop) => prop.type === 'Property' && prop.value === definition.name,
          );
          if (property) return `factory:${property.key.name ?? literal(property.key)}`;
        }
        return null;
      }
      if (
        node.type === 'MemberExpression' &&
        origin(node.object, factory, module, seen) === 'scaffold'
      )
        return `factory:${key(node)}`;
      if (node.type === 'CallExpression') {
        const callee = origin(node.callee, factory, module, seen);
        if (factories.get(module) && callee === `factory:${factories.get(module)}`)
          return 'defaults';
        // withReal(importOriginal, overrides) resolves to the real exports.
        if (realHelpers.has(callee) && isImportOriginal(node.arguments[0], factory))
          return 'promise:defaults';
        if (isImportOriginal(node.callee, factory)) return 'promise:defaults';
        if (isViCall(node, ['importActual']) && modulePath(node.arguments[0]) === module)
          return 'promise:defaults';
      }
      if (
        node.type === 'ObjectExpression' &&
        node.properties.some(
          (prop) =>
            prop.type === 'SpreadElement' &&
            origin(prop.argument, factory, module, seen) === 'defaults',
        )
      )
        return 'defaults';
      return null;
    }

    function preservesExports(mock, module) {
      const factory = unwrap(mock.arguments[1]);
      if (factory?.type === 'ObjectExpression') {
        return factory.properties.some(
          (prop) =>
            prop.type === 'Property' &&
            (prop.key.name ?? literal(prop.key)) === 'spy' &&
            literal(prop.value) === true,
        );
      }
      if (!functions.has(factory?.type)) return false;
      const values =
        factory.body.type !== 'BlockStatement'
          ? [factory.body]
          : returns
              .filter(
                (node) =>
                  source.getAncestors(node).findLast((parent) => functions.has(parent.type)) ===
                  factory,
              )
              .map((node) => node.argument);
      return (
        values.length > 0 &&
        values.every((value) =>
          ['defaults', 'promise:defaults'].includes(origin(value, factory, module)),
        )
      );
    }

    return {
      ImportDeclaration(node) {
        if (node.importKind !== 'type') imports.add(modulePath(node.source));
      },
      ImportExpression(node) {
        imports.add(modulePath(node));
      },
      CallExpression(node) {
        if (isViCall(node, ['mock', 'doMock'])) mocks.push(node);
      },
      ReturnStatement(node) {
        returns.push(node);
      },
      'Program:exit'() {
        if (
          !imports.has(panelPath) ||
          mocks.some(
            (mock) =>
              modulePath(mock.arguments[0]) === panelPath && !preservesExports(mock, panelPath),
          )
        )
          return;
        for (const mock of mocks) {
          const module = modulePath(mock.arguments[0]);
          if (!selectorModule.test(module ?? '')) continue;
          if (preservesExports(mock, module)) continue;
          const factory = factories.get(module);
          context.report(
            factory
              ? { node: mock, messageId: 'sharedDefaults', data: { factory } }
              : { node: mock, messageId: 'realDefaults' },
          );
        }
      },
    };
  },
};
