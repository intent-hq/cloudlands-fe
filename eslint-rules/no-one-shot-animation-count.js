/**
 * Rejects one-time "no animation is running" checks in Playwright component tests:
 *
 *   expect(await el.evaluate((n) => n.getAnimations({ subtree: true }).length)).toBe(0);
 *
 * A single read fails at random whenever a child component is mid-way through a short,
 * normal fade at that instant. cloudlands-fe#3651 was ejected from the merge queue
 * (merge_group run 40096632126, intent-hq/intent#7749) because the IntentMarkLoader's
 * 160 ms crossfade was caught mid-flight. The shared helpers in src/test/ct-animations.ts
 * either wait for motion to settle or ignore only a named component's short fades, and
 * report which animations are still running.
 *
 * Flagged: `expect(x)` / `expect.soft(x)` / `expect(p).resolves` asserted against zero
 * (`toBe(0)`, `toEqual(0 | [])`, `toStrictEqual(0 | [])`, `toHaveLength(0)`, `toBeFalsy()`,
 * `toBeLessThan(1)`, `toBeLessThanOrEqual(0)`, or an object matcher pinning a key to
 * zero) where that value reads `getAnimations()` directly, inside an `evaluate` callback,
 * or through a local binding, function declaration, or property of one whose value did.
 *
 * Not flagged: `expect.poll(...)` (it retries), assertions inside an
 * `expect(async () => ...).toPass()` block (also retried), non-zero expectations, and
 * values that never touched `getAnimations()`.
 */

const MESSAGE =
  'One-time animation counts are flaky: a child component can be mid-way through a short, ' +
  'normal fade at the instant of the read (cloudlands-fe#3651 was ejected from the merge queue ' +
  "by the IntentMarkLoader's 160 ms crossfade; intent-hq/intent#7749). Use the shared helpers " +
  'from src/test/ct-test.ts: `await expectAnimationsToSettle(locator)` when the motion should ' +
  "have finished, or `await expectNoAnimations(locator, { ignore: [{ within: '<component " +
  "selector>' }] })` when nothing may animate except that component's own short fades. Both " +
  'report which animations are still running. If the zero count is the deliberate contract ' +
  '(e.g. a reduced-motion or paused state that must create no animation at all), disable this ' +
  'rule on that line with the reason. See packages/cloudlands-fe/AGENTS.md (motion specs).';

const ZERO_MATCHERS = new Set(['toBe', 'toEqual', 'toStrictEqual']);

// Bounds identifier → initializer chains (`const count = await ...; expect(count)`).
const MAX_RESOLVE_DEPTH = 8;

function isExpectCallee(callee) {
  if (callee.type === 'Identifier') return callee.name === 'expect';
  return (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'expect' &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'soft'
  );
}

function isZero(node) {
  return (
    (node?.type === 'Literal' && node.value === 0) ||
    (node?.type === 'ArrayExpression' && node.elements.length === 0)
  );
}

function isLiteral(node, value) {
  return node?.type === 'Literal' && node.value === value;
}

function isZeroAssertion(matcher, args) {
  if (matcher === 'toBeFalsy') return args.length === 0;
  if (args.length !== 1) return false;
  if (matcher === 'toHaveLength') return isLiteral(args[0], 0);
  if (matcher === 'toBeLessThan') return isLiteral(args[0], 1);
  if (matcher === 'toBeLessThanOrEqual') return isLiteral(args[0], 0);
  return ZERO_MATCHERS.has(matcher) && isZero(args[0]);
}

const OBJECT_MATCHERS = new Set(['toEqual', 'toStrictEqual', 'toMatchObject']);

// Keys an object-shaped expectation pins to zero: `toEqual({ ..., animations: 0 })`.
function zeroKeys(matcher, args) {
  if (!OBJECT_MATCHERS.has(matcher) || args[0]?.type !== 'ObjectExpression') return [];
  return args[0].properties
    .filter((property) => isZero(property.value))
    .map(propertyKey)
    .filter((key) => key !== null);
}

function isGetAnimationsCall(node) {
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    !node.callee.computed &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === 'getAnimations'
  );
}

// The single variable an identifier refers to, or null.
function resolveVariable(identifier, context) {
  for (let scope = context.sourceCode.getScope(identifier); scope; scope = scope.upper) {
    const variable = scope.set.get(identifier.name);
    if (variable) return variable;
  }
  return null;
}

// Expressions whose value flows into the binding: `const x = <init>`, `for (const x of <right>)`.
function bindingSources(variable) {
  const sources = [];
  for (const def of variable.defs) {
    // `async function count(root) { return root.evaluate(...getAnimations()...) }`
    if (def.type === 'FunctionName' && def.node.body) {
      sources.push(def.node.body);
      continue;
    }
    if (def.type !== 'Variable') continue;
    const declarator = def.node;
    if (declarator.init) sources.push(declarator.init);
    const statement = declarator.parent?.parent;
    if (
      (statement?.type === 'ForOfStatement' || statement?.type === 'ForInStatement') &&
      statement.left === declarator.parent
    ) {
      sources.push(statement.right);
    }
  }
  for (const reference of variable.references) {
    if (reference.isWrite() && !reference.init && reference.writeExpr) {
      sources.push(reference.writeExpr);
    }
  }
  return sources;
}

/**
 * Depth-first walk of `root` that also walks the sources of every local binding it
 * names (bounded, each binding once). Stops and returns true when `visit` does.
 */
function walk(root, context, visit, seen = new Set(), depth = 0) {
  if (!root || depth > MAX_RESOLVE_DEPTH) return false;
  const keys = context.sourceCode.visitorKeys;
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node.type !== 'string') continue;
    if (visit(node)) return true;
    if (node.type === 'Identifier') {
      const variable = resolveVariable(node, context);
      if (variable && !seen.has(variable)) {
        seen.add(variable);
        for (const source of bindingSources(variable)) {
          if (walk(source, context, visit, seen, depth + 1)) return true;
        }
      }
      continue;
    }
    for (const key of keys[node.type] ?? []) {
      // Property names are not variable references: `a.animations`, `{ animations: x }`.
      if (key === 'property' && node.type === 'MemberExpression' && !node.computed) continue;
      if (key === 'key' && !node.computed && !node.shorthand) continue;
      const child = node[key];
      if (Array.isArray(child)) stack.push(...child);
      else if (child) stack.push(child);
    }
  }
  return false;
}

/**
 * Whether evaluating `root` reads `getAnimations()`, following local bindings. A
 * non-computed `obj.key` read follows only the `key:` entries that flow into `obj`
 * (see `keyReadsAnimations`), so `Math.abs(sample.remaining)` is not flagged because
 * `sample.animations` came from the same `evaluate`.
 */
function readsAnimations(root, context, depth = 0) {
  if (!root || depth > MAX_RESOLVE_DEPTH) return false;
  const keys = context.sourceCode.visitorKeys;
  const seen = new Set();
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node.type !== 'string') continue;
    if (isGetAnimationsCall(node)) return true;
    if (node.type === 'MemberExpression' && !node.computed) {
      if (keyReadsAnimations(node.object, node.property.name, context, depth + 1)) return true;
      continue;
    }
    if (node.type === 'Identifier') {
      const variable = resolveVariable(node, context);
      if (variable && !seen.has(variable)) {
        seen.add(variable);
        for (const source of bindingSources(variable)) {
          if (readsAnimations(source, context, depth + 1)) return true;
        }
      }
      continue;
    }
    for (const key of keys[node.type] ?? []) {
      if (key === 'key' && !node.computed && !node.shorthand) continue;
      const child = node[key];
      if (Array.isArray(child)) stack.push(...child);
      else if (child) stack.push(child);
    }
  }
  return false;
}

function propertyKey(property) {
  if (property.type !== 'Property' || property.computed) return null;
  return property.key.type === 'Identifier' ? property.key.name : String(property.key.value);
}

function unwrap(node) {
  let current = node;
  while (current?.type === 'AwaitExpression' || current?.type === 'ChainExpression') {
    current = current.type === 'AwaitExpression' ? current.argument : current.expression;
  }
  return current;
}

/**
 * Whether `object.key` reads `getAnimations()`: only the `key:` entries of object
 * literals that flow into `object` count. Without any `key:` entry (e.g. `list.length`,
 * `node.getAnimations().length`), the whole object counts.
 */
function keyReadsAnimations(object, key, context, depth = 0) {
  if (depth > MAX_RESOLVE_DEPTH) return false;
  const entries = [];
  walk(object, context, (node) => {
    if (node.type === 'ObjectExpression') {
      for (const property of node.properties) {
        if (propertyKey(property) === key) entries.push(property.value);
      }
    }
    return false;
  });
  if (entries.length === 0) return readsAnimations(object, context, depth);
  return entries.some((entry) => readsAnimations(entry, context, depth));
}

// Whether `node` sits inside the callback of `expect(async () => ...).toPass()`.
function isInsideToPass(node) {
  for (let current = node.parent; current; current = current.parent) {
    const isFunction =
      current.type === 'ArrowFunctionExpression' || current.type === 'FunctionExpression';
    if (!isFunction) continue;
    const call = current.parent;
    if (
      call?.type === 'CallExpression' &&
      call.arguments[0] === current &&
      isExpectCallee(call.callee) &&
      call.parent?.type === 'MemberExpression' &&
      call.parent.object === call &&
      !call.parent.computed &&
      call.parent.property.name === 'toPass'
    ) {
      return true;
    }
  }
  return false;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow one-time "animation count is 0" assertions in component tests; use the shared settle helpers.',
    },
    schema: [],
    messages: {
      oneShotAnimationCount: MESSAGE,
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const member = node.callee;
        if (member.type !== 'MemberExpression' || member.computed) return;
        if (member.property.type !== 'Identifier') return;
        const matcher = member.property.name;
        const keys = zeroKeys(matcher, node.arguments);
        if (!isZeroAssertion(matcher, node.arguments) && keys.length === 0) return;
        // `expect(x).toBe(0)` or `expect(promise).resolves.toBe(0)`; `.not.toBe(0)` asserts
        // that something does animate.
        let expectCall = member.object;
        if (
          expectCall.type === 'MemberExpression' &&
          !expectCall.computed &&
          expectCall.property.name === 'resolves'
        ) {
          expectCall = expectCall.object;
        }
        if (expectCall.type !== 'CallExpression' || !isExpectCallee(expectCall.callee)) return;
        const [actual] = expectCall.arguments;
        if (!actual) return;
        const flagged =
          keys.length > 0
            ? keys.some((key) => keyReadsAnimations(unwrap(actual), key, context))
            : readsAnimations(actual, context);
        if (!flagged) return;
        if (isInsideToPass(node)) return;
        context.report({ node: expectCall, messageId: 'oneShotAnimationCount' });
      },
    };
  },
};
