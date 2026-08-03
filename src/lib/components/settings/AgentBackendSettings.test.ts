/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import AgentBackendSettings from './AgentBackendSettings.svelte';

// Mock appClient - use vi.hoisted to avoid hoisting issues
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

const MAX_CONCURRENT_PATH = 'agents.maxConcurrent';
const FLUSH_PATH = 'agents.flushQueuedMessages';
const FLUSH_LABEL = /Flush queued messages together/;

/** Path-aware settings.get mock; `flush: undefined` = daemon has no value (null). */
function mockSettings({
  maxConcurrent = 0,
  flush,
}: { maxConcurrent?: number; flush?: boolean } = {}) {
  mocks.mockSettingsGet.mockImplementation(async (path: string) => {
    if (path === MAX_CONCURRENT_PATH) return { path, value: maxConcurrent };
    if (path === FLUSH_PATH) return flush === undefined ? null : { path, value: flush };
    return null;
  });
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
    mocks.mockSettingsGet.mockRejectedValue(new Error('Network error'));

    render(AgentBackendSettings);

    await waitFor(() => {
      expect(screen.getByText('Failed to load agent settings from the backend.')).toBeTruthy();
    });
  });
});

describe('AgentBackendSettings — flush queued messages toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('defaults to on when the daemon has no value for the setting', async () => {
    mockSettings({ flush: undefined });

    render(AgentBackendSettings);

    const toggle = await waitFor(
      () => screen.getByRole('switch', { name: FLUSH_LABEL }) as HTMLButtonElement,
    );
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('renders off when the daemon reports false', async () => {
    mockSettings({ flush: false });

    render(AgentBackendSettings);

    const toggle = await waitFor(
      () => screen.getByRole('switch', { name: FLUSH_LABEL }) as HTMLButtonElement,
    );
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('persists a toggle-off via settings.update with the exact payload', async () => {
    mockSettings({ flush: true });
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: FLUSH_PATH, value: false }]);

    render(AgentBackendSettings);

    const toggle = await waitFor(
      () => screen.getByRole('switch', { name: FLUSH_LABEL }) as HTMLButtonElement,
    );
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: FLUSH_PATH, value: false },
      ]);
      expect(toggle.getAttribute('aria-checked')).toBe('false');
    });
  });

  it('persists a toggle-on via settings.update with the exact payload', async () => {
    mockSettings({ flush: false });
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: FLUSH_PATH, value: true }]);

    render(AgentBackendSettings);

    const toggle = await waitFor(
      () => screen.getByRole('switch', { name: FLUSH_LABEL }) as HTMLButtonElement,
    );
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([{ path: FLUSH_PATH, value: true }]);
      expect(toggle.getAttribute('aria-checked')).toBe('true');
    });
  });

  it('keeps the current value and shows an error when the update fails', async () => {
    mockSettings({ flush: true });
    mocks.mockSettingsUpdate.mockRejectedValue(new Error('Network error'));

    render(AgentBackendSettings);

    const toggle = await waitFor(
      () => screen.getByRole('switch', { name: FLUSH_LABEL }) as HTMLButtonElement,
    );
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByText('Failed to save agent settings.')).toBeTruthy();
      expect(toggle.getAttribute('aria-checked')).toBe('true');
    });
  });
});
