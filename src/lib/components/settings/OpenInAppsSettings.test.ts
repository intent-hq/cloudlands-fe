/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchEditors,
  toggleHiddenEditor,
  type InstalledEditor,
} from '$store/renderer/slices/external-editors/external-editors-slice';

const mocks = vi.hoisted(() => {
  const writable = <T>(initial: T) => {
    let value = initial;
    const subscribers = new Set<(next: T) => void>();
    return {
      get: () => value,
      set(next: T) {
        value = next;
        for (const subscriber of subscribers) subscriber(next);
      },
      subscribe(subscriber: (next: T) => void) {
        subscribers.add(subscriber);
        subscriber(value);
        return () => subscribers.delete(subscriber);
      },
    };
  };
  return {
    editors$: writable<InstalledEditor[]>([]),
    hiddenIds$: writable<string[]>([]),
    dispatched: [] as unknown[],
  };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: (action: { type: string; payload: unknown[] }) => {
      mocks.dispatched.push(action);
      if (action.type === 'externalEditors/toggleHiddenEditor') {
        const id = action.payload[0] as string;
        const hiddenIds = mocks.hiddenIds$.get();
        mocks.hiddenIds$.set(
          hiddenIds.includes(id)
            ? hiddenIds.filter((hiddenId) => hiddenId !== id)
            : [...hiddenIds, id],
        );
      }
    },
  });
});

vi.mock('$store/renderer/slices/external-editors/external-editors-selectors', () => ({
  selectInstalledEditors: () => mocks.editors$,
  selectHiddenEditorIds: () => mocks.hiddenIds$,
}));

import OpenInAppsSettings from './OpenInAppsSettings.svelte';

const LONG_EDITOR_NAME =
  'Visual Studio Code Insiders With A Very Long Extension Profile Display Name';

function editor(overrides: Partial<InstalledEditor> = {}): InstalledEditor {
  return {
    id: 'vscode',
    name: LONG_EDITOR_NAME,
    shortLabel: 'VS Code',
    appName: 'Visual Studio Code',
    category: 'ide',
    handlerType: 'vscode',
    priority: 100,
    installed: true,
    ...overrides,
  };
}

function renderApps() {
  return render(OpenInAppsSettings);
}

beforeEach(() => {
  mocks.editors$.set([]);
  mocks.hiddenIds$.set([]);
  mocks.dispatched.length = 0;
});

afterEach(() => {
  cleanup();
});

describe('OpenInAppsSettings', () => {
  it('fetches on mount and excludes apps that are not installed', () => {
    mocks.editors$.set([editor({ id: 'missing', installed: false })]);

    renderApps();

    expect(screen.queryByRole('button')).toBeNull();
    expect(mocks.dispatched).toContainEqual(fetchEditors());
  });

  it('keeps installed-only filtering, selected state, and the exact toggle action', async () => {
    const visible = editor({ iconBase64: 'cG5n' });
    mocks.editors$.set([visible, editor({ id: 'not-installed', installed: false })]);
    mocks.hiddenIds$.set([visible.id]);

    renderApps();
    const toggle = screen.getByRole('button', { name: LONG_EDITOR_NAME });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.textContent?.trim()).toBe('');
    expect(screen.getByText(LONG_EDITOR_NAME).id).toBe(`open-in-${visible.id}-label`);

    await fireEvent.click(toggle);

    expect(mocks.dispatched).toContainEqual(fetchEditors());
    expect(
      mocks.dispatched.filter(
        (action) => (action as { type: string }).type === toggleHiddenEditor.type,
      ),
    ).toEqual([toggleHiddenEditor(visible.id)]);
    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('true'));
  });
});
