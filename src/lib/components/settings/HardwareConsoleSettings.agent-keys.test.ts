/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: { current: {} as unknown },
  focusWorkspaceSlot: vi.fn(),
  managerStatus: { current: 'connected' as string },
  deviceModel: { current: 'creator-micro-2' as string },
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

vi.mock('$features/hardware-console/assignment/key-switch-service', () => ({
  focusWorkspaceSlot: mocks.focusWorkspaceSlot,
}));

vi.mock('$features/hardware-console/instance', () => ({
  getHardwareConsoleManager: () => ({
    get status() {
      return mocks.managerStatus.current;
    },
    get connectedDevice() {
      return { name: 'Creator Micro', model: mocks.deviceModel.current };
    },
    client: null,
    onStatusChange: () => () => {},
    connectedCollectionCount: () => Promise.resolve(0),
  }),
}));

function workspace(id: string, title: string, lastActivity: string) {
  return {
    id,
    title,
    lastActivity,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: lastActivity,
  };
}

async function buildState() {
  const { initialState } =
    await import('$store/renderer/slices/hardware-console/hardware-console-slice');
  const { createCollection } =
    await import('$lib/store-shim/utils/collections/collection-utils');
  return {
    hardwareConsole: { ...initialState, enabled: true },
    workspace: {
      activeWorkspaceId: null,
      workspaces: createCollection('id', [
        workspace('ws-a', 'Alpha', '2026-08-01T12:00:00Z'),
        workspace('ws-b', 'Beta', '2026-08-01T11:00:00Z'),
      ] as never[]),
    },
  };
}

describe('HardwareConsoleSettings agent keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.managerStatus.current = 'connected';
    mocks.deviceModel.current = 'creator-micro-2';
  });

  afterEach(() => {
    cleanup();
  });

  it('clicking an assigned key calls focusWorkspaceSlot with the resolved workspace', async () => {
    mocks.state.current = await buildState();
    const HardwareConsoleSettings = (await import('./HardwareConsoleSettings.svelte')).default;
    const { m } = await import('$shared/paraglide/messages.js');
    const result = render(HardwareConsoleSettings);

    // Auto-fill by recency: slot 1 = ws-a (most recent), slot 2 = ws-b.
    await fireEvent.click(
      result.getByRole('button', {
        name: m.settings_hardware_agentKey_ariaLabel({ number: '2', name: 'Beta' }),
      }),
    );
    expect(mocks.focusWorkspaceSlot).toHaveBeenCalledExactlyOnceWith('ws-b');
  });

  it('agent keys are not interactive while disconnected', async () => {
    mocks.managerStatus.current = 'disconnected';
    mocks.state.current = await buildState();
    const HardwareConsoleSettings = (await import('./HardwareConsoleSettings.svelte')).default;
    const { m } = await import('$shared/paraglide/messages.js');
    const result = render(HardwareConsoleSettings);

    expect(
      result.queryByRole('button', {
        name: m.settings_hardware_agentKey_ariaLabel({ number: '1', name: 'Alpha' }),
      }),
    ).toBeNull();
    expect(mocks.focusWorkspaceSlot).not.toHaveBeenCalled();
  });

  it('shows the linked-key warning when the Codex second Mic switch is selected', async () => {
    mocks.deviceModel.current = 'codex-micro';
    mocks.state.current = await buildState();
    const HardwareConsoleSettings = (await import('./HardwareConsoleSettings.svelte')).default;
    const { m } = await import('$shared/paraglide/messages.js');
    const { codexCapLabel } = await import('./HardwareConsoleDeviceSvg.svelte');
    const { CODEX_MIC_LINKED_SLOT } =
      await import('$features/hardware-console/actions/action-mapping');
    const result = render(HardwareConsoleSettings);

    // Select the normal Mic key (ACT10): no warning.
    await fireEvent.click(
      result.getByRole('button', {
        name: m.settings_hardware_codexActionKey_ariaLabel({ number: '5', cap: codexCapLabel(4) }),
      }),
    );
    expect(result.queryByText(m.settings_hardware_linkedKey_warning())).toBeNull();

    // Select the second switch of the linked pair (ACT11): warning shown.
    await fireEvent.click(
      result.getByRole('button', {
        name: m.settings_hardware_codexActionKey_ariaLabel({
          number: String(CODEX_MIC_LINKED_SLOT + 1),
          cap: codexCapLabel(CODEX_MIC_LINKED_SLOT),
        }),
      }),
    );
    expect(result.getByText(m.settings_hardware_linkedKey_warning())).toBeTruthy();
  });
});
