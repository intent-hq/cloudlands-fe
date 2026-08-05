/**
 * Tests for the dictation insertion semantics: never replace existing text,
 * caret-position-aware joins (empty composer as-is, mid-text single-space,
 * append-after-text newline), and the synthetic-Enter send trigger.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  insertTranscriptText,
  isFocusInsideDialog,
  padTranscriptForInsertion,
  sendFocusedComposer,
} from '../transcript-insertion';

function focusTextarea(value = '', caret = value.length): HTMLTextAreaElement {
  const textarea = document.createElement('textarea');
  textarea.value = value;
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.setSelectionRange(caret, caret);
  return textarea;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('padTranscriptForInsertion', () => {
  it('inserts as-is into an empty composer', () => {
    expect(padTranscriptForInsertion('Hello world', '', '')).toBe('Hello world');
    expect(padTranscriptForInsertion('Hello world', '  ', ' ')).toBe('Hello world');
  });

  it('joins with single spaces at a mid-text caret', () => {
    expect(padTranscriptForInsertion('new words', 'left', 'right')).toBe(' new words ');
    // Existing whitespace on a side means no extra padding there.
    expect(padTranscriptForInsertion('new words', 'left ', ' right')).toBe('new words');
  });

  it('joins with a newline when appending after existing text', () => {
    expect(padTranscriptForInsertion('dictated line', 'existing draft', '')).toBe(
      '\ndictated line',
    );
    // A trailing newline in the draft is not duplicated.
    expect(padTranscriptForInsertion('dictated line', 'existing draft\n', '')).toBe(
      'dictated line',
    );
  });
});

describe('insertTranscriptText', () => {
  it('returns false when nothing editable has focus', () => {
    expect(insertTranscriptText('hello')).toBe(false);
  });

  it('inserts into an empty focused composer as-is', () => {
    const textarea = focusTextarea();
    expect(insertTranscriptText('Hello world')).toBe(true);
    expect(textarea.value).toBe('Hello world');
  });

  it('joins with single spaces at a mid-text caret', () => {
    const textarea = focusTextarea('fix the bug', 3);
    expect(insertTranscriptText('failing')).toBe(true);
    expect(textarea.value).toBe('fix failing the bug');
  });

  it('appends after existing text on a new line', () => {
    const textarea = focusTextarea('existing draft');
    expect(insertTranscriptText('dictated sentence')).toBe(true);
    expect(textarea.value).toBe('existing draft\ndictated sentence');
  });

  it('never replaces a selection — it collapses to the selection end first', () => {
    const textarea = focusTextarea('keep all of this');
    textarea.setSelectionRange(0, 8);
    expect(insertTranscriptText('added')).toBe(true);
    expect(textarea.value).toBe('keep all added of this');
  });
});

describe('isFocusInsideDialog', () => {
  it('returns false when nothing has focus', () => {
    expect(isFocusInsideDialog()).toBe(false);
  });

  it('returns false when the focused element is outside any dialog', () => {
    focusTextarea();
    expect(isFocusInsideDialog()).toBe(false);
  });

  it('returns true when the focused element sits inside a [role="dialog"]', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const textarea = document.createElement('textarea');
    dialog.appendChild(textarea);
    document.body.appendChild(dialog);
    textarea.focus();
    expect(isFocusInsideDialog()).toBe(true);
  });

  it('returns true when the dialog element itself holds focus', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.tabIndex = -1;
    document.body.appendChild(dialog);
    dialog.focus();
    expect(isFocusInsideDialog()).toBe(true);
  });

  it('returns true when the focused element sits inside a [role="alertdialog"]', () => {
    const alertDialog = document.createElement('div');
    alertDialog.setAttribute('role', 'alertdialog');
    const textarea = document.createElement('textarea');
    alertDialog.appendChild(textarea);
    document.body.appendChild(alertDialog);
    textarea.focus();
    expect(isFocusInsideDialog()).toBe(true);
  });

  it('returns true when the alertdialog element itself holds focus', () => {
    const alertDialog = document.createElement('div');
    alertDialog.setAttribute('role', 'alertdialog');
    alertDialog.tabIndex = -1;
    document.body.appendChild(alertDialog);
    alertDialog.focus();
    expect(isFocusInsideDialog()).toBe(true);
  });
});

describe('sendFocusedComposer', () => {
  it('returns false when nothing editable has focus', () => {
    expect(sendFocusedComposer()).toBe(false);
  });

  it('dispatches a synthetic Enter keydown on the focused editable', () => {
    const textarea = focusTextarea('ready to send');
    const seen: KeyboardEvent[] = [];
    textarea.addEventListener('keydown', (event) => seen.push(event));
    expect(sendFocusedComposer()).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].key).toBe('Enter');
    expect(seen[0].bubbles).toBe(true);
    expect(seen[0].cancelable).toBe(true);
  });
});
