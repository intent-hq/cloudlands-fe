// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextSelection } from '@tiptap/pm/state';
import {
  AUTOCOMPLETE_GHOST_ACCEPTED,
  AutocompleteGhostExtension,
  getAutocompleteGhost,
  setAutocompleteGhost,
} from './autocomplete-ghost-extension';
import { consumeGhost } from '$features/autocomplete/utils/ghost-consumption';

let editor: Editor | null = null;
let element: HTMLDivElement;

afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.innerHTML = '';
});

function mount(content = '<p>Show me the</p>'): Editor {
  element = document.createElement('div');
  document.body.append(element);
  editor = new Editor({
    element,
    content,
    extensions: [StarterKit, AutocompleteGhostExtension],
  });
  editor.commands.focus('end');
  return editor;
}

function type(current: Editor, text: string) {
  current.view.dispatch(current.state.tr.insertText(text));
}

function press(current: Editor, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  current.view.dom.dispatchEvent(event);
  return event;
}

function ghostElement() {
  return element.querySelector<HTMLElement>('[data-testid="composer-autocomplete-ghost"]');
}

describe('consumeGhost', () => {
  it('keeps the ghost when the text did not change', () => {
    expect(consumeGhost(' diff', 'abc', 'abc')).toBe(' diff');
  });

  it('consumes matching typed characters, case-insensitively', () => {
    expect(consumeGhost(' Diff now', 'Show me the', 'Show me the d')).toBe('iff now');
    expect(consumeGhost(' diff', 'Show me the', 'Show me the di')).toBe('ff');
  });

  it('clears on a mismatch, a non-append edit, or when fully typed', () => {
    expect(consumeGhost(' diff', 'Show me the', 'Show me the x')).toBeNull();
    expect(consumeGhost(' diff', 'Show me the', 'Show me th')).toBeNull();
    expect(consumeGhost(' diff', 'Show me the', 'Show me the diff')).toBeNull();
  });
});

describe('AutocompleteGhostExtension', () => {
  it('draws the ghost after the caret without changing the document', () => {
    const current = mount();
    setAutocompleteGhost(current.view, ' diff.');
    expect(ghostElement()?.textContent).toBe(' diff.Tab');
    expect(ghostElement()?.getAttribute('aria-hidden')).toBe('true');
    expect(current.getText()).toBe('Show me the');
  });

  it('refuses to show a ghost when the caret is not at the end', () => {
    const current = mount();
    current.view.dispatch(
      current.state.tr.setSelection(TextSelection.create(current.state.doc, 2)),
    );
    setAutocompleteGhost(current.view, ' diff.');
    expect(getAutocompleteGhost(current.state)).toBeNull();
  });

  it('Tab accepts: inserts the ghost and clears it', () => {
    const current = mount();
    setAutocompleteGhost(current.view, ' diff.');
    let accepted = false;
    current.on('transaction', ({ transaction }) => {
      if (transaction.getMeta(AUTOCOMPLETE_GHOST_ACCEPTED)) accepted = true;
    });
    const event = press(current, 'Tab');
    expect(event.defaultPrevented).toBe(true);
    expect(current.getText()).toBe('Show me the diff.');
    expect(getAutocompleteGhost(current.state)).toBeNull();
    expect(ghostElement()).toBeNull();
    expect(accepted).toBe(true);
  });

  it('Tab without a ghost is left to the browser', () => {
    const current = mount();
    const event = press(current, 'Tab');
    expect(event.defaultPrevented).toBe(false);
    expect(current.getText()).toBe('Show me the');
  });

  it('modified Tab does not accept', () => {
    const current = mount();
    setAutocompleteGhost(current.view, ' diff.');
    press(current, 'Tab', { shiftKey: true });
    expect(current.getText()).toBe('Show me the');
    expect(getAutocompleteGhost(current.state)).toBe(' diff.');
  });

  it('Esc dismisses without editing', () => {
    const current = mount();
    setAutocompleteGhost(current.view, ' diff.');
    const event = press(current, 'Escape');
    expect(event.defaultPrevented).toBe(true);
    expect(getAutocompleteGhost(current.state)).toBeNull();
    expect(current.getText()).toBe('Show me the');
  });

  it('typing matching characters consumes the ghost', () => {
    const current = mount();
    setAutocompleteGhost(current.view, ' diff.');
    type(current, ' d');
    expect(getAutocompleteGhost(current.state)).toBe('iff.');
    expect(ghostElement()?.textContent).toBe('iff.Tab');
  });

  it('any other edit clears the ghost', () => {
    const current = mount();
    setAutocompleteGhost(current.view, ' diff.');
    type(current, 'x');
    expect(getAutocompleteGhost(current.state)).toBeNull();
  });

  it('moving the caret away from the end clears the ghost', () => {
    const current = mount();
    setAutocompleteGhost(current.view, ' diff.');
    current.view.dispatch(
      current.state.tr.setSelection(TextSelection.create(current.state.doc, 2)),
    );
    expect(getAutocompleteGhost(current.state)).toBeNull();
  });

  it('a programmatic content update clears the ghost', () => {
    const current = mount();
    setAutocompleteGhost(current.view, ' diff.');
    current.view.dispatch(
      current.state.tr.insertText(' d').setMeta('external-update', true),
    );
    expect(getAutocompleteGhost(current.state)).toBeNull();
  });
});
