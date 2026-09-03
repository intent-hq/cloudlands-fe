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
const REAP_STEPPER_LABEL = 'Idle reap minutes';
const REAP_TOGGLE_LABEL = 'Reap idle agents';

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

    await waitFor(() => expect(screen.getByRole('slider')).toBeTruthy());
    const slider = screen.getByRole('slider') as HTMLInputElement;
    expect(slider.getAttribute('aria-valuetext')).toBe('Off');
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

    await waitFor(() =>
      expect((screen.getByLabelText(BUDGET_LABEL) as HTMLInputElement).value).toBe('1500'),
    );
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

    await waitFor(() =>
      expect(screen.getByRole('switch', { name: REAP_TOGGLE_LABEL })).toBeTruthy(),
    );
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
    // The ceiling widens to admit it rather than hiding it.
    expect((screen.getByRole('slider') as HTMLInputElement).max).toBe(String(configuredMb));
    // Nothing was written back: hydration must not rewrite the daemon's value.
    expect(mocks.mockSettingsUpdate).not.toHaveBeenCalled();
  });

  it('does not drop a return to the previous value while the first write is in flight', async () => {
    // 100 → 200 → 100 with the first write still outstanding. Comparing the
    // second 100 against the last acknowledgement (still 100) would read it as
    // a no-op, skip the write, and strand the daemon on 200. Two slider
    // releases in quick succession are enough to reach this.
    mockSettings({ budget: { value: 100, max: TOTAL_RAM_MB } });
    const pending: Array<(value: unknown) => void> = [];
    mocks.mockSettingsUpdate.mockImplementation(
      (changes: Array<{ path: string; value: number }>) =>
        new Promise((resolve) =>
          pending.push(() => resolve([{ path: changes[0].path, value: changes[0].value }])),
        ),
    );

    render(AgentBackendSettings);

    const input = (await waitFor(() => screen.getByLabelText(BUDGET_LABEL))) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '200' } });
    await fireEvent.blur(input);
    await waitFor(() => expect(pending).toHaveLength(1));

    await fireEvent.input(input, { target: { value: '100' } });
    await fireEvent.blur(input);

    // Held back rather than raced against the first write, then sent once it
    // resolves — the daemon may apply concurrent updates in either order, so
    // the return to 100 must not be in flight beside the 200.
    expect(pending).toHaveLength(1);
    pending[0]();
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(mocks.mockSettingsUpdate).toHaveBeenNthCalledWith(2, [
      { path: MEMORY_BUDGET_PATH, value: 100 },
    ]);

    pending[1]();
    await waitFor(() => expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('100'));
    expect((screen.getByLabelText(BUDGET_LABEL) as HTMLInputElement).value).toBe('100');
  });

  it('never has two writes for the same setting in flight at once', async () => {
    // Ordering cannot be recovered on the client: the transport allows
    // concurrent requests, so 100 → 200 → 300 could be applied 300 then 200 and
    // persist the value the user did not choose. Only one request at a time.
    mockSettings({ budget: { value: 100, max: TOTAL_RAM_MB } });
    const pending: Array<(value: unknown) => void> = [];
    mocks.mockSettingsUpdate.mockImplementation(
      (changes: Array<{ path: string; value: number }>) =>
        new Promise((resolve) =>
          pending.push(() => resolve([{ path: changes[0].path, value: changes[0].value }])),
        ),
    );

    render(AgentBackendSettings);

    const input = (await waitFor(() => screen.getByLabelText(BUDGET_LABEL))) as HTMLInputElement;
    for (const value of ['200', '300', '400']) {
      await fireEvent.input(input, { target: { value } });
      await fireEvent.blur(input);
    }

    expect(pending).toHaveLength(1);
    expect(mocks.mockSettingsUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.mockSettingsUpdate).toHaveBeenNthCalledWith(1, [
      { path: MEMORY_BUDGET_PATH, value: 200 },
    ]);

    // The intermediate 300 coalesces away; the user's final 400 is what follows.
    pending[0]();
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(mocks.mockSettingsUpdate).toHaveBeenCalledTimes(2);
    expect(mocks.mockSettingsUpdate).toHaveBeenNthCalledWith(2, [
      { path: MEMORY_BUDGET_PATH, value: 400 },
    ]);

    pending[1]();
    await waitFor(() => expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('400'));
  });

  it('does not overwrite a value the user is typing when an earlier save resolves', async () => {
    mockSettings({ budget: { value: 100, max: TOTAL_RAM_MB } });
    const pending: Array<(value: unknown) => void> = [];
    mocks.mockSettingsUpdate.mockImplementation(
      (changes: Array<{ path: string; value: number }>) =>
        new Promise((resolve) =>
          pending.push(() => resolve([{ path: changes[0].path, value: changes[0].value }])),
        ),
    );

    render(AgentBackendSettings);

    const input = (await waitFor(() => screen.getByLabelText(BUDGET_LABEL))) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '200' } });
    await fireEvent.blur(input);
    await waitFor(() => expect(pending).toHaveLength(1));

    // Still typing the next value when the earlier response lands.
    await fireEvent.input(input, { target: { value: '300' } });
    pending[0]();
    await waitFor(() => expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('200'));

    // The half-typed 300 survives; the field is not rewritten under the cursor.
    expect((screen.getByLabelText(BUDGET_LABEL) as HTMLInputElement).value).toBe('300');
  });
});

describe('AgentBackendSettings — idle reap minutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('reads 0 as an explicit off state with no minutes row rendered', async () => {
    mockSettings({ reap: { value: 0, defaultValue: 10 } });

    render(AgentBackendSettings);

    const toggle = await waitFor(() => screen.getByRole('switch', { name: REAP_TOGGLE_LABEL }));
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByLabelText(REAP_STEPPER_LABEL)).toBeNull();
    expect(screen.getByText(/Turn off to disable reaping entirely \(0 minutes\)\./)).toBeTruthy();
  });

  it('exposes the documented stepper range with 0 reachable through the toggle', async () => {
    mockSettings({ reap: { value: 10 } });

    render(AgentBackendSettings);

    const stepper = (await waitFor(() =>
      screen.getByLabelText(REAP_STEPPER_LABEL),
    )) as HTMLInputElement;
    expect(stepper.min).toBe('1');
    expect(stepper.max).toBe('120');
    expect(screen.getByText(/1–120 minutes\./)).toBeTruthy();
    expect(screen.getByText(/Turn off to disable reaping entirely \(0 minutes\)\./)).toBeTruthy();
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
    await waitFor(() => expect(screen.queryByLabelText(REAP_STEPPER_LABEL)).toBeNull());
  });

  it("keeps an existing install's own interval rather than migrating it to the new default", async () => {
    // The 30 → 10 default change ships for new installs only: an existing
    // config.toml keeps its explicit 30 permanently. This UI must therefore
    // show 30 and restore 30, never quietly write the daemon's newer default
    // over a value the user already has.
    mockSettings({ reap: { value: 30, defaultValue: 10 } });
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: IDLE_REAP_PATH, value: 0 }]);

    render(AgentBackendSettings);

    await waitFor(() =>
      expect((screen.getByLabelText(REAP_STEPPER_LABEL) as HTMLInputElement).value).toBe('30'),
    );

    // Off and back on round-trips their 30, not the catalog's 10.
    const toggle = screen.getByRole('switch', { name: REAP_TOGGLE_LABEL });
    await fireEvent.click(toggle);
    await waitFor(() =>
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([{ path: IDLE_REAP_PATH, value: 0 }]),
    );

    mocks.mockSettingsUpdate.mockResolvedValue([{ path: IDLE_REAP_PATH, value: 30 }]);
    await fireEvent.click(screen.getByRole('switch', { name: REAP_TOGGLE_LABEL }));

    await waitFor(() =>
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([{ path: IDLE_REAP_PATH, value: 30 }]),
    );
    expect(mocks.mockSettingsUpdate).not.toHaveBeenCalledWith([
      { path: IDLE_REAP_PATH, value: 10 },
    ]);
  });

  it('restores the daemon catalog default only when there is no interval to keep', async () => {
    mockSettings({ reap: { value: 0, defaultValue: 10 } });
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: IDLE_REAP_PATH, value: 10 }]);

    render(AgentBackendSettings);

    const toggle = await waitFor(() => screen.getByRole('switch', { name: REAP_TOGGLE_LABEL }));
    await fireEvent.click(toggle);

    await waitFor(() =>
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([{ path: IDLE_REAP_PATH, value: 10 }]),
    );
    await waitFor(() =>
      expect((screen.getByLabelText(REAP_STEPPER_LABEL) as HTMLInputElement).value).toBe('10'),
    );
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

    await waitFor(() =>
      expect(
        screen.getByRole('switch', { name: REAP_TOGGLE_LABEL }).getAttribute('aria-checked'),
      ).toBe('true'),
    );
    expect(
      screen.getByRole('switch', { name: REAP_TOGGLE_LABEL }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(screen.getByLabelText(REAP_STEPPER_LABEL)).toBeTruthy();
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

  it('removes the minutes row as soon as reaping is switched off, before the write lands', async () => {
    // The daemon still reports the old interval while the 0 is in flight. A
    // stepper left in the DOM in that window lets an edit queue a positive
    // write behind the disable and quietly undo the switch-off.
    mockSettings({ reap: { value: 10 } });
    const pending: Array<(value: unknown) => void> = [];
    mocks.mockSettingsUpdate.mockImplementation(
      (changes: Array<{ path: string; value: number }>) =>
        new Promise((resolve) =>
          pending.push(() => resolve([{ path: changes[0].path, value: changes[0].value }])),
        ),
    );

    render(AgentBackendSettings);

    const toggle = await waitFor(() => screen.getByRole('switch', { name: REAP_TOGGLE_LABEL }));
    await fireEvent.click(toggle);
    await waitFor(() => expect(pending).toHaveLength(1));

    expect(screen.queryByLabelText(REAP_STEPPER_LABEL)).toBeNull();

    pending[0]();
    await waitFor(() =>
      expect(
        screen.getByRole('switch', { name: REAP_TOGGLE_LABEL }).getAttribute('aria-checked'),
      ).toBe('false'),
    );
    expect(screen.queryByLabelText(REAP_STEPPER_LABEL)).toBeNull();
    // The disable is the only write: nothing resurrected the interval.
    expect(mocks.mockSettingsUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.mockSettingsUpdate).toHaveBeenNthCalledWith(1, [
      { path: IDLE_REAP_PATH, value: 0 },
    ]);
  });

  it('brings the minutes row back when a failed disable puts the toggle back', async () => {
    mockSettings({ reap: { value: 10 } });
    mocks.mockSettingsUpdate.mockRejectedValue(new Error('Network error'));

    render(AgentBackendSettings);

    const toggle = await waitFor(() => screen.getByRole('switch', { name: REAP_TOGGLE_LABEL }));
    await fireEvent.click(toggle);

    await waitFor(() =>
      expect((screen.getByLabelText(REAP_STEPPER_LABEL) as HTMLInputElement).value).toBe('10'),
    );
  });

  it('sends every toggle click even when the previous write is still in flight', async () => {
    // on → off → on with the first write outstanding. Comparing against the
    // last acknowledgement would read the third click as a no-op and leave
    // reaping disabled while the toggle shows it enabled.
    mockSettings({ reap: { value: 10 } });
    const pending: Array<(value: unknown) => void> = [];
    mocks.mockSettingsUpdate.mockImplementation(
      (changes: Array<{ path: string; value: number }>) =>
        new Promise((resolve) =>
          pending.push(() => resolve([{ path: changes[0].path, value: changes[0].value }])),
        ),
    );

    render(AgentBackendSettings);

    const toggle = await waitFor(() => screen.getByRole('switch', { name: REAP_TOGGLE_LABEL }));
    await fireEvent.click(toggle);
    await waitFor(() => expect(pending).toHaveLength(1));
    await fireEvent.click(screen.getByRole('switch', { name: REAP_TOGGLE_LABEL }));

    // Queued behind the first click rather than raced against it.
    expect(pending).toHaveLength(1);
    expect(mocks.mockSettingsUpdate).toHaveBeenNthCalledWith(1, [
      { path: IDLE_REAP_PATH, value: 0 },
    ]);

    pending[0]();
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(mocks.mockSettingsUpdate).toHaveBeenNthCalledWith(2, [
      { path: IDLE_REAP_PATH, value: 10 },
    ]);

    pending[1]();
    await waitFor(() =>
      expect(
        screen.getByRole('switch', { name: REAP_TOGGLE_LABEL }).getAttribute('aria-checked'),
      ).toBe('true'),
    );
    expect((screen.getByLabelText(REAP_STEPPER_LABEL) as HTMLInputElement).value).toBe('10');
  });
});
