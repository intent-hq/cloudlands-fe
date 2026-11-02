/**
 * Rejects a test that replaces, defines or deletes `scrollIntoView` on an element
 * prototype:
 *
 *   Element.prototype.scrollIntoView = vi.fn();                          // flagged
 *   HTMLElement.prototype.scrollIntoView ??= () => undefined;            // flagged
 *   Object.defineProperty(Element.prototype, 'scrollIntoView', { ... }); // flagged
 *   Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');     // flagged
 *
 * jsdom has no `Element.prototype.scrollIntoView`; src/test-setup.ts installs a writable,
 * configurable no-op for every unit test (cloudlands-fe#3921). Before that, about thirty
 * test files each carried their own copy, and new tests kept copying the pattern. A copy
 * is dead weight, and a delete or non-writable redefinition can break the shared default
 * for the rest of the file. A test that needs to record calls spies instead:
 * `vi.spyOn(Element.prototype, 'scrollIntoView')`, restored by `vi.restoreAllMocks()`.
 *
 * Flagged, when the target is `<Name>.prototype` (optionally reached through `window.` or
 * `globalThis.`) and `<Name>` is `Element` or ends in `Element`:
 * - assigning `.scrollIntoView` / `['scrollIntoView']` with `=`, `??=`, `||=` or `&&=`;
 * - `Object.defineProperty`, `Reflect.defineProperty` or `Reflect.deleteProperty` with
 *   'scrollIntoView' as the key;
 * - `delete <Name>.prototype.scrollIntoView`.
 *
 * Stubbing a single element (`element.scrollIntoView = vi.fn()`) is not flagged.
 * src/test-setup.ts, which owns the shared default, is excluded in eslint.config.js.
 */

const MESSAGE =
  'src/test-setup.ts already gives every unit test a no-op Element.prototype.scrollIntoView ' +
  '(cloudlands-fe#3921), so a per-file stub is dead weight and a delete or non-writable ' +
  'redefinition can break the shared default. Delete this stub. To record calls, use ' +
  "`vi.spyOn(Element.prototype, 'scrollIntoView')` and restore it with `vi.restoreAllMocks()`.";

const METHOD = 'scrollIntoView';
const GLOBAL_OBJECTS = new Set(['window', 'globalThis', 'self']);
const ASSIGNMENT_OPERATORS = new Set(['=', '??=', '||=', '&&=']);
const PROPERTY_WRITERS = {
  Object: new Set(['defineProperty']),
  Reflect: new Set(['defineProperty', 'deleteProperty']),
};

const TS_WRAPPERS = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
]);

// `(Element.prototype as any)` and `HTMLElement.prototype!` name the same prototype.
function unwrap(node) {
  let current = node;
  while (current && TS_WRAPPERS.has(current.type)) current = current.expression;
  return current;
}

function propertyName(node) {
  const member = unwrap(node);
  if (member?.type !== 'MemberExpression') return null;
  if (!member.computed && member.property.type === 'Identifier') return member.property.name;
  if (member.computed && member.property.type === 'Literal') return member.property.value;
  return null;
}

function isElementName(name) {
  return name === 'Element' || name.endsWith('Element');
}

// `Element`, `HTMLElement`, `window.HTMLElement`, `globalThis.SVGElement`, ...
function isElementConstructor(candidate) {
  const node = unwrap(candidate);
  if (node?.type === 'Identifier') return isElementName(node.name);
  if (node?.type !== 'MemberExpression' || node.computed) return false;
  return (
    node.object.type === 'Identifier' &&
    GLOBAL_OBJECTS.has(node.object.name) &&
    isElementName(propertyName(node) ?? '')
  );
}

function isElementPrototype(node) {
  return propertyName(node) === 'prototype' && isElementConstructor(unwrap(node).object);
}

function isPrototypeMethod(node) {
  return propertyName(node) === METHOD && isElementPrototype(unwrap(node).object);
}

function isPropertyWriterCall(node) {
  const { callee } = node;
  if (callee.type !== 'MemberExpression' || callee.object.type !== 'Identifier') return false;
  const writers = PROPERTY_WRITERS[callee.object.name];
  const method = propertyName(callee);
  if (!writers || !method || !writers.has(method)) return false;
  const [target, key] = node.arguments;
  return isElementPrototype(target) && key?.type === 'Literal' && key.value === METHOD;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow per-file scrollIntoView stubs on element prototypes; src/test-setup.ts provides one',
    },
    schema: [],
    messages: {
      prototypeStub: MESSAGE,
    },
  },

  create(context) {
    const report = (node) => context.report({ node, messageId: 'prototypeStub' });
    return {
      AssignmentExpression(node) {
        if (ASSIGNMENT_OPERATORS.has(node.operator) && isPrototypeMethod(node.left)) report(node);
      },
      CallExpression(node) {
        if (isPropertyWriterCall(node)) report(node);
      },
      UnaryExpression(node) {
        if (node.operator === 'delete' && isPrototypeMethod(node.argument)) report(node);
      },
    };
  },
};
