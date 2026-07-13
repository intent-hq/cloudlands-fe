/**
 * Tests for usePanelShortcuts composable — Cmd+B sidebar toggle.
 */

import {
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from 'vitest';
import { flushSync } from 'svelte';

const { dispatchMock } = vi.hoisted(() => ({
  dispatchMock: vi.fn(),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: dispatchMock,
  });
});

import { usePanelShortcuts } from '../use-panel-shortcuts.svelte';
import { toggleSidebar } from '$store/renderer/slices/ui-layout/ui-layout-slice';

describe('usePanelShortcuts — Cmd+B', () => {
  let cleanup: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    dispatchMock.mockReset();

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

  it('dispatches toggleSidebar when Cmd+B is pressed', () => {
    const event = new KeyboardEvent('keydown', { key: 'b', metaKey: true, cancelable: true });
    window.dispatchEvent(event);

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(toggleSidebar());
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores Cmd+Shift+B (modifier guard)', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'b',
      metaKey: true,
      shiftKey: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('ignores plain B (no Cmd)', () => {
    const event = new KeyboardEvent('keydown', { key: 'b', cancelable: true });
    window.dispatchEvent(event);

    expect(dispatchMock).not.toHaveBeenCalled();
  });
});
