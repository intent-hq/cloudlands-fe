/**
 * Transcript-specific composer insertion and send triggering for the voice
 * dictation flow. Builds on the prompt-picker's focused-editable seam but
 * with dictation semantics: the transcript NEVER replaces existing text —
 * a non-collapsed selection is collapsed to its end before inserting.
 * Joining with surrounding draft text:
 * - empty composer → inserted as-is;
 * - caret mid-text → joined with single spaces on the sides that need one;
 * - appending after existing text (caret at end) → joined with a newline so
 *   dictation starts on its own line below the draft.
 *
 * `sendFocusedComposer` triggers the composer's send via a synthetic Enter
 * keydown on the focused editable — the same code path as pressing Enter
 * (the chat composer's TipTap keydown handler routes it to submit).
 *
 * Pure DOM module — no store, no services.
 */

import { insertPromptText, resolveFocusedEditable } from '../prompt-picker/insertion';

/** Text before/after the caret in the focused editable. */
interface CaretSurroundings {
  before: string;
  after: string;
}

/**
 * Join the transcript with the surrounding draft text: no padding into an
 * empty composer, single-space joins mid-text, a newline when appending
 * after existing text (only when one isn't already there).
 */
export function padTranscriptForInsertion(text: string, before: string, after: string): string {
  const hasBefore = before.trim().length > 0;
  const hasAfter = after.trim().length > 0;
  let prefix = '';
  if (hasBefore) {
    if (!hasAfter) prefix = /\n\s*$/.test(before) ? '' : '\n';
    else prefix = /\s$/.test(before) ? '' : ' ';
  }
  const suffix = hasAfter && !/^\s/.test(after) ? ' ' : '';
  return prefix + text + suffix;
}

function textFieldSurroundings(element: HTMLInputElement | HTMLTextAreaElement): CaretSurroundings {
  // Collapse any selection to its end so the insertion never replaces text.
  const caret = element.selectionEnd ?? element.value.length;
  element.setSelectionRange(caret, caret);
  return { before: element.value.slice(0, caret), after: element.value.slice(caret) };
}

function contentEditableSurroundings(element: HTMLElement, doc: Document): CaretSurroundings {
  const full = element.textContent ?? '';
  const selection = doc.defaultView?.getSelection?.() ?? null;
  if (!selection || selection.rangeCount === 0 || !element.contains(selection.anchorNode)) {
    // Caret position unknown → the insertion will append; treat as at-end.
    return { before: full, after: '' };
  }
  // Collapse any selection to its end so the insertion never replaces text.
  selection.collapseToEnd();
  const range = selection.getRangeAt(0);
  const preceding = range.cloneRange();
  preceding.selectNodeContents(element);
  preceding.setEnd(range.endContainer, range.endOffset);
  const before = preceding.toString();
  return { before, after: full.slice(before.length) };
}

/**
 * Insert a transcript at the caret of the focused editable with dictation
 * join semantics (see module doc). Returns true when an insertion happened,
 * false when nothing editable had focus. Never replaces existing text and
 * never submits.
 */
export function insertTranscriptText(text: string, doc: Document = document): boolean {
  const target = resolveFocusedEditable(doc);
  if (!target) return false;
  const surroundings =
    target.kind === 'text-field'
      ? textFieldSurroundings(target.element)
      : contentEditableSurroundings(target.element, doc);
  return insertPromptText(
    padTranscriptForInsertion(text, surroundings.before, surroundings.after),
    doc,
  );
}

/**
 * Trigger the focused composer's send by dispatching a synthetic Enter
 * keydown on the focused editable — the same path as pressing Enter.
 * Returns true when a focused editable received the event, false otherwise
 * (whether anything was actually sent is up to the composer's own guards,
 * e.g. an empty composer ignores Enter).
 */
export function sendFocusedComposer(doc: Document = document): boolean {
  const target = resolveFocusedEditable(doc);
  if (!target) return false;
  const KeyboardEventCtor = doc.defaultView?.KeyboardEvent ?? KeyboardEvent;
  target.element.dispatchEvent(
    new KeyboardEventCtor('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    }),
  );
  return true;
}
