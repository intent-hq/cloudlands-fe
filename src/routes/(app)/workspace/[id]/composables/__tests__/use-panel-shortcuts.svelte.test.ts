/**
 * Tests for usePanelShortcuts global shortcut boundaries.
 */

import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { flushSync } from 'svelte';

import { usePanelShortcuts } from '../use-panel-shortcuts.svelte';
import { store as appStore } from '$store/renderer/store';
import {
  resetShortcutOverride,
  setShortcutOverride,
} from '$store/renderer/slices/user-preferences/user-preferences-slice';

describe('usePanelShortcuts shortcut boundaries', () => {
  let cleanup: () => void;

  beforeAll(() => appStore.init());

  beforeEach(() => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    });

    cleanup = $effect.root(() => {
      usePanelShortcuts({});
    });
    flushSync();
  });

  afterEach(() => {
    cleanup?.();
    appStore.dispatch(resetShortcutOverride('panel.maximize'));
  });

  it('replaces the maximize binding instead of retaining Mod+Shift+M', () => {
    cleanup();
    const onMaximizePanel = vi.fn();
    appStore.dispatch(setShortcutOverride('panel.maximize', 'alt+m'));
    cleanup = $effect.root(() => usePanelShortcuts({ onMaximizePanel }));
    flushSync();

    const oldBinding = new KeyboardEvent('keydown', {
      key: 'M',
      metaKey: true,
      shiftKey: true,
      cancelable: true,
    });
    window.dispatchEvent(oldBinding);
    const newBinding = new KeyboardEvent('keydown', {
      key: 'm',
      altKey: true,
      cancelable: true,
    });
    window.dispatchEvent(newBinding);

    expect(oldBinding.defaultPrevented).toBe(false);
    expect(newBinding.defaultPrevented).toBe(true);
    expect(onMaximizePanel).toHaveBeenCalledOnce();
  });

  it('leaves Cmd+B available for the global workspace shortcut router', () => {
    const event = new KeyboardEvent('keydown', { key: 'b', metaKey: true, cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves Mod+1-9 available for global workspace-tab navigation', () => {
    const event = new KeyboardEvent('keydown', { key: '1', metaKey: true, cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it.each(['[', ']'])('leaves Cmd+%s available to browser history', (key) => {
    const event = new KeyboardEvent('keydown', { key, metaKey: true, cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
