/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import AgentBackendSettings from './AgentBackendSettings.svelte';

// Mock appClient - use vi.hoisted to avoid hoisting issues
const mocks = vi.hoisted(() => ({
  mockSettingsList: vi.fn(),
  mockSettingsUpdate: vi.fn(),
}));

vi.mock('$lib/client', () => ({
  appClient: {
    settings: {
      list: mocks.mockSettingsList,
      update: mocks.mockSettingsUpdate,
    },
  },
}));

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});

const MAX_CONCURRENT_PATH = 'agents.maxConcurrent';
const FLUSH_PATH = 'agents.flushQueuedMessages';
const FLUSH_TRIGGER = { name: /Flush queued messages/ };

/** settings.list mock; `flush: undefined` = daemon does not report the setting. */
function mockSettings({
  maxConcurrent = 0,
  flush,
}: { maxConcurrent?: number; flush?: string | boolean } = {}) {
  mocks.mockSettingsList.mockResolvedValue([
    { path: MAX_CONCURRENT_PATH, value: maxConcurrent },
    ...(flush === undefined ? [] : [{ path: FLUSH_PATH, value: flush }]),
  ]);
}

describe('AgentBackendSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('loads and displays auto setting (0) as empty input', async () => {
    mockSettings({ maxConcurrent: 0 });

    render(AgentBackendSettings);

    await waitFor(() => {
      const input = screen.getByPlaceholderText('Auto') as HTMLInputElement;
      expect(input.value).toBe('');
    });

    expect(screen.getByText(/Current: Auto \(based on system RAM\)/)).toBeTruthy();
  });

  it('loads and displays explicit cap setting', async () => {
    mockSettings({ maxConcurrent: 12 });

    render(AgentBackendSettings);

    await waitFor(() => {
      const input = screen.getByPlaceholderText('Auto') as HTMLInputElement;
      expect(input.value).toBe('12');
    });

    expect(screen.getByText(/Current: 12\./)).toBeTruthy();
  });

  it('saves valid positive integer on blur', async () => {
    mockSettings({ maxConcurrent: 0 });
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: 'agents.maxConcurrent', value: 10 }]);

    render(AgentBackendSettings);

    const input = await waitFor(() => screen.getByPlaceholderText('Auto') as HTMLInputElement);

    await fireEvent.input(input, { target: { value: '10' } });
    await fireEvent.blur(input);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'agents.maxConcurrent', value: 10 },
      ]);
    });
  });

  it('saves 0 when input is empty', async () => {
    mockSettings({ maxConcurrent: 12 });
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: 'agents.maxConcurrent', value: 0 }]);

    render(AgentBackendSettings);

    const input = await waitFor(() => screen.getByPlaceholderText('Auto') as HTMLInputElement);

    await fireEvent.input(input, { target: { value: '' } });
    await fireEvent.blur(input);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'agents.maxConcurrent', value: 0 },
      ]);
    });
  });

  it('saves 0 when input is "0"', async () => {
    mockSettings({ maxConcurrent: 12 });
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: 'agents.maxConcurrent', value: 0 }]);

    render(AgentBackendSettings);

    const input = await waitFor(() => screen.getByPlaceholderText('Auto') as HTMLInputElement);

    await fireEvent.input(input, { target: { value: '0' } });
    await fireEvent.blur(input);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'agents.maxConcurrent', value: 0 },
      ]);
    });
  });

  it('clamps value to 200 maximum', async () => {
    mockSettings({ maxConcurrent: 0 });
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: 'agents.maxConcurrent', value: 200 }]);

    render(AgentBackendSettings);

    const input = await waitFor(() => screen.getByPlaceholderText('Auto') as HTMLInputElement);

    await fireEvent.input(input, { target: { value: '250' } });
    await fireEvent.blur(input);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'agents.maxConcurrent', value: 200 },
      ]);
    });
  });

  it('rejects negative values and keeps current value', async () => {
    mockSettings({ maxConcurrent: 10 });

    render(AgentBackendSettings);

    const input = await waitFor(() => screen.getByPlaceholderText('Auto') as HTMLInputElement);
    expect(input.value).toBe('10');

    await fireEvent.input(input, { target: { value: '-5' } });
    await fireEvent.blur(input);

    // Should not call update and reset to original value
    expect(mocks.mockSettingsUpdate).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(input.value).toBe('10');
    });
  });

  it('displays error message on load failure', async () => {
    // The live client folds read failures to an empty list rather than throwing.
    mocks.mockSettingsList.mockResolvedValue([]);

    render(AgentBackendSettings);

    await waitFor(() => {
      expect(screen.getByText('Failed to load agent settings from the backend.')).toBeTruthy();
    });
  });
});

describe('AgentBackendSettings — flush queued messages mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('defaults to "All Queued Messages" when the daemon has no value for the setting', async () => {
    mockSettings({ flush: undefined });

    render(AgentBackendSettings);

    const trigger = await waitFor(() => screen.getByRole('button', FLUSH_TRIGGER));
    expect(trigger.textContent).toContain('All Queued Messages');
  });

  it('defaults to "All Queued Messages" when the daemon reports a legacy boolean', async () => {
    mockSettings({ flush: true });

    render(AgentBackendSettings);

    const trigger = await waitFor(() => screen.getByRole('button', FLUSH_TRIGGER));
    expect(trigger.textContent).toContain('All Queued Messages');
  });

  it('renders "System Messages Only" when the daemon reports systemOnly', async () => {
    mockSettings({ flush: 'systemOnly' });

    render(AgentBackendSettings);

    const trigger = await waitFor(() => screen.getByRole('button', FLUSH_TRIGGER));
    expect(trigger.textContent).toContain('System Messages Only');
  });

  it('renders "Off (FIFO)" when the daemon reports off', async () => {
    mockSettings({ flush: 'off' });

    render(AgentBackendSettings);

    const trigger = await waitFor(() => screen.getByRole('button', FLUSH_TRIGGER));
    expect(trigger.textContent).toContain('Off (FIFO)');
  });

  it('persists a selection of systemOnly via settings.update with the exact payload', async () => {
    mockSettings({ flush: 'all' });
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: FLUSH_PATH, value: 'systemOnly' }]);

    render(AgentBackendSettings);

    const trigger = await waitFor(() => screen.getByRole('button', FLUSH_TRIGGER));
    await fireEvent.click(trigger);

    const option = await waitFor(() => screen.getByRole('button', { name: 'System Messages Only' }));
    await fireEvent.click(option);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: FLUSH_PATH, value: 'systemOnly' },
      ]);
    });
    expect(screen.getByRole('button', FLUSH_TRIGGER).textContent).toContain(
      'System Messages Only',
    );
  });

  it('persists a selection of off via settings.update with the exact payload', async () => {
    mockSettings({ flush: 'all' });
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: FLUSH_PATH, value: 'off' }]);

    render(AgentBackendSettings);

    const trigger = await waitFor(() => screen.getByRole('button', FLUSH_TRIGGER));
    await fireEvent.click(trigger);

    const option = await waitFor(() => screen.getByRole('button', { name: 'Off (FIFO)' }));
    await fireEvent.click(option);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([{ path: FLUSH_PATH, value: 'off' }]);
    });
    expect(screen.getByRole('button', FLUSH_TRIGGER).textContent).toContain('Off (FIFO)');
  });

  it('persists a selection of all via settings.update with the exact payload', async () => {
    mockSettings({ flush: 'off' });
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: FLUSH_PATH, value: 'all' }]);

    render(AgentBackendSettings);

    const trigger = await waitFor(() => screen.getByRole('button', FLUSH_TRIGGER));
    await fireEvent.click(trigger);

    const option = await waitFor(() => screen.getByRole('button', { name: 'All Queued Messages' }));
    await fireEvent.click(option);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([{ path: FLUSH_PATH, value: 'all' }]);
    });
    expect(screen.getByRole('button', FLUSH_TRIGGER).textContent).toContain(
      'All Queued Messages',
    );
  });

  it('keeps the current value and shows an error when the update fails', async () => {
    mockSettings({ flush: 'all' });
    mocks.mockSettingsUpdate.mockRejectedValue(new Error('Network error'));

    render(AgentBackendSettings);

    const trigger = await waitFor(() => screen.getByRole('button', FLUSH_TRIGGER));
    await fireEvent.click(trigger);

    const option = await waitFor(() => screen.getByRole('button', { name: 'Off (FIFO)' }));
    await fireEvent.click(option);

    await waitFor(() => {
      expect(screen.getByText('Failed to save agent settings.')).toBeTruthy();
      expect(screen.getByRole('button', FLUSH_TRIGGER).textContent).toContain(
        'All Queued Messages',
      );
    });
  });

  it('keeps the current value and shows an error when the daemon does not apply the path', async () => {
    mockSettings({ flush: 'all' });
    mocks.mockSettingsUpdate.mockResolvedValue([]);

    render(AgentBackendSettings);

    const trigger = await waitFor(() => screen.getByRole('button', FLUSH_TRIGGER));
    await fireEvent.click(trigger);

    const option = await waitFor(() => screen.getByRole('button', { name: 'Off (FIFO)' }));
    await fireEvent.click(option);

    await waitFor(() => {
      expect(screen.getByText('Failed to save agent settings.')).toBeTruthy();
      expect(screen.getByRole('button', FLUSH_TRIGGER).textContent).toContain(
        'All Queued Messages',
      );
    });
  });

  it('commits the daemon-applied value rather than the requested one', async () => {
    mockSettings({ flush: 'all' });
    // Daemon acknowledges the path but reports it kept the setting at "all".
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: FLUSH_PATH, value: 'all' }]);

    render(AgentBackendSettings);

    const trigger = await waitFor(() => screen.getByRole('button', FLUSH_TRIGGER));
    await fireEvent.click(trigger);

    const option = await waitFor(() => screen.getByRole('button', { name: 'Off (FIFO)' }));
    await fireEvent.click(option);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([{ path: FLUSH_PATH, value: 'off' }]);
      expect(screen.getByRole('button', FLUSH_TRIGGER).textContent).toContain(
        'All Queued Messages',
      );
    });
  });
});
