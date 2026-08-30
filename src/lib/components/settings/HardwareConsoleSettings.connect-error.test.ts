/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: { current: {} as unknown },
  manager: {
    status: 'disconnected' as string,
    lastConnectError: null as { name: string; message: string } | null,
    requestConnect: vi.fn(() => Promise.resolve(false)),
  },
  isElectron: { current: false },
  isMac: { current: false },
  openExternalUrl: vi.fn(() => Promise.resolve()),
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => mocks.state.current,
    dispatch: mocks.dispatch,
  });
});

vi.mock('$features/hardware-console/instance', () => ({
  getHardwareConsoleManager: () => ({
    get status() {
      return mocks.manager.status;
    },
    get lastConnectError() {
      return mocks.manager.lastConnectError;
    },
    connectedDevice: null,
    client: null,
    onStatusChange: () => () => {},
    connectedCollections: () => Promise.resolve([]),
    requestConnect: mocks.manager.requestConnect,
  }),
}));

vi.mock('$lib/utils/platform-capabilities', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isElectronPlatform: () => mocks.isElectron.current,
}));

vi.mock('$lib/utils/shortcuts', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isMacPlatform: () => mocks.isMac.current,
}));

vi.mock('$lib/utils/open-external', () => ({
  openExternalUrl: mocks.openExternalUrl,
}));

async function buildState() {
  const { initialState } =
    await import('$store/renderer/slices/hardware-console/hardware-console-slice');
  const { createCollection } =
    await import('@augmentcode/themis/utils/collections/collection-utils');
  return {
    hardwareConsole: { ...initialState, enabled: true },
    workspace: { workspaces: createCollection('id', []) },
  };
}

async function renderSettings() {
  mocks.state.current = await buildState();
  const HardwareConsoleSettings = (await import('./HardwareConsoleSettings.svelte')).default;
  const { m } = await import('$shared/paraglide/messages.js');
  return { result: render(HardwareConsoleSettings), m };
}

describe('HardwareConsoleSettings connect error', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.manager.status = 'disconnected';
    mocks.manager.lastConnectError = null;
    mocks.isElectron.current = false;
    mocks.isMac.current = false;
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the plain disconnected line when there is no connect error', async () => {
    const { result, m } = await renderSettings();
    expect(result.getByText(m.settings_hardware_status_disconnected_label())).toBeTruthy();
    expect(result.queryByRole('button', { name: m.settings_hardware_retry_button() })).toBeNull();
  });

  it('shows the connect error detail and a Retry button that calls requestConnect', async () => {
    mocks.manager.lastConnectError = { name: 'NotFoundError', message: 'boom' };
    const { result, m } = await renderSettings();
    expect(
      result.getByText(m.settings_hardware_connectError_label({ error: 'boom' })),
    ).toBeTruthy();
    const retry = result.getByRole('button', { name: m.settings_hardware_retry_button() });
    await fireEvent.click(retry);
    expect(mocks.manager.requestConnect).toHaveBeenCalledTimes(1);
  });

  it('offers Retry on Electron too when a connect error is present', async () => {
    mocks.isElectron.current = true;
    mocks.manager.lastConnectError = { name: 'NotAllowedError', message: 'denied' };
    const { result, m } = await renderSettings();
    expect(result.getByRole('button', { name: m.settings_hardware_retry_button() })).toBeTruthy();
  });

  it('shows Input Monitoring guidance for NotAllowedError on macOS Electron and opens System Settings', async () => {
    mocks.isElectron.current = true;
    mocks.isMac.current = true;
    mocks.manager.lastConnectError = { name: 'NotAllowedError', message: 'denied' };
    const { result, m } = await renderSettings();
    expect(result.getByText(m.settings_hardware_inputMonitoring_error())).toBeTruthy();
    expect(
      result.getByText(m.settings_hardware_inputMonitoring_regrant_description()),
    ).toBeTruthy();
    await fireEvent.click(
      result.getByRole('button', {
        name: m.settings_hardware_inputMonitoring_openSettings_button(),
      }),
    );
    expect(mocks.openExternalUrl).toHaveBeenCalledWith(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
    );
  });

  it('does not show the Input Monitoring hint for NotAllowedError outside macOS Electron', async () => {
    mocks.manager.lastConnectError = { name: 'NotAllowedError', message: 'denied' };
    const { result, m } = await renderSettings();
    expect(result.queryByText(m.settings_hardware_inputMonitoring_error())).toBeNull();
    expect(
      result.getByText(m.settings_hardware_connectError_label({ error: 'denied' })),
    ).toBeTruthy();
  });
});
