/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  selectUpdateChannel,
  selectNoteFontStyle,
  selectAgentFontStyle,
} from '$store/renderer/slices/user-preferences/user-preferences-selectors';
import {
  setAgentFontStyle,
  setNoteFontStyle,
  setUpdateChannel,
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

function renderSettingsTab(tab: 'general' | 'appearance' | 'app-behavior' | 'advanced') {
  window.history.pushState({}, '', `/settings?tab=${tab}`);
  mocks.page.url = new URL(window.location.href);
  return render(SettingsPage, {
    context: new Map([[STORE_CONTEXT, storeContext]]),
  });
}

const renderGeneral = () => renderSettingsTab('general');
const renderAppearance = () => renderSettingsTab('appearance');
const renderAppBehavior = () => renderSettingsTab('app-behavior');
const renderAdvanced = () => renderSettingsTab('advanced');

function installDispatchRecorder() {
  const spy = vi.spyOn(appStore, 'dispatch');
  return {
    get calls() {
      return spy.mock.calls.map(([action]) => action);
    },
    restore: () => spy.mockRestore(),
  };
}

function backendCalls() {
  return vi
    .mocked(window.electronAPI!.invoke)
    .mock.calls.filter(([channel]) => channel === IPC_CHANNELS.BACKEND.REQUEST);
}

beforeAll(() => {
  storeContext = initAppStore(appStore);
});

beforeEach(() => {
  resetMockIpcRouter();
  setChannelResponse = { success: true };
  window.electronAPI!.invoke = vi.fn(async (channel: string) => {
    if (channel === IPC_CHANNELS.BACKEND.GET_STATUS) return { status: 'connected' };
    if (channel === AUTO_UPDATE_CHANNELS.SET_CHANNEL) return setChannelResponse;
    return { success: true, data: null };
  });
  registerAutoUpdateBridge();
  appStore.dispatch(setUpdateChannel('stable'));
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
  vi.restoreAllMocks();
  cleanup();
  window.electronAPI!.invoke = originalInvoke;
  resetMockIpcRouter();
});

afterAll(() => {
  storeContext?.dispose();
  storeContext = undefined;
});

describe('Settings migration', () => {
  it('keeps the fixed-column preference in the workspace header instead of settings', async () => {
    const recorder = installDispatchRecorder();
    const general = renderGeneral();
    expect(document.querySelector('[data-panel-column-count]')).toBeNull();
    general.unmount();

    renderAppearance();
    expect(document.querySelector('[data-panel-column-count]')).toBeNull();
    expect(appStore.state.userPreferences).not.toHaveProperty('panelColumnCount');
    expect(readFileSync('src/lib/components/layout/WindowTitleBar.svelte', 'utf8')).not.toContain(
      'data-titlebar-panel-open-mode',
    );
    expect(
      readFileSync('src/lib/components/workspace/WorkspaceSidebarHeader.svelte', 'utf8'),
    ).not.toContain('data-panel-column-count-trigger');
    const panelTabBar = readFileSync(
      'src/lib/components/layout/panel-system/PanelTabBar.svelte',
      'utf8',
    );
    expect(panelTabBar).not.toContain('data-panel-column-count-trigger');
    expect(panelTabBar).toContain('data-add-panel-column');
    recorder.restore();
  });

  it('dispatches the exact Redux update-channel action without a direct backend request', async () => {
    const recorder = installDispatchRecorder();
    renderAppBehavior();

    await fireEvent.click(screen.getByRole('button', { name: 'Select update channel' }));
    await fireEvent.pointerUp(await screen.findByRole('option', { name: 'Beta' }), {
      button: 0,
      pointerType: 'mouse',
    });

    await waitFor(() => expect(selectUpdateChannel.select(appStore.state)).toBe('beta'));
    expect(recorder.calls).toContainEqual(setUpdateChannel('beta'));
    expect(backendCalls()).toHaveLength(0);
    expect(window.electronAPI!.invoke).not.toHaveBeenCalledWith(
      AUTO_UPDATE_CHANNELS.SET_CHANNEL,
      expect.anything(),
    );
    recorder.restore();
  });

  it('keeps the channel selector focusable and offers all four channels', async () => {
    const recorder = installDispatchRecorder();
    renderAppBehavior();

    const trigger = screen.getByRole('button', { name: 'Select update channel' });
    expect(trigger.textContent).toContain('Stable');
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    await fireEvent.click(trigger);

    expect(await screen.findByRole('option', { name: 'Stable' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Beta' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Disabled' })).toBeTruthy();
    await fireEvent.pointerUp(screen.getByRole('option', { name: 'Alpha' }), {
      button: 0,
      pointerType: 'mouse',
    });

    await waitFor(() => expect(selectUpdateChannel.select(appStore.state)).toBe('alpha'));
    expect(recorder.calls).toContainEqual(setUpdateChannel('alpha'));
    expect(backendCalls()).toHaveLength(0);
    recorder.restore();
  });

  it('renders the Disabled option and dispatches setUpdateChannel(disabled) on selection', async () => {
    const recorder = installDispatchRecorder();
    renderGeneral();

    await fireEvent.click(screen.getByRole('button', { name: 'Select update channel' }));
    await fireEvent.pointerUp(await screen.findByRole('option', { name: 'Disabled' }), {
      button: 0,
      pointerType: 'mouse',
    });

    await waitFor(() => expect(selectUpdateChannel.select(appStore.state)).toBe('disabled'));
    expect(recorder.calls).toContainEqual(setUpdateChannel('disabled'));
    expect(backendCalls()).toHaveLength(0);
    recorder.restore();
  });

  it('does not activate reset from Escape and preserves focus', async () => {
    const recorder = installDispatchRecorder();
    renderAdvanced();
    const trigger = screen.getByRole('button', { name: 'Reset to Defaults' });
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
    expect(
      recorder.calls.filter((action) => /reset|FontStyle/.test((action as { type: string }).type)),
    ).toEqual([]);
    recorder.restore();
  });

  it('runs the existing reset action sequence without resetting update preferences', async () => {
    const recorder = installDispatchRecorder();
    renderAdvanced();
    const trigger = screen.getByRole('button', { name: 'Reset to Defaults' });
    trigger.focus();
    await fireEvent.click(trigger);
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
    expect(selectUpdateChannel.select(appStore.state)).toBe('stable');
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
    const initial = renderGeneral();
    const { container } = initial;
    expect(screen.getByText(/v2\.0\.10/)).toBeTruthy();
    expect(screen.getByText('Up to date')).toBeTruthy();
    const support = screen.getByRole('link', { name: 'Support' });
    expect(support.getAttribute('href')).toBe('https://www.intentapp.dev/docs');
    expect(support.getAttribute('target')).toBe('_blank');
    expect(support.getAttribute('rel')).toBe('noopener noreferrer');
    expect(container.firstElementChild?.className).toContain('flex h-full');
    expect(container.querySelector('aside')?.className).toContain('border-r');
    appStore.dispatch(simulateSetState({ status: 'downloaded' }));
    const update = await screen.findByRole('button', { name: 'Update available' });
    const recorder = installDispatchRecorder();
    await fireEvent.click(update);
    expect(recorder.calls).toContainEqual(installUpdate());
    recorder.restore();
  });

  it('preserves exact developer simulation payloads behind the dev-only section', async () => {
    const recorder = installDispatchRecorder();
    renderAdvanced();
    const developer = document.getElementById('developer')!;
    expect(screen.getByRole('heading', { name: 'Developer' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Simulate Update Flow' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Simulate No Update' }));
    await fireEvent.click(
      within(developer).getByRole('button', {
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
    const { container } = renderAdvanced();
    expect(container.querySelector('main')?.className).toContain('max-w-4xl');
    expect(screen.getByRole('heading', { name: 'WebSocket API' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Reset' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Developer' })).toBeTruthy();
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
    expect(screen.getByRole('button', { name: 'Reset to Defaults' }).className).toContain(
      'motion-reduce:transition-none',
    );
  });
});
