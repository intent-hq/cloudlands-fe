/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: { current: {} as unknown },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => mocks.state.current,
    dispatch: mocks.dispatch,
  });
});

async function loadComponent() {
  const HardwareConsoleDeviceSvg = (await import('./HardwareConsoleDeviceSvg.svelte')).default;
  const { m } = await import('$shared/paraglide/messages.js');
  return { HardwareConsoleDeviceSvg, m };
}

function slots(entries: ({ id: string; name: string } | null)[]) {
  return entries.map((entry) =>
    entry === null
      ? { workspaceId: null, name: null }
      : { workspaceId: entry.id, name: entry.name },
  );
}

const SIX_SLOTS = slots([
  { id: 'ws-1', name: 'Alpha' },
  { id: 'ws-2', name: 'Beta' },
  { id: 'ws-3', name: 'Gamma' },
  { id: 'ws-4', name: 'Delta' },
  { id: 'ws-5', name: 'Epsilon' },
  null,
]);

describe('HardwareConsoleDeviceSvg', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.current = {};
  });

  afterEach(() => {
    cleanup();
  });

  it('opens the knob explainer with the fixed rotate/click behavior text', async () => {
    const { HardwareConsoleDeviceSvg, m } = await loadComponent();
    const result = render(HardwareConsoleDeviceSvg);

    const knob = result.getByRole('button', { name: m.settings_hardware_knob_ariaLabel() });
    await fireEvent.click(knob);

    const dialog = result.getByRole('dialog', { name: m.settings_hardware_knobExplainer_label() });
    expect(dialog.textContent).toContain(m.settings_hardware_knobExplainer_rotate_description());
    expect(dialog.textContent).toContain(m.settings_hardware_knobExplainer_click_description());
    expect(dialog.textContent).toContain(m.settings_hardware_explainer_fixed_description());
  });

  it('opens the joystick explainer with the hold/cancel behavior text', async () => {
    const { HardwareConsoleDeviceSvg, m } = await loadComponent();
    const result = render(HardwareConsoleDeviceSvg);

    const joystick = result.getByRole('button', {
      name: m.settings_hardware_joystick_ariaLabel(),
    });
    await fireEvent.click(joystick);

    const dialog = result.getByRole('dialog', {
      name: m.settings_hardware_joystickExplainer_label(),
    });
    expect(dialog.textContent).toContain(
      m.settings_hardware_joystickExplainer_hold_description(),
    );
    expect(dialog.textContent).toContain(
      m.settings_hardware_joystickExplainer_cancel_description(),
    );
  });

  it('numbers agent-key badges per the binding: slots 1-4 on the second row, 5-6 on the top row', async () => {
    const { HardwareConsoleDeviceSvg, m } = await loadComponent();
    const result = render(HardwareConsoleDeviceSvg, {
      props: { agentSlots: SIX_SLOTS, agentKeysInteractive: true },
    });

    const rowOf = (name: string) => {
      const key = result.getByRole('button', { name });
      return Number(key.querySelector('rect')?.getAttribute('y'));
    };
    const TOP_ROW_Y = 16;
    const SECOND_ROW_Y = 84;

    for (const [number, name] of [
      ['1', 'Alpha'],
      ['2', 'Beta'],
      ['3', 'Gamma'],
      ['4', 'Delta'],
    ]) {
      expect(rowOf(m.settings_hardware_agentKey_ariaLabel({ number, name }))).toBe(SECOND_ROW_Y);
    }
    expect(
      rowOf(m.settings_hardware_agentKey_ariaLabel({ number: '5', name: 'Epsilon' })),
    ).toBe(TOP_ROW_Y);
    expect(
      rowOf(m.settings_hardware_agentKeyUnassigned_ariaLabel({ number: '6' })),
    ).toBe(TOP_ROW_Y);

    const badgeNumbers = Array.from(
      result.container.querySelectorAll('foreignObject'),
    ).map((node) => node.textContent?.trim());
    expect(badgeNumbers).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('clicking an assigned key opens the workspace-info popover; unassigned is a no-op', async () => {
    const { HardwareConsoleDeviceSvg, m } = await loadComponent();
    const agentKeyStatusLabel = vi.fn(() => 'Agent running');
    const result = render(HardwareConsoleDeviceSvg, {
      props: { agentSlots: SIX_SLOTS, agentKeysInteractive: true, agentKeyStatusLabel },
    });

    await fireEvent.click(
      result.getByRole('button', {
        name: m.settings_hardware_agentKey_ariaLabel({ number: '3', name: 'Gamma' }),
      }),
    );
    const popover = result.getByRole('dialog', {
      name: m.settings_hardware_agentKeyPopover_ariaLabel({ number: '3' }),
    });
    expect(popover.textContent).toContain('Gamma');
    expect(popover.textContent).toContain('Agent running');
    expect(agentKeyStatusLabel).toHaveBeenCalledExactlyOnceWith(2);

    // Unassigned key: no popover, popover state untouched.
    await fireEvent.click(
      result.getByRole('button', {
        name: m.settings_hardware_agentKeyUnassigned_ariaLabel({ number: '6' }),
      }),
    );
    expect(
      result.getByRole('dialog', {
        name: m.settings_hardware_agentKeyPopover_ariaLabel({ number: '3' }),
      }),
    ).toBeTruthy();
  });

  it('renders assigned-key slot badges display-only: no menu trigger, clicks fall through to the popover', async () => {
    const { HardwareConsoleDeviceSvg, m } = await loadComponent();
    const result = render(HardwareConsoleDeviceSvg, {
      props: { agentSlots: SIX_SLOTS, agentKeysInteractive: true },
    });

    // No interactive MicroKeySlotBadge menu trigger anywhere in the graphic.
    for (let n = 1; n <= 6; n += 1) {
      expect(
        result.queryByRole('button', {
          name: m.workspace_microKeyBadge_ariaLabel({ number: String(n) }),
        }),
      ).toBeNull();
    }

    // Clicking directly on the slot square bubbles to the key: the
    // workspace-info popover opens, no pin/unassign menu appears.
    const square = result.container.querySelector('foreignObject span') as HTMLElement;
    await fireEvent.click(square);
    expect(
      result.getByRole('dialog', {
        name: m.settings_hardware_agentKeyPopover_ariaLabel({ number: '1' }),
      }).textContent,
    ).toContain('Alpha');
    expect(
      result.queryByText(m.workspace_card_assignMicroKeyNumber_label({ number: '1' })),
    ).toBeNull();
    expect(result.queryByText(m.workspace_card_unassignMicroKey_label())).toBeNull();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('keyboard-activating an assigned key opens the popover; Escape dismisses it', async () => {
    const { HardwareConsoleDeviceSvg, m } = await loadComponent();
    const result = render(HardwareConsoleDeviceSvg, {
      props: { agentSlots: SIX_SLOTS, agentKeysInteractive: true },
    });

    const key = result.getByRole('button', {
      name: m.settings_hardware_agentKey_ariaLabel({ number: '1', name: 'Alpha' }),
    });
    expect(key.getAttribute('aria-haspopup')).toBe('dialog');
    await fireEvent.keyDown(key, { key: 'Enter' });
    expect(key.getAttribute('aria-expanded')).toBe('true');
    expect(
      result.getByRole('dialog', {
        name: m.settings_hardware_agentKeyPopover_ariaLabel({ number: '1' }),
      }).textContent,
    ).toContain('Alpha');

    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(
      result.queryByRole('dialog', {
        name: m.settings_hardware_agentKeyPopover_ariaLabel({ number: '1' }),
      }),
    ).toBeNull();
    expect(key.getAttribute('aria-expanded')).toBe('false');
  });

  it('clicking another key moves the popover; outside pointerdown dismisses it', async () => {
    const { HardwareConsoleDeviceSvg, m } = await loadComponent();
    const result = render(HardwareConsoleDeviceSvg, {
      props: { agentSlots: SIX_SLOTS, agentKeysInteractive: true },
    });

    await fireEvent.click(
      result.getByRole('button', {
        name: m.settings_hardware_agentKey_ariaLabel({ number: '1', name: 'Alpha' }),
      }),
    );
    await fireEvent.click(
      result.getByRole('button', {
        name: m.settings_hardware_agentKey_ariaLabel({ number: '2', name: 'Beta' }),
      }),
    );
    expect(
      result.queryByRole('dialog', {
        name: m.settings_hardware_agentKeyPopover_ariaLabel({ number: '1' }),
      }),
    ).toBeNull();
    expect(
      result.getByRole('dialog', {
        name: m.settings_hardware_agentKeyPopover_ariaLabel({ number: '2' }),
      }).textContent,
    ).toContain('Beta');

    await fireEvent.pointerDown(document.body);
    expect(
      result.queryByRole('dialog', {
        name: m.settings_hardware_agentKeyPopover_ariaLabel({ number: '2' }),
      }),
    ).toBeNull();
  });

  it('renders agent keys inert (no buttons, no badges) when not interactive', async () => {
    const { HardwareConsoleDeviceSvg, m } = await loadComponent();
    const result = render(HardwareConsoleDeviceSvg, {
      props: { agentSlots: SIX_SLOTS, agentKeysInteractive: false },
    });

    expect(
      result.queryByRole('button', {
        name: m.settings_hardware_agentKey_ariaLabel({ number: '1', name: 'Alpha' }),
      }),
    ).toBeNull();
    expect(result.container.querySelectorAll('foreignObject')).toHaveLength(0);
  });

  it('renders numeric key labels 1-7 on the CM2 (no printed caps)', async () => {
    const { HardwareConsoleDeviceSvg, m } = await loadComponent();
    const result = render(HardwareConsoleDeviceSvg);

    expect(
      result.getByRole('group', { name: m.settings_hardware_deviceGraphic_ariaLabel() }),
    ).toBeTruthy();
    for (let n = 1; n <= 7; n += 1) {
      expect(
        result.getByRole('button', {
          name: m.settings_hardware_actionKey_ariaLabel({ number: String(n) }),
        }),
      ).toBeTruthy();
    }
  });

  it('renders printed-cap action keys on the Codex Micro, mic pair as two keys under a linked outline', async () => {
    const { HardwareConsoleDeviceSvg, m } = await loadComponent();
    const { codexCapLabel } = await import('./HardwareConsoleDeviceSvg.svelte');
    const onSelectKey = vi.fn();
    const result = render(HardwareConsoleDeviceSvg, {
      props: { model: 'codex-micro', onSelectKey },
    });

    expect(
      result.getByRole('group', { name: m.settings_hardware_deviceGraphicCodex_ariaLabel() }),
    ).toBeTruthy();

    const capButton = (slot: number) =>
      result.getByRole('button', {
        name: m.settings_hardware_codexActionKey_ariaLabel({
          number: String(slot + 1),
          cap: codexCapLabel(slot),
        }),
      });
    for (let slot = 0; slot < 7; slot += 1) expect(capButton(slot)).toBeTruthy();

    // The linked Mic pair stays two individually selectable keys.
    await fireEvent.click(capButton(4));
    expect(onSelectKey).toHaveBeenCalledWith(4);
    await fireEvent.click(capButton(5));
    expect(onSelectKey).toHaveBeenCalledWith(5);

    // Shared "linked" outline around the pair.
    expect(result.container.querySelector('rect[stroke-dasharray]')).toBeTruthy();
  });
});
