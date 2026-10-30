import { describe, expect, it } from 'vitest';
import { shouldHandlePermissionShortcut } from './permission-shortcut';

function keydown(target: Element, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: '1',
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe('shouldHandlePermissionShortcut', () => {
  it('requires the owning chat to be active and focused', () => {
    expect(shouldHandlePermissionShortcut(keydown(document.body), false)).toBe(false);
    expect(shouldHandlePermissionShortcut(keydown(document.body), true)).toBe(true);
  });

  it.each(['input', 'textarea', 'select'])('ignores shortcuts from editable %s elements', (tag) => {
    const element = document.createElement(tag);
    document.body.append(element);
    expect(shouldHandlePermissionShortcut(keydown(element), true)).toBe(false);
    element.remove();
  });

  it('ignores contenteditable targets, handled events, and modifier chords', () => {
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    document.body.append(editable);
    expect(shouldHandlePermissionShortcut(keydown(editable), true)).toBe(false);
    editable.remove();

    const handled = keydown(document.body);
    handled.preventDefault();
    expect(shouldHandlePermissionShortcut(handled, true)).toBe(false);
    expect(shouldHandlePermissionShortcut(keydown(document.body, { metaKey: true }), true)).toBe(
      false,
    );
  });

  it('ignores shortcuts typed into a Monaco code editor (EditContext textbox)', () => {
    const monaco = document.createElement('div');
    monaco.setAttribute('role', 'textbox');
    monaco.setAttribute('aria-multiline', 'true');
    Object.defineProperty(monaco, 'editContext', { value: {}, configurable: true });
    document.body.append(monaco);
    expect(shouldHandlePermissionShortcut(keydown(monaco), true)).toBe(false);
    monaco.remove();
  });

  it('still handles shortcuts from elements whose editContext is the null default', () => {
    const plain = document.createElement('div');
    Object.defineProperty(plain, 'editContext', { value: null, configurable: true });
    document.body.append(plain);
    expect(shouldHandlePermissionShortcut(keydown(plain), true)).toBe(true);
    plain.remove();
  });
});
