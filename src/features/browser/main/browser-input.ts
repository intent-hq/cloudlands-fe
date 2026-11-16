/**
 * Trusted input for browser.exec (intent-hq/intent#9266): click, hover, type,
 * press and selectOption through the CDP Input domain, so the page receives
 * `isTrusted: true` events with native editing and selection behaviour.
 *
 * Electron-free: it only needs a CDP `send`, so the executor binds it to a
 * guest's debugger and the Electron test binds it to a bare BrowserWindow.
 */

export type CdpSend = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export type InputErrorCode =
  | 'element-not-found'
  | 'element-not-visible'
  | 'element-obscured'
  | 'invalid-selector'
  | 'not-focusable'
  | 'not-a-select'
  | 'option-not-found'
  | 'unknown-key';

export const INPUT_ERROR_CODES: readonly InputErrorCode[] = [
  'element-not-found',
  'element-not-visible',
  'element-obscured',
  'invalid-selector',
  'not-focusable',
  'not-a-select',
  'option-not-found',
  'unknown-key',
];

export class InputActionError extends Error {
  constructor(
    message: string,
    readonly errorCode: InputErrorCode,
  ) {
    super(message);
    this.name = 'InputActionError';
  }
}

export type InputModifier = 'Alt' | 'Control' | 'Meta' | 'Shift' | 'ControlOrMeta';
export type MouseButton = 'left' | 'right' | 'middle';

interface Target {
  selector?: string;
  x?: number;
  y?: number;
}

export type InputAction =
  | ({ action: 'click'; button?: MouseButton; clickCount?: number } & Target)
  | ({ action: 'hover' } & Target)
  | { action: 'type'; text: string; selector?: string; clear?: boolean; mode?: 'keys' | 'insert' }
  | { action: 'press'; key: string; modifiers?: InputModifier[] }
  | { action: 'selectOption'; selector: string; value: string | string[] };

export const INPUT_ACTIONS = new Set(['click', 'hover', 'type', 'press', 'selectOption']);

const MODIFIER_BITS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 } as const;
const BUTTON_BITS: Record<MouseButton, number> = { left: 1, right: 2, middle: 4 };

interface KeyDefinition {
  code: string;
  keyCode: number;
  text?: string;
}

const NAMED_KEYS: Record<string, KeyDefinition> = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { code: 'Tab', keyCode: 9 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  Escape: { code: 'Escape', keyCode: 27 },
  Insert: { code: 'Insert', keyCode: 45 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  PageUp: { code: 'PageUp', keyCode: 33 },
  PageDown: { code: 'PageDown', keyCode: 34 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  Shift: { code: 'ShiftLeft', keyCode: 16 },
  Control: { code: 'ControlLeft', keyCode: 17 },
  Alt: { code: 'AltLeft', keyCode: 18 },
  Meta: { code: 'MetaLeft', keyCode: 91 },
  ...Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, { code: `F${i + 1}`, keyCode: 112 + i }]),
  ),
};

const PUNCTUATION: Record<string, [code: string, keyCode: number]> = {
  ' ': ['Space', 32],
  '-': ['Minus', 189],
  '=': ['Equal', 187],
  ',': ['Comma', 188],
  '.': ['Period', 190],
  '/': ['Slash', 191],
  ';': ['Semicolon', 186],
  "'": ['Quote', 222],
  '[': ['BracketLeft', 219],
  ']': ['BracketRight', 221],
  '\\': ['Backslash', 220],
  '`': ['Backquote', 192],
};

/**
 * On macOS, Chromium performs editing shortcuts from the browser-side
 * NSResponder commands, so CDP key events must name them (as Playwright does).
 */
const MAC_EDITING_COMMANDS: Record<string, string> = {
  Backspace: 'deleteBackward',
  Delete: 'deleteForward',
  Enter: 'insertNewline',
  Tab: 'insertTab',
  'Shift+Tab': 'insertBacktab',
  Escape: 'cancelOperation',
  ArrowUp: 'moveUp',
  ArrowDown: 'moveDown',
  ArrowLeft: 'moveLeft',
  ArrowRight: 'moveRight',
  'Shift+ArrowUp': 'moveUpAndModifySelection',
  'Shift+ArrowDown': 'moveDownAndModifySelection',
  'Shift+ArrowLeft': 'moveLeftAndModifySelection',
  'Shift+ArrowRight': 'moveRightAndModifySelection',
  'Alt+ArrowLeft': 'moveWordLeft',
  'Alt+ArrowRight': 'moveWordRight',
  'Meta+ArrowLeft': 'moveToLeftEndOfLine',
  'Meta+ArrowRight': 'moveToRightEndOfLine',
  'Meta+ArrowUp': 'moveToBeginningOfDocument',
  'Meta+ArrowDown': 'moveToEndOfDocument',
  'Alt+Backspace': 'deleteWordBackward',
  'Meta+Backspace': 'deleteToBeginningOfLine',
  Home: 'scrollToBeginningOfDocument',
  End: 'scrollToEndOfDocument',
  PageUp: 'scrollPageUp',
  PageDown: 'scrollPageDown',
  'Meta+a': 'selectAll',
  'Meta+c': 'copy',
  'Meta+x': 'cut',
  'Meta+v': 'paste',
  'Meta+z': 'undo',
  'Shift+Meta+z': 'redo',
};

function describeKey(key: string): KeyDefinition | undefined {
  const named = NAMED_KEYS[key];
  if (named) return named;
  if ([...key].length !== 1) return undefined;
  if (/^[a-z]$/i.test(key)) {
    const upper = key.toUpperCase();
    return { code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: key };
  }
  if (/^[0-9]$/.test(key)) return { code: `Digit${key}`, keyCode: key.charCodeAt(0), text: key };
  const punctuation = PUNCTUATION[key];
  if (punctuation) return { code: punctuation[0], keyCode: punctuation[1], text: key };
  return { code: '', keyCode: 0, text: key };
}

function keyDefinition(key: string): KeyDefinition {
  const definition = describeKey(key);
  if (definition) return definition;
  throw new InputActionError(
    // i18n-ignore (agent-facing protocol error, not user-facing)
    `Unknown key "${key}". Use a single character or a named key such as Enter, Tab, Backspace, Delete, Escape, ArrowLeft, Home, PageDown or F1-F12.`,
    'unknown-key',
  );
}

function resolveModifiers(modifiers: InputModifier[], platform: string) {
  const names = new Set(
    modifiers.map((m) => (m === 'ControlOrMeta' ? (platform === 'darwin' ? 'Meta' : 'Control') : m)),
  );
  const ordered = (['Shift', 'Control', 'Alt', 'Meta'] as const).filter((m) => names.has(m));
  return { names: ordered, bits: ordered.reduce((sum, m) => sum + MODIFIER_BITS[m], 0) };
}

async function pressKey(
  send: CdpSend,
  key: string,
  modifiers: InputModifier[],
  platform: string,
): Promise<void> {
  const definition = keyDefinition(key);
  const mods = resolveModifiers(modifiers, platform);
  const shortcut = mods.names.some((m) => m !== 'Shift');
  let text = shortcut ? undefined : definition.text;
  if (text && mods.names.includes('Shift') && /^[a-z]$/.test(text)) text = text.toUpperCase();
  const command =
    platform === 'darwin' ? MAC_EDITING_COMMANDS[[...mods.names, key].join('+')] : undefined;
  const base = {
    key,
    code: definition.code,
    windowsVirtualKeyCode: definition.keyCode,
    nativeVirtualKeyCode: definition.keyCode,
    modifiers: mods.bits,
  };
  await send('Input.dispatchKeyEvent', {
    ...base,
    type: text ? 'keyDown' : 'rawKeyDown',
    ...(text ? { text, unmodifiedText: text } : {}),
    ...(command ? { commands: [command] } : {}),
  });
  await send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
}

type PageStatus = {
  status: string;
  x?: number;
  y?: number;
  hit?: string;
  message?: string;
  selected?: string[];
  missing?: string[];
};

async function evaluateInPage(send: CdpSend, fn: string, ...args: unknown[]): Promise<PageStatus> {
  const result = (await send('Runtime.evaluate', {
    expression: `(${fn})(${args.map((a) => JSON.stringify(a)).join(', ')})`,
    returnByValue: true,
    awaitPromise: true,
  })) as { result?: { value?: PageStatus }; exceptionDetails?: { text?: string } };
  if (result.exceptionDetails) {
    // i18n-ignore (agent-facing protocol error, not user-facing)
    throw new Error(`Input page script failed: ${result.exceptionDetails.text ?? 'exception'}`);
  }
  return result.result?.value ?? { status: 'not-found' };
}

const FIND_ELEMENT = `function find(selector) {
  try { return { el: document.querySelector(selector) }; }
  catch (e) { return { error: String(e && e.message || e) }; }
}`;

/** Scrolls the element into view and returns its center if it would receive the pointer. */
const RESOLVE_POINT = `(selector) => {
  ${FIND_ELEMENT}
  const found = find(selector);
  if (found.error) return { status: 'invalid-selector', message: found.error };
  const el = found.el;
  if (!el) return { status: 'not-found' };
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') return { status: 'not-visible' };
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const hit = document.elementFromPoint(x, y);
  let receives = !hit || hit === el || el.contains(hit);
  for (let node = el.getRootNode(); !receives && node && node.host; node = node.host.getRootNode()) {
    receives = node.host === hit;
  }
  if (receives) return { status: 'ok', x, y };
  const name = hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '') +
    (typeof hit.className === 'string' && hit.className.trim() ? '.' + hit.className.trim().split(/\\s+/).join('.') : '');
  return { status: 'obscured', x, y, hit: name };
}`;

const FOCUS_ELEMENT = `(selector) => {
  ${FIND_ELEMENT}
  const found = find(selector);
  if (found.error) return { status: 'invalid-selector', message: found.error };
  const el = found.el;
  if (!el) return { status: 'not-found' };
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  el.focus();
  const active = document.activeElement;
  return active === el || el.contains(active) ? { status: 'ok' } : { status: 'not-focusable' };
}`;

const SELECT_OPTION = `(selector, wanted) => {
  ${FIND_ELEMENT}
  const found = find(selector);
  if (found.error) return { status: 'invalid-selector', message: found.error };
  const el = found.el;
  if (!el) return { status: 'not-found' };
  if (!(el instanceof HTMLSelectElement)) return { status: 'not-a-select', message: el.tagName.toLowerCase() };
  const options = Array.from(el.options);
  const picks = wanted.map((w) => options.find((o) => o.value === w) || options.find((o) => o.label === w || o.text.trim() === w));
  const missing = wanted.filter((_, i) => !picks[i]);
  if (missing.length) return { status: 'option-not-found', missing };
  if (!el.multiple && picks.length > 1) return { status: 'option-not-found', message: 'the select is not multiple' };
  el.focus();
  for (const o of options) o.selected = picks.includes(o);
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { status: 'ok', selected: picks.map((o) => o.value) };
}`;

function failForStatus(page: PageStatus, selector: string): never {
  // i18n-ignore-start (agent-facing protocol errors, not user-facing)
  switch (page.status) {
    case 'invalid-selector':
      throw new InputActionError(
        `Invalid selector "${selector}": ${page.message}`,
        'invalid-selector',
      );
    case 'not-visible':
      throw new InputActionError(
        `"${selector}" has no visible box (zero size or visibility: hidden).`,
        'element-not-visible',
      );
    case 'obscured':
      throw new InputActionError(
        `"${selector}" is covered by ${page.hit} at (${Math.round(page.x ?? 0)}, ${Math.round(page.y ?? 0)}). Close the overlay, or pass x/y to click that point anyway.`,
        'element-obscured',
      );
    case 'not-focusable':
      throw new InputActionError(`"${selector}" cannot take focus.`, 'not-focusable');
    case 'not-a-select':
      throw new InputActionError(
        `"${selector}" is a <${page.message}>, not a <select>. Click custom dropdowns with click instead.`,
        'not-a-select',
      );
    case 'option-not-found':
      throw new InputActionError(
        page.missing
          ? `No option of "${selector}" has the value or label ${page.missing.map((m) => JSON.stringify(m)).join(', ')}.`
          : `"${selector}": ${page.message}.`,
        'option-not-found',
      );
    default:
      throw new InputActionError(
        `No element matches "${selector}" in the top document (iframes and closed shadow roots are not searched).`,
        'element-not-found',
      );
  }
  // i18n-ignore-end
}

async function resolvePoint(send: CdpSend, target: Target): Promise<{ x: number; y: number }> {
  if (target.selector === undefined) return { x: target.x ?? 0, y: target.y ?? 0 };
  const page = await evaluateInPage(send, RESOLVE_POINT, target.selector);
  if (page.status !== 'ok') failForStatus(page, target.selector);
  return { x: page.x ?? 0, y: page.y ?? 0 };
}

/**
 * Runs one input action. Focus emulation lets an unfocused or hidden guest
 * behave as focused, so input never needs (or takes) window or panel focus.
 */
export async function runInputAction(
  send: CdpSend,
  action: InputAction,
  platform: string = process.platform,
): Promise<unknown> {
  if (action.action === 'press') keyDefinition(action.key);
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });

  switch (action.action) {
    case 'click':
    case 'hover': {
      const { x, y } = await resolvePoint(send, action);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
      if (action.action === 'click') {
        const button = action.button ?? 'left';
        for (let clickCount = 1; clickCount <= (action.clickCount ?? 1); clickCount++) {
          await send('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x,
            y,
            button,
            buttons: BUTTON_BITS[button],
            clickCount,
          });
          await send('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x,
            y,
            button,
            buttons: 0,
            clickCount,
          });
        }
      }
      return { x, y };
    }

    case 'type': {
      if (action.selector !== undefined) {
        const page = await evaluateInPage(send, FOCUS_ELEMENT, action.selector);
        if (page.status !== 'ok') failForStatus(page, action.selector);
      }
      if (action.clear) {
        await pressKey(send, 'a', ['ControlOrMeta'], platform);
        await pressKey(send, 'Backspace', [], platform);
      }
      const chars = Array.from(action.text);
      if (action.mode === 'insert') {
        await send('Input.insertText', { text: action.text });
      } else {
        for (const char of chars) {
          await pressKey(send, char === '\n' || char === '\r' ? 'Enter' : char, [], platform);
        }
      }
      return { length: chars.length };
    }

    case 'press':
      await pressKey(send, action.key, action.modifiers ?? [], platform);
      return { key: action.key };

    case 'selectOption': {
      const wanted = Array.isArray(action.value) ? action.value : [action.value];
      const page = await evaluateInPage(send, SELECT_OPTION, action.selector, wanted);
      if (page.status !== 'ok') failForStatus(page, action.selector);
      return { selected: page.selected ?? [] };
    }
  }
}

