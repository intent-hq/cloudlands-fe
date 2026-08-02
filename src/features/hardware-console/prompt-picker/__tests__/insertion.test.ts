// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { insertPromptText, resolveFocusedEditable } from '../insertion';

beforeEach(() => {
  document.body.innerHTML = '';
});

function mountTextarea(value = '', cursor = value.length): HTMLTextAreaElement {
  const textarea = document.createElement('textarea');
  textarea.value = value;
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.setSelectionRange(cursor, cursor);
  return textarea;
}

describe('resolveFocusedEditable', () => {
  it('returns null when nothing editable has focus', () => {
    expect(resolveFocusedEditable(document)).toBeNull();
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    expect(resolveFocusedEditable(document)).toBeNull();
  });

  it('resolves focused textareas and text-like inputs', () => {
    const textarea = mountTextarea();
    expect(resolveFocusedEditable(document)).toEqual({ kind: 'text-field', element: textarea });

    const input = document.createElement('input');
    input.type = 'search';
    document.body.appendChild(input);
    input.focus();
    expect(resolveFocusedEditable(document)).toEqual({ kind: 'text-field', element: input });
  });

  it('rejects non-text inputs and readonly/disabled fields', () => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    document.body.appendChild(checkbox);
    checkbox.focus();
    expect(resolveFocusedEditable(document)).toBeNull();

    const readonly = document.createElement('textarea');
    readonly.readOnly = true;
    document.body.appendChild(readonly);
    readonly.focus();
    expect(resolveFocusedEditable(document)).toBeNull();
  });

  it('resolves the contenteditable host from a focused descendant', () => {
    const host = document.createElement('div');
    host.setAttribute('contenteditable', 'true');
    const inner = document.createElement('span');
    inner.tabIndex = 0;
    host.appendChild(inner);
    document.body.appendChild(host);
    inner.focus();
    expect(resolveFocusedEditable(document)).toEqual({ kind: 'content-editable', element: host });
  });

  it('ignores contenteditable="false" hosts', () => {
    const host = document.createElement('div');
    host.setAttribute('contenteditable', 'false');
    host.tabIndex = 0;
    document.body.appendChild(host);
    host.focus();
    expect(resolveFocusedEditable(document)).toBeNull();
  });
});

describe('insertPromptText', () => {
  it('inserts at the cursor of a focused textarea and fires input', () => {
    const textarea = mountTextarea('before after', 'before '.length);
    const onInput = vi.fn();
    textarea.addEventListener('input', onInput);

    expect(insertPromptText('X', document)).toBe(true);
    expect(textarea.value).toBe('before Xafter');
    expect(textarea.selectionStart).toBe('before X'.length);
    expect(onInput).toHaveBeenCalledTimes(1);
  });

  it('replaces the selected range', () => {
    const textarea = mountTextarea('delete THIS now');
    textarea.setSelectionRange('delete '.length, 'delete THIS'.length);

    expect(insertPromptText('that', document)).toBe(true);
    expect(textarea.value).toBe('delete that now');
  });

  it('inserts at the caret of a focused contenteditable host without execCommand', () => {
    const host = document.createElement('div');
    host.setAttribute('contenteditable', 'true');
    host.tabIndex = 0;
    host.textContent = 'hello ';
    document.body.appendChild(host);
    host.focus();
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(host);
    range.collapse(false); // caret at end
    selection.removeAllRanges();
    selection.addRange(range);
    const onInput = vi.fn();
    host.addEventListener('input', onInput);

    expect(insertPromptText('world', document)).toBe(true);
    expect(host.textContent).toBe('hello world');
    expect(onInput).toHaveBeenCalledTimes(1);
  });

  it('returns false and inserts nothing when focus is elsewhere', () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'untouched';
    document.body.appendChild(textarea);

    expect(insertPromptText('X', document)).toBe(false);
    expect(textarea.value).toBe('untouched');
  });
});
