/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { warmImport } from '../../../test/warm-import';
import type { HardwareDeviceModel } from '$features/hardware-console/input/types';

const mocks = vi.hoisted(() => ({
  state: { current: {} as unknown },
  emit: () => {},
  dispatch: vi.fn(),
  manager: {
    status: 'connected',
    connectedDevice: { model: 'creator-micro-2', name: 'Creator Micro 2' },
    onStatus: (_status: string) => {},
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
    onStatusChange: (listener: (status: string) => void) => {
      mocks.manager.onStatus = listener;
      return () => {};
    },
    connectedCollections: () => Promise.resolve([]),
  }),
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  const module = createAppStoreMockModule({
    state: () => mocks.state.current,
    dispatch: mocks.dispatch,
  });
  mocks.emit = module.store.emitState;
  return module;
});

import {
  hardwareConsoleReducer,
  hardwareConsoleEncoderBehaviorSaveFailed,
  hydrateHardwareConsoleEncoderBehavior,
  initialState,
} from '$store/renderer/slices/hardware-console/hardware-console-slice';
import { m } from '$shared/paraglide/messages.js';

warmImport(() => import('./HardwareConsoleSettings.svelte'));

function connect(model: HardwareDeviceModel) {
  mocks.manager.status = 'connected';
  mocks.manager.connectedDevice = { model, name: model };
  mocks.manager.onStatus('connected');
}

beforeEach(() => {
  vi.clearAllMocks();
  let state = {
    hardwareConsole: initialState,
    workspace: { workspaces: createCollection('id', []) },
  };
  mocks.state.current = state;
  mocks.dispatch.mockImplementation((action: Parameters<typeof hardwareConsoleReducer>[1]) => {
    state = { ...state, hardwareConsole: hardwareConsoleReducer(state.hardwareConsole, action) };
    mocks.state.current = state;
    mocks.emit();
  });
});
afterEach(cleanup);

describe('shared Micro encoder preference control', () => {
  it.each(
    (['codex-micro', 'creator-micro-2'] as const).flatMap((model) =>
      (['agent-effort', 'workspace-switch'] as const).map((behavior) => ({ model, behavior })),
    ),
  )(
    'keeps the open $model knob hint in sync with $behavior and keyboard changes',
    async ({ model, behavior }) => {
      connect(model);
      mocks.dispatch(hydrateHardwareConsoleEncoderBehavior(behavior));
      const HardwareConsoleSettings = (await import('./HardwareConsoleSettings.svelte')).default;
      render(HardwareConsoleSettings);
      const knob = screen.getByRole('button', { name: m.settings_hardware_knob_ariaLabel() });
      await fireEvent.keyDown(knob, { key: 'Enter' });
      const dialog = screen.getByRole('dialog', {
        name: m.settings_hardware_knobExplainer_label(),
      });
      const effortHint = m.settings_hardware_knobExplainer_effort_description();
      const workspaceHint = m.settings_hardware_knobExplainer_rotate_description();
      const initialHint = behavior === 'agent-effort' ? effortHint : workspaceHint;
      const changedHint = behavior === 'agent-effort' ? workspaceHint : effortHint;
      expect(dialog.textContent).toContain(initialHint);
      expect(dialog.textContent).not.toContain(changedHint);
      expect(dialog.textContent).toContain(m.settings_hardware_knobExplainer_click_description());
      expect(dialog.textContent).toContain(
        m.settings_hardware_knobExplainer_configurable_description({
          setting: m.settings_hardware_encoderBehavior_label(),
        }),
      );
      expect(dialog.textContent).not.toContain(m.settings_hardware_explainer_fixed_description());

      const trigger = screen.getByRole('combobox', {
        name: m.settings_hardware_encoderBehavior_label(),
      });
      trigger.focus();
      await fireEvent.keyDown(trigger, { key: 'Enter' });
      await fireEvent.keyDown(trigger, {
        key: behavior === 'agent-effort' ? 'ArrowDown' : 'ArrowUp',
      });
      await fireEvent.keyDown(trigger, { key: 'Enter' });
      await waitFor(() => expect(dialog.textContent).toContain(changedHint));
      expect(dialog.textContent).not.toContain(initialHint);
      expect(screen.getByRole('dialog', { name: m.settings_hardware_knobExplainer_label() })).toBe(
        dialog,
      );
      await fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(knob.getAttribute('aria-expanded')).toBe('false');

      await fireEvent.click(
        screen.getByRole('button', { name: m.settings_hardware_joystick_ariaLabel() }),
      );
      const joystick = screen.getByRole('dialog', {
        name: m.settings_hardware_joystickExplainer_label(),
      });
      expect(joystick.textContent).toContain(m.settings_hardware_explainer_fixed_description());
      expect(joystick.textContent).not.toContain(changedHint);
    },
  );

  it.each<HardwareDeviceModel>(['codex-micro', 'creator-micro-2'])(
    'changes the shared choice from %s and keeps it when the other model connects',
    async (model) => {
      connect(model);
      const HardwareConsoleSettings = (await import('./HardwareConsoleSettings.svelte')).default;
      render(HardwareConsoleSettings);
      const trigger = screen.getByRole('combobox', {
        name: m.settings_hardware_encoderBehavior_label(),
      });
      trigger.focus();
      await fireEvent.keyDown(trigger, { key: 'Enter' });
      expect(
        screen
          .getByRole('option', { name: m.settings_hardware_encoderBehavior_effort_label() })
          .getAttribute('aria-selected'),
      ).toBe('true');
      await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      await fireEvent.keyDown(trigger, { key: 'Enter' });
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'hardwareConsole/setEncoderBehavior',
          payload: ['workspace-switch'],
        }),
      );
      await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
      mocks.manager.onStatus('disconnected');
      connect(model === 'codex-micro' ? 'creator-micro-2' : 'codex-micro');
      await fireEvent.keyDown(trigger, { key: 'Enter' });
      expect(
        screen
          .getByRole('option', { name: m.settings_hardware_encoderBehavior_workspaces_label() })
          .getAttribute('aria-selected'),
      ).toBe('true');
      await fireEvent.keyDown(trigger, { key: 'ArrowUp' });
      await fireEvent.keyDown(trigger, { key: 'Enter' });
      expect(mocks.dispatch).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: 'hardwareConsole/setEncoderBehavior',
          payload: ['agent-effort'],
        }),
      );
    },
  );

  it('announces a failed save and lets the user select the choice again', async () => {
    const HardwareConsoleSettings = (await import('./HardwareConsoleSettings.svelte')).default;
    render(HardwareConsoleSettings);
    const trigger = screen.getByRole('combobox', {
      name: m.settings_hardware_encoderBehavior_label(),
    });
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(mocks.dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'hardwareConsole/setEncoderBehavior',
        payload: ['workspace-switch'],
      }),
    );
    mocks.dispatch(hardwareConsoleEncoderBehaviorSaveFailed('agent-effort'));
    const error = await screen.findByRole('alert');
    expect(trigger.getAttribute('aria-describedby')?.split(' ')).toContain(error.id);
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(
      screen
        .getByRole('option', { name: m.settings_hardware_encoderBehavior_effort_label() })
        .getAttribute('aria-selected'),
    ).toBe('true');
    await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(mocks.dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'hardwareConsole/setEncoderBehavior',
        payload: ['workspace-switch'],
      }),
    );
  });
});
