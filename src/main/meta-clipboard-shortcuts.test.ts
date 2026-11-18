import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { on: vi.fn() } }));

import { metaClipboardAction } from './meta-clipboard-shortcuts';

const key = (
  k: string,
  mods: Partial<Record<'meta' | 'control' | 'alt' | 'shift', boolean>> = {},
) => ({
  type: 'keyDown',
  key: k,
  meta: false,
  control: false,
  alt: false,
  shift: false,
  isAutoRepeat: false,
  ...mods,
});

describe('metaClipboardAction', () => {
  it('maps Super+C/X/V to copy, cut and paste', () => {
    expect(metaClipboardAction(key('c', { meta: true }))).toBe('copy');
    expect(metaClipboardAction(key('X', { meta: true }))).toBe('cut');
    expect(metaClipboardAction(key('v', { meta: true }))).toBe('paste');
  });

  it('leaves Ctrl, other keys, extra modifiers and key-up alone', () => {
    expect(metaClipboardAction(key('c', { control: true }))).toBeUndefined();
    expect(metaClipboardAction(key('a', { meta: true }))).toBeUndefined();
    expect(metaClipboardAction(key('c', { meta: true, shift: true }))).toBeUndefined();
    expect(metaClipboardAction(key('v', { meta: true, control: true }))).toBeUndefined();
    expect(metaClipboardAction({ ...key('c', { meta: true }), type: 'keyUp' })).toBeUndefined();
  });
});
