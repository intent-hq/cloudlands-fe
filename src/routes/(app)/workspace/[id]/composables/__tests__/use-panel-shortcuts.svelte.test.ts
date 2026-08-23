/**
 * Tests for usePanelShortcuts global shortcut boundaries.
 */

import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';

import { usePanelShortcuts } from '../use-panel-shortcuts.svelte';

describe('usePanelShortcuts shortcut boundaries', () => {
  let cleanup: () => void;

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
