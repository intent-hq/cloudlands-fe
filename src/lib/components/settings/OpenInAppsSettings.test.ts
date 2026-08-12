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
import { m } from '$shared/paraglide/messages.js';

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
  it('fetches on mount and renders the deterministic empty state for no installed apps', () => {
    mocks.editors$.set([editor({ id: 'missing', installed: false })]);

    renderApps();

    expect(screen.getByText(m.settings_openInApps_empty())).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(mocks.dispatched).toContainEqual(fetchEditors());
  });

  it('keeps installed-only filtering, long labels, icons, selected state, and exact toggle action', async () => {
    const visible = editor({ iconBase64: 'cG5n' });
    mocks.editors$.set([visible, editor({ id: 'not-installed', installed: false })]);
    mocks.hiddenIds$.set([visible.id]);

    const { container } = renderApps();
    const toggle = screen.getByRole('switch', { name: LONG_EDITOR_NAME });
    const list = container.querySelector('[data-open-in-apps]');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(list?.className).toContain('space-y-1');
    expect(list?.className).not.toContain('divide-y');
    expect(list?.className).not.toContain('divide-border');
    expect(screen.queryByText('not-installed')).toBeNull();
    expect(container.querySelector('img[alt=""]')).not.toBeNull();
    expect(container.querySelector('[data-slot="settings-field-row"]')?.className).toContain(
      'md:grid-cols-[minmax(0,1fr)_auto]',
    );
    expect(container.querySelector('[data-field-leading]')).not.toBeNull();
    expect(toggle.id).toBe('open-in-vscode-switch');

    await fireEvent.click(toggle);

    expect(mocks.dispatched).toContainEqual(fetchEditors());
    expect(
      mocks.dispatched.filter(
        (action) => (action as { type: string }).type === toggleHiddenEditor.type,
      ),
    ).toEqual([toggleHiddenEditor(visible.id)]);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
  });
});
