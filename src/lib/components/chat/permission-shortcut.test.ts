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
});
