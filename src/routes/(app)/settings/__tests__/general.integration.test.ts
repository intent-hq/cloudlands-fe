/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_UPDATE_CHANNELS } from '$features/auto-update/types';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { resetMockIpcRouter } from '$shared/ipc-mock-router';
import type { ReduxStoreContext } from '$store/renderer/types';
import { initAppStore, store as appStore } from '$store/renderer/store';
import { registerAutoUpdateBridge } from '$store/renderer/seeders/auto-update-bridge-seeder';
import {
  simulateSetState,
  installUpdate,
} from '$store/renderer/slices/auto-update/auto-update-slice';
import {
  selectBetaUpdatesEnabled,
  selectNoteFontStyle,
  selectAgentFontStyle,
} from '$store/renderer/slices/user-preferences/user-preferences-selectors';
import {
  setAgentFontStyle,
  setBetaUpdatesEnabled,
  setNoteFontStyle,
} from '$store/renderer/slices/user-preferences/user-preferences-slice';
import {
  GENERAL_ACCESSIBILITY_FIXTURE,
  GENERAL_STATE_FIXTURES,
  GENERAL_VISUAL_FIXTURES,
} from './general.fixtures';

const STORE_CONTEXT = 'redux-store-context';
const mocks = vi.hoisted(() => ({
  page: { url: new URL('http://localhost/settings?tab=general') },
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
vi.mock('$lib/components/settings/McpServersSettings.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/settings/BackgroundAgentSettings.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/settings/ColorThemeSettings.svelte', async () => ({
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
vi.mock('$lib/components/settings/WorkspaceApiSettings.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/settings/AgentBackendSettings.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
}));

import SettingsPage from '../+page.svelte';

let storeContext: ReduxStoreContext | undefined;
const originalInvoke = window.electronAPI!.invoke;
let setChannelResponse: { success: boolean; error?: { message: string } };

function renderGeneral() {
  window.history.pushState({}, '', '/settings?tab=general');
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

function backendCalls() {
  return vi
    .mocked(window.electronAPI!.invoke)
    .mock.calls.filter(([channel]) => channel === IPC_CHANNELS.BACKEND.REQUEST);
}

beforeEach(() => {
  resetMockIpcRouter();
  setChannelResponse = { success: true };
  window.electronAPI!.invoke = vi.fn(async (channel: string) => {
    if (channel === IPC_CHANNELS.BACKEND.GET_STATUS) return { status: 'connected' };
    if (channel === AUTO_UPDATE_CHANNELS.SET_CHANNEL) return setChannelResponse;
    return { success: true, data: null };
  });
  registerAutoUpdateBridge();
  storeContext = initAppStore(appStore);
  appStore.dispatch(setBetaUpdatesEnabled(false));
  appStore.dispatch(setNoteFontStyle('monospace'));
  appStore.dispatch(setAgentFontStyle('monospace'));
  appStore.dispatch(simulateSetState({ status: 'idle' }));
  vi.clearAllMocks();
  (globalThis as typeof globalThis & { __APP_VERSION__: string }).__APP_VERSION__ = '2.0.10';
  Object.defineProperty(Element.prototype, 'scrollTo', { value: vi.fn(), configurable: true });
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value: vi.fn(),
    configurable: true,
  });
});

afterEach(() => {
  delete (appStore as { dispatch?: unknown }).dispatch;
  storeContext?.dispose();
  storeContext = undefined;
  cleanup();
  window.electronAPI!.invoke = originalInvoke;
  resetMockIpcRouter();
});

describe('General settings migration', () => {
  it('sets beta through the exact IPC request before the exact Redux success action', async () => {
    const recorder = installDispatchRecorder();
    renderGeneral();

    await fireEvent.click(screen.getByRole('switch', { name: 'Beta updates' }));

    await waitFor(() => expect(selectBetaUpdatesEnabled.select(appStore.state)).toBe(true));
    expect(window.electronAPI!.invoke).toHaveBeenCalledWith(AUTO_UPDATE_CHANNELS.SET_CHANNEL, {
      channel: 'beta',
    });
    expect(
      vi
        .mocked(window.electronAPI!.invoke)
        .mock.calls.filter(([channel]) => channel === AUTO_UPDATE_CHANNELS.SET_CHANNEL),
    ).toEqual([
      [AUTO_UPDATE_CHANNELS.SET_CHANNEL, { channel: 'beta' }],
      [AUTO_UPDATE_CHANNELS.SET_CHANNEL, { channel: 'beta' }],
    ]);
    expect(recorder.calls).toContainEqual(setBetaUpdatesEnabled(true));
    expect(backendCalls()).toHaveLength(0);
    recorder.restore();
  });

  it('keeps Redux unchanged and exposes the shaped set-channel failure accessibly', async () => {
    setChannelResponse = {
      success: false,
      error: { message: 'The beta feed is unavailable.' },
    };
    const recorder = installDispatchRecorder();
    renderGeneral();

    await fireEvent.click(screen.getByRole('switch', { name: 'Beta updates' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'The beta feed is unavailable.',
    );
    expect(selectBetaUpdatesEnabled.select(appStore.state)).toBe(false);
    expect(window.electronAPI!.invoke).toHaveBeenCalledWith(AUTO_UPDATE_CHANNELS.SET_CHANNEL, {
      channel: 'beta',
    });
    expect(recorder.calls).not.toContainEqual(setBetaUpdatesEnabled(true));
    expect(backendCalls()).toHaveLength(0);
    recorder.restore();
  });

  it('cancels and dismisses reset by Escape with focus restoration and no reset actions', async () => {
    const recorder = installDispatchRecorder();
    renderGeneral();
    const trigger = screen.getByRole('button', { name: 'Reset to Defaults' });
    trigger.focus();
    await fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Reset Settings' })).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    await fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    await fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(
      recorder.calls.filter((action) => /reset|FontStyle/.test((action as { type: string }).type)),
    ).toEqual([]);
    recorder.restore();
  });

  it('confirms the existing reset action sequence without resetting update preferences', async () => {
    const recorder = installDispatchRecorder();
    renderGeneral();
    const trigger = screen.getByRole('button', { name: 'Reset to Defaults' });
    trigger.focus();
    await fireEvent.click(trigger);
    await fireEvent.click(screen.getByRole('button', { name: 'Reset Settings' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    const resetTypes = new Set([
      'theme/requestThemePreferenceChange',
      'fontSettings/setNoteFontStyle',
      'fontSettings/setAgentFontStyle',
      'notificationSettings/resetNotificationSettings',
    ]);
    expect(
      recorder.calls.filter((action) => resetTypes.has((action as { type: string }).type)),
    ).toEqual([
      { type: 'theme/requestThemePreferenceChange', payload: ['system'] },
      { type: 'fontSettings/setNoteFontStyle', payload: ['sans'] },
      { type: 'fontSettings/setAgentFontStyle', payload: ['sans'] },
      { type: 'notificationSettings/resetNotificationSettings', payload: [] },
    ]);
    expect(selectNoteFontStyle.select(appStore.state)).toBe('sans');
    expect(selectAgentFontStyle.select(appStore.state)).toBe('sans');
    expect(selectBetaUpdatesEnabled.select(appStore.state)).toBe(false);
    expect(backendCalls()).toHaveLength(0);
    recorder.restore();
  });

  it('pins the complete reset callback order in the production handler', () => {
    const source = readFileSync('src/routes/(app)/settings/+page.svelte', 'utf8');
    const handler = source.slice(
      source.indexOf('function handleResetInterfaceSystem()'),
      source.indexOf('</script>'),
    );
    const orderedCalls = [
      "requestThemePreferenceChange('system')",
      'colorThemeSettingsRef?.clearTheme()',
      "setNoteFontStyle('sans')",
      "setAgentFontStyle('sans')",
      'resetNotificationSettings()',
      'gitWorkspaceSettingsRef?.resetToDefaults()',
    ];
    const positions = orderedCalls.map((call) => handler.indexOf(call));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it('preserves footer states, canonical actions, support semantics, and fixed-row geometry', async () => {
    const recorder = installDispatchRecorder();
    const { container } = renderGeneral();
    expect(screen.getByText(/v2\.0\.10/)).toBeTruthy();
    expect(screen.getByText('Up to date')).toBeTruthy();
    const support = screen.getByRole('link', { name: 'Support' });
    expect(support.getAttribute('href')).toBe('https://www.intentapp.dev/docs');
    expect(support.getAttribute('target')).toBe('_blank');
    expect(support.getAttribute('rel')).toBe('noopener noreferrer');
    expect(support.getAttribute('data-slot')).toBe('button');

    appStore.dispatch(simulateSetState({ status: 'downloaded' }));
    const update = await screen.findByRole('button', { name: 'Update available' });
    expect(update.getAttribute('data-slot')).toBe('button');
    await fireEvent.click(update);
    expect(recorder.calls).toContainEqual(installUpdate());
    expect(container.firstElementChild?.className).toContain(
      'grid-rows-[min-content_1fr_min-content]',
    );
    expect(container.querySelector('[data-settings-footer] .max-w-5xl')?.className).toContain(
      'flex-wrap',
    );
    recorder.restore();
  });

  it('preserves exact developer simulation payloads behind the dev-only section', async () => {
    const recorder = installDispatchRecorder();
    renderGeneral();
    expect(screen.getByRole('region', { name: 'Developer' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Simulate Update Flow' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Simulate No Update' }));
    await fireEvent.click(
      within(screen.getByRole('region', { name: 'Developer' })).getByRole('button', {
        name: 'Reset',
      }),
    );

    const simulations = recorder.calls.filter(
      (action) => (action as { type: string }).type === 'autoUpdate/simulateSetState',
    );
    expect(simulations).toHaveLength(3);
    expect(simulations[0]).toMatchObject({
      payload: {
        toastVisible: true,
        status: 'downloading',
        updateInfo: { version: '99.0.0', releaseNotes: 'Simulated' },
        progress: {
          percent: 50,
          bytesPerSecond: 2500000,
          transferred: 25000000,
          total: 50000000,
        },
        error: null,
      },
    });
    expect(simulations[1]).toEqual(
      simulateSetState({
        toastVisible: true,
        status: 'not-available',
        currentVersion: '1.0.0-dev',
      }),
    );
    expect(simulations[2]).toEqual(
      simulateSetState({
        toastVisible: false,
        status: 'idle',
        currentVersion: '1.0.0-dev',
        updateInfo: null,
        progress: null,
        error: null,
        channel: 'stable',
      }),
    );
    expect(readFileSync('src/routes/(app)/settings/+page.svelte', 'utf8')).toContain(
      '{#if isDevMode}',
    );
    recorder.restore();
  });

  it('uses canonical responsive composition and deterministic visual/accessibility fixtures', () => {
    const { container } = renderGeneral();
    expect(container.querySelector('[data-settings-general]')?.className).toContain('max-w-5xl');
    expect(screen.getByRole('region', { name: 'Updates' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'WebSocket API' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Reset' }).className).toContain('border-destructive');
    expect(container.querySelector('[data-settings-footer]')?.className).toContain('border-t');
    for (const row of container.querySelectorAll('[data-slot="settings-field-row"]')) {
      expect(row.className).toContain('min-w-0');
    }
    expect(GENERAL_VISUAL_FIXTURES).toHaveLength(4);
    expect(new Set(GENERAL_VISUAL_FIXTURES.map(({ id }) => id)).size).toBe(4);
    expect(new Set(GENERAL_VISUAL_FIXTURES.map(({ theme }) => theme))).toEqual(
      new Set(['light', 'dark']),
    );
    expect(new Set(GENERAL_VISUAL_FIXTURES.map(({ width }) => width))).toEqual(
      new Set([1440, 900]),
    );
    expect(GENERAL_STATE_FIXTURES).toEqual(
      expect.arrayContaining([
        'no-apps',
        'installed-apps',
        'long-editor-label',
        'beta-success',
        'beta-failure',
        'update-available',
        'up-to-date',
        'reset-confirmation',
        'reset-cancelled',
        'reset-confirmed',
        'developer',
      ]),
    );
    expect(GENERAL_ACCESSIBILITY_FIXTURE).toEqual({
      zoomPercent: 200,
      reducedMotion: true,
      overflow: 'none',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset to Defaults' }));
    expect(screen.getByRole('dialog').className).toContain('motion-reduce:animate-none');
  });
});
