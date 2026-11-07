import { shortcutChord } from '../src/test/shortcut-chords.ts';

/**
 * Rejects a component test that presses a registered shortcut's keys typed out by hand:
 *
 *   await page.keyboard.press('Control+Backslash');                        // flagged
 *   element.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', ctrlKey: true }));
 *
 * When the shortcut moves, such a spec keeps pressing the old keys and fails later, often
 * only in the nightly run: cloudlands-fe#4205 moved column focus, the spec kept the old
 * chord, nightly failed twice (intent-hq/intent#8681, #8682) until the hand fix in
 * cloudlands-fe#4229. `shortcutChord(binding, mac)` (src/test/shortcut-chords.ts) turns a
 * `SHORTCUT_DEFAULTS` binding into the `press` string and the `KeyboardEvent` init.
 *
 * Flagged, in `*.ct.spec.ts` files: a string (or plain template) argument of any `.press(...)`
 * call (`keyboard.press`, `locator.press`, `page.press(selector, key)`), and an object-literal
 * init of `new KeyboardEvent(...)` or of `.dispatchEvent('keydown', ...)`, whose chord equals
 * a binding's chord on macOS or on Windows/Linux. `ControlOrMeta` counts as either.
 * Only bindings with an explicit modifier (`mod+`, `ctrl+`, `alt+`, `shift+`) are matched:
 * a bare key such as `enter` or `/` is ordinary typing. Key sequences, ranges and
 * alternatives (`q + 1-9`, `mod+1-9`, `h/j/k/l`) are skipped. An init with a spread or a
 * computed modifier is not read.
 *
 * Options: `bindings` maps shortcut ids to bindings (eslint.config.js passes
 * `SHORTCUT_DEFAULTS`, so a table change also changes the lint cache key); `ignore` maps
 * ids to the reason their chord is not checked. When a spec's keys belong to a hard-coded
 * handler that only shares the chord, disable this rule on that line with a reason.
 */

const MESSAGE =
  '`{{chord}}` is the {{shortcuts}} shortcut typed out by hand. When the shortcut moves, ' +
  'the spec keeps pressing the old keys and fails later, often only nightly ' +
  '(cloudlands-fe#4205 moved column focus; intent-hq/intent#8681 and #8682 followed). Read ' +
  'the keys from the table: `shortcutChord(SHORTCUT_DEFAULTS[{{id}}], isMac)` from ' +
  'src/test/shortcut-chords.ts gives `.press` and the `KeyboardEvent` init `.event`. Import ' +
  "SHORTCUT_DEFAULTS from '$lib/utils/shortcut-bindings' in the spec itself: changed-test " +
  "selection follows a spec's direct imports only (scripts/verify-changed.mjs). If the keys " +
  'belong to a hard-coded handler that only shares this chord, disable this rule on that ' +
  'line with a reason.';

const MODIFIERS = ['Meta', 'Control', 'Alt', 'Shift'];

const NAMED_KEYS = new Map(
  [
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'PageUp',
    'PageDown',
    'Home',
    'End',
    'Enter',
    'Escape',
    'Tab',
    'Backspace',
    'Delete',
    'Insert',
    ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
  ].map((name) => [name.toLowerCase(), name]),
);
NAMED_KEYS.set('space', 'Space');
NAMED_KEYS.set(' ', 'Space');
NAMED_KEYS.set('esc', 'Escape');

const CODE_KEYS = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
};

const SHIFTED = {
  '~': '`',
  '!': '1',
  '@': '2',
  '#': '3',
  $: '4',
  '%': '5',
  '^': '6',
  '&': '7',
  '*': '8',
  '(': '9',
  ')': '0',
  _: '-',
  '+': '=',
  '{': '[',
  '}': ']',
  '|': '\\',
  ':': ';',
  '"': "'",
  '<': ',',
  '>': '.',
  '?': '/',
};

// The physical key a key name, code or character stands for, and whether it implies Shift.
function physicalKey(name) {
  if (NAMED_KEYS.has(name.toLowerCase())) return { key: NAMED_KEYS.get(name.toLowerCase()) };
  if (CODE_KEYS[name]) return { key: CODE_KEYS[name] };
  const code = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(name);
  if (code) return { key: (code[1] ?? code[2]).toLowerCase() };
  if (name.length !== 1) return null;
  if (SHIFTED[name]) return { key: SHIFTED[name], shift: true };
  return { key: name.toLowerCase() };
}

function chordId({ meta, ctrl, alt, shift, key }) {
  return `${meta ? 'Meta+' : ''}${ctrl ? 'Control+' : ''}${alt ? 'Alt+' : ''}${shift ? 'Shift+' : ''}${key}`;
}

// The chords (one per platform reading) a Playwright `press` string produces, or [].
function pressChords(text) {
  let parts;
  if (text === '+') parts = ['+'];
  else if (text.endsWith('++')) parts = [...text.slice(0, -2).split('+'), '+'];
  else parts = text.split('+');
  const name = parts.pop();
  const physical = name ? physicalKey(name) : null;
  if (!physical) return [];
  const held = new Set();
  for (const part of parts) {
    if (!MODIFIERS.includes(part) && part !== 'ControlOrMeta') return [];
    held.add(part);
  }
  const variants = held.has('ControlOrMeta') ? ['Meta', 'Control'] : [null];
  return variants.map((primary) => {
    const has = (modifier) => held.has(modifier) || primary === modifier;
    return chordId({
      meta: has('Meta'),
      ctrl: has('Control'),
      alt: has('Alt'),
      shift: has('Shift') || Boolean(physical.shift),
      key: physical.key,
    });
  });
}

function staticString(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

function propertyKey(property) {
  if (!property.computed && property.key.type === 'Identifier') return property.key.name;
  return staticString(property.key);
}

const INIT_MODIFIERS = { metaKey: 'meta', ctrlKey: 'ctrl', altKey: 'alt', shiftKey: 'shift' };

// The chord a `KeyboardEvent` init literal describes, or null when it cannot be read.
function initChord(node) {
  if (node?.type !== 'ObjectExpression') return null;
  const chord = { meta: false, ctrl: false, alt: false, shift: false };
  let key = null;
  let code = null;
  for (const property of node.properties) {
    if (property.type !== 'Property') return null;
    const name = propertyKey(property);
    if (name === 'key') key = staticString(property.value);
    else if (name === 'code') code = staticString(property.value);
    else if (name in INIT_MODIFIERS) {
      if (property.value.type !== 'Literal' || typeof property.value.value !== 'boolean') {
        return null;
      }
      chord[INIT_MODIFIERS[name]] = property.value.value;
    }
  }
  const physical = physicalKey(key ?? code ?? '');
  if (!physical) return null;
  return chordId({ ...chord, shift: chord.shift || Boolean(physical.shift), key: physical.key });
}

function isSingleChord(binding) {
  if (!/^(?:mod|ctrl|alt|shift)\+/.test(binding)) return false;
  try {
    shortcutChord(binding, true);
    return true;
  } catch {
    return false;
  }
}

// Map each registered chord, on either platform, to the shortcut ids bound to it.
function registeredChords(bindings, ignore) {
  const chords = new Map();
  for (const [id, binding] of Object.entries(bindings)) {
    if (Object.hasOwn(ignore, id) || typeof binding !== 'string' || !isSingleChord(binding)) {
      continue;
    }
    for (const mac of [true, false]) {
      for (const chord of pressChords(shortcutChord(binding, mac).press)) {
        const ids = chords.get(chord) ?? new Set();
        ids.add(id);
        chords.set(chord, ids);
      }
    }
  }
  return chords;
}

function calleeName(callee) {
  const target = callee?.type === 'ChainExpression' ? callee.expression : callee;
  if (target?.type !== 'MemberExpression') return null;
  if (!target.computed && target.property.type === 'Identifier') return target.property.name;
  return staticString(target.property);
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Require a component test to read a registered shortcut's keys from SHORTCUT_DEFAULTS instead of typing them out.",
    },
    schema: [
      {
        type: 'object',
        properties: {
          bindings: { type: 'object', additionalProperties: { type: 'string' } },
          ignore: { type: 'object', additionalProperties: { type: 'string', minLength: 1 } },
        },
        required: ['bindings'],
        additionalProperties: false,
      },
    ],
    messages: {
      handTypedShortcut: MESSAGE,
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (!filename.endsWith('.ct.spec.ts')) return {};
    const { bindings, ignore = {} } = context.options[0] ?? {};
    const unknown = Object.keys(ignore).filter((id) => !Object.hasOwn(bindings, id));
    if (unknown.length > 0) {
      throw new Error(
        `no-hand-typed-shortcut-in-ct: unknown ignored shortcut ${unknown.join(', ')}`,
      );
    }
    const registered = registeredChords(bindings, ignore);

    function report(node, text, chords) {
      const ids = [...new Set(chords.flatMap((chord) => [...(registered.get(chord) ?? [])]))];
      if (ids.length === 0) return;
      context.report({
        node,
        messageId: 'handTypedShortcut',
        data: {
          chord: text,
          shortcuts: ids.map((id) => `\`${id}\` (\`${bindings[id]}\`)`).join(' / '),
          id: `'${ids[0]}'`,
        },
      });
    }

    return {
      CallExpression(node) {
        const name = calleeName(node.callee);
        if (name === 'press') {
          for (const argument of node.arguments.slice(0, 2)) {
            const text = staticString(argument);
            if (text !== null) report(argument, text, pressChords(text));
          }
        } else if (name === 'dispatchEvent') {
          const type = staticString(node.arguments[0]);
          const chord = type === 'keydown' ? initChord(node.arguments[1]) : null;
          if (chord) report(node.arguments[1], chord, [chord]);
        }
      },
      NewExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'KeyboardEvent') return;
        const type = staticString(node.arguments[0]);
        const chord = type === null || type === 'keydown' ? initChord(node.arguments[1]) : null;
        if (chord) report(node.arguments[1], chord, [chord]);
      },
    };
  },
};
