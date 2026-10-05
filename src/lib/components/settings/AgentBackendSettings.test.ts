import { admitLegacyPrincipal } from '../../../test/fixtures/principal-state';
/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import AgentBackendSettings from './AgentBackendSettings.svelte';
import { warmImport } from '../../../test/warm-import';
import { m } from '$shared/paraglide/messages.js';
import { store } from '$store/renderer/store';
import { settingsFormSaga } from '$store/renderer/slices/settings-events/sagas/settings-form-saga';

let stop: () => void;
beforeEach(() => {
  store.init();
  admitLegacyPrincipal();
  stop = store.runSaga(settingsFormSaga);
});
afterEach(() => {
  cleanup();
  stop();
  store.dispose();
});

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
function mockSettings({ maxConcurrent = 0 }: { maxConcurrent?: number } = {}) {
  mocks.mockSettingsList.mockResolvedValue([{ path: MAX_CONCURRENT_PATH, value: maxConcurrent }]);
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../ui/__tests__/mocks/Fa.svelte'));

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
  });

  it('loads and displays explicit cap setting', async () => {
    mockSettings({ maxConcurrent: 12 });

    render(AgentBackendSettings);

    await waitFor(() => {
      const input = screen.getByPlaceholderText('Auto') as HTMLInputElement;
      expect(input.value).toBe('12');
    });
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

  it('saves valid positive integer on Enter', async () => {
    mockSettings({ maxConcurrent: 0 });
    mocks.mockSettingsUpdate.mockResolvedValue([{ path: 'agents.maxConcurrent', value: 8 }]);
    render(AgentBackendSettings);
    const input = await waitFor(() => screen.getByPlaceholderText('Auto') as HTMLInputElement);

    await fireEvent.input(input, { target: { value: '8' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'agents.maxConcurrent', value: 8 },
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
    await waitFor(() => expect(input.value).toBe('10'));

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
      expect(screen.getByText(m.settings_agentBackend_loadError())).toBeTruthy();
    });
  });
});
