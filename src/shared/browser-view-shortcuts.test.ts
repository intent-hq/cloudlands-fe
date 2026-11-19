import { describe, expect, it } from 'vitest';
import { classifyBrowserViewShortcut, type BrowserViewKeyInput } from './browser-view-shortcuts';

const key = (input: Partial<BrowserViewKeyInput>): BrowserViewKeyInput => ({
  type: 'keyDown',
  key: '',
  shift: false,
  control: false,
  alt: false,
  meta: false,
  ...input,
});

const action = (input: Partial<BrowserViewKeyInput>, isMac = true) =>
  classifyBrowserViewShortcut(key(input), isMac)?.action ?? null;

describe('classifyBrowserViewShortcut', () => {
  it('matches the shortcuts the <webview> key script forwards', () => {
    expect(action({ key: 'w', meta: true })).toBe('close-tab');
    expect(action({ key: 'W', control: true }, false)).toBe('close-tab');
    expect(action({ key: 'F5' })).toBe('refresh');
    expect(action({ key: 'r', meta: true })).toBe('refresh');
    expect(action({ key: 'l', meta: true })).toBe('focus-url');
    expect(action({ key: 'C', meta: true, shift: true })).toBe('copy-url');
    expect(action({ key: 'i', meta: true, alt: true })).toBe('devtools');
    expect(action({ key: 'I', control: true, shift: true }, false)).toBe('devtools');
    expect(action({ key: ']', meta: true })).toBe('forward');
    expect(action({ key: '{', meta: true, shift: true })).toBe('forward');
  });

  it('leaves the page its own keys', () => {
    expect(action({ key: 'a', meta: true })).toBeNull();
    expect(action({ key: 'l', meta: true, shift: true })).toBeNull();
    expect(action({ key: 'c', meta: true })).toBeNull();
    expect(action({ key: 'ArrowLeft', alt: true })).toBeNull();
    expect(action({ key: 'w', meta: true, type: 'keyUp' })).toBeNull();
  });

  it('reads the physical key when Option changes the character on macOS', () => {
    expect(action({ key: 'ˆ', code: 'KeyI', meta: true, alt: true })).toBe('devtools');
  });

  it('forwards column focus with the platform modifier only', () => {
    expect(action({ key: 'ArrowLeft', meta: true, alt: true }, true)).toBe('forward');
    expect(action({ key: 'ArrowLeft', control: true, alt: true }, true)).toBeNull();
    expect(action({ key: 'ArrowRight', control: true, alt: true }, false)).toBe('forward');
    expect(action({ key: 'ArrowRight', meta: true, alt: true }, false)).toBeNull();
  });

  it('keeps the modifier state for the renderer keydown', () => {
    expect(classifyBrowserViewShortcut(key({ key: ']', meta: true, shift: true }), true)).toEqual({
      action: 'forward',
      key: ']',
      shiftKey: true,
      metaKey: true,
      ctrlKey: false,
      altKey: false,
    });
  });
});
