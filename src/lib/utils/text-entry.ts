/**
 * Shared "is the user typing here?" checks for window/document keyboard handlers.
 *
 * Monaco 0.57 types through the browser EditContext API in Chromium/Electron: its
 * focus target is a plain `<div role="textbox" aria-multiline="true">`, not a
 * textarea and not contentEditable. Checks that only recognize native controls
 * and contenteditable therefore treat a focused code editor as "not typing" and
 * steal its keys (intent-hq/intent#8068).
 */

/**
 * Native form controls own their keys (typing, arrow/space on selects and ranges),
 * so every input type counts — matching the handlers this helper replaced.
 */
const NATIVE_FORM_CONTROL = 'input, textarea, select';

/**
 * True when the element owns an attached EditContext. Chromium exposes
 * `editContext === null` on every ordinary element, so presence of the property
 * alone is not a signal.
 */
function hasAttachedEditContext(element: Element): boolean {
  return 'editContext' in element && (element as { editContext?: unknown }).editContext != null;
}

/** Live editability, plus the reflected property for DOMs that do not compute it (jsdom). */
function isContentEditableElement(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return (
    element.isContentEditable === true ||
    element.contentEditable === 'true' ||
    element.contentEditable === 'plaintext-only'
  );
}

function asElement(target: EventTarget | Element | null | undefined): Element | null {
  if (!target || typeof Element === 'undefined' || !(target instanceof Element)) return null;
  return target;
}

/**
 * True when keystrokes on `target` are text entry that page-level shortcuts must
 * not intercept: native form controls, contenteditable regions, EditContext owners
 * (Monaco), and ARIA textboxes, including their descendants. Read-only textboxes
 * count too — focus is still in an editor with caret navigation.
 */
export function isTextEntryTarget(target: EventTarget | Element | null | undefined): boolean {
  const element = asElement(target);
  if (!element) return false;
  if (isContentEditableElement(element)) return true;
  if (hasAttachedEditContext(element)) return true;
  if (element.closest(NATIVE_FORM_CONTROL)) return true;
  // A contenteditable="false" island (e.g. a TipTap node-view toolbar) is a
  // boundary: editors outside it — including a role="textbox" editor root —
  // do not make its controls text entry. Textboxes inside the island still count.
  const island = element.closest('[contenteditable="false"]');
  const textbox = element.closest('[role="textbox"]');
  if (textbox && (!island || island.contains(textbox))) return true;
  const editableHost = element.closest('[contenteditable]');
  return editableHost !== null && editableHost.getAttribute('contenteditable') !== 'false';
}

/**
 * True when Enter on `target` should insert a new line rather than act as a
 * default action: textareas, contenteditable regions, EditContext owners, and
 * editable multi-line ARIA textboxes.
 */
export function isMultilineTextEntryTarget(
  target: EventTarget | Element | null | undefined,
): boolean {
  const element = asElement(target);
  if (!element) return false;
  return (
    element instanceof HTMLTextAreaElement ||
    isContentEditableElement(element) ||
    hasAttachedEditContext(element) ||
    (element.getAttribute('role') === 'textbox' &&
      element.getAttribute('aria-multiline') === 'true' &&
      element.getAttribute('aria-readonly') !== 'true')
  );
}
