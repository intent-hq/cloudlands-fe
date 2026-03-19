const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

const SELECTOR_IMPORT_SOURCE_PATTERN = /selectors/;

const SELECTOR_NESTED_MESSAGE =
  'Selector readables from *-selectors files must be created during component initialization (top-level <script>). Create the selector store once and reuse it in callbacks, handlers, and async functions.';

const GET_DISPATCH_MESSAGE =
  'getDispatch() must be called during component initialization (top-level <script>). Capture dispatch once and reuse it in callbacks, handlers, and async functions.';

const GET_SELECTOR_MESSAGE =
  'Do not wrap selector readables with svelte/store get(). Create the selector readable during component initialization and use it reactively, or use selector.select(...) with Redux state when you need a one-off read.';

function unwrapExpression(node) {
  let current = node;

  while (current) {
    switch (current.type) {
      case 'ChainExpression':
        current = current.expression;
        break;
      case 'TSAsExpression':
      case 'TSTypeAssertion':
      case 'TSNonNullExpression':
      case 'ParenthesizedExpression':
        current = current.expression;
        break;
      default:
        return current;
    }
  }

  return current;
}

function isWrappedSelectorArgumentToGet(node, svelteStoreGetNames) {
  let current = node;

  while (current.parent) {
    switch (current.parent.type) {
      case 'ChainExpression':
      case 'TSAsExpression':
      case 'TSTypeAssertion':
      case 'TSNonNullExpression':
      case 'ParenthesizedExpression':
        current = current.parent;
        break;
      default:
        return current.parent.type === 'CallExpression'
          && current.parent.arguments[0] === current
          && isTrackedIdentifier(current.parent.callee, svelteStoreGetNames);
    }
  }

  return false;
}

function isTrackedIdentifier(node, names) {
  const unwrapped = unwrapExpression(node);
  return unwrapped?.type === 'Identifier' && names.has(unwrapped.name);
}

function isSelectorCall(node, selectorNames) {
  const unwrapped = unwrapExpression(node);
  if (unwrapped?.type !== 'CallExpression') {
    return false;
  }

  return isTrackedIdentifier(unwrapped.callee, selectorNames);
}

function isInsideFunction(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (FUNCTION_TYPES.has(current.type)) {
      return true;
    }
    if (current.type === 'Program') {
      return false;
    }
  }

  return false;
}

function isInsideEventHandler(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === 'SvelteDirective' && current.kind === 'EventHandler') {
      return true;
    }

    if (
      current.type === 'SvelteAttribute'
      && typeof current.key?.name === 'string'
      && /^on[A-Z]/.test(current.key.name)
    ) {
      return true;
    }
  }

  return false;
}

function isInsideModuleScript(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === 'SvelteScriptElement') {
      return current.startTag?.attributes?.some(
        (attribute) => attribute.type === 'SvelteAttribute'
          && attribute.key?.name === 'context'
          && attribute.value?.some((value) => value.type === 'SvelteLiteral' && value.value === 'module'),
      ) ?? false;
    }
  }

  return false;
}

function isRestrictedLifecycleContext(node) {
  return isInsideFunction(node) || isInsideEventHandler(node) || isInsideModuleScript(node);
}

function isSelectorImportSource(source) {
  return typeof source === 'string' && SELECTOR_IMPORT_SOURCE_PATTERN.test(source);
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Warn about selector and getDispatch lifecycle violations in Svelte components',
    },
    schema: [],
  },

  create(context) {
    const svelteStoreGetNames = new Set();
    const selectorNames = new Set();
    const getDispatchNames = new Set();

    return {
      ImportDeclaration(node) {
        const source = node.source.value;

        for (const specifier of node.specifiers) {
          if (specifier.type !== 'ImportSpecifier') {
            continue;
          }

          if (source === 'svelte/store' && specifier.imported.name === 'get') {
            svelteStoreGetNames.add(specifier.local.name);
          }

          if (specifier.imported.name === 'getDispatch') {
            getDispatchNames.add(specifier.local.name);
          }

          if (isSelectorImportSource(source) && specifier.imported.name.startsWith('select')) {
            selectorNames.add(specifier.local.name);
          }
        }
      },

      CallExpression(node) {
        if (isTrackedIdentifier(node.callee, getDispatchNames) && isRestrictedLifecycleContext(node)) {
          context.report({ node, message: GET_DISPATCH_MESSAGE });
          return;
        }

        if (isTrackedIdentifier(node.callee, svelteStoreGetNames) && isSelectorCall(node.arguments[0], selectorNames)) {
          context.report({ node, message: GET_SELECTOR_MESSAGE });
          return;
        }

        if (
          isTrackedIdentifier(node.callee, selectorNames)
          && isRestrictedLifecycleContext(node)
          && !isWrappedSelectorArgumentToGet(node, svelteStoreGetNames)
        ) {
          context.report({ node, message: SELECTOR_NESTED_MESSAGE });
        }
      },
    };
  },
};