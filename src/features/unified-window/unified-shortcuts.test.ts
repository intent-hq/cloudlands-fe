import { describe, expect, it } from 'vitest';
import { unifiedTabShortcut, type ShortcutInput } from './unified-shortcuts';

const key = (overrides: Partial<ShortcutInput>): ShortcutInput => ({
  type: 'keyDown',
  key: '',
  code: '',
  meta: false,
  control: false,
  shift: false,
  alt: false,
  ...overrides,
});

describe('unifiedTabShortcut', () => {
  it.each([
    [key({ key: 'k', meta: true }), true, { command: 'palette' }],
    [key({ key: 'k', control: true }), false, { command: 'palette' }],
    [key({ key: '1', code: 'Digit1', meta: true }), true, { command: 'select-index', index: 0 }],
    [key({ key: '9', code: 'Digit9', meta: true }), true, { command: 'select-last' }],
    [key({ key: 'Tab', control: true }), true, { command: 'next-tab' }],
    [key({ key: 'Tab', control: true, shift: true }), false, { command: 'previous-tab' }],
    [key({ key: '}', code: 'BracketRight', meta: true, shift: true }), true, { command: 'next-tab' }],
    [key({ key: '{', code: 'BracketLeft', meta: true, shift: true }), true, { command: 'previous-tab' }],
    [key({ key: 'w', meta: true }), true, { command: 'close-tab' }],
    [key({ key: 'T', meta: true, shift: true }), true, { command: 'reopen-tab' }],
  ])('maps %o (mac=%s) to the shell command', (input, mac, expected) => {
    expect(unifiedTabShortcut(input, mac)).toEqual(expected);
  });

  it.each([
    [key({ key: 'k' }), true],
    [key({ key: 'k', control: true }), true],
    [key({ key: 'k', meta: true }), false],
    [key({ key: 'k', meta: true, alt: true }), true],
    [key({ key: 'k', meta: true, type: 'keyUp' }), true],
    [key({ key: 'w', meta: true, shift: true }), true],
    [key({ key: '0', code: 'Digit0', meta: true }), true],
  ])('leaves %o (mac=%s) to the view', (input, mac) => {
    expect(unifiedTabShortcut(input, mac)).toBeNull();
  });
});
