import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { VoiceSettingsSliceState } from '$store/renderer/slices/voice-settings/voice-settings-types';
import { m } from '$shared/paraglide/messages.js';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), voice: {} as VoiceSettingsSliceState }));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({ voiceSettings: mocks.voice }),
    dispatch: mocks.dispatch,
  });
});

import VoiceSettings from './VoiceSettings.svelte';
import {
  initialState,
  changeVoiceInputDevice,
} from '$store/renderer/slices/voice-settings/voice-settings-slice';

beforeEach(() => {
  mocks.dispatch.mockClear();
  mocks.voice = { ...initialState, isLoading: false, available: true };
});
afterEach(cleanup);

describe('voice input selection', () => {
  it('keeps a disconnected selection explicit until the user chooses the system default', async () => {
    mocks.voice.inputDeviceId = 'disconnected-mic';
    render(VoiceSettings);
    const trigger = screen.getByRole('combobox', {
      name: m.settings_voice_inputDevice_ariaLabel(),
    });
    expect(trigger.textContent).toContain(
      m.settings_voice_inputDevice_unavailable({ id: 'disconnected-mic' }),
    );
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    const unavailable = screen.getByRole('option', {
      name: m.settings_voice_inputDevice_unavailable({ id: 'disconnected-mic' }),
    });
    expect(unavailable.getAttribute('aria-disabled')).toBe('true');
    await fireEvent.pointerUp(unavailable, { pointerType: 'mouse' });
    expect(mocks.dispatch).not.toHaveBeenCalledWith(changeVoiceInputDevice('disconnected-mic'));
    await fireEvent.pointerUp(
      screen.getByRole('option', { name: m.settings_voice_inputDevice_default() }),
      { pointerType: 'mouse' },
    );
    expect(mocks.dispatch).toHaveBeenCalledWith(changeVoiceInputDevice(null));
  });

  it('gives permission-hidden device names a usable label and dispatches the device ID', async () => {
    mocks.voice.inputDevices = [{ deviceId: 'mic-2', label: '' }];
    render(VoiceSettings);
    const trigger = screen.getByRole('combobox', {
      name: m.settings_voice_inputDevice_ariaLabel(),
    });
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    await fireEvent.pointerUp(
      screen.getByRole('option', { name: m.settings_voice_inputDevice_unnamed({ number: 1 }) }),
      { pointerType: 'mouse' },
    );
    expect(mocks.dispatch).toHaveBeenCalledWith(changeVoiceInputDevice('mic-2'));
  });
});
