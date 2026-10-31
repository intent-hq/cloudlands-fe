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
 *   name bound to either, including `const { tagName } = el`) with 'INPUT' / 'TEXTAREA' in
 *   any case, through `===` / `==` / `!==` / `!=`, `includes` / `indexOf` / `has` on a
 *   collection of those names, a regex `.test(tag)` naming them, or a `switch` case;
 * - reading `isContentEditable` or `contentEditable`, directly or by destructuring
 *   (assigning `contentEditable` is fine), and `hasAttribute` / `getAttribute`
 *   ('contenteditable');
 * - a selector naming `input`, `textarea` or `[contenteditable]` passed to `closest`,
 *   `matches`, `querySelector` or `querySelectorAll`, as a literal or a name bound to one.
 *   A selector that also names `button`, `a`, `[href]` or `[tabindex]`, and not
 *   `[contenteditable]`, lists interactive or focusable controls (focus traps,
 *   nested-control guards) and is not flagged.
 *
 * Only inside a keyboard context:
 * - a function with a parameter typed `KeyboardEvent`, or a name annotated
 *   `KeyboardEventHandler<...>`;
 * - a listener passed after a 'keydown' / 'keyup' / 'keypress' argument to
 *   `addEventListener` or svelte/events `on`;
 * - a handler assigned to, or given as, a key-handler property or Svelte attribute —
 *   `on…keydown` / `on…keyup` / `on…keypress` / `handle…KeyDown`, with optional `capture`
 *   (`onkeydown`, `onkeydowncapture`, `onEscapeKeydown`, TipTap's `handleKeyDown`),
 *   `{onkeydown}` shorthand included — or an `on:keydown`-style directive;
 * - any function in the same file that one of those calls or passes along by name
 *   (`helper()`, `this.helper()`, `list.some(helper)`), transitively — the helper
 *   predicates (`isEditableTarget`, `isMultilineInput`) where most shipped copies lived.
 *   Function names come from declarations, `const` initializers, class methods and fields,
 *   and object-literal methods.
 *
 * Names are matched per file, without scope analysis; bindings may be declared anywhere in
 * the file. Callbacks nested inside a keyboard function count as keyboard code. Pointer,
 * click, drag and focus code, text walks outside keyboard handling, and `instanceof`
 * checks are not checked. A keyboard handler that inspects a tag for a reason other than
 * "is the user typing" disables this rule on that line with a reason.
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
const KEY_HANDLER_NAME = /^(?:on|handle)\w*key(?:down|up|press)(?:capture)?$/i;
const LISTENER_REGISTRARS = new Set(['addEventListener', 'on']);
const TAG_PROPERTIES = new Set(['tagName', 'nodeName', 'localName']);
const CASE_METHODS = new Set([
  'toLowerCase',
  'toUpperCase',
  'toLocaleLowerCase',
  'toLocaleUpperCase',
]);
const EDITABLE_PROPERTIES = new Set(['isContentEditable', 'contentEditable']);
const SELECTOR_METHODS = new Set(['closest', 'matches', 'querySelector', 'querySelectorAll']);
const MEMBERSHIP_METHODS = new Set(['includes', 'indexOf', 'has']);
const ATTRIBUTE_METHODS = new Set(['hasAttribute', 'getAttribute']);
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
const TYPING_TAG_PATTERN = /input|textarea/i;

function keyName(key, computed) {
  if (!key) return null;
  if (!computed && (key.type === 'Identifier' || key.type === 'PrivateIdentifier')) {
    return key.name;
  }
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
  return null;
}

function propertyName(node) {
  if (node?.type !== 'MemberExpression') return null;
  return keyName(node.property, node.computed);
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

function isTypingSelectorText(text) {
  if (text === null) return false;
  if (CONTENTEDITABLE_SELECTOR.test(text)) return true;
  return TYPING_TAG_SELECTOR.test(text) && !CONTROL_SELECTOR.test(text);
}

function isTypingTagLiteral(node) {
  const text = staticString(node);
  return text !== null && TYPING_TAGS.has(text.toLowerCase());
}

function isTypingTagRegex(node) {
  const target = unwrap(node);
  return Boolean(
    target?.type === 'Literal' && target.regex && TYPING_TAG_PATTERN.test(target.regex.pattern),
  );
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

function enclosingFunctions(node) {
  const functions = [];
  for (let current = node.parent; current; current = current.parent) {
    if (FUNCTION_TYPES.has(current.type)) functions.push(current);
  }
  return functions;
}

// `helper` or `this.helper` → 'helper'; anything else is not a same-file function name.
function referencedName(node) {
  const target = unwrap(node);
  if (target?.type === 'Identifier') return target.name;
  if (target?.type === 'MemberExpression' && unwrap(target.object)?.type === 'ThisExpression') {
    return propertyName(target);
  }
  return null;
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
    // Per-file name tables (no scope analysis). Bindings are resolved at Program:exit,
    // so a constant may be declared after the function that uses it.
    const functionsByName = new Map();
    const declarators = [];
    const tagNameAliases = new Set();
    const selectorNames = new Set();
    const typingTagCollections = new Set();
    // Names each call site references; enclosing functions are computed only when needed.
    const references = [];
    // Nodes that may be typing checks once bindings are known, and definite ones.
    const candidates = [];
    const signals = [];

    function addFunctionName(name, fn) {
      if (typeof name !== 'string' || !fn || !FUNCTION_TYPES.has(fn.type)) return;
      if (!functionsByName.has(name)) functionsByName.set(name, []);
      functionsByName.get(name).push(fn);
    }

    function markHandler(node) {
      const target = unwrap(node);
      if (!target) return;
      if (FUNCTION_TYPES.has(target.type)) {
        keyboardFunctions.add(target);
        return;
      }
      const name = referencedName(target);
      if (name) keyboardNames.add(name);
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

    function isTypingSelector(node) {
      const target = unwrap(node);
      if (target?.type === 'Identifier') return selectorNames.has(target.name);
      return isTypingSelectorText(staticString(target));
    }

    // Record what a declarator binds; repeated until no table grows, so aliases of
    // aliases resolve regardless of order.
    function resolveDeclarator({ id, init }) {
      let grew = false;
      const add = (set, name) => {
        if (set.has(name)) return;
        set.add(name);
        grew = true;
      };
      if (id.type === 'Identifier') {
        if (isTagName(init)) add(tagNameAliases, id.name);
        if (isTypingSelectorText(staticString(init))) add(selectorNames, id.name);
        if (isTypingTagCollection(init)) add(typingTagCollections, id.name);
      } else if (id.type === 'ObjectPattern') {
        for (const property of id.properties) {
          if (property.type !== 'Property' || property.value.type !== 'Identifier') continue;
          if (TAG_PROPERTIES.has(keyName(property.key, property.computed))) {
            add(tagNameAliases, property.value.name);
          }
        }
      }
      return grew;
    }

    function isCandidateSignal(node) {
      switch (node.type) {
        case 'BinaryExpression':
          return (
            (isTagName(node.left) && isTypingTagLiteral(node.right)) ||
            (isTagName(node.right) && isTypingTagLiteral(node.left))
          );
        case 'SwitchCase':
          return isTagName(node.parent.discriminant) && isTypingTagLiteral(node.test);
        case 'CallExpression': {
          const callee = unwrap(node.callee);
          const method = propertyName(callee);
          const [first] = node.arguments;
          if (SELECTOR_METHODS.has(method)) return isTypingSelector(first);
          if (MEMBERSHIP_METHODS.has(method)) {
            return isTagName(first) && isTypingTagCollection(callee.object);
          }
          if (method === 'test') return isTagName(first) && isTypingTagRegex(callee.object);
          return false;
        }
        default:
          return false;
      }
    }

    return {
      'FunctionDeclaration, FunctionExpression, ArrowFunctionExpression'(node) {
        if (node.id?.type === 'Identifier') addFunctionName(node.id.name, node);
        if (node.params.some((param) => mentionsKeyboardEvent(paramAnnotation(param)))) {
          keyboardFunctions.add(node);
        }
      },
      VariableDeclarator(node) {
        if (!node.init) return;
        declarators.push(node);
        if (node.id.type === 'Identifier') {
          const init = unwrap(node.init);
          addFunctionName(node.id.name, init);
          if (isKeyboardEventHandlerType(node.id.typeAnnotation)) markHandler(init);
          return;
        }
        if (node.id.type !== 'ObjectPattern') return;
        for (const property of node.id.properties) {
          if (property.type !== 'Property') continue;
          if (EDITABLE_PROPERTIES.has(keyName(property.key, property.computed))) {
            signals.push(property);
          }
        }
      },
      'MethodDefinition, PropertyDefinition'(node) {
        const name = keyName(node.key, node.computed);
        const value = node.value && unwrap(node.value);
        addFunctionName(name, value);
        if (node.type === 'PropertyDefinition' && isKeyboardEventHandlerType(node.typeAnnotation)) {
          markHandler(value);
        }
        if (KEY_HANDLER_NAME.test(name ?? '')) markHandler(value);
      },
      Property(node) {
        if (node.parent?.type !== 'ObjectExpression') return;
        const name = keyName(node.key, node.computed);
        addFunctionName(name, unwrap(node.value));
        if (KEY_HANDLER_NAME.test(name ?? '')) markHandler(node.value);
      },
      CallExpression(node) {
        const callee = unwrap(node.callee);
        const names = [referencedName(callee), ...node.arguments.map(referencedName)].filter(
          Boolean,
        );
        if (names.length > 0) references.push({ names, node });

        const registrar = callee.type === 'Identifier' ? callee.name : propertyName(callee);
        if (
          LISTENER_REGISTRARS.has(registrar) &&
          (registrar !== 'on' || callee.type === 'Identifier')
        ) {
          const keyIndex = node.arguments.findIndex((argument) =>
            KEY_EVENTS.has(staticString(argument) ?? ''),
          );
          if (keyIndex !== -1) node.arguments.slice(keyIndex + 1).forEach(markHandler);
        }

        const method = propertyName(callee);
        if (
          ATTRIBUTE_METHODS.has(method) &&
          staticString(node.arguments[0])?.toLowerCase() === 'contenteditable'
        ) {
          signals.push(node);
        } else if (
          SELECTOR_METHODS.has(method) ||
          MEMBERSHIP_METHODS.has(method) ||
          method === 'test'
        ) {
          candidates.push(node);
        }
      },
      AssignmentExpression(node) {
        if (KEY_HANDLER_NAME.test(propertyName(node.left) ?? '')) markHandler(node.right);
      },
      BinaryExpression(node) {
        if (EQUALITY.has(node.operator)) candidates.push(node);
      },
      SwitchCase(node) {
        if (node.test) candidates.push(node);
      },
      MemberExpression(node) {
        if (!EDITABLE_PROPERTIES.has(propertyName(node))) return;
        const { parent } = node;
        if (parent?.type === 'AssignmentExpression' && parent.left === node) return;
        signals.push(node);
      },
      SvelteAttribute(node) {
        if (!KEY_HANDLER_NAME.test(node.key?.name ?? '')) return;
        for (const value of node.value ?? []) {
          if (value.type === 'SvelteMustacheTag') markHandler(value.expression);
        }
      },
      SvelteShorthandAttribute(node) {
        if (KEY_HANDLER_NAME.test(node.key?.name ?? '')) markHandler(node.value);
      },
      SvelteDirective(node) {
        if (node.kind !== 'EventHandler' || !KEY_EVENTS.has(node.key?.name?.name)) return;
        if (node.expression) markHandler(node.expression);
      },
      'Program:exit'() {
        if (signals.length === 0 && candidates.length === 0) return;
        while (declarators.some(resolveDeclarator));
        const found = [...signals, ...candidates.filter(isCandidateSignal)];
        if (found.length === 0) return;

        for (const name of keyboardNames) {
          for (const fn of functionsByName.get(name) ?? []) keyboardFunctions.add(fn);
        }
        // Spread keyboard context to every same-file function a keyboard function
        // references; each call site is consumed once it is reached.
        let pending = references.map(({ names, node }) => ({
          names,
          functions: enclosingFunctions(node),
        }));
        let grew = true;
        while (grew && pending.length > 0) {
          grew = false;
          const next = [];
          for (const reference of pending) {
            if (!reference.functions.some((fn) => keyboardFunctions.has(fn))) {
              next.push(reference);
              continue;
            }
            for (const name of reference.names) {
              for (const fn of functionsByName.get(name) ?? []) {
                if (keyboardFunctions.has(fn)) continue;
                keyboardFunctions.add(fn);
                grew = true;
              }
            }
          }
          pending = next;
        }

        for (const signal of found) {
          if (enclosingFunctions(signal).some((fn) => keyboardFunctions.has(fn))) {
            context.report({ node: signal, messageId: 'handWrittenTypingCheck' });
          }
        }
      },
    };
  },
};
