/**
 * Rejects a hand-written "is the user typing?" check in keyboard handling code:
 *
 *   window.addEventListener('keydown', (event) => {
 *     const target = event.target as HTMLElement;
 *     if (target.tagName === 'TEXTAREA' || target.isContentEditable) return;   // flagged
 *     ...
 *   });
 *
 * Such checks know native inputs and contenteditable, but Monaco 0.57 types through an
 * EditContext `<div role="textbox">`, which is neither. A shortcut guarded this way fires
 * while the user types in the code editor. That shipped twice: Enter in the Setup Script
 * dialog (intent-hq/intent#8068, cloudlands-fe#3848), then digits and brackets swallowed by
 * permission prompts, question cards and the sidebar (intent-hq/intent#8115,
 * cloudlands-fe#3865). `isTextEntryTarget` / `isMultilineTextEntryTarget` in
 * src/lib/utils/text-entry.ts recognize every kind of text entry.
 *
 * Flagged signals:
 * - comparing `tagName` / `nodeName` / `localName` (or its lower/upper-cased form, or a
 *   name bound to either) with 'INPUT' / 'TEXTAREA' in any case, through `===`, `==`,
 *   `!==`, `!=`, `[...].includes(tag)`, `new Set([...]).has(tag)` or a `switch` case;
 * - reading `isContentEditable` or `contentEditable` (assigning `contentEditable` is fine);
 * - a selector naming `input`, `textarea` or `[contenteditable]` passed to `closest`,
 *   `matches`, `querySelector` or `querySelectorAll`, as a literal or a name bound to one.
 *   A selector that also names `button`, `a`, `[href]` or `[tabindex]` lists interactive or
 *   focusable controls (focus traps, nested-control guards) and is not flagged.
 *
 * Only inside a keyboard context:
 * - a function with a parameter typed `KeyboardEvent`, or a name annotated
 *   `KeyboardEventHandler<...>`;
 * - a listener passed after a 'keydown' / 'keyup' / 'keypress' argument (`addEventListener`,
 *   svelte/events `on`), assigned to `el.onkeydown` / `onkeyup` / `onkeypress`, or given
 *   as an `onkeydown: fn` object property;
 * - a Svelte `onkeydown` / `onkeyup` / `onkeypress` attribute (`{onkeydown}` shorthand too)
 *   or `on:keydown`-style directive;
 * - any function in the same file that one of those calls or passes along by name,
 *   transitively — the helper predicates (`isEditableTarget`, `isMultilineInput`) where
 *   most of the shipped copies lived.
 *
 * Names are matched per file, without scope analysis. Pointer, click, drag and focus code,
 * and text walks outside keyboard handling, are not checked. A keyboard handler that
 * inspects a tag for a reason other than "is the user typing" disables this rule on that
 * line with a reason.
 */

const MESSAGE =
  'Hand-written "is the user typing?" checks miss the code editor: Monaco types through an ' +
  'EditContext `<div role="textbox">`, which is not an input, a textarea or contenteditable, so ' +
  'the shortcut fires while the user types (intent-hq/intent#8068, intent-hq/intent#8115). Use ' +
  '`isTextEntryTarget(event.target)` (or `isMultilineTextEntryTarget` to decide whether Enter ' +
  "inserts a newline) from '$lib/utils/text-entry'. If this is not a typing check, disable " +
  'this rule on that line with a reason: ' +
  '`// eslint-disable-next-line intent/no-hand-written-typing-check -- <why>`.';

const KEY_EVENTS = new Set(['keydown', 'keyup', 'keypress']);
const KEY_HANDLER_PROPS = new Set(['onkeydown', 'onkeyup', 'onkeypress']);
const TAG_PROPERTIES = new Set(['tagName', 'nodeName', 'localName']);
const CASE_METHODS = new Set([
  'toLowerCase',
  'toUpperCase',
  'toLocaleLowerCase',
  'toLocaleUpperCase',
]);
const EDITABLE_PROPERTIES = new Set(['isContentEditable', 'contentEditable']);
const SELECTOR_METHODS = new Set(['closest', 'matches', 'querySelector', 'querySelectorAll']);
const EQUALITY = new Set(['===', '==', '!==', '!=']);
const TYPING_TAGS = new Set(['input', 'textarea']);
const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

const TYPING_TAG_SELECTOR = /(?:^|[\s,>+~(])(?:input|textarea)(?=$|[\s,>+~:.[#)])/i;
const CONTENTEDITABLE_SELECTOR = /\[\s*contenteditable\b/i;
// A selector that also names buttons, links or tab stops lists interactive or focusable
// controls (focus traps, "was a nested control clicked") rather than asking whether the
// user is typing; every shipped typing check named only text-entry selectors.
const CONTROL_SELECTOR = /(?:^|[\s,>+~(])(?:button|a)(?=$|[\s,>+~:.[#)])|\[\s*(?:href|tabindex)\b/i;

function propertyName(node) {
  if (node?.type !== 'MemberExpression') return null;
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.property.type === 'Literal' && typeof node.property.value === 'string') {
    return node.property.value;
  }
  return null;
}

function unwrap(node) {
  let current = node;
  while (
    current &&
    (current.type === 'ChainExpression' ||
      current.type === 'TSAsExpression' ||
      current.type === 'TSNonNullExpression' ||
      current.type === 'TSSatisfiesExpression')
  ) {
    current = current.expression;
  }
  return current;
}

function staticString(node) {
  const target = unwrap(node);
  if (target?.type === 'Literal' && typeof target.value === 'string') return target.value;
  if (target?.type === 'TemplateLiteral') {
    return target.quasis.map((quasi) => quasi.value.cooked ?? '').join(' ');
  }
  return null;
}

function isTypingSelector(text) {
  if (text === null || CONTROL_SELECTOR.test(text)) return false;
  return TYPING_TAG_SELECTOR.test(text) || CONTENTEDITABLE_SELECTOR.test(text);
}

function isTypingTagLiteral(node) {
  const text = staticString(node);
  return text !== null && TYPING_TAGS.has(text.toLowerCase());
}

function mentionsKeyboardEvent(type) {
  if (!type) return false;
  switch (type.type) {
    case 'TSTypeAnnotation':
      return mentionsKeyboardEvent(type.typeAnnotation);
    case 'TSTypeReference':
      return type.typeName?.type === 'Identifier' && type.typeName.name === 'KeyboardEvent';
    case 'TSUnionType':
    case 'TSIntersectionType':
      return type.types.some(mentionsKeyboardEvent);
    default:
      return false;
  }
}

function isKeyboardEventHandlerType(annotation) {
  const type = annotation?.typeAnnotation;
  return (
    type?.type === 'TSTypeReference' &&
    type.typeName?.type === 'Identifier' &&
    type.typeName.name === 'KeyboardEventHandler'
  );
}

function paramAnnotation(param) {
  if (param.type === 'AssignmentPattern') return param.left.typeAnnotation;
  if (param.type === 'TSParameterProperty') return paramAnnotation(param.parameter);
  return param.typeAnnotation;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require isTextEntryTarget instead of a hand-written tag-name / contenteditable typing check in keyboard handlers, so focused code editors keep their keys.',
    },
    schema: [],
    messages: {
      handWrittenTypingCheck: MESSAGE,
    },
  },
  create(context) {
    // Function nodes known to handle keyboard events, and names that refer to one.
    const keyboardFunctions = new Set();
    const keyboardNames = new Set();
    // Per-file name tables (no scope analysis): functions, tag-name values, typing
    // selectors and typing-tag collections bound by `const`/`let`/`function`.
    const functionsByName = new Map();
    const tagNameAliases = new Set();
    const selectorNames = new Set();
    const typingTagCollections = new Set();
    // Names each function references as a callee or a passed-along argument.
    const references = [];
    const signals = [];

    const enclosingFunctions = (node) => {
      const functions = [];
      for (let current = node.parent; current; current = current.parent) {
        if (FUNCTION_TYPES.has(current.type)) functions.push(current);
      }
      return functions;
    };

    function addFunctionName(name, fn) {
      if (!functionsByName.has(name)) functionsByName.set(name, []);
      functionsByName.get(name).push(fn);
    }

    function markHandler(node) {
      const target = unwrap(node);
      if (!target) return;
      if (FUNCTION_TYPES.has(target.type)) keyboardFunctions.add(target);
      else if (target.type === 'Identifier') keyboardNames.add(target.name);
    }

    function isTagName(node) {
      const target = unwrap(node);
      if (!target) return false;
      if (target.type === 'Identifier') return tagNameAliases.has(target.name);
      if (TAG_PROPERTIES.has(propertyName(target))) return true;
      if (
        target.type === 'CallExpression' &&
        CASE_METHODS.has(propertyName(unwrap(target.callee)))
      ) {
        return isTagName(unwrap(target.callee).object);
      }
      return false;
    }

    function isTypingTagCollection(node) {
      const target = unwrap(node);
      if (!target) return false;
      if (target.type === 'Identifier') return typingTagCollections.has(target.name);
      if (target.type === 'ArrayExpression') return target.elements.some(isTypingTagLiteral);
      if (target.type === 'NewExpression' && target.callee.type === 'Identifier') {
        return target.callee.name === 'Set' && isTypingTagCollection(target.arguments[0]);
      }
      return false;
    }

    function isSelectorArgument(node) {
      const target = unwrap(node);
      if (target?.type === 'Identifier') return selectorNames.has(target.name);
      return isTypingSelector(staticString(target));
    }

    function recordReference(node, name) {
      references.push({ name, functions: enclosingFunctions(node) });
    }

    return {
      'FunctionDeclaration, FunctionExpression, ArrowFunctionExpression'(node) {
        if (node.id?.type === 'Identifier') addFunctionName(node.id.name, node);
        if (node.params.some((param) => mentionsKeyboardEvent(paramAnnotation(param)))) {
          keyboardFunctions.add(node);
        }
      },
      VariableDeclarator(node) {
        if (node.id.type !== 'Identifier' || !node.init) return;
        const init = unwrap(node.init);
        const { name } = node.id;
        if (FUNCTION_TYPES.has(init.type)) {
          addFunctionName(name, init);
          if (isKeyboardEventHandlerType(node.id.typeAnnotation)) keyboardFunctions.add(init);
        }
        if (isTagName(init)) tagNameAliases.add(name);
        if (isTypingSelector(staticString(init))) selectorNames.add(name);
        if (isTypingTagCollection(init)) typingTagCollections.add(name);
      },
      CallExpression(node) {
        const callee = unwrap(node.callee);
        if (callee.type === 'Identifier') recordReference(node, callee.name);
        for (const argument of node.arguments) {
          if (argument.type === 'Identifier') recordReference(node, argument.name);
        }

        const keyIndex = node.arguments.findIndex((argument) =>
          KEY_EVENTS.has(staticString(argument) ?? ''),
        );
        if (keyIndex !== -1) node.arguments.slice(keyIndex + 1).forEach(markHandler);

        const method = propertyName(callee);
        if (SELECTOR_METHODS.has(method) && isSelectorArgument(node.arguments[0])) {
          signals.push(node);
        }
        if (
          (method === 'includes' || method === 'has') &&
          isTagName(node.arguments[0]) &&
          isTypingTagCollection(callee.object)
        ) {
          signals.push(node);
        }
      },
      Property(node) {
        const key = node.computed ? null : (node.key.name ?? node.key.value);
        if (typeof key === 'string' && KEY_HANDLER_PROPS.has(key.toLowerCase())) {
          markHandler(node.value);
        }
      },
      AssignmentExpression(node) {
        if (KEY_HANDLER_PROPS.has(propertyName(node.left)?.toLowerCase())) markHandler(node.right);
      },
      BinaryExpression(node) {
        if (!EQUALITY.has(node.operator)) return;
        if (
          (isTagName(node.left) && isTypingTagLiteral(node.right)) ||
          (isTagName(node.right) && isTypingTagLiteral(node.left))
        ) {
          signals.push(node);
        }
      },
      SwitchStatement(node) {
        if (!isTagName(node.discriminant)) return;
        for (const switchCase of node.cases) {
          if (switchCase.test && isTypingTagLiteral(switchCase.test)) signals.push(switchCase);
        }
      },
      MemberExpression(node) {
        if (!EDITABLE_PROPERTIES.has(propertyName(node))) return;
        const { parent } = node;
        if (parent?.type === 'AssignmentExpression' && parent.left === node) return;
        signals.push(node);
      },
      SvelteAttribute(node) {
        if (!KEY_HANDLER_PROPS.has(node.key?.name?.toLowerCase())) return;
        for (const value of node.value ?? []) {
          if (value.type === 'SvelteMustacheTag') markHandler(value.expression);
        }
      },
      SvelteShorthandAttribute(node) {
        if (KEY_HANDLER_PROPS.has(node.key?.name?.toLowerCase())) markHandler(node.value);
      },
      SvelteDirective(node) {
        if (node.kind !== 'EventHandler' || !KEY_EVENTS.has(node.key?.name?.name)) return;
        if (node.expression) markHandler(node.expression);
      },
      'Program:exit'() {
        for (const name of keyboardNames) {
          for (const fn of functionsByName.get(name) ?? []) keyboardFunctions.add(fn);
        }
        // Spread keyboard context to every same-file function a keyboard function
        // references, until nothing new is reached.
        let grew = true;
        while (grew) {
          grew = false;
          for (const { name, functions } of references) {
            if (!functions.some((fn) => keyboardFunctions.has(fn))) continue;
            for (const fn of functionsByName.get(name) ?? []) {
              if (keyboardFunctions.has(fn)) continue;
              keyboardFunctions.add(fn);
              grew = true;
            }
          }
        }
        for (const signal of signals) {
          if (enclosingFunctions(signal).some((fn) => keyboardFunctions.has(fn))) {
            context.report({ node: signal, messageId: 'handWrittenTypingCheck' });
          }
        }
      },
    };
  },
};
