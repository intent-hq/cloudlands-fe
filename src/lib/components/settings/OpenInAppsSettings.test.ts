/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ReduxStoreContext } from '$store/renderer/types';
import { initAppStore, store as appStore } from '$store/renderer/store';
import {
  fetchEditors,
  fetchEditorsSuccess,
  setHiddenEditorIds,
  toggleHiddenEditor,
  type InstalledEditor,
} from '$store/renderer/slices/external-editors/external-editors-slice';
import OpenInAppsSettings from './OpenInAppsSettings.svelte';

const STORE_CONTEXT = 'redux-store-context';
const LONG_EDITOR_NAME =
  'Visual Studio Code Insiders With A Very Long Extension Profile Display Name';
let storeContext: ReduxStoreContext | undefined;

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

function installDispatchRecorder() {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(appStore), 'dispatch');
  const originalDispatch = descriptor?.get?.call(appStore) as (action: unknown) => unknown;
  const calls: unknown[] = [];
  Object.defineProperty(appStore, 'dispatch', {
    configurable: true,
    enumerable: true,
    get: () => (action: unknown) => {
      calls.push(action);
      return originalDispatch(action);
    },
  });
  return { calls, restore: () => delete (appStore as { dispatch?: unknown }).dispatch };
}

function renderApps() {
  return render(OpenInAppsSettings, {
    context: new Map([[STORE_CONTEXT, storeContext]]),
  });
}

beforeEach(() => {
  storeContext = initAppStore(appStore);
});

afterEach(() => {
  delete (appStore as { dispatch?: unknown }).dispatch;
  storeContext?.dispose();
  storeContext = undefined;
  cleanup();
});

describe('OpenInAppsSettings', () => {
  it('fetches on mount and renders the deterministic empty state for no installed apps', () => {
    appStore.dispatch(fetchEditorsSuccess([editor({ id: 'missing', installed: false })], 1));
    const recorder = installDispatchRecorder();

    renderApps();

    expect(screen.getByText('No compatible apps detected.')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(recorder.calls).toContainEqual(fetchEditors());
    recorder.restore();
  });

  it('keeps installed-only filtering, long labels, icons, selected state, and exact toggle action', async () => {
    const visible = editor({ iconBase64: 'cG5n' });
    appStore.dispatch(
      fetchEditorsSuccess([visible, editor({ id: 'not-installed', installed: false })], 1),
    );
    appStore.dispatch(setHiddenEditorIds([visible.id]));
    const recorder = installDispatchRecorder();

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

    expect(recorder.calls).toContainEqual(fetchEditors());
    expect(
      recorder.calls.filter(
        (action) => (action as { type: string }).type === toggleHiddenEditor.type,
      ),
    ).toEqual([toggleHiddenEditor(visible.id)]);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    recorder.restore();
  });
});
