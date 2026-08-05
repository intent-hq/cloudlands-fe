/**
 * Focused-element seam for the radial prompt picker: resolve whatever text
 * input currently has focus (composer, note editor, plain form field, …) and
 * insert prompt text at the cursor — never auto-sending.
 *
 * Structural checks only (tag names + attributes, no `instanceof`) so the
 * seam works across realms (jsdom tests, webviews). Pure DOM module — no
 * store, no services.
 */

/** Editable target kinds the seam can insert into. */
export type FocusedEditableTarget =
  | { kind: 'text-field'; element: HTMLInputElement | HTMLTextAreaElement }
  | { kind: 'content-editable'; element: HTMLElement };

/** `<input>` types that accept free text and support selection ranges. */
const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'url', 'tel']);

function asTextField(element: Element): HTMLInputElement | HTMLTextAreaElement | null {
  if (element.tagName === 'TEXTAREA') {
    const textarea = element as HTMLTextAreaElement;
    return textarea.disabled || textarea.readOnly ? null : textarea;
  }
  if (element.tagName === 'INPUT') {
    const input = element as HTMLInputElement;
    if (input.disabled || input.readOnly) return null;
    return TEXT_INPUT_TYPES.has((input.getAttribute('type') ?? '').toLowerCase()) ? input : null;
  }
  return null;
}

function contentEditableHost(element: Element): HTMLElement | null {
  const host = element.closest('[contenteditable]');
  if (!host) return null;
  const value = (host.getAttribute('contenteditable') ?? '').toLowerCase();
  return value === 'false' ? null : (host as HTMLElement);
}

/**
 * Resolve the currently focused editable element, or `null` when focus is
 * elsewhere (insertion is then a no-op — the picker never steals focus).
 */
export function resolveFocusedEditable(doc: Document = document): FocusedEditableTarget | null {
  const active = doc.activeElement;
  if (!active || active === doc.body) return null;
  const field = asTextField(active);
  if (field) return { kind: 'text-field', element: field };
  const editable = contentEditableHost(active);
  return editable ? { kind: 'content-editable', element: editable } : null;
}

function fireInput(element: HTMLElement, text: string, doc: Document): void {
  const InputEventCtor = doc.defaultView?.InputEvent ?? InputEvent;
  element.dispatchEvent(
    new InputEventCtor('input', { bubbles: true, data: text, inputType: 'insertText' }),
  );
}

function insertIntoTextField(
  element: HTMLInputElement | HTMLTextAreaElement,
  text: string,
  doc: Document,
): void {
  const start = element.selectionStart ?? element.value.length;
  const end = element.selectionEnd ?? start;
  element.setRangeText(text, start, end, 'end');
  // Notify framework bindings (Svelte bind:value listens for `input`).
  fireInput(element, text, doc);
}

function insertIntoContentEditable(element: HTMLElement, text: string, doc: Document): void {
  // Preferred: execCommand produces the `beforeinput`/`input` pair rich
  // editors (TipTap/ProseMirror) consume natively. Deprecated but still the
  // only synchronous insertion path Chromium routes through editor stacks.
  if (typeof doc.execCommand === 'function' && doc.execCommand('insertText', false, text)) {
    return;
  }
  // Fallback (no execCommand, e.g. jsdom): splice a text node at the caret.
  const selection = doc.defaultView?.getSelection?.() ?? null;
  const node = doc.createTextNode(text);
  if (selection && selection.rangeCount > 0 && element.contains(selection.anchorNode)) {
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  } else {
    element.appendChild(node);
  }
  fireInput(element, text, doc);
}

/**
 * Insert `text` at the cursor of the focused editable element. Returns true
 * when an insertion happened, false when nothing editable had focus. Never
 * submits — the user reviews and sends manually.
 */
export function insertPromptText(text: string, doc: Document = document): boolean {
  const target = resolveFocusedEditable(doc);
  if (!target) return false;
  if (target.kind === 'text-field') insertIntoTextField(target.element, text, doc);
  else insertIntoContentEditable(target.element, text, doc);
  return true;
}
