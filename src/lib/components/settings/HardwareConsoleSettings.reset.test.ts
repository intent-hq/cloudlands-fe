/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: { current: {} as unknown },
  manager: {
    status: 'unavailable' as string,
    connectedDevice: null as { model: string; name: string } | null,
  },
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

vi.mock('$features/hardware-console/instance', () => ({
  getHardwareConsoleManager: () => ({
    get status() {
      return mocks.manager.status;
    },
    get connectedDevice() {
      return mocks.manager.connectedDevice;
    },
    client: null,
    onStatusChange: () => () => {},
    connectedCollectionCount: () => Promise.resolve(0),
    requestConnect: () => Promise.resolve(false),
  }),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => mocks.state.current,
    dispatch: mocks.dispatch,
  });
});

async function buildState(actionMapping: readonly string[]) {
  const { initialState } =
    await import('$store/renderer/slices/hardware-console/hardware-console-slice');
  const { createCollection } =
    await import('$lib/store-shim/utils/collections/collection-utils');
  return {
    hardwareConsole: {
      ...initialState,
      enabled: true,
      actionMappingByModel: {
        ...initialState.actionMappingByModel,
        'creator-micro-2': [...actionMapping],
      },
    },
    workspace: { activeWorkspaceId: null, workspaces: createCollection('id', []) },
  };
}

async function renderResetButton() {
  const HardwareConsoleSettings = (await import('./HardwareConsoleSettings.svelte')).default;
  const { m } = await import('$shared/paraglide/messages.js');
  const result = render(HardwareConsoleSettings);
  const button = result.getByRole('button', {
    name: m.settings_hardware_actionKeys_reset_button(),
  });
  return button;
}

describe('HardwareConsoleSettings reset to defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.manager.status = 'unavailable';
    mocks.manager.connectedDevice = null;
  });

  afterEach(() => {
    cleanup();
  });

  it('dispatches the connected model defaults through setActionKeyMapping for changed slots', async () => {
    const { DEFAULT_ACTION_MAPPING } =
      await import('$features/hardware-console/actions/action-mapping');
    const customized = [...DEFAULT_ACTION_MAPPING];
    customized[0] = 'stop-agent';
    customized[3] = 'none';
    mocks.state.current = await buildState(customized);

    const button = await renderResetButton();
    expect((button as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.click(button);

    // No device connected → the panel edits the CM2 mapping.
    expect(mocks.dispatch).toHaveBeenCalledTimes(2);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'hardwareConsole/setActionKeyMapping',
        payload: ['creator-micro-2', 0, DEFAULT_ACTION_MAPPING[0]],
      }),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'hardwareConsole/setActionKeyMapping',
        payload: ['creator-micro-2', 3, DEFAULT_ACTION_MAPPING[3]],
      }),
    );
  });

  it('disables the button when the mapping already equals the defaults', async () => {
    const { DEFAULT_ACTION_MAPPING } =
      await import('$features/hardware-console/actions/action-mapping');
    mocks.state.current = await buildState(DEFAULT_ACTION_MAPPING);

    const button = await renderResetButton();
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(button);
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'hardwareConsole/setActionKeyMapping' }),
    );
  });

  it('resets to the CONNECTED model defaults (Codex Micro)', async () => {
    const { DEFAULT_ACTION_MAPPINGS } =
      await import('$features/hardware-console/actions/action-mapping');
    mocks.manager.status = 'connected';
    mocks.manager.connectedDevice = { model: 'codex-micro', name: 'Codex Micro' };
    const codexDefaults = DEFAULT_ACTION_MAPPINGS['codex-micro'];
    const customized = [...codexDefaults];
    customized[0] = 'see-spec';
    const state = await buildState(DEFAULT_ACTION_MAPPINGS['creator-micro-2']);
    state.hardwareConsole.actionMappingByModel['codex-micro'] = customized;
    mocks.state.current = state;

    const button = await renderResetButton();
    expect((button as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.click(button);

    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'hardwareConsole/setActionKeyMapping',
        payload: ['codex-micro', 0, codexDefaults[0]],
      }),
    );
  });
});
