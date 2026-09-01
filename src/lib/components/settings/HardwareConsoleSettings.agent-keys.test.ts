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
    connectedCollections: () => Promise.resolve([]),
  }),
}));

// Static imports (vi.mock calls above are hoisted ahead of these): importing
// the component + helpers once at module load keeps the transform/evaluation
// cost out of the per-test timeout budget (intent-hq/monorepo#4015).
import HardwareConsoleSettings from './HardwareConsoleSettings.svelte';
import { codexCapLabel } from './HardwareConsoleDeviceSvg.svelte';
import { m } from '$shared/paraglide/messages.js';
import { CODEX_MIC_LINKED_SLOT } from '$features/hardware-console/actions/action-mapping';
import { initialState } from '$store/renderer/slices/hardware-console/hardware-console-slice';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';

function workspace(id: string, title: string, lastActivity: string) {
  return {
    id,
    title,
    lastActivity,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: lastActivity,
  };
}

function buildState() {
  return {
    hardwareConsole: { ...initialState, enabled: true },
    workspace: {
      workspaces: createCollection('id', [
        workspace('ws-a', 'Alpha', '2026-08-01T12:00:00Z'),
        workspace('ws-b', 'Beta', '2026-08-01T11:00:00Z'),
      ] as never[]),
    },
    workspaceAgents: { byWorkspaceId: {} },
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

  it('clicking an assigned key opens the workspace-info popover and does not navigate', async () => {
    mocks.state.current = buildState();
    const result = render(HardwareConsoleSettings);

    // Auto-fill by recency: slot 1 = ws-a (most recent), slot 2 = ws-b.
    await fireEvent.click(
      result.getByRole('button', {
        name: m.settings_hardware_agentKey_ariaLabel({ number: '2', name: 'Beta' }),
      }),
    );
    result.getByRole('dialog', {
      name: m.settings_hardware_agentKeyPopover_ariaLabel({ number: '2' }),
    });
    expect(mocks.focusWorkspaceSlot).not.toHaveBeenCalled();
  });

  it('assigned-key slot badges are display-only: clicking one opens the popover, not a pin menu', async () => {
    mocks.state.current = buildState();
    const result = render(HardwareConsoleSettings);

    // No interactive MicroKeySlotBadge menu trigger in the device graphic.
    expect(
      result.queryByRole('button', {
        name: m.workspace_microKeyBadge_ariaLabel({ number: '1' }),
      }),
    ).toBeNull();

    // Clicking directly on the slot square falls through to the key and
    // opens the workspace-info popover; no pin/unassign menu appears.
    const square = result.container.querySelector('foreignObject span') as HTMLElement;
    await fireEvent.click(square);
    expect(
      result.getByRole('dialog', {
        name: m.settings_hardware_agentKeyPopover_ariaLabel({ number: '1' }),
      }),
    ).toBeTruthy();
    expect(
      result.queryByText(m.workspace_card_assignMicroKeyNumber_label({ number: '1' })),
    ).toBeNull();
    expect(result.queryByText(m.workspace_card_unassignMicroKey_label())).toBeNull();
  });

  it('agent keys are not interactive while disconnected', async () => {
    mocks.managerStatus.current = 'disconnected';
    mocks.state.current = buildState();
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
    mocks.state.current = buildState();
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
