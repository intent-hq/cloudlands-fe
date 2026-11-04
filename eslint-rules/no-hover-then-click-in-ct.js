import { relativeFilename } from './design-system/common.js';
import { suppressedLines } from './lib/disable-directives.js';

/**
 * Rejects a pointer click on a hover-only action right after hovering its row, in a
 * Playwright component test:
 *
 *   await row.hover();
 *   await row.getByRole('button', { name: 'Copy' }).click();   // flagged
 *
 * Hover-only actions take pointer events only while their row is hovered
 * (`group-hover:pointer-events-auto`, src/lib/components/chat/message-action-surface.ts).
 * Playwright checks a click's hit target before it moves the pointer, so when the row
 * moves after the hover (content above it grows, follow-bottom pins a transcript) the
 * pointer is left over another element and every retry hits the row's text until the
 * test times out. That froze a CT shard for 30 s and ejected the unrelated
 * cloudlands-fe#4078 from the merge queue (run 41601559601; cloudlands-fe#4112, after a
 * partial fix in #3385). `activateHoverAction(action, region)` (src/test/ct-hover-action.ts,
 * re-exported from src/test/ct-test.ts) waits for motion to settle, presses Enter on the
 * action and waits for the region to change and settle, with no pointer involved.
 *
 * Flagged: a `.click()` call, or the first argument of
 * `clickAndSettle(...)`, whose locator is built from a locator hovered earlier in the
 * same function, an enclosing one, or a `test.step(...)` callback it ran, by at least
 * one descendant step (`getByRole`,
 * `getByText`, `getByLabel`, `getByTestId`, `getByTitle`, `getByPlaceholder`,
 * `getByAltText`, `locator`). Locators are compared by source text, through `const`
 * aliases declared in the same or an enclosing function (`const action =
 * row.getByRole(...)`). Any other pointer action moves the pointer off the row, so it
 * forgets the hover: a later hover replaces the hovered locator with its own target, and
 * a click, check or tap on something outside the row, or a `mouse.move` / `mouse.click`,
 * clears it.
 * Clicking the hovered element itself is not flagged, nor is a double-click: tests
 * double-click message text to edit it, and text is never hover-only. A selector hover
 * (`page.hover('.row')`) only forgets earlier hovers. Pointer actions inside a local
 * function do not reach past it (it may never run, and is not followed to its call
 * sites); only a `test.step(...)` callback, which runs in place, carries them out.
 *
 * Ratchet: the `baseline` option maps each spec that already had such clicks to its
 * count; the first `count` in source order are tolerated and every further one is
 * reported. Counts may only shrink (eslint-rules/no-hover-then-click-in-ct.test.js). A
 * test whose point is the real pointer path, on a row that cannot move, may keep its
 * click by disabling this rule on that line with a reason.
 */

const MESSAGE =
  'Do not click a hover-only action right after hovering its row: the action takes ' +
  'pointer events only while the row is hovered, and Playwright checks the hit target ' +
  'before it moves the pointer, so if the row moves after the hover every retry hits the ' +
  'row text until the test times out (cloudlands-fe#4112; the hang ejected ' +
  'cloudlands-fe#4078 from the merge queue). Use `await activateHoverAction(action, region)` ' +
  "from 'src/test/ct-test', which waits for motion to settle, presses Enter on the action " +
  'and waits for the region to change and settle (`requireChange: false` when it may ' +
  'not move). If the test must cover the pointer path on a row that cannot move, disable ' +
  'this rule on that line with a reason.';

const RULE_NAME = 'no-hover-then-click-in-ct';

// Steps that select something inside the receiver.
const DESCENDANT_STEPS = new Set([
  'getByRole',
  'getByText',
  'getByLabel',
  'getByTestId',
  'getByTitle',
  'getByPlaceholder',
  'getByAltText',
  'locator',
]);
// Steps that narrow the receiver's own matches.
const NARROWING_STEPS = new Set(['first', 'last', 'nth', 'filter', 'and', 'or']);
// Other locator actions that move the pointer to their target.
const POINTER_ACTIONS = new Set(['dblclick', 'check', 'uncheck', 'setChecked', 'tap', 'dragTo']);
// `page.mouse` methods that move the pointer.
const MOUSE_MOVES = new Set(['move', 'click', 'dblclick']);
const CLICK_HELPERS = new Set(['clickAndSettle']);

function keyName(property, computed) {
  if (!computed && property.type === 'Identifier') return property.name;
  if (property.type === 'Literal') return property.value;
  if (property.type === 'TemplateLiteral' && property.expressions.length === 0) {
    return property.quasis[0].value.cooked;
  }
  return null;
}

function propertyName(node) {
  if (node?.type !== 'MemberExpression') return null;
  return keyName(node.property, node.computed);
}

const WRAPPERS = new Set([
  'ChainExpression',
  'AwaitExpression',
  'TSNonNullExpression',
  'TSAsExpression',
  'TSSatisfiesExpression',
  'ParenthesizedExpression',
]);

function unwrap(node) {
  let current = node;
  while (current && WRAPPERS.has(current.type)) current = current.expression ?? current.argument;
  return current;
}

const FUNCTIONS = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'];

function isStepCallback(node) {
  const call = node.parent;
  if (call?.type !== 'CallExpression' || !call.arguments.includes(node)) return false;
  const callee = unwrap(call.callee);
  return propertyName(callee) === 'step' && unwrap(callee.object)?.name === 'test';
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow a pointer click on a hover-only action right after hovering its row in a component test; use activateHoverAction instead.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          // Package-relative spec file → number of hover-then-click sites it may still contain.
          baseline: {
            type: 'object',
            additionalProperties: { type: 'integer', minimum: 1 },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      hoverThenClick: MESSAGE,
    },
  },

  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (!filename.endsWith('.ct.spec.ts')) return {};
    const { sourceCode } = context;
    const allowed = context.options[0]?.baseline?.[relativeFilename(context)] ?? 0;
    const suppressed = suppressedLines(sourceCode, RULE_NAME);
    let seen = 0;

    // One frame per function (plus the module): its `const` aliases and hovered locators.
    const frames = [{ aliases: new Map(), hovered: new Set() }];
    const current = () => frames[frames.length - 1];
    const text = (node) => sourceCode.getText(node).replace(/\s+/g, '');

    const aliasOf = (name) => {
      for (let index = frames.length - 1; index >= 0; index -= 1) {
        const alias = frames[index].aliases.get(name);
        if (alias) return alias;
      }
      return null;
    };

    // The locator and everything it was built from: `{ text, inside }` from the
    // expression outwards, where `inside` says a descendant step separates the two.
    const lineage = (node) => {
      const chain = [];
      const visited = new Set();
      let inside = false;
      let target = unwrap(node);
      while (target) {
        chain.push({ text: text(target), inside });
        if (target.type === 'CallExpression') {
          const step = propertyName(unwrap(target.callee));
          if (DESCENDANT_STEPS.has(step)) inside = true;
          if (DESCENDANT_STEPS.has(step) || NARROWING_STEPS.has(step)) {
            target = unwrap(unwrap(target.callee).object);
            continue;
          }
        }
        if (target.type === 'Identifier' && !visited.has(target.name)) {
          visited.add(target.name);
          const alias = aliasOf(target.name);
          if (alias) {
            target = unwrap(alias);
            continue;
          }
        }
        break;
      }
      return chain;
    };

    const isHovered = (text) => frames.some((frame) => frame.hovered.has(text));
    const forgetHover = () => {
      for (const frame of frames) frame.hovered.clear();
    };

    // Whether `receiver` was built from the hovered locator. A pointer action there
    // keeps the pointer over the row; any other one moves it away.
    const insideHovered = (receiver) => {
      const hit = lineage(receiver).some((link) => link.inside && isHovered(link.text));
      if (!hit) forgetHover();
      return hit;
    };

    const checkClick = (receiver, reportNode) => {
      if (!insideHovered(receiver)) return;
      // A reasoned disable still gets its report, so ESLint counts the directive as used,
      // but it does not use up the baseline allowance.
      if (!suppressed(reportNode.loc.start.line)) {
        seen += 1;
        if (seen <= allowed) return;
      }
      context.report({ node: reportNode, messageId: 'hoverThenClick' });
    };

    // Traversal visits every function body, called or not, so pointer effects inside one
    // are undone on exit; only a `test.step` callback runs in place and keeps them.
    const enter = () =>
      frames.push({
        aliases: new Map(),
        hovered: new Set(),
        outer: frames.map((frame) => new Set(frame.hovered)),
      });
    const exit = (node) => {
      const frame = frames.pop();
      if (!isStepCallback(node)) {
        frames.forEach((outer, index) => {
          outer.hovered = frame.outer[index];
        });
      } else if (frame.hovered.size > 0) {
        current().hovered = frame.hovered;
      }
    };
    const handlers = {
      VariableDeclarator(node) {
        if (node.id.type === 'Identifier' && node.init && node.parent.kind === 'const') {
          current().aliases.set(node.id.name, node.init);
        }
      },
      CallExpression(node) {
        const callee = unwrap(node.callee);
        if (callee.type === 'Identifier' && CLICK_HELPERS.has(callee.name)) {
          if (node.arguments[0]) checkClick(node.arguments[0], node);
          return;
        }
        const name = propertyName(callee);
        if (name === 'hover') {
          forgetHover();
          // `page.hover(selector)` hovers the selector's match, not its receiver.
          const selector = node.arguments[0];
          if (selector && selector.type !== 'ObjectExpression') return;
          // The target and its aliases / narrowings; not the locators it was built from,
          // or hovering `page.getByRole(...)` would mark the whole page as hovered.
          current().hovered = new Set(
            lineage(callee.object)
              .filter((link) => !link.inside)
              .map((link) => link.text),
          );
        } else if (MOUSE_MOVES.has(name) && propertyName(unwrap(callee.object)) === 'mouse') {
          forgetHover();
        } else if (POINTER_ACTIONS.has(name)) {
          insideHovered(callee.object);
        } else if (name === 'click') {
          checkClick(callee.object, callee.property);
        }
      },
    };
    for (const type of FUNCTIONS) {
      handlers[type] = enter;
      handlers[`${type}:exit`] = exit;
    }
    return handlers;
  },
};
