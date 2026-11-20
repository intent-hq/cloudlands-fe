/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { m } from '$shared/paraglide/messages.js';
import ActionKeyHud from '../ActionKeyHud.svelte';

const state = vi.hoisted(() => ({
  hardwareConsole: {
    actionHudLabel: null as string | null,
    pttRecording: false,
    pttRecordingSource: null as string | null,
    pttRecordingStartedAt: null as number | null,
    pttInputLevels: [] as number[],
  },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => state });
});

function record(source: string) {
  Object.assign(state.hardwareConsole, {
    pttRecording: true,
    pttRecordingSource: source,
    pttRecordingStartedAt: 3_000,
    pttInputLevels: [0.1, 0.9, 0.4, 0.2, 0.6],
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.assign(state.hardwareConsole, {
    actionHudLabel: null,
    pttRecording: false,
    pttRecordingSource: null,
    pttRecordingStartedAt: null,
    pttInputLevels: [],
  });
});

describe('ActionKeyHud dictation', () => {
  it('shows the elapsed time and level bars while the hardware voice key records', () => {
    vi.useFakeTimers({ now: 10_000, toFake: ['Date'] });
    record('key');
    render(ActionKeyHud);
    const status = screen.getByRole('status');
    expect(status.querySelector('[data-dictation-elapsed]')?.textContent).toBe('0:07');
    expect(status.querySelectorAll('[data-dictation-waveform] > span')).toHaveLength(5);
    expect(status.textContent).toContain(m.hardwareConsole_ptt_listening_label());
  });

  it.each(['composer', 'prompt', 'discussion'])(
    'stays hidden while the %s mic records (that surface shows its own pill)',
    (source) => {
      record(source);
      render(ActionKeyHud);
      expect(screen.queryByRole('status')).toBeNull();
    },
  );

  it('still shows an action label while another surface records', () => {
    record('composer');
    state.hardwareConsole.actionHudLabel = 'Cycle idle agents';
    render(ActionKeyHud);
    expect(screen.getByRole('status').textContent).toContain('Cycle idle agents');
    expect(screen.getByRole('status').querySelector('[data-dictation-waveform]')).toBeNull();
  });
});
