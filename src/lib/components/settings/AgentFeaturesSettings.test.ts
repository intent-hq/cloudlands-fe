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
  'agentFeatures.peerAgents',
  'agentFeatures.mcpTools',
];

function getToggles() {
  return screen.getAllByRole('button').filter((button) => button.hasAttribute('aria-pressed'));
}

describe('AgentFeaturesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default daemon state (PROTOCOL §5.12 settings.list entries): all on
    mocks.mockSettingsList.mockResolvedValue(FEATURE_PATHS.map((path) => ({ path, value: true })));
  });

  afterEach(() => {
    cleanup();
  });

  it('renders thirteen toggles; all on when the daemon reports every path true', async () => {
    render(AgentFeaturesSettings);

    await waitFor(() => {
      expect(getToggles()).toHaveLength(13);
    });
    for (const toggle of getToggles()) {
      expect(toggle.getAttribute('aria-pressed')).toBe('true');
    }
  });

  it('defaults each feature to its daemon default when the daemon has no entry for its path', async () => {
    // Daemon predates agentFeatures.* — settings.list returns unrelated entries only
    mocks.mockSettingsList.mockResolvedValue([{ path: 'rtk.enabled', value: true }]);

    render(AgentFeaturesSettings);

    await waitFor(() => {
      expect(getToggles()).toHaveLength(13);
    });
    const peerAgents = screen.getByRole('button', {
      name: 'Top-level agent spawning & retirement',
    });
    // peerAgents is the one opt-in feature — absent coerces to off
    expect(peerAgents.getAttribute('aria-pressed')).toBe('false');
    for (const toggle of getToggles()) {
      if (toggle === peerAgents) continue;
      expect(toggle.getAttribute('aria-pressed')).toBe('true');
    }
  });

  it('renders task graph on when an older daemon does not report the key', async () => {
    // Daemon predates agentFeatures.taskGraph — the other twelve entries are present
    mocks.mockSettingsList.mockResolvedValue(
      FEATURE_PATHS.filter((path) => path !== 'agentFeatures.taskGraph').map((path) => ({
        path,
        value: true,
      })),
    );

    render(AgentFeaturesSettings);

    const taskGraph = await screen.findByRole('button', { name: 'Task graph coordination' });
    await waitFor(() => {
      expect(taskGraph.getAttribute('aria-pressed')).toBe('true');
    });
  });

  it('renders task graph off when the daemon reports value false', async () => {
    mocks.mockSettingsList.mockResolvedValue(
      FEATURE_PATHS.map((path) => ({
        path,
        value: path !== 'agentFeatures.taskGraph',
      })),
    );

    render(AgentFeaturesSettings);

    const taskGraph = await screen.findByRole('button', { name: 'Task graph coordination' });
    await waitFor(() => {
      expect(taskGraph.getAttribute('aria-pressed')).toBe('false');
    });
  });

  it('toggling task graph off sends the exact settings.update request', async () => {
    mocks.mockSettingsUpdate.mockResolvedValueOnce([
      { path: 'agentFeatures.taskGraph', value: false },
    ]);

    render(AgentFeaturesSettings);

    const toggle = await screen.findByRole('button', { name: 'Task graph coordination' });
    await waitFor(() => {
      expect(toggle.getAttribute('aria-pressed')).toBe('true');
    });
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'agentFeatures.taskGraph', value: false },
      ]);
    });
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('renders a feature off when the daemon reports value false', async () => {
    mocks.mockSettingsList.mockResolvedValue(
      FEATURE_PATHS.map((path) => ({
        path,
        value: path !== 'agentFeatures.hostExec',
      })),
    );

    render(AgentFeaturesSettings);

    const hostExec = await screen.findByRole('button', { name: 'Host command execution' });
    await waitFor(() => {
      expect(hostExec.getAttribute('aria-pressed')).toBe('false');
    });
    expect(
      screen.getByRole('button', { name: 'Background hooks' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('toggling a feature off sends the exact settings.update request', async () => {
    mocks.mockSettingsUpdate.mockResolvedValueOnce([
      { path: 'agentFeatures.browserAutomation', value: false },
    ]);

    render(AgentFeaturesSettings);

    const toggle = await screen.findByRole('button', { name: 'Browser automation' });
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'agentFeatures.browserAutomation', value: false },
      ]);
    });
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('toggling attention requests off sends the exact settings.update request', async () => {
    mocks.mockSettingsUpdate.mockResolvedValueOnce([
      { path: 'agentFeatures.attentionRequests', value: false },
    ]);

    render(AgentFeaturesSettings);

    const toggle = await screen.findByRole('button', { name: 'Attention requests' });
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'agentFeatures.attentionRequests', value: false },
      ]);
    });
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('toggling the state snapshot off sends the exact settings.update request', async () => {
    mocks.mockSettingsUpdate.mockResolvedValueOnce([
      { path: 'agentFeatures.stateSnapshot', value: false },
    ]);

    render(AgentFeaturesSettings);

    const toggle = await screen.findByRole('button', { name: 'State snapshot' });
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'agentFeatures.stateSnapshot', value: false },
      ]);
    });
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('renders the state snapshot off when the daemon reports value false', async () => {
    mocks.mockSettingsList.mockResolvedValue(
      FEATURE_PATHS.map((path) => ({
        path,
        value: path !== 'agentFeatures.stateSnapshot',
      })),
    );

    render(AgentFeaturesSettings);

    const toggle = await screen.findByRole('button', { name: 'State snapshot' });
    await waitFor(() => {
      expect(toggle.getAttribute('aria-pressed')).toBe('false');
    });
  });

  it('renders tokenImpact when the daemon provides it (§5.12)', async () => {
    mocks.mockSettingsList.mockResolvedValue(
      FEATURE_PATHS.map((path) => ({
        path,
        value: true,
        tokenImpact:
          path === 'agentFeatures.stateSnapshot' ? '~50 tokens/turn' : '~620 tokens/session',
      })),
    );

    render(AgentFeaturesSettings);

    await waitFor(() => {
      expect(screen.getAllByText('~620 tokens/session')).toHaveLength(12);
    });
    expect(screen.getByText('~50 tokens/turn')).toBeTruthy();
  });

  it('renders no token-impact line when the daemon omits the field (older daemon)', async () => {
    render(AgentFeaturesSettings);

    await waitFor(() => {
      expect(getToggles()).toHaveLength(13);
    });
    expect(screen.queryByText(/tokens\/(session|turn)/)).toBeNull();
  });

  it('shows toast.error and reverts when the daemon returns a rolled-back value', async () => {
    // Daemon rolled back to true when toggling off
    mocks.mockSettingsUpdate.mockResolvedValueOnce([
      { path: 'agentFeatures.scripts', value: true },
    ]);

    render(AgentFeaturesSettings);

    const toggle = await screen.findByRole('button', { name: 'Saved scripts' });
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows toast.error and reverts when settings.update rejects', async () => {
    mocks.mockSettingsUpdate.mockRejectedValueOnce(new Error('daemon unavailable'));

    render(AgentFeaturesSettings);

    const toggle = await screen.findByRole('button', { name: 'Background hooks' });
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('daemon unavailable'));
    });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  describe('peer agents (opt-in)', () => {
    const maxAgentsInputName = 'Maximum top-level agents per workspace';

    it('renders peer agents on when the daemon reports value true', async () => {
      render(AgentFeaturesSettings);

      const toggle = await screen.findByRole('button', {
        name: 'Top-level agent spawning & retirement',
      });
      await waitFor(() => {
        expect(toggle.getAttribute('aria-pressed')).toBe('true');
      });
    });

    it('toggling peer agents on sends the exact settings.update request', async () => {
      mocks.mockSettingsList.mockResolvedValue(
        FEATURE_PATHS.map((path) => ({
          path,
          value: path !== 'agentFeatures.peerAgents',
        })),
      );
      mocks.mockSettingsUpdate.mockResolvedValueOnce([
        { path: 'agentFeatures.peerAgents', value: true },
      ]);

      render(AgentFeaturesSettings);

      const toggle = await screen.findByRole('button', {
        name: 'Top-level agent spawning & retirement',
      });
      await waitFor(() => {
        expect(toggle.getAttribute('aria-pressed')).toBe('false');
      });
      await fireEvent.click(toggle);

      await waitFor(() => {
        expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
          { path: 'agentFeatures.peerAgents', value: true },
        ]);
      });
      expect(mockToast.error).not.toHaveBeenCalled();
      expect(toggle.getAttribute('aria-pressed')).toBe('true');
    });

    it('seeds the max agents input from agents.maxTopLevelAgents in settings.list', async () => {
      mocks.mockSettingsList.mockResolvedValue([
        ...FEATURE_PATHS.map((path) => ({ path, value: true })),
        { path: 'agents.maxTopLevelAgents', value: 8 },
      ]);

      render(AgentFeaturesSettings);

      const input = await screen.findByRole('spinbutton', { name: maxAgentsInputName });
      await waitFor(() => {
        expect((input as HTMLInputElement).value).toBe('8');
      });
    });

    it('saving the max agents cap sends the exact settings.update request', async () => {
      mocks.mockSettingsList.mockResolvedValue([
        ...FEATURE_PATHS.map((path) => ({ path, value: true })),
        { path: 'agents.maxTopLevelAgents', value: 20 },
      ]);
      mocks.mockSettingsUpdate.mockResolvedValueOnce([
        { path: 'agents.maxTopLevelAgents', value: 5 },
      ]);

      render(AgentFeaturesSettings);

      const input = await screen.findByRole('spinbutton', { name: maxAgentsInputName });
      await waitFor(() => expect((input as HTMLInputElement).value).toBe('20'));
      await fireEvent.input(input, { target: { value: '5' } });
      const save = await screen.findByRole('button', { name: 'Save' });
      await fireEvent.click(save);

      await waitFor(() => {
        expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
          { path: 'agents.maxTopLevelAgents', value: 5 },
        ]);
      });
      expect(mockToast.error).not.toHaveBeenCalled();
    });

    it('rejects a sub-minimum max agents value without calling settings.update', async () => {
      render(AgentFeaturesSettings);

      const input = await screen.findByRole('spinbutton', { name: maxAgentsInputName });
      await fireEvent.input(input, { target: { value: '0' } });

      const save = await screen.findByRole('button', { name: 'Save' });
      expect((save as HTMLButtonElement).disabled).toBe(true);
      expect(mocks.mockSettingsUpdate).not.toHaveBeenCalled();
    });

    it('rejects a non-integer max agents value without calling settings.update', async () => {
      render(AgentFeaturesSettings);

      const input = await screen.findByRole('spinbutton', { name: maxAgentsInputName });
      await fireEvent.input(input, { target: { value: '2.5' } });

      const save = await screen.findByRole('button', { name: 'Save' });
      expect((save as HTMLButtonElement).disabled).toBe(true);
      expect(mocks.mockSettingsUpdate).not.toHaveBeenCalled();
    });

    it('disables the max agents input while the peer agents toggle is off', async () => {
      mocks.mockSettingsList.mockResolvedValue(
        FEATURE_PATHS.map((path) => ({
          path,
          value: path !== 'agentFeatures.peerAgents',
        })),
      );

      render(AgentFeaturesSettings);

      const toggle = await screen.findByRole('button', {
        name: 'Top-level agent spawning & retirement',
      });
      await waitFor(() => {
        expect(toggle.getAttribute('aria-pressed')).toBe('false');
      });
      const input = screen.getByRole('spinbutton', { name: maxAgentsInputName });
      expect((input as HTMLInputElement).disabled).toBe(true);
    });

    it('reverts the max agents input when the daemon rolls the value back', async () => {
      mocks.mockSettingsList.mockResolvedValue([
        ...FEATURE_PATHS.map((path) => ({ path, value: true })),
        { path: 'agents.maxTopLevelAgents', value: 20 },
      ]);
      // Daemon clamps/rolls back to 20
      mocks.mockSettingsUpdate.mockResolvedValueOnce([
        { path: 'agents.maxTopLevelAgents', value: 20 },
      ]);

      render(AgentFeaturesSettings);

      const input = await screen.findByRole('spinbutton', { name: maxAgentsInputName });
      await waitFor(() => expect((input as HTMLInputElement).value).toBe('20'));
      await fireEvent.input(input, { target: { value: '50' } });
      const save = await screen.findByRole('button', { name: 'Save' });
      await fireEvent.click(save);

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalled();
      });
      expect((input as HTMLInputElement).value).toBe('20');
    });
  });

  describe('PR monitoring (§6.9)', () => {
    const debounceInputName = 'PR monitor change debounce in seconds';

    it('toggling PR monitoring off sends the exact settings.update request', async () => {
      mocks.mockSettingsUpdate.mockResolvedValueOnce([
        { path: 'agentFeatures.prMonitor', value: false },
      ]);

      render(AgentFeaturesSettings);

      const toggle = await screen.findByRole('button', { name: 'PR monitoring' });
      await fireEvent.click(toggle);

      await waitFor(() => {
        expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
          { path: 'agentFeatures.prMonitor', value: false },
        ]);
      });
      expect(toggle.getAttribute('aria-pressed')).toBe('false');
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
      // Exactly two numeric inputs: the debounce and the max top-level agents cap
      expect(screen.getAllByRole('spinbutton')).toHaveLength(2);
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

      const toggle = await screen.findByRole('button', { name: 'PR monitoring' });
      await waitFor(() => {
        expect(toggle.getAttribute('aria-pressed')).toBe('false');
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
