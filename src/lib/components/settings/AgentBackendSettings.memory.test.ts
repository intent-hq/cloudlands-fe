/**
 * @vitest-environment jsdom
 *
 * Agent Backend memory bounds: `agents.memoryBudgetMb` and
 * `agents.idleReapMinutes`. Kept in its own file because these rows read the
 * catalog *definition* (the budget's maximum is the daemon's to supply), which
 * means mocking `settings.get` — the sibling suite deliberately exercises the
 * `settings.list` fallback instead.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import AgentBackendSettings from './AgentBackendSettings.svelte';
import { warmImport } from '../../../test/warm-import';

const mocks = vi.hoisted(() => ({
  mockSettingsGet: vi.fn(),
  mockSettingsUpdate: vi.fn(),
}));

vi.mock('$lib/client', () => ({
  appClient: {
    settings: {
      get: mocks.mockSettingsGet,
      update: mocks.mockSettingsUpdate,
    },
  },
}));

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});

const MEMORY_BUDGET_PATH = 'agents.memoryBudgetMb';
const IDLE_REAP_PATH = 'agents.idleReapMinutes';

// Deliberately not a round power-of-two guess: this is the total-RAM bound a
// 48 GB machine reports, and every assertion about the slider's ceiling reads
// it back rather than restating a constant the FE could have hardcoded.
const TOTAL_RAM_MB = 49152;

const BUDGET_LABEL = 'Agent memory budget';
const REAP_STEPPER_LABEL = 'Minutes before an idle agent is reaped';
const REAP_TOGGLE_LABEL = 'Reap idle agents';
const RESTART_NOTE = /Changes apply on daemon restart\./;
// Both rows read "Current: Off." when disabled, so anchor each assertion on the
// sentence that follows it rather than on the shared prefix.
const BUDGET_OFF = /Current: Off\. A soft admission gate/;
const REAP_OFF = /Current: Off\. How long an agent process/;

type Entry = Record<string, unknown> | null;

/**
 * Wire up `settings.get`. `budget`/`reap` accept `null` to model a daemon that
 * does not report the path at all.
 */
function mockSettings({
  budget = { value: 0, max: TOTAL_RAM_MB } as { value: number; max?: number } | null,
  reap = { value: 0, defaultValue: 10 } as {
    value: number;
    defaultValue?: number;
    max?: number;
  } | null,
}: {
  budget?: { value: number; max?: number } | null;
  reap?: { value: number; defaultValue?: number; max?: number } | null;
} = {}) {
  const entries: Record<string, Entry> = {
    'agents.maxConcurrent': { path: 'agents.maxConcurrent', value: 0, min: 0, max: 200 },
    'agents.flushQueuedMessages': { path: 'agents.flushQueuedMessages', value: 'all' },
    [MEMORY_BUDGET_PATH]: budget
      ? {
          path: MEMORY_BUDGET_PATH,
          type: 'number',
          min: 0,
          defaultValue: 0,
          ...budget,
        }
      : null,
    [IDLE_REAP_PATH]: reap ? { path: IDLE_REAP_PATH, type: 'number', min: 0, ...reap } : null,
  };
  mocks.mockSettingsGet.mockImplementation(async (path: string) => entries[path] ?? null);
}

warmImport(() => import('../ui/__tests__/mocks/Fa.svelte'));

describe('AgentBackendSettings — agent memory budget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('takes the slider maximum from the catalog bound rather than a built-in constant', async () => {
    mockSettings({ budget: { value: 1500, max: TOTAL_RAM_MB } });

    render(AgentBackendSettings);

    const slider = await waitFor(() => screen.getByRole('slider') as HTMLInputElement);
    expect(slider.max).toBe(String(TOTAL_RAM_MB));
    expect(slider.min).toBe('0');
    expect(slider.value).toBe('1500');
    const input = screen.getByLabelText(BUDGET_LABEL) as HTMLInputElement;
    expect(input.value).toBe('1500');
    expect(input.max).toBe(String(TOTAL_RAM_MB));
  });

  it('tracks a different machine bound, proving the maximum is read and not remembered', async () => {
    const otherMachineMb = 16384;
    mockSettings({ budget: { value: 0, max: otherMachineMb } });

    render(AgentBackendSettings);

    const slider = await waitFor(() => screen.getByRole('slider') as HTMLInputElement);
    expect(slider.max).toBe(String(otherMachineMb));
  });

  it('reads 0 as "Off" rather than as a zero-byte budget', async () => {
    mockSettings({ budget: { value: 0, max: TOTAL_RAM_MB } });

    render(AgentBackendSettings);

    await waitFor(() => expect(screen.getByText(BUDGET_OFF)).toBeTruthy());
    expect(screen.queryByText(/Current: 0 MB/)).toBeNull();
    const slider = screen.getByRole('slider') as HTMLInputElement;
    expect(slider.getAttribute('aria-valuetext')).toBe('Off');
  });

  it('says the change only takes effect on daemon restart', async () => {
    mockSettings();

    render(AgentBackendSettings);

    await waitFor(() => expect(screen.getByText(RESTART_NOTE)).toBeTruthy());
    // Both new rows carry the note, alongside the shipped max-concurrent row.
    expect(screen.getAllByText(RESTART_NOTE)).toHaveLength(3);
  });

  it('names the maximum as this machine total memory', async () => {
    mockSettings({ budget: { value: 0, max: TOTAL_RAM_MB } });

    render(AgentBackendSettings);

    await waitFor(() =>
      expect(
        screen.getByText(/the maximum, 49,152 MB, is this machine's total memory/),
      ).toBeTruthy(),
    );
  });

  it('persists a typed budget with the exact settings.update payload', async () => {
    mockSettings({ budget: { value: 0, max: TOTAL_RAM_MB } });
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: MEMORY_BUDGET_PATH, value: 2048 }]);

    render(AgentBackendSettings);

    const input = (await waitFor(() => screen.getByLabelText(BUDGET_LABEL))) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '2048' } });
    await fireEvent.blur(input);

    await waitFor(() =>
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: MEMORY_BUDGET_PATH, value: 2048 },
      ]),
    );
    await waitFor(() => expect(screen.getByText(/Current: 2,048 MB\./)).toBeTruthy());
  });

  it('persists 0 to turn the gate off', async () => {
    mockSettings({ budget: { value: 4096, max: TOTAL_RAM_MB } });
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: MEMORY_BUDGET_PATH, value: 0 }]);

    render(AgentBackendSettings);

    const input = (await waitFor(() => screen.getByLabelText(BUDGET_LABEL))) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '0' } });
    await fireEvent.blur(input);

    await waitFor(() =>
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: MEMORY_BUDGET_PATH, value: 0 },
      ]),
    );
    await waitFor(() => expect(screen.getByText(BUDGET_OFF)).toBeTruthy());
  });

  it('clamps a typed value above the catalog maximum', async () => {
    mockSettings({ budget: { value: 0, max: TOTAL_RAM_MB } });
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: MEMORY_BUDGET_PATH, value: TOTAL_RAM_MB }]);

    render(AgentBackendSettings);

    const input = (await waitFor(() => screen.getByLabelText(BUDGET_LABEL))) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '999999' } });
    await fireEvent.blur(input);

    await waitFor(() =>
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: MEMORY_BUDGET_PATH, value: TOTAL_RAM_MB },
      ]),
    );
  });

  it('restores the committed value and reports the failure when the save is rejected', async () => {
    mockSettings({ budget: { value: 1500, max: TOTAL_RAM_MB } });
    mocks.mockSettingsUpdate.mockResolvedValue([]);

    render(AgentBackendSettings);

    const input = (await waitFor(() => screen.getByLabelText(BUDGET_LABEL))) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '8192' } });
    await fireEvent.blur(input);

    await waitFor(() => expect(screen.getByText('Failed to save agent settings.')).toBeTruthy());
    expect((screen.getByLabelText(BUDGET_LABEL) as HTMLInputElement).value).toBe('1500');
    expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('1500');
  });

  it('drops the slider but keeps the field when the catalog reports no maximum', async () => {
    mockSettings({ budget: { value: 512 } });

    render(AgentBackendSettings);

    const input = (await waitFor(() => screen.getByLabelText(BUDGET_LABEL))) as HTMLInputElement;
    expect(input.value).toBe('512');
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('hides the row entirely when the daemon does not report the setting', async () => {
    mockSettings({ budget: null });

    render(AgentBackendSettings);

    await waitFor(() => expect(screen.getByLabelText(REAP_STEPPER_LABEL)).toBeTruthy());
    expect(screen.queryByLabelText(BUDGET_LABEL)).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('shows a configured budget above the catalog ceiling instead of clamping it down', async () => {
    // The config file's own validation is looser than the catalog bound, so a
    // budget larger than total memory is a value the daemon really holds.
    const configuredMb = 100000;
    mockSettings({ budget: { value: configuredMb, max: TOTAL_RAM_MB } });

    render(AgentBackendSettings);

    const input = (await waitFor(() => screen.getByLabelText(BUDGET_LABEL))) as HTMLInputElement;
    expect(input.value).toBe(String(configuredMb));
    expect(screen.getByText(/Current: 100,000 MB\./)).toBeTruthy();
    // The ceiling widens to admit it rather than hiding it.
    expect((screen.getByRole('slider') as HTMLInputElement).max).toBe(String(configuredMb));
    // …and the note claiming the maximum is this machine's total memory is
    // withheld, because with a widened ceiling it would not be true.
    expect(screen.queryByText(/is this machine's total memory/)).toBeNull();
    // Nothing was written back: hydration must not rewrite the daemon's value.
    expect(mocks.mockSettingsUpdate).not.toHaveBeenCalled();
  });
});

describe('AgentBackendSettings — idle reap minutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('reads 0 as an explicit off state with the stepper disabled', async () => {
    mockSettings({ reap: { value: 0, defaultValue: 10 } });

    render(AgentBackendSettings);

    const stepper = (await waitFor(() =>
      screen.getByLabelText(REAP_STEPPER_LABEL),
    )) as HTMLInputElement;
    expect(stepper.disabled).toBe(true);
    expect(
      screen.getByRole('switch', { name: REAP_TOGGLE_LABEL }).getAttribute('aria-checked'),
    ).toBe('false');
    expect(screen.getByText(REAP_OFF)).toBeTruthy();
  });

  it('exposes the documented stepper range with 0 reachable through the toggle', async () => {
    mockSettings({ reap: { value: 10 } });

    render(AgentBackendSettings);

    const stepper = (await waitFor(() =>
      screen.getByLabelText(REAP_STEPPER_LABEL),
    )) as HTMLInputElement;
    expect(stepper.min).toBe('1');
    expect(stepper.max).toBe('120');
    expect(stepper.disabled).toBe(false);
    expect(
      screen.getByText(
        /Turn off to disable reaping entirely \(0 minutes\); otherwise 1–120 minutes\./,
      ),
    ).toBeTruthy();
  });

  it('writes 0 when reaping is switched off — the disable state is reachable', async () => {
    mockSettings({ reap: { value: 10 } });
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: IDLE_REAP_PATH, value: 0 }]);

    render(AgentBackendSettings);

    const toggle = await waitFor(() => screen.getByRole('switch', { name: REAP_TOGGLE_LABEL }));
    await fireEvent.click(toggle);

    await waitFor(() =>
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([{ path: IDLE_REAP_PATH, value: 0 }]),
    );
    await waitFor(() =>
      expect((screen.getByLabelText(REAP_STEPPER_LABEL) as HTMLInputElement).disabled).toBe(true),
    );
    expect(screen.getByText(REAP_OFF)).toBeTruthy();
  });

  it('restores the daemon catalog default when reaping is switched back on', async () => {
    mockSettings({ reap: { value: 0, defaultValue: 10 } });
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: IDLE_REAP_PATH, value: 10 }]);

    render(AgentBackendSettings);

    const toggle = await waitFor(() => screen.getByRole('switch', { name: REAP_TOGGLE_LABEL }));
    await fireEvent.click(toggle);

    await waitFor(() =>
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([{ path: IDLE_REAP_PATH, value: 10 }]),
    );
    await waitFor(() => expect(screen.getByText(/Current: 10 min\./)).toBeTruthy());
  });

  it('falls back to the stepper minimum when the catalog default is itself off', async () => {
    mockSettings({ reap: { value: 0, defaultValue: 0 } });
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: IDLE_REAP_PATH, value: 1 }]);

    render(AgentBackendSettings);

    const toggle = await waitFor(() => screen.getByRole('switch', { name: REAP_TOGGLE_LABEL }));
    await fireEvent.click(toggle);

    await waitFor(() =>
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([{ path: IDLE_REAP_PATH, value: 1 }]),
    );
  });

  it('clamps a typed interval into the stepper range', async () => {
    mockSettings({ reap: { value: 10 } });
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: IDLE_REAP_PATH, value: 120 }]);

    render(AgentBackendSettings);

    const stepper = (await waitFor(() =>
      screen.getByLabelText(REAP_STEPPER_LABEL),
    )) as HTMLInputElement;
    await fireEvent.input(stepper, { target: { value: '500' } });
    await fireEvent.blur(stepper);

    await waitFor(() =>
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([{ path: IDLE_REAP_PATH, value: 120 }]),
    );
  });

  it('clamps a typed 0 up to the minimum instead of disabling reaping behind the toggle', async () => {
    mockSettings({ reap: { value: 10 } });
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: IDLE_REAP_PATH, value: 1 }]);

    render(AgentBackendSettings);

    const stepper = (await waitFor(() =>
      screen.getByLabelText(REAP_STEPPER_LABEL),
    )) as HTMLInputElement;
    await fireEvent.input(stepper, { target: { value: '0' } });
    await fireEvent.blur(stepper);

    await waitFor(() =>
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([{ path: IDLE_REAP_PATH, value: 1 }]),
    );
    expect(
      screen.getByRole('switch', { name: REAP_TOGGLE_LABEL }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('puts the toggle back when the daemon rejects the write', async () => {
    mockSettings({ reap: { value: 10 } });
    mocks.mockSettingsUpdate.mockRejectedValue(new Error('Network error'));

    render(AgentBackendSettings);

    const toggle = await waitFor(() => screen.getByRole('switch', { name: REAP_TOGGLE_LABEL }));
    await fireEvent.click(toggle);

    await waitFor(() => expect(screen.getByText('Failed to save agent settings.')).toBeTruthy());
    expect(
      screen.getByRole('switch', { name: REAP_TOGGLE_LABEL }).getAttribute('aria-checked'),
    ).toBe('true');
    expect((screen.getByLabelText(REAP_STEPPER_LABEL) as HTMLInputElement).disabled).toBe(false);
  });

  it('respects a catalog-supplied maximum over the UI convention', async () => {
    mockSettings({ reap: { value: 10, max: 60 } });

    render(AgentBackendSettings);

    const stepper = (await waitFor(() =>
      screen.getByLabelText(REAP_STEPPER_LABEL),
    )) as HTMLInputElement;
    expect(stepper.max).toBe('60');
  });

  it('shows a configured interval above the 120-minute convention instead of clamping it', async () => {
    // The catalog declares no maximum for this setting, so 240 is a perfectly
    // valid daemon-owned interval; 1–120 is only a convention for picking one.
    mockSettings({ reap: { value: 240, defaultValue: 10 } });

    render(AgentBackendSettings);

    const stepper = (await waitFor(() =>
      screen.getByLabelText(REAP_STEPPER_LABEL),
    )) as HTMLInputElement;
    expect(stepper.value).toBe('240');
    expect(stepper.max).toBe('240');
    expect(screen.getByText(/Current: 240 min\./)).toBeTruthy();
    expect(mocks.mockSettingsUpdate).not.toHaveBeenCalled();
  });

  it('does not write the convention ceiling back over a larger configured interval', async () => {
    mockSettings({ reap: { value: 240, defaultValue: 10 } });
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: IDLE_REAP_PATH, value: 0 }]);

    render(AgentBackendSettings);

    // Toggling off and back on must restore 240, not the 120 convention.
    const toggle = await waitFor(() => screen.getByRole('switch', { name: REAP_TOGGLE_LABEL }));
    await fireEvent.click(toggle);
    await waitFor(() =>
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([{ path: IDLE_REAP_PATH, value: 0 }]),
    );

    mocks.mockSettingsUpdate.mockResolvedValue([{ path: IDLE_REAP_PATH, value: 240 }]);
    await fireEvent.click(screen.getByRole('switch', { name: REAP_TOGGLE_LABEL }));

    await waitFor(() =>
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([{ path: IDLE_REAP_PATH, value: 240 }]),
    );
  });

  it('hides the row entirely when the daemon does not report the setting', async () => {
    mockSettings({ reap: null });

    render(AgentBackendSettings);

    await waitFor(() => expect(screen.getByLabelText(BUDGET_LABEL)).toBeTruthy());
    expect(screen.queryByLabelText(REAP_STEPPER_LABEL)).toBeNull();
    expect(screen.queryByRole('switch', { name: REAP_TOGGLE_LABEL })).toBeNull();
  });
});
