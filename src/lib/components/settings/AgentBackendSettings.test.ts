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

describe('AgentBackendSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('loads and displays auto setting (0) as empty input', async () => {
    mocks.mockSettingsGet.mockResolvedValue({ path: 'agents.maxConcurrent', value: 0 });

    render(AgentBackendSettings);

    await waitFor(() => {
      const input = screen.getByPlaceholderText('Auto') as HTMLInputElement;
      expect(input.value).toBe('');
    });

    expect(screen.getByText(/Current: Auto \(based on system RAM\)/)).toBeTruthy();
  });

  it('loads and displays explicit cap setting', async () => {
    mocks.mockSettingsGet.mockResolvedValue({ path: 'agents.maxConcurrent', value: 12 });

    render(AgentBackendSettings);

    await waitFor(() => {
      const input = screen.getByPlaceholderText('Auto') as HTMLInputElement;
      expect(input.value).toBe('12');
    });

    expect(screen.getByText(/Current: 12\./)).toBeTruthy();
  });

  it('saves valid positive integer on blur', async () => {
    mocks.mockSettingsGet.mockResolvedValue({ path: 'agents.maxConcurrent', value: 0 });
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
    mocks.mockSettingsGet.mockResolvedValue({ path: 'agents.maxConcurrent', value: 12 });
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
    mocks.mockSettingsGet.mockResolvedValue({ path: 'agents.maxConcurrent', value: 12 });
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
    mocks.mockSettingsGet.mockResolvedValue({ path: 'agents.maxConcurrent', value: 0 });
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
    mocks.mockSettingsGet.mockResolvedValue({ path: 'agents.maxConcurrent', value: 10 });

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
