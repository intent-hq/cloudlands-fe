/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { ReduxStoreContext } from '$store/renderer/types';
import { initAppStore, store as appStore } from '$store/renderer/store';
import {
  setThemeCustomization,
  setThemePreference,
} from '$store/renderer/slices/theme/theme-slice';
import {
  setAgentFontStyle,
  setCodeFontFamily,
  setNoteFontStyle,
  setSystemFonts,
} from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { FONTS_COLORS_VISUAL_FIXTURES } from './fonts-colors.fixtures';

const STORE_CONTEXT = 'redux-store-context';
const LONG_FONT_NAME = 'A Very Long Editorial Programming Font Family Name';
const mocks = vi.hoisted(() => ({
  page: { url: new URL('http://localhost/settings?tab=fonts-colors') },
}));

vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$lib/utils/workspace-navigation', () => ({
  getSettingsPreviousPath: () => '/',
  navigateBackFromSettings: vi.fn(),
}));
vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/workspace/sidebar/__tests__/mocks/Fa.svelte')).default,
}));

vi.mock('$lib/components/settings/ProviderSelector.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/settings/AIBehaviorEditor.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/settings/AIBehaviorSidebar.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/settings/ConnectionsSettings.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/settings/GitWorkspaceSettings.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/settings/OpenInAppsSettings.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/settings/McpServersSettings.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/settings/BackgroundAgentSettings.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/settings/NotificationSettings.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/settings/RtkSettings.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/settings/WebSocketApiSettings.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/settings/AgentBackendSettings.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
}));

import SettingsPage from '../+page.svelte';

let storeContext: ReduxStoreContext | undefined;

function renderFontsColors() {
  window.history.pushState({}, '', '/settings?tab=fonts-colors');
  mocks.page.url = new URL(window.location.href);
  return render(SettingsPage, {
    context: new Map([[STORE_CONTEXT, storeContext]]),
  });
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

beforeEach(() => {
  (window as unknown as { intentFlags?: { enableReduxLogger: boolean } }).intentFlags = {
    enableReduxLogger: false,
  };
  storeContext = initAppStore(appStore);
  appStore.dispatch(setThemePreference('light'));
  appStore.dispatch(
    setThemeCustomization({ hasCustomTheme: false, customThemeName: null, activePresetId: null }),
  );
  appStore.dispatch(setNoteFontStyle('sans'));
  appStore.dispatch(setAgentFontStyle('sans'));
  appStore.dispatch(setCodeFontFamily('system-default'));
  appStore.dispatch(setSystemFonts([LONG_FONT_NAME]));
  vi.clearAllMocks();
  (globalThis as typeof globalThis & { __APP_VERSION__: string }).__APP_VERSION__ = '2.0.10';
  Object.defineProperty(Element.prototype, 'scrollTo', { value: vi.fn(), configurable: true });
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value: vi.fn(),
    configurable: true,
  });
});

afterEach(() => {
  storeContext?.dispose();
  storeContext = undefined;
  cleanup();
});

describe('Fonts & Colors settings migration', () => {
  it('dispatches exact FE-owned theme and font actions with no backend request', async () => {
    const recorder = installDispatchRecorder();
    try {
      renderFontsColors();
      const light = screen.getByRole('radio', { name: 'Light' });
      const dark = screen.getByRole('radio', { name: 'Dark' });
      expect(light.getAttribute('aria-checked')).toBe('true');
      light.focus();
      await fireEvent.keyDown(light, { key: 'ArrowRight' });
      expect(document.activeElement).toBe(dark);
      await fireEvent.click(dark);

      await fireEvent.click(
        within(document.getElementById('note-font')!).getByRole('radio', { name: 'Mono' }),
      );
      await fireEvent.click(
        within(document.getElementById('agent-chat-font')!).getByRole('radio', { name: 'Mono' }),
      );

      const codeFont = screen.getByRole('button', { name: 'Font' });
      await fireEvent.keyDown(codeFont, { key: 'Enter' });
      expect(await screen.findByRole('option', { name: LONG_FONT_NAME })).toBeTruthy();
      await fireEvent.keyDown(codeFont, { key: 'ArrowDown' });
      await fireEvent.keyDown(codeFont, { key: 'Enter' });
      await waitFor(() => expect(codeFont.textContent).toContain(LONG_FONT_NAME));

      const relevantTypes = new Set([
        'theme/requestThemePreferenceChange',
        'fontSettings/setNoteFontStyle',
        'fontSettings/setAgentFontStyle',
        'fontSettings/setCodeFontFamily',
      ]);
      expect(
        recorder.calls.filter((action) => relevantTypes.has((action as { type: string }).type)),
      ).toEqual([
        { type: 'theme/requestThemePreferenceChange', payload: ['dark'] },
        { type: 'fontSettings/setNoteFontStyle', payload: ['monospace'] },
        { type: 'fontSettings/setAgentFontStyle', payload: ['monospace'] },
        { type: 'fontSettings/setCodeFontFamily', payload: [LONG_FONT_NAME] },
      ]);
      expect(codeFont.querySelector('.truncate')).not.toBeNull();
      expect(
        vi
          .mocked(window.electronAPI!.invoke)
          .mock.calls.filter(([channel]) => channel === IPC_CHANNELS.BACKEND.REQUEST),
      ).toHaveLength(0);
    } finally {
      recorder.restore();
    }
  });

  it('preserves the four hash/highlight contracts and canonical responsive composition', () => {
    const { container } = renderFontsColors();
    for (const id of ['color-theme', 'note-font', 'agent-chat-font', 'code-font']) {
      const target = document.getElementById(id);
      expect(target?.getAttribute('data-highlight-id')).toBe(id);
    }
    expect(screen.getByRole('region', { name: 'Appearance' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Font Style' })).toBeTruthy();
    expect(container.querySelector('[data-settings-fonts-colors]')?.className).toContain(
      'max-w-5xl',
    );
    const rows = [...container.querySelectorAll('[data-slot="settings-field-row"]')];
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.getAttribute('data-orientation')).toBe('responsive');
      expect(row.className).toContain('md:grid-cols-');
    }
  });

  it('defines deterministic light/dark desktop/compact visual fixtures', () => {
    expect(FONTS_COLORS_VISUAL_FIXTURES).toEqual([
      { id: 'fonts-colors-light-desktop', theme: 'light', width: 1440, height: 1000 },
      { id: 'fonts-colors-dark-desktop', theme: 'dark', width: 1440, height: 1000 },
      { id: 'fonts-colors-light-compact', theme: 'light', width: 900, height: 760 },
      { id: 'fonts-colors-dark-compact', theme: 'dark', width: 900, height: 760 },
    ]);
  });
});
