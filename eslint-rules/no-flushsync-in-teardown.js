// flushSync() from a teardown path flushes unrelated dirty effects while Svelte
// still has is_destroying_effect set; any component mounted during that flush
// throws effect_in_teardown. The pattern passed review and CI in
// cloudlands-fe#2143 and crashed the workspace page in v2.141.0
// (intent-hq/intent#4550). Teardown paths are: a function returned from an
// $effect / $effect.pre / onMount callback, an onDestroy callback, and the
// destroy() method of an object returned by a function used with `use:`.
// A same-file helper whose body calls flushSync counts as flushSync, unless the
// flush is guarded by one of the helper's own parameters — the caller then
// decides, and teardown callers are expected to opt out (`{ sync: false }`).

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

const EFFECT_CALLBACK_HOSTS = new Set(['$effect', '$effect.pre', 'onMount']);

function unwrapExpression(node) {
  let current = node;
  while (
    current &&
    (current.type === 'TSAsExpression' ||
      current.type === 'TSNonNullExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'ParenthesizedExpression')
  ) {
    current = current.expression;
  }
  return current;
}

function getEnclosingFunction(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (FUNCTION_TYPES.has(current.type)) return current;
  }
  return null;
}

function getCalleeName(callee) {
  const unwrapped = unwrapExpression(callee);
  if (unwrapped?.type === 'Identifier') return unwrapped.name;
  if (
    unwrapped?.type === 'MemberExpression' &&
    !unwrapped.computed &&
    unwrapped.object.type === 'Identifier' &&
    unwrapped.property.type === 'Identifier'
  ) {
    return `${unwrapped.object.name}.${unwrapped.property.name}`;
  }
  return null;
}

function isCallbackOf(fn, hostNames) {
  const parent = fn.parent;
  return (
    parent?.type === 'CallExpression' &&
    parent.arguments[0] === fn &&
    hostNames.has(getCalleeName(parent.callee))
  );
}

// The function that lexically returns `node` (as a `return` statement or an
// arrow expression body), or null when `node` is not a returned value.
function getReturningFunction(node) {
  let value = node;
  while (value.parent?.type === 'TSAsExpression' || value.parent?.type === 'TSNonNullExpression') {
    value = value.parent;
  }
  const parent = value.parent;
  if (parent?.type === 'ReturnStatement') return getEnclosingFunction(parent);
  if (parent?.type === 'ArrowFunctionExpression' && parent.body === value) return parent;
  return null;
}

function getDeclaredName(fn) {
  if (fn.type === 'FunctionDeclaration') return fn.id?.name ?? null;
  const parent = fn.parent;
  if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
    return parent.id.name;
  }
  return null;
}

function getTeardownKind(fn, actionNames) {
  if (isCallbackOf(fn, new Set(['onDestroy']))) return 'an onDestroy callback';

  const returningFn = getReturningFunction(fn);
  if (returningFn && isCallbackOf(returningFn, EFFECT_CALLBACK_HOSTS)) {
    return `a cleanup returned from ${getCalleeName(returningFn.parent.callee)}`;
  }

  const property = fn.parent;
  if (
    property?.type === 'Property' &&
    property.value === fn &&
    !property.computed &&
    property.key.type === 'Identifier' &&
    property.key.name === 'destroy' &&
    property.parent.type === 'ObjectExpression'
  ) {
    const actionFn = getReturningFunction(property.parent);
    const actionName = actionFn ? getDeclaredName(actionFn) : null;
    if (actionName && actionNames.has(actionName)) {
      return `the destroy() of the use:${actionName} action`;
    }
  }

  return null;
}

function findTeardownKind(node, actionNames) {
  for (let fn = getEnclosingFunction(node); fn; fn = getEnclosingFunction(fn)) {
    const kind = getTeardownKind(fn, actionNames);
    if (kind) return kind;
  }
  return null;
}

function getDeclarationNode(fn) {
  if (fn.type === 'FunctionDeclaration') return fn;
  return fn.parent?.type === 'VariableDeclarator' ? fn.parent : null;
}

function isWithin(node, container) {
  return node.range[0] >= container.range[0] && node.range[1] <= container.range[1];
}

function getGuardConditions(call, helper) {
  const conditions = [];
  for (
    let child = call, parent = call.parent;
    parent && parent !== helper;
    parent = parent.parent
  ) {
    if (
      (parent.type === 'IfStatement' || parent.type === 'ConditionalExpression') &&
      parent.test !== child
    ) {
      conditions.push(parent.test);
    } else if (parent.type === 'LogicalExpression' && parent.right === child) {
      conditions.push(parent.left);
    }
    child = parent;
  }
  return conditions;
}

function isGuardedByParameter(sourceCode, call, helper) {
  const conditions = getGuardConditions(call, helper);
  if (conditions.length === 0) return false;
  return sourceCode
    .getDeclaredVariables(helper)
    .filter((variable) => variable.defs.some((definition) => definition.type === 'Parameter'))
    .some((parameter) =>
      parameter.references.some((reference) =>
        conditions.some((condition) => isWithin(reference.identifier, condition)),
      ),
    );
}

function getCallsThrough(sourceCode, declarationNode) {
  const calls = [];
  for (const variable of sourceCode.getDeclaredVariables(declarationNode)) {
    for (const reference of variable.references) {
      const identifier = reference.identifier;
      if (identifier.parent?.type === 'CallExpression' && identifier.parent.callee === identifier) {
        calls.push(identifier.parent);
      }
    }
  }
  return calls;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow flushSync (directly or through a same-file helper) inside Svelte effect cleanups, onDestroy callbacks, and action destroy methods',
    },
    schema: [],
    messages: {
      flushSyncInTeardown:
        '{{call}} runs inside {{teardown}}. flushSync flushes unrelated dirty effects while Svelte is still destroying, and any component mounted by that flush throws effect_in_teardown (intent-hq/intent#4550). Skip the synchronous flush on teardown paths.',
    },
  },

  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const flushSyncImports = [];
    const actionNames = new Set();

    return {
      ImportDeclaration(node) {
        if (node.source.value !== 'svelte' || node.importKind === 'type') return;
        const importsFlushSync = node.specifiers.some(
          (specifier) =>
            specifier.type === 'ImportSpecifier' &&
            specifier.importKind !== 'type' &&
            (specifier.imported.name ?? specifier.imported.value) === 'flushSync',
        );
        if (importsFlushSync) flushSyncImports.push(node);
      },

      SvelteDirective(node) {
        if (node.kind === 'Action' && node.key.name.type === 'Identifier') {
          actionNames.add(node.key.name.name);
        }
      },

      'Program:exit'() {
        if (flushSyncImports.length === 0) return;

        const visitedDeclarations = new Set();
        const queue = [];
        for (const importNode of flushSyncImports) {
          for (const variable of sourceCode.getDeclaredVariables(importNode)) {
            const specifier = variable.defs[0]?.node;
            if (specifier?.type !== 'ImportSpecifier') continue;
            if ((specifier.imported.name ?? specifier.imported.value) !== 'flushSync') continue;
            for (const call of getCallsThrough(sourceCode, specifier)) {
              queue.push({ call, label: 'flushSync()' });
            }
          }
        }

        while (queue.length > 0) {
          const { call, label } = queue.shift();
          const teardown = findTeardownKind(call, actionNames);
          if (teardown) {
            context.report({
              node: call,
              messageId: 'flushSyncInTeardown',
              data: { call: label, teardown },
            });
            continue;
          }

          const helper = getEnclosingFunction(call);
          const declaration = helper ? getDeclarationNode(helper) : null;
          const helperName = helper ? getDeclaredName(helper) : null;
          if (!declaration || !helperName || visitedDeclarations.has(declaration)) continue;
          if (isGuardedByParameter(sourceCode, call, helper)) continue;
          visitedDeclarations.add(declaration);
          for (const helperCall of getCallsThrough(sourceCode, declaration)) {
            queue.push({ call: helperCall, label: `${helperName}() (which calls flushSync)` });
          }
        }
      },
    };
  },
};
