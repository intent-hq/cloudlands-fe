/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import AgentFeaturesSettings from './AgentFeaturesSettings.svelte';

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

// Mock toast
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('svelte-sonner', () => ({
  toast: mockToast,
}));

const FEATURE_PATHS = [
  'agentFeatures.backgroundHooks',
  'agentFeatures.hostExec',
  'agentFeatures.scripts',
  'agentFeatures.terminalAccess',
  'agentFeatures.browserAutomation',
  'agentFeatures.richChatBlocks',
  'agentFeatures.structuredQuestions',
  'agentFeatures.attentionRequests',
  'agentFeatures.stateSnapshot',
  'agentFeatures.prMonitor',
  'agentFeatures.taskGraph',
];

describe('AgentFeaturesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default daemon state (PROTOCOL §5.12 settings.list entries): all on
    // except taskGraph, the one default-off opt-in (intent-hq/monorepo#2445)
    mocks.mockSettingsList.mockResolvedValue(
      FEATURE_PATHS.map((path) => ({ path, value: path !== 'agentFeatures.taskGraph' })),
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('renders eleven toggles; all on by default except task graph, which is off', async () => {
    render(AgentFeaturesSettings);

    await waitFor(() => {
      expect(screen.getAllByRole('switch')).toHaveLength(11);
    });
    const taskGraph = screen.getByRole('switch', { name: 'Task graph coordination' });
    expect(taskGraph.getAttribute('aria-checked')).toBe('false');
    for (const toggle of screen.getAllByRole('switch')) {
      if (toggle === taskGraph) continue;
      expect(toggle.getAttribute('aria-checked')).toBe('true');
    }
  });

  it('shows the new-sessions-only note without a live-read qualifier', async () => {
    render(AgentFeaturesSettings);

    const note = screen.getByText(/newly created agent sessions only/i);
    expect(note).toBeTruthy();
    expect(note.textContent).not.toMatch(/unless noted otherwise/i);
  });

  it('defaults each feature to its daemon default when the daemon has no entry for its path', async () => {
    // Daemon predates agentFeatures.* — settings.list returns unrelated entries only
    mocks.mockSettingsList.mockResolvedValue([{ path: 'rtk.enabled', value: true }]);

    render(AgentFeaturesSettings);

    await waitFor(() => {
      expect(screen.getAllByRole('switch')).toHaveLength(11);
    });
    const taskGraph = screen.getByRole('switch', { name: 'Task graph coordination' });
    expect(taskGraph.getAttribute('aria-checked')).toBe('false');
    for (const toggle of screen.getAllByRole('switch')) {
      if (toggle === taskGraph) continue;
      expect(toggle.getAttribute('aria-checked')).toBe('true');
    }
  });

  it('renders task graph off when an older daemon does not report the key', async () => {
    // Daemon predates agentFeatures.taskGraph — the other ten entries are present
    mocks.mockSettingsList.mockResolvedValue(
      FEATURE_PATHS.filter((path) => path !== 'agentFeatures.taskGraph').map((path) => ({
        path,
        value: true,
      })),
    );

    render(AgentFeaturesSettings);

    const taskGraph = await screen.findByRole('switch', { name: 'Task graph coordination' });
    await waitFor(() => {
      expect(taskGraph.getAttribute('aria-checked')).toBe('false');
    });
  });

  it('renders task graph on when the daemon reports value true', async () => {
    mocks.mockSettingsList.mockResolvedValue(FEATURE_PATHS.map((path) => ({ path, value: true })));

    render(AgentFeaturesSettings);

    const taskGraph = await screen.findByRole('switch', { name: 'Task graph coordination' });
    await waitFor(() => {
      expect(taskGraph.getAttribute('aria-checked')).toBe('true');
    });
  });

  it('toggling task graph on sends the exact settings.update request', async () => {
    mocks.mockSettingsUpdate.mockResolvedValueOnce([
      { path: 'agentFeatures.taskGraph', value: true },
    ]);

    render(AgentFeaturesSettings);

    const toggle = await screen.findByRole('switch', { name: 'Task graph coordination' });
    await waitFor(() => {
      expect(toggle.getAttribute('aria-checked')).toBe('false');
    });
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'agentFeatures.taskGraph', value: true },
      ]);
    });
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('renders a feature off when the daemon reports value false', async () => {
    mocks.mockSettingsList.mockResolvedValue(
      FEATURE_PATHS.map((path) => ({
        path,
        value: path !== 'agentFeatures.hostExec',
      })),
    );

    render(AgentFeaturesSettings);

    const hostExec = await screen.findByRole('switch', { name: 'Host command execution' });
    await waitFor(() => {
      expect(hostExec.getAttribute('aria-checked')).toBe('false');
    });
    expect(
      screen.getByRole('switch', { name: 'Background hooks' }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('toggling a feature off sends the exact settings.update request', async () => {
    mocks.mockSettingsUpdate.mockResolvedValueOnce([
      { path: 'agentFeatures.browserAutomation', value: false },
    ]);

    render(AgentFeaturesSettings);

    const toggle = await screen.findByRole('switch', { name: 'Browser automation' });
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'agentFeatures.browserAutomation', value: false },
      ]);
    });
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('toggling attention requests off sends the exact settings.update request', async () => {
    mocks.mockSettingsUpdate.mockResolvedValueOnce([
      { path: 'agentFeatures.attentionRequests', value: false },
    ]);

    render(AgentFeaturesSettings);

    const toggle = await screen.findByRole('switch', { name: 'Attention requests' });
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'agentFeatures.attentionRequests', value: false },
      ]);
    });
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('toggling the state snapshot off sends the exact settings.update request', async () => {
    mocks.mockSettingsUpdate.mockResolvedValueOnce([
      { path: 'agentFeatures.stateSnapshot', value: false },
    ]);

    render(AgentFeaturesSettings);

    const toggle = await screen.findByRole('switch', { name: 'State snapshot' });
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'agentFeatures.stateSnapshot', value: false },
      ]);
    });
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('renders the state snapshot off when the daemon reports value false', async () => {
    mocks.mockSettingsList.mockResolvedValue(
      FEATURE_PATHS.map((path) => ({
        path,
        value: path !== 'agentFeatures.stateSnapshot',
      })),
    );

    render(AgentFeaturesSettings);

    const toggle = await screen.findByRole('switch', { name: 'State snapshot' });
    await waitFor(() => {
      expect(toggle.getAttribute('aria-checked')).toBe('false');
    });
  });

  it('shows toast.error and reverts when the daemon returns a rolled-back value', async () => {
    // Daemon rolled back to true when toggling off
    mocks.mockSettingsUpdate.mockResolvedValueOnce([
      { path: 'agentFeatures.scripts', value: true },
    ]);

    render(AgentFeaturesSettings);

    const toggle = await screen.findByRole('switch', { name: 'Saved scripts' });
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('shows toast.error and reverts when settings.update rejects', async () => {
    mocks.mockSettingsUpdate.mockRejectedValueOnce(new Error('daemon unavailable'));

    render(AgentFeaturesSettings);

    const toggle = await screen.findByRole('switch', { name: 'Background hooks' });
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('daemon unavailable'));
    });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  describe('PR monitoring (§6.9)', () => {
    const debounceInputName = 'PR monitor change debounce in seconds';

    it('toggling PR monitoring off sends the exact settings.update request', async () => {
      mocks.mockSettingsUpdate.mockResolvedValueOnce([
        { path: 'agentFeatures.prMonitor', value: false },
      ]);

      render(AgentFeaturesSettings);

      const toggle = await screen.findByRole('switch', { name: 'PR monitoring' });
      await fireEvent.click(toggle);

      await waitFor(() => {
        expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
          { path: 'agentFeatures.prMonitor', value: false },
        ]);
      });
      expect(toggle.getAttribute('aria-checked')).toBe('false');
    });

    it('seeds the debounce input from prMonitor.debounceSeconds in settings.list', async () => {
      mocks.mockSettingsList.mockResolvedValue([
        ...FEATURE_PATHS.map((path) => ({ path, value: true })),
        { path: 'prMonitor.debounceSeconds', value: 120 },
      ]);

      render(AgentFeaturesSettings);

      const input = await screen.findByRole('spinbutton', { name: debounceInputName });
      await waitFor(() => {
        expect((input as HTMLInputElement).value).toBe('120');
      });
    });

    it('never renders a pollSeconds field even when settings.list carries it', async () => {
      mocks.mockSettingsList.mockResolvedValue([
        ...FEATURE_PATHS.map((path) => ({ path, value: true })),
        { path: 'prMonitor.debounceSeconds', value: 60 },
        { path: 'prMonitor.pollSeconds', value: 30 },
      ]);

      render(AgentFeaturesSettings);

      await screen.findByRole('spinbutton', { name: debounceInputName });
      expect(screen.getAllByRole('spinbutton')).toHaveLength(1);
    });

    it('saving the debounce sends the exact settings.update request', async () => {
      mocks.mockSettingsList.mockResolvedValue([
        ...FEATURE_PATHS.map((path) => ({ path, value: true })),
        { path: 'prMonitor.debounceSeconds', value: 60 },
      ]);
      mocks.mockSettingsUpdate.mockResolvedValueOnce([
        { path: 'prMonitor.debounceSeconds', value: 90 },
      ]);

      render(AgentFeaturesSettings);

      const input = await screen.findByRole('spinbutton', { name: debounceInputName });
      await waitFor(() => expect((input as HTMLInputElement).value).toBe('60'));
      await fireEvent.input(input, { target: { value: '90' } });
      const save = await screen.findByRole('button', { name: 'Save' });
      await fireEvent.click(save);

      await waitFor(() => {
        expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
          { path: 'prMonitor.debounceSeconds', value: 90 },
        ]);
      });
      expect(mockToast.error).not.toHaveBeenCalled();
    });

    it('rejects a sub-minimum debounce without calling settings.update', async () => {
      render(AgentFeaturesSettings);

      const input = await screen.findByRole('spinbutton', { name: debounceInputName });
      await fireEvent.input(input, { target: { value: '5' } });

      const save = await screen.findByRole('button', { name: 'Save' });
      expect((save as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText(/between 10 and 86,400 seconds/i)).toBeTruthy();
      expect(mocks.mockSettingsUpdate).not.toHaveBeenCalled();
    });

    it('rejects an above-maximum debounce (daemon cap 86400) without calling settings.update', async () => {
      render(AgentFeaturesSettings);

      const input = await screen.findByRole('spinbutton', { name: debounceInputName });
      await fireEvent.input(input, { target: { value: '100000' } });

      const save = await screen.findByRole('button', { name: 'Save' });
      expect((save as HTMLButtonElement).disabled).toBe(true);
      expect(mocks.mockSettingsUpdate).not.toHaveBeenCalled();
    });

    it('disables the debounce input while the PR monitoring toggle is off', async () => {
      mocks.mockSettingsList.mockResolvedValue(
        FEATURE_PATHS.map((path) => ({
          path,
          value: path !== 'agentFeatures.prMonitor',
        })),
      );

      render(AgentFeaturesSettings);

      const toggle = await screen.findByRole('switch', { name: 'PR monitoring' });
      await waitFor(() => {
        expect(toggle.getAttribute('aria-checked')).toBe('false');
      });
      const input = screen.getByRole('spinbutton', { name: debounceInputName });
      expect((input as HTMLInputElement).disabled).toBe(true);
    });

    it('reverts the debounce input when the daemon rolls the value back', async () => {
      mocks.mockSettingsList.mockResolvedValue([
        ...FEATURE_PATHS.map((path) => ({ path, value: true })),
        { path: 'prMonitor.debounceSeconds', value: 60 },
      ]);
      // Daemon clamps/rolls back to 60
      mocks.mockSettingsUpdate.mockResolvedValueOnce([
        { path: 'prMonitor.debounceSeconds', value: 60 },
      ]);

      render(AgentFeaturesSettings);

      const input = await screen.findByRole('spinbutton', { name: debounceInputName });
      await waitFor(() => expect((input as HTMLInputElement).value).toBe('60'));
      await fireEvent.input(input, { target: { value: '90' } });
      const save = await screen.findByRole('button', { name: 'Save' });
      await fireEvent.click(save);

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalled();
      });
      expect((input as HTMLInputElement).value).toBe('60');
    });
  });
});
