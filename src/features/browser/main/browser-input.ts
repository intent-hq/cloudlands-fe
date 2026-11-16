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
  | 'element-disabled'
  | 'unknown-key';

export const INPUT_ERROR_CODES: readonly InputErrorCode[] = [
  'element-not-found',
  'element-not-visible',
  'element-obscured',
  'invalid-selector',
  'not-focusable',
  'not-a-select',
  'option-not-found',
  'element-disabled',
  'unknown-key',
];

class InputActionError extends Error {
  constructor(
    message: string,
    readonly errorCode: InputErrorCode,
  ) {
    super(message);
    this.name = 'InputActionError';
  }
}

type InputModifier = 'Alt' | 'Control' | 'Meta' | 'Shift' | 'ControlOrMeta';
type MouseButton = 'left' | 'right' | 'middle';

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
  /** Typed with Shift on a US layout (`A`, `!`). */
  shifted?: boolean;
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
  'Shift+Enter': 'insertNewline',
  'Alt+Enter': 'insertNewlineIgnoringFieldEditor',
  'Shift+Backspace': 'deleteBackward',
  'Shift+Delete': 'deleteForward',
  'Alt+Delete': 'deleteWordForward',
  'Meta+Delete': 'deleteToEndOfLine',
  'Shift+Alt+ArrowLeft': 'moveWordLeftAndModifySelection',
  'Shift+Alt+ArrowRight': 'moveWordRightAndModifySelection',
  'Shift+Meta+ArrowLeft': 'moveToLeftEndOfLineAndModifySelection',
  'Shift+Meta+ArrowRight': 'moveToRightEndOfLineAndModifySelection',
  'Shift+Meta+ArrowUp': 'moveToBeginningOfDocumentAndModifySelection',
  'Shift+Meta+ArrowDown': 'moveToEndOfDocumentAndModifySelection',
  'Shift+Home': 'moveToBeginningOfDocumentAndModifySelection',
  'Shift+End': 'moveToEndOfDocumentAndModifySelection',
  'Shift+PageUp': 'pageUpAndModifySelection',
  'Shift+PageDown': 'pageDownAndModifySelection',
};

/** US-layout shifted characters and the key that produces them. */
const SHIFTED: Record<string, string> = {
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
  '<': ',',
  '>': '.',
  '?': '/',
  ':': ';',
  '"': "'",
  '{': '[',
  '}': ']',
  '|': '\\',
  '~': '`',
};
const UNSHIFTED = Object.fromEntries(Object.entries(SHIFTED).map(([up, down]) => [down, up]));

function describeKey(key: string): KeyDefinition | undefined {
  const named = NAMED_KEYS[key];
  if (named) return named;
  if ([...key].length !== 1) return undefined;
  if (/^[a-z]$/i.test(key)) {
    const upper = key.toUpperCase();
    return { code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: key, shifted: key === upper };
  }
  if (/^[0-9]$/.test(key)) return { code: `Digit${key}`, keyCode: key.charCodeAt(0), text: key };
  const base = SHIFTED[key];
  const known = base === undefined ? PUNCTUATION[key] : undefined;
  if (known) return { code: known[0], keyCode: known[1], text: key };
  if (base !== undefined) {
    const baseKey = describeKey(base);
    if (baseKey) return { ...baseKey, text: key, shifted: true };
  }
  return { code: '', keyCode: 0, text: key };
}

/** The key Shift turns `key` into on a US layout, if any. */
function shiftedKey(key: string): string {
  if (/^[a-z]$/.test(key)) return key.toUpperCase();
  return UNSHIFTED[key] ?? key;
}

/** The unshifted key, used to look up macOS editing commands. */
function baseKey(key: string): string {
  if (/^[A-Z]$/.test(key)) return key.toLowerCase();
  return SHIFTED[key] ?? key;
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
    modifiers.map((m) =>
      m === 'ControlOrMeta' ? (platform === 'darwin' ? 'Meta' : 'Control') : m,
    ),
  );
  const ordered = (['Shift', 'Control', 'Alt', 'Meta'] as const).filter((m) => names.has(m));
  return { names: ordered, bits: ordered.reduce((sum, m) => sum + MODIFIER_BITS[m], 0) };
}

async function pressKey(
  send: CdpSend,
  requestedKey: string,
  modifiers: InputModifier[],
  platform: string,
): Promise<void> {
  const shift = modifiers.includes('Shift');
  const key = shift ? shiftedKey(requestedKey) : requestedKey;
  const definition = keyDefinition(key);
  const mods = resolveModifiers(
    definition.shifted && !shift ? [...modifiers, 'Shift'] : modifiers,
    platform,
  );
  const shortcut = mods.names.some((m) => m !== 'Shift');
  const text = shortcut ? undefined : definition.text;
  const command =
    platform === 'darwin'
      ? MAC_EDITING_COMMANDS[[...mods.names, baseKey(key)].join('+')]
      : undefined;
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

/** Top document first, then open shadow roots (breadth-first). */
const FIND_ELEMENT = `function find(selector) {
  try {
    const top = document.querySelector(selector);
    if (top) return { el: top };
    const roots = [document];
    while (roots.length) {
      for (const node of roots.shift().querySelectorAll('*')) {
        if (!node.shadowRoot) continue;
        const match = node.shadowRoot.querySelector(selector);
        if (match) return { el: match };
        roots.push(node.shadowRoot);
      }
    }
    return { el: null };
  } catch (e) { return { error: String(e && e.message || e) }; }
}
function within(node, el) {
  for (let n = node; n; n = n.parentNode || n.host) if (n === el) return true;
  return false;
}`;

/**
 * Scrolls the element into view and picks the center of its first box part
 * inside the viewport; returns it only if a deep hit test lands on the element.
 */
const RESOLVE_POINT = `(selector) => {
  ${FIND_ELEMENT}
  const found = find(selector);
  if (found.error) return { status: 'invalid-selector', message: found.error };
  const el = found.el;
  if (!el) return { status: 'not-found' };
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  if (getComputedStyle(el).visibility === 'hidden') return { status: 'not-visible' };
  let point;
  for (const r of el.getClientRects()) {
    const left = Math.max(r.left, 0), right = Math.min(r.right, innerWidth);
    const top = Math.max(r.top, 0), bottom = Math.min(r.bottom, innerHeight);
    if (right - left >= 1 && bottom - top >= 1) { point = { x: (left + right) / 2, y: (top + bottom) / 2 }; break; }
  }
  if (!point) return { status: 'not-visible' };
  let hit = document.elementFromPoint(point.x, point.y);
  while (hit && hit.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(point.x, point.y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  if (!hit) return { status: 'not-visible' };
  if (within(hit, el)) return { status: 'ok', x: point.x, y: point.y };
  const name = hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '') +
    (typeof hit.className === 'string' && hit.className.trim() ? '.' + hit.className.trim().split(/\\s+/).join('.') : '');
  return { status: 'obscured', x: point.x, y: point.y, hit: name };
}`;

const FOCUS_ELEMENT = `(selector) => {
  ${FIND_ELEMENT}
  const found = find(selector);
  if (found.error) return { status: 'invalid-selector', message: found.error };
  const el = found.el;
  if (!el) return { status: 'not-found' };
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  el.focus();
  let active = document.activeElement;
  while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
  return within(active, el) ? { status: 'ok' } : { status: 'not-focusable' };
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
  if (!el.multiple && picks.length > 1) return { status: 'option-not-found', message: 'is not a multiple select' };
  const disabled = (o) => o.disabled || (o.parentElement instanceof HTMLOptGroupElement && o.parentElement.disabled);
  if (el.matches(':disabled') || picks.some(disabled)) return { status: 'disabled' };
  el.focus();
  for (const o of options) o.selected = picks.includes(o);
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { status: 'ok', selected: picks.map((o) => o.value) };
}`;

function failForStatus(page: PageStatus, selector: string): never {
  switch (page.status) {
    case 'invalid-selector':
      throw new InputActionError(
        // i18n-ignore (agent-facing protocol error, not user-facing)
        `Invalid selector "${selector}": ${page.message}`,
        'invalid-selector',
      );
    case 'not-visible':
      throw new InputActionError(
        // i18n-ignore (agent-facing protocol error, not user-facing)
        `"${selector}" has no visible box (zero size or visibility: hidden).`,
        'element-not-visible',
      );
    case 'obscured':
      throw new InputActionError(
        // i18n-ignore (agent-facing protocol error, not user-facing)
        `"${selector}" is covered by ${page.hit} at (${Math.round(page.x ?? 0)}, ${Math.round(page.y ?? 0)}). Dismiss the covering element first; clicking by x/y would hit it too.`,
        'element-obscured',
      );
    case 'disabled':
      throw new InputActionError(
        // i18n-ignore (agent-facing protocol error, not user-facing)
        `"${selector}" or the requested option is disabled.`,
        'element-disabled',
      );
    case 'not-focusable':
      // i18n-ignore (agent-facing protocol error, not user-facing)
      throw new InputActionError(`"${selector}" cannot take focus.`, 'not-focusable');
    case 'not-a-select':
      throw new InputActionError(
        // i18n-ignore (agent-facing protocol error, not user-facing)
        `"${selector}" is a <${page.message}>, not a <select>. Click custom dropdowns with click instead.`,
        'not-a-select',
      );
    case 'option-not-found': {
      const wanted = page.missing?.map((m) => JSON.stringify(m)).join(', ');
      // i18n-ignore (agent-facing protocol error, not user-facing)
      const detail = wanted ? `has no option with the value or label ${wanted}` : page.message;
      // i18n-ignore (agent-facing protocol error, not user-facing)
      throw new InputActionError(`"${selector}" ${detail}.`, 'option-not-found');
    }
    default:
      throw new InputActionError(
        // i18n-ignore (agent-facing protocol error, not user-facing)
        `No element matches "${selector}" in the page or its open shadow roots (iframes are not searched).`,
        'element-not-found',
      );
  }
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
 * `scale` is the tab's scale-to-fit factor: mouse events are hit-tested on
 * the scaled drawing, so CSS-pixel points are multiplied by it.
 */
export async function runInputAction(
  send: CdpSend,
  action: InputAction,
  platform: string = process.platform,
  scale = 1,
): Promise<unknown> {
  if (action.action === 'press') keyDefinition(action.key);
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });

  switch (action.action) {
    case 'click':
    case 'hover': {
      const point = await resolvePoint(send, action);
      const x = point.x * scale;
      const y = point.y * scale;
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
      if (action.action === 'click') {
        const button = action.button ?? 'left';
        for (let clickCount = 1; clickCount <= (action.clickCount ?? 1); clickCount++) {
          const release = {
            type: 'mouseReleased',
            x,
            y,
            button,
            buttons: 0,
            clickCount,
          };
          try {
            await send('Input.dispatchMouseEvent', {
              type: 'mousePressed',
              x,
              y,
              button,
              buttons: BUTTON_BITS[button],
              clickCount,
            });
            await send('Input.dispatchMouseEvent', release);
          } catch (error) {
            // Never leave the page with a button held down (e.g. the request
            // deadline ran out between press and release).
            await send('Input.dispatchMouseEvent', release).catch(() => undefined);
            throw error;
          }
        }
      }
      return point;
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
      const text = action.text.replace(/\r\n?/g, '\n');
      const chars = Array.from(text);
      if (action.mode === 'insert') {
        await send('Input.insertText', { text });
      } else {
        for (const [typed, char] of chars.entries()) {
          try {
            await pressKey(
              send,
              char === '\n' ? 'Enter' : char === '\t' ? 'Tab' : char,
              [],
              platform,
            );
          } catch (error) {
            throw Object.assign(
              new Error(
                // i18n-ignore (agent-facing protocol error, not user-facing)
                `Typing stopped after ${typed} of ${chars.length} characters: ${error instanceof Error ? error.message : String(error)}`,
              ),
              { errorCode: (error as { errorCode?: unknown }).errorCode },
            );
          }
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
