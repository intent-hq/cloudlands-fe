/**
 * KeyboardShortcutsCheatSheet.svelte Escape handling via the escape-layer
 * stack. Migrated from a `svelte:window` Escape listener; the sheet renders
 * from the real `shortcutsCheatSheet` slice so Escape dispatching
 * `closeCheatSheet()` actually hides it.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterEach,
} from 'vitest';
import {
  render,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/svelte';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

vi.mock('svelte-fa', async () => {
  const MockFa = (
    await import('../../ui/__tests__/mocks/Fa.svelte')
  ).default;
  return { default: MockFa, Fa: MockFa };
});

import { store as appStore } from '$store/renderer/store';
import {
  openCheatSheet,
  closeCheatSheet,
} from '$store/renderer/slices/shortcuts-cheatsheet/shortcuts-cheatsheet-slice';
import KeyboardShortcutsCheatSheet from '../KeyboardShortcutsCheatSheet.svelte';

describe('KeyboardShortcutsCheatSheet Escape handling (escape-layer stack)', () => {
  beforeAll(() => {
    appStore.init();
  });

  afterEach(() => {
    cleanup();
    appStore.dispatch(closeCheatSheet());
  });

  it('Escape closes the open cheat sheet', async () => {
    const { container } = render(KeyboardShortcutsCheatSheet);
    appStore.dispatch(openCheatSheet('global'));
    await waitFor(() => {
      expect(container.querySelector('.cheat-sheet')).toBeTruthy();
    });

    await fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(container.querySelector('.cheat-sheet')).toBeFalsy();
    });
    expect(appStore.state.shortcutsCheatSheet.isOpen).toBe(false);
  });

  it('Escape is not consumed while the sheet is closed (no layer registered)', async () => {
    const { container } = render(KeyboardShortcutsCheatSheet);
    expect(container.querySelector('.cheat-sheet')).toBeFalsy();

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
