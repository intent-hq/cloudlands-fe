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
 * Flagged: `expect(x)` / `expect.soft(x)` asserted against zero (`toBe(0)`, `toEqual(0)`,
 * `toStrictEqual(0)`, `toEqual([])`, `toStrictEqual([])`, `toHaveLength(0)`) where `x`
 * reads `getAnimations()` directly, inside an `evaluate` callback, or through a local
 * binding (or a property of one) whose value did.
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

function isZeroAssertion(matcher, args) {
  if (args.length !== 1) return false;
  if (matcher === 'toHaveLength') return args[0].type === 'Literal' && args[0].value === 0;
  return ZERO_MATCHERS.has(matcher) && isZero(args[0]);
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
      const child = node[key];
      if (Array.isArray(child)) stack.push(...child);
      else if (child) stack.push(child);
    }
  }
  return false;
}

/** Whether evaluating `root` reads `getAnimations()`, following local bindings. */
function readsAnimations(root, context) {
  return walk(root, context, isGetAnimationsCall);
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
 * Whether the asserted value reads `getAnimations()`. For `obj.key`, only the `key:`
 * entries of object literals that flow into `obj` count, so
 * `expect(sample.iconCount).toBe(0)` is not flagged just because `sample.animations`
 * came from the same `evaluate`. Without any `key:` entry (e.g. `list.length`), the
 * whole object counts.
 */
function assertedValueReadsAnimations(actual, context) {
  const value = unwrap(actual);
  if (value?.type !== 'MemberExpression' || value.computed) return readsAnimations(value, context);
  const key = value.property.name;
  const entries = [];
  walk(value.object, context, (node) => {
    if (node.type === 'ObjectExpression') {
      for (const property of node.properties) {
        if (propertyKey(property) === key) entries.push(property.value);
      }
    }
    return false;
  });
  if (entries.length === 0) return readsAnimations(value.object, context);
  return entries.some((entry) => readsAnimations(entry, context));
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
        if (!isZeroAssertion(member.property.name, node.arguments)) return;
        // `expect(x).toBe(0)`; `.not.toBe(0)` asserts that something does animate.
        const expectCall = member.object;
        if (expectCall.type !== 'CallExpression' || !isExpectCallee(expectCall.callee)) return;
        const [actual] = expectCall.arguments;
        if (!actual || !assertedValueReadsAnimations(actual, context)) return;
        if (isInsideToPass(node)) return;
        context.report({ node: expectCall, messageId: 'oneShotAnimationCount' });
      },
    };
  },
};
