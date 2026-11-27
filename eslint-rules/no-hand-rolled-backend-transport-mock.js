import path from 'node:path';
import { relativeFilename } from './design-system/common.js';
import { suppressedLines } from './lib/disable-directives.js';

/**
 * Rejects a hand-written `vi.mock` / `vi.doMock` factory for
 * `$lib/client/live/backend-transport`:
 *
 *   vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: vi.fn() }));
 *
 * A hand-written factory lists only the exports its test needed on the day it was
 * written. When cloudlands-fe#5090 moved capability reads to the new `readBackendHello`,
 * 19 such factories broke (197 tests) and fixing them took three extra rounds of the
 * local check.
 *
 * Allowed factories return a complete module:
 *
 * - `createBackendTransportFake(overrides)` from src/test/mocks/backend-transport-fake.ts;
 * - `mockBackendTransportModule` from src/test/mocks/backend-transport.mock.ts;
 * - the real module, through the factory's `importOriginal` or `vi.importActual`;
 * - an object that spreads one of these before its own overrides.
 *
 * Automock (`vi.mock(path)`) and `vi.mock(path, { spy: true })` are allowed too. Values
 * are followed through `await`, TypeScript wrappers and never-reassigned `const` aliases
 * only; a factory the rule cannot read is reported, and so is a block-bodied factory
 * whose last statement is not a `return`.
 *
 * Ratchet: the `baseline` option maps each file that already had hand-written factories
 * to its count; the first `count` in source order are tolerated and every further one is
 * reported. Counts may only shrink (eslint-rules/no-hand-rolled-backend-transport-mock.test.js).
 */

const MESSAGE =
  'Do not hand-write a backend-transport mock: it misses the next transport export and ' +
  'breaks with it (cloudlands-fe#5090 broke 19 files). Return ' +
  'createBackendTransportFake({ ...only the exports you drive }) from ' +
  'src/test/mocks/backend-transport-fake.ts, or mockBackendTransportModule from ' +
  'src/test/mocks/backend-transport.mock.ts for a scripted daemon.';

const RULE_NAME = 'no-hand-rolled-backend-transport-mock';
const TRANSPORT = 'src/lib/client/live/backend-transport';
const FAKE_FACTORY = 'createBackendTransportFake';
const SCRIPTED_MODULE = 'mockBackendTransportModule';
const FUNCTIONS = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration']);
const WRAPPERS = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSTypeAssertion',
  'TSNonNullExpression',
  'ChainExpression',
]);

function unwrap(node) {
  while (node && WRAPPERS.has(node.type)) node = node.expression;
  return node;
}

function literal(node) {
  if (node?.type === 'Literal') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

function propertyName(node) {
  return node.computed ? literal(node.property) : node.property?.name;
}

function isViCall(node, methods) {
  const callee = node?.type === 'CallExpression' ? unwrap(node.callee) : null;
  return (
    callee?.type === 'MemberExpression' &&
    ['vi', 'vitest'].includes(callee.object.name) &&
    methods.includes(propertyName(callee))
  );
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require the shared backend-transport fake instead of a hand-written vi.mock factory',
    },
    schema: [
      {
        type: 'object',
        properties: {
          // Package-relative test file → number of hand-written factories it may keep.
          baseline: {
            type: 'object',
            additionalProperties: { type: 'integer', minimum: 1 },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      handRolled: MESSAGE,
    },
  },

  create(context) {
    const { sourceCode } = context;
    const file = relativeFilename(context);
    const allowed = context.options[0]?.baseline?.[file] ?? 0;
    const suppressed = suppressedLines(sourceCode, RULE_NAME);
    const mocks = [];
    const returns = [];

    function modulePath(node) {
      node = unwrap(node);
      if (node?.type === 'ImportExpression') node = node.source;
      let value = literal(node);
      if (typeof value !== 'string') return null;
      if (value.startsWith('$lib/')) value = `src/lib/${value.slice(5)}`;
      else if (value.startsWith('.')) value = path.posix.join(path.posix.dirname(file), value);
      return value.replace(/\.[cm]?[jt]s$/, '');
    }

    function variable(identifier) {
      for (let scope = sourceCode.getScope(identifier); scope; scope = scope.upper) {
        const found = scope.set.get(identifier.name);
        if (found) return found;
      }
      return null;
    }

    // The function or never-reassigned const initializer `identifier` names in this file.
    function definitionOf(identifier) {
      const binding = variable(identifier);
      const definition = binding?.defs[0];
      if (!definition || binding.references.some((ref) => ref.isWrite() && !ref.init)) {
        return null;
      }
      if (definition.type === 'FunctionName') return definition.node;
      if (
        definition.type === 'Variable' &&
        definition.parent.kind === 'const' &&
        definition.node.id.type === 'Identifier'
      ) {
        return unwrap(definition.node.init);
      }
      return null;
    }

    function isImportOriginal(node, factory) {
      const param = factory.params[0];
      return (
        node?.type === 'Identifier' &&
        param?.type === 'Identifier' &&
        variable(node) !== null &&
        variable(node) === variable(param)
      );
    }

    // Whether `node` evaluates to a complete transport module.
    function isComplete(node, factory, seen = new Set()) {
      node = unwrap(node);
      if (!node || seen.has(node)) return false;
      seen = new Set(seen).add(node);
      switch (node.type) {
        case 'AwaitExpression':
          return isComplete(node.argument, factory, seen);
        case 'MemberExpression':
          return propertyName(node) === SCRIPTED_MODULE;
        case 'Identifier': {
          if (node.name === SCRIPTED_MODULE) return true;
          const definition = definitionOf(node);
          return definition !== null && isComplete(definition, factory, seen);
        }
        case 'CallExpression': {
          // The helper is complete only when called; the bare function is not a module.
          const callee = unwrap(node.callee);
          const name = callee.type === 'Identifier' ? callee.name : propertyName(callee);
          if (name === FAKE_FACTORY) return true;
          if (isImportOriginal(callee, factory)) return true;
          return isViCall(node, ['importActual']) && modulePath(node.arguments[0]) === TRANSPORT;
        }
        case 'ObjectExpression':
          return node.properties.some(
            (property) =>
              property.type === 'SpreadElement' && isComplete(property.argument, factory, seen),
          );
        default:
          return false;
      }
    }

    function returnsCompleteModule(factory) {
      if (factory?.type === 'Identifier') factory = definitionOf(factory);
      if (!FUNCTIONS.has(factory?.type)) return false;
      // A block body that can run off its end returns undefined, not a module.
      if (
        factory.body.type === 'BlockStatement' &&
        factory.body.body.at(-1)?.type !== 'ReturnStatement'
      ) {
        return false;
      }
      const values =
        factory.body.type !== 'BlockStatement'
          ? [factory.body]
          : returns
              .filter(
                (statement) =>
                  sourceCode
                    .getAncestors(statement)
                    .findLast((node) => FUNCTIONS.has(node.type)) === factory,
              )
              .map((statement) => statement.argument);
      return values.length > 0 && values.every((value) => isComplete(value, factory));
    }

    function isAllowed(mock) {
      const factory = unwrap(mock.arguments[1]);
      // Automock and `{ spy: true }` keep every export of the real module.
      if (!factory || factory.type === 'ObjectExpression') return true;
      return returnsCompleteModule(factory);
    }

    return {
      CallExpression(node) {
        if (isViCall(node, ['mock', 'doMock'])) mocks.push(node);
      },
      ReturnStatement(node) {
        returns.push(node);
      },
      'Program:exit'() {
        let seen = 0;
        for (const mock of mocks) {
          if (modulePath(mock.arguments[0]) !== TRANSPORT || isAllowed(mock)) continue;
          // A disabled site still gets its report, so ESLint counts the directive as used,
          // but it does not use up the baseline allowance.
          if (!suppressed(mock.loc.start.line)) {
            seen += 1;
            if (seen <= allowed) continue;
          }
          context.report({ node: mock, messageId: 'handRolled' });
        }
      },
    };
  },
};
