// flushSync() from a teardown path flushes unrelated dirty effects while Svelte
// still has is_destroying_effect set; any component mounted during that flush
// throws effect_in_teardown. The pattern passed review and CI in
// cloudlands-fe#2143 and crashed the workspace page in v2.141.0
// (intent-hq/intent#4550). Teardown paths are: a function returned from an
// $effect / $effect.pre / onMount callback, an onDestroy callback, and the
// destroy() method of an object returned by a function used with `use:`.
// A same-file helper whose body calls flushSync counts as flushSync. When the
// flush is guarded by one of the helper's own parameters (`if (sync)`,
// `sync ? flushSync(fn) : fn()`, `sync && flushSync()`, `if (!sync) return`),
// a call is exempt only when its argument provably disables the flush: a falsy
// literal, an omitted or `undefined` value whose default is not truthy, or a
// parameter of the caller that is itself carried to the caller's call sites
// (keeping the callee's default semantics). Anything else — `true`, a default
// of `true`, component state, a computed object key, a parameter that is
// reassigned in the helper body — counts as a flush.
// Analysis is lexical: a flush inside a nested callback (rAF, forEach, ...) is
// attributed to that callback, not to the helper that schedules it.

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

const WRAPPER_TYPES = new Set([
  'TSAsExpression',
  'TSNonNullExpression',
  'TSSatisfiesExpression',
  'ParenthesizedExpression',
]);

const CLEANUP_HOSTS = new Set(['$effect', '$effect.pre', 'onMount']);

function unwrapExpression(node) {
  let current = node;
  while (current && WRAPPER_TYPES.has(current.type)) current = current.expression;
  return current;
}

// The outermost transparent wrapper around `node` (`x as T`, `x!`, `x satisfies T`).
function unwrapParent(node) {
  let current = node;
  while (current.parent && WRAPPER_TYPES.has(current.parent.type)) current = current.parent;
  return current;
}

function getEnclosingFunction(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (FUNCTION_TYPES.has(current.type)) return current;
  }
  return null;
}

function isWithin(node, container) {
  return node.range[0] >= container.range[0] && node.range[1] <= container.range[1];
}

function getKeyName(property) {
  if (property.computed) return null;
  if (property.key.type === 'Identifier') return property.key.name;
  if (property.key.type === 'Literal') return String(property.key.value);
  return null;
}

// The last static property named `key` of an object literal, `undefined` when
// the key is absent, or null when the literal cannot be read (spread, computed
// key) and must be treated as unknown.
function getStaticProperty(object, key) {
  let match;
  for (const property of object.properties) {
    if (property.type !== 'Property' || property.computed) return null;
    if (getKeyName(property) === key) match = property;
  }
  return match;
}

// A parameter that is redeclared in the body (`var p = true`, `function p() {}`)
// or written to anywhere but its own default initializer cannot be proven from
// the call-site argument. With the parameter as the only definition, an `init`
// write can only be that default.
function isReassigned(variable) {
  return (
    variable.defs.length !== 1 ||
    variable.references.some((reference) => reference.isWrite() && !reference.init)
  );
}

// Binding resolution goes through the scope manager so aliases resolve and
// shadowed names (a local `onDestroy`, an `{#each ... as action}` variable) do not.
function buildReferenceIndex(sourceCode) {
  const index = new Map();
  for (const scope of sourceCode.scopeManager.scopes) {
    for (const reference of scope.references) {
      if (reference.resolved) index.set(reference.identifier, reference.resolved);
    }
  }
  return index;
}

function getSvelteImportName(variable) {
  const definition = variable?.defs[0];
  if (definition?.type !== 'ImportBinding' || definition.node.type !== 'ImportSpecifier')
    return null;
  if (definition.parent.source.value !== 'svelte') return null;
  if (definition.parent.importKind === 'type' || definition.node.importKind === 'type') return null;
  return definition.node.imported.name ?? definition.node.imported.value;
}

function getBindingIdentifier(fn) {
  if (fn.type === 'FunctionDeclaration') return fn.id ?? null;
  const parent = fn.parent;
  return parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier'
    ? parent.id
    : null;
}

// The variable bound to a named function (not its parameters), or null for an
// anonymous function.
function getFunctionVariable(sourceCode, fn) {
  const identifier = getBindingIdentifier(fn);
  if (!identifier) return null;
  const declaration = fn.type === 'FunctionDeclaration' ? fn : fn.parent;
  return (
    sourceCode
      .getDeclaredVariables(declaration)
      .find((variable) => variable.defs.some((definition) => definition.name === identifier)) ??
    null
  );
}

function getCallsOf(variable) {
  const calls = [];
  for (const reference of variable.references) {
    const callee = unwrapParent(reference.identifier);
    if (callee.parent?.type === 'CallExpression' && callee.parent.callee === callee) {
      calls.push(callee.parent);
    }
  }
  return calls;
}

function getSvelteImports(sourceCode, name) {
  const variables = [];
  for (const scope of sourceCode.scopeManager.scopes) {
    for (const variable of scope.variables) {
      if (getSvelteImportName(variable) === name) variables.push(variable);
    }
  }
  return variables;
}

function createAnalyzer(sourceCode, actionIdentifiers) {
  const references = buildReferenceIndex(sourceCode);

  function resolve(identifier) {
    return references.get(identifier) ?? null;
  }

  const actionVariables = new Set(actionIdentifiers.map(resolve).filter(Boolean));

  // `$effect` / `$effect.pre` are runes (compiler globals); onMount / onDestroy are
  // the `svelte` exports, whatever their local alias.
  function getHostName(callee) {
    const unwrapped = unwrapExpression(callee);
    if (unwrapped.type === 'Identifier') {
      const variable = resolve(unwrapped);
      if (variable && variable.defs.length > 0) return getSvelteImportName(variable);
      return unwrapped.name === '$effect' ? '$effect' : null;
    }
    if (
      unwrapped.type === 'MemberExpression' &&
      !unwrapped.computed &&
      unwrapped.object.type === 'Identifier' &&
      unwrapped.object.name === '$effect' &&
      unwrapped.property.type === 'Identifier' &&
      unwrapped.property.name === 'pre'
    ) {
      return '$effect.pre';
    }
    return null;
  }

  function getCallbackHost(fn) {
    const argument = unwrapParent(fn);
    const parent = argument.parent;
    if (parent?.type !== 'CallExpression' || parent.arguments[0] !== argument) return null;
    return getHostName(parent.callee);
  }

  // The function that lexically returns `node` (as a `return` statement or an
  // arrow expression body), or null when `node` is not a returned value.
  function getReturningFunction(node) {
    const value = unwrapParent(node);
    const parent = value.parent;
    if (parent?.type === 'ReturnStatement') return getEnclosingFunction(parent);
    if (parent?.type === 'ArrowFunctionExpression' && parent.body === value) return parent;
    return null;
  }

  function isDestroyProperty(property) {
    return (
      property?.type === 'Property' &&
      property.kind === 'init' &&
      property.parent.type === 'ObjectExpression' &&
      getKeyName(property) === 'destroy'
    );
  }

  // Object literals whose `destroy` is `fn`: `{ destroy() {} }`, `{ destroy: fn }`,
  // and `{ destroy }` where `destroy` is bound to `fn`.
  function getDestroyObjects(fn) {
    const objects = [];
    const inline = unwrapParent(fn);
    if (isDestroyProperty(inline.parent) && inline.parent.value === inline) {
      objects.push(inline.parent.parent);
    }
    const variable = getFunctionVariable(sourceCode, fn);
    for (const reference of variable?.references ?? []) {
      const value = unwrapParent(reference.identifier);
      if (isDestroyProperty(value.parent) && value.parent.value === value) {
        objects.push(value.parent.parent);
      }
    }
    return objects;
  }

  function getTeardownKind(fn) {
    if (getCallbackHost(fn) === 'onDestroy') return 'an onDestroy callback';

    const returningFn = getReturningFunction(fn);
    if (returningFn && CLEANUP_HOSTS.has(getCallbackHost(returningFn))) {
      const host = unwrapParent(returningFn).parent.callee;
      return `a cleanup returned from ${sourceCode.getText(host)}`;
    }

    for (const object of getDestroyObjects(fn)) {
      const actionFn = getReturningFunction(object);
      const actionVariable = actionFn ? getFunctionVariable(sourceCode, actionFn) : null;
      if (actionVariable && actionVariables.has(actionVariable)) {
        return `the destroy() of the use:${actionVariable.name} action`;
      }
    }

    return null;
  }

  function findTeardownKind(node) {
    for (let fn = getEnclosingFunction(node); fn; fn = getEnclosingFunction(fn)) {
      const kind = getTeardownKind(fn);
      if (kind) return kind;
    }
    return null;
  }

  // What a value expression contributes to a guard: 'undefined' (the global
  // `undefined` or `void`), 'falsy' (a falsy literal), 'forward' (some other
  // binding), or 'unknown' (anything else — treated as truthy).
  function classifyValue(node) {
    const value = unwrapExpression(node);
    if (value.type === 'Literal') return !value.value ? 'falsy' : 'unknown';
    if (value.type === 'UnaryExpression' && value.operator === 'void') return 'undefined';
    if (value.type === 'Identifier') {
      const variable = resolve(value);
      const isGlobal = !variable || variable.defs.length === 0;
      return value.name === 'undefined' && isGlobal ? 'undefined' : 'forward';
    }
    return 'unknown';
  }

  // Whether an `undefined` value flushes once `defaultNode` (the parameter's
  // default, or null) is applied; `undefinedOn` is what `undefined` means to
  // whoever consumes the parameter downstream.
  function applyDefault(defaultNode, undefinedOn) {
    if (!defaultNode) return undefinedOn;
    const kind = classifyValue(defaultNode);
    if (kind === 'undefined') return undefinedOn;
    return kind !== 'falsy';
  }

  // Whether omitting the whole argument flushes when the guard is destructured
  // from an object parameter with default `defaultNode`.
  function applyObjectDefault(defaultNode, key, undefinedOn) {
    const object = defaultNode ? unwrapExpression(defaultNode) : null;
    if (object?.type !== 'ObjectExpression') return true;
    const property = getStaticProperty(object, key);
    if (property === null) return true;
    if (property === undefined) return undefinedOn;
    const kind = classifyValue(property.value);
    if (kind === 'undefined') return undefinedOn;
    return kind !== 'falsy';
  }

  // A guard is a parameter of `fn` whose falsy value disables the flush:
  // `index` is its position, `key` the destructured property (or null), and
  // `undefinedOn` / `omittedOn` whether passing `undefined` / leaving the whole
  // argument out still flushes. `undefinedOn` on input is what `undefined`
  // means downstream: false for a lexical `if (p)` guard, the callee's own
  // value for a forwarded parameter.
  function getParameterGuard(identifier, fn, undefinedOn = false) {
    const variable = resolve(identifier);
    const definition = variable?.defs.find((candidate) => candidate.type === 'Parameter');
    if (!definition || definition.node !== fn || isReassigned(variable)) return null;
    const name = definition.name;
    const index = fn.params.findIndex((param) => isWithin(name, param));
    if (index < 0) return null;

    let param = fn.params[index];
    let outerDefault = null;
    if (param.type === 'AssignmentPattern') {
      outerDefault = param.right;
      param = param.left;
    }
    if (param.type === 'Identifier') {
      if (param !== name) return null;
      const effectiveUndefinedOn = applyDefault(outerDefault, undefinedOn);
      return {
        variable,
        index,
        key: null,
        undefinedOn: effectiveUndefinedOn,
        omittedOn: effectiveUndefinedOn,
      };
    }
    if (param.type !== 'ObjectPattern') return null;
    for (const property of param.properties) {
      if (property.type !== 'Property') continue;
      let value = property.value;
      let propertyDefault = null;
      if (value.type === 'AssignmentPattern') {
        propertyDefault = value.right;
        value = value.left;
      }
      if (value !== name) continue;
      const key = getKeyName(property);
      if (key === null) return null;
      const effectiveUndefinedOn = applyDefault(propertyDefault, undefinedOn);
      return {
        variable,
        index,
        key,
        undefinedOn: effectiveUndefinedOn,
        omittedOn: applyObjectDefault(outerDefault, key, effectiveUndefinedOn),
      };
    }
    return null;
  }

  function getEarlyReturnGuard(statement, fn) {
    if (statement.type !== 'IfStatement' || statement.alternate) return null;
    const test = unwrapExpression(statement.test);
    if (test.type !== 'UnaryExpression' || test.operator !== '!') return null;
    const argument = unwrapExpression(test.argument);
    if (argument.type !== 'Identifier') return null;
    let consequent = statement.consequent;
    if (consequent.type === 'BlockStatement' && consequent.body.length === 1) {
      consequent = consequent.body[0];
    }
    if (consequent.type !== 'ReturnStatement') return null;
    return getParameterGuard(argument, fn);
  }

  // Parameters of `fn` that guard `call` lexically: `if (p) call()`,
  // `p ? call() : ...`, `p && call()`, and a preceding `if (!p) return`.
  function getConditionGuards(call, fn) {
    const guards = [];
    for (let child = call, parent = call.parent; parent && parent !== fn; parent = parent.parent) {
      let test = null;
      if (parent.type === 'IfStatement' && parent.consequent === child) test = parent.test;
      else if (parent.type === 'ConditionalExpression' && parent.consequent === child) {
        test = parent.test;
      } else if (
        parent.type === 'LogicalExpression' &&
        parent.operator === '&&' &&
        parent.right === child
      ) {
        test = parent.left;
      }
      if (test) {
        const unwrapped = unwrapExpression(test);
        if (unwrapped.type === 'Identifier') {
          const guard = getParameterGuard(unwrapped, fn);
          if (guard) guards.push(guard);
        }
      }
      if (parent.type === 'BlockStatement') {
        for (const statement of parent.body) {
          if (statement === child) break;
          const guard = getEarlyReturnGuard(statement, fn);
          if (guard) guards.push(guard);
        }
      }
      child = parent;
    }
    return guards;
  }

  // How `call` sets `guard`: 'off' (provably falsy — no flush), 'forward' (a
  // binding of the caller decides; `undefinedOn` travels with it), or 'on'
  // (anything else).
  function evaluateGuardArgument(call, guard) {
    if (call.arguments.some((argument) => argument.type === 'SpreadElement')) {
      return { state: 'on' };
    }
    const argument = call.arguments[guard.index];
    if (!argument) return { state: guard.omittedOn ? 'on' : 'off' };
    let value = argument;
    if (guard.key !== null) {
      const object = unwrapExpression(argument);
      if (object.type !== 'ObjectExpression') return { state: 'on' };
      const property = getStaticProperty(object, guard.key);
      if (property === null) return { state: 'on' };
      if (property === undefined) return { state: guard.undefinedOn ? 'on' : 'off' };
      value = property.value;
    }
    const kind = classifyValue(value);
    if (kind === 'undefined') return { state: guard.undefinedOn ? 'on' : 'off' };
    if (kind === 'falsy') return { state: 'off' };
    if (kind === 'forward') {
      return {
        state: 'forward',
        identifier: unwrapExpression(value),
        undefinedOn: guard.undefinedOn,
      };
    }
    return { state: 'on' };
  }

  return { findTeardownKind, getConditionGuards, evaluateGuardArgument, getParameterGuard };
}

function getGuardId(guard) {
  return `${guard.variable.name}@${guard.variable.defs[0].name.range[0]}:${Number(guard.undefinedOn)}${Number(guard.omittedOn)}`;
}

// Collapse guards that resolve to the same parameter with the same semantics;
// a recursive helper otherwise re-derives its own guard from both the lexical
// condition and the forwarded argument on every visit, and the guard list (and
// its visited key) grows without bound.
function dedupeGuards(guards) {
  const byId = new Map();
  for (const guard of guards) byId.set(getGuardId(guard), guard);
  return [...byId.values()];
}

function getGuardKey(guards) {
  return guards.map(getGuardId).sort().join(',');
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
    const actionIdentifiers = [];

    return {
      SvelteDirective(node) {
        if (node.kind === 'Action' && node.key.name.type === 'Identifier') {
          actionIdentifiers.push(node.key.name);
        }
      },

      'Program:exit'() {
        const flushSyncVariables = getSvelteImports(sourceCode, 'flushSync');
        if (flushSyncVariables.length === 0) return;

        const analyzer = createAnalyzer(sourceCode, actionIdentifiers);
        const visited = new Set();
        // Each entry is a call that flushes synchronously when it runs, except
        // when one of `forwarded` (identifier arguments, each with what
        // `undefined` means to the callee) turns out to be a falsy parameter of
        // the enclosing helper.
        const queue = [];
        for (const variable of flushSyncVariables) {
          for (const call of getCallsOf(variable)) {
            queue.push({ call, label: 'flushSync()', forwarded: [] });
          }
        }

        while (queue.length > 0) {
          const { call, label, forwarded } = queue.shift();
          const teardown = analyzer.findTeardownKind(call);
          if (teardown) {
            context.report({
              node: call,
              messageId: 'flushSyncInTeardown',
              data: { call: label, teardown },
            });
            continue;
          }

          const helper = getEnclosingFunction(call);
          const helperVariable = helper ? getFunctionVariable(sourceCode, helper) : null;
          if (!helperVariable) continue;

          const collected = analyzer.getConditionGuards(call, helper);
          for (const { identifier, undefinedOn } of forwarded) {
            const guard = analyzer.getParameterGuard(identifier, helper, undefinedOn);
            if (guard) collected.push(guard);
          }
          const guards = dedupeGuards(collected);
          const key = `${helperVariable.defs[0].name.range[0]}:${getGuardKey(guards)}`;
          if (visited.has(key)) continue;
          visited.add(key);

          const helperLabel = `${helperVariable.name}() (which calls flushSync)`;
          for (const helperCall of getCallsOf(helperVariable)) {
            const states = guards.map((guard) => analyzer.evaluateGuardArgument(helperCall, guard));
            if (states.some((state) => state.state === 'off')) continue;
            queue.push({
              call: helperCall,
              label: helperLabel,
              forwarded: states
                .filter((state) => state.state === 'forward')
                .map(({ identifier, undefinedOn }) => ({ identifier, undefinedOn })),
            });
          }
        }
      },
    };
  },
};
