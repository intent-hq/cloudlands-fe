/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import AgentFeaturesSettings from './AgentFeaturesSettings.svelte';
import { store } from '$store/renderer/store';
import { settingsFormSaga } from '$store/renderer/slices/settings-events/sagas/settings-form-saga';

let stop: () => void;
beforeEach(() => {
  store.init();
  stop = store.runSaga(settingsFormSaga);
});
afterEach(() => {
  cleanup();
  stop();
  store.dispose();
});

async function renderReady() {
  render(AgentFeaturesSettings);
  await waitFor(() =>
    expect(
      (screen.getByRole('switch', { name: 'Background hooks' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
}

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

vi.mock('$lib/components/patterns/notify', () => ({
  notify: mockToast,
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
    await renderReady();

    await waitFor(() => {
      expect(screen.getAllByRole('switch')).toHaveLength(13);
    });
    for (const toggle of screen.getAllByRole('switch')) {
      expect(toggle.getAttribute('aria-checked')).toBe('true');
    }
  });

  it('keeps unregistered peer agents off while preserving other feature fallbacks', async () => {
    // Daemon predates agentFeatures.* — settings.list returns unrelated entries only
    mocks.mockSettingsList.mockResolvedValue([{ path: 'rtk.enabled', value: true }]);

    await renderReady();

    await waitFor(() => {
      expect(screen.getAllByRole('switch')).toHaveLength(13);
      expect((screen.getAllByRole('switch')[0] as HTMLButtonElement).disabled).toBe(false);
    });
    for (const toggle of screen.getAllByRole('switch')) {
      const peerAgents =
        toggle ===
        screen.getByRole('switch', {
          name: 'Top-level agent spawning & retirement',
        });
      expect(toggle.getAttribute('aria-checked')).toBe(String(!peerAgents));
      expect((toggle as HTMLButtonElement).disabled).toBe(peerAgents);
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

    await renderReady();

    const taskGraph = await screen.findByRole('switch', { name: 'Task graph coordination' });
    await waitFor(() => {
      expect(taskGraph.getAttribute('aria-checked')).toBe('true');
    });
  });

  it('renders task graph off when the daemon reports value false', async () => {
    mocks.mockSettingsList.mockResolvedValue(
      FEATURE_PATHS.map((path) => ({
        path,
        value: path !== 'agentFeatures.taskGraph',
      })),
    );

    await renderReady();

    const taskGraph = await screen.findByRole('switch', { name: 'Task graph coordination' });
    await waitFor(() => {
      expect(taskGraph.getAttribute('aria-checked')).toBe('false');
    });
  });

  it('toggling task graph off sends the exact settings.update request', async () => {
    mocks.mockSettingsUpdate.mockResolvedValueOnce([
      { path: 'agentFeatures.taskGraph', value: false },
    ]);

    await renderReady();

    const toggle = await screen.findByRole('switch', { name: 'Task graph coordination' });
    await waitFor(() => {
      expect(toggle.getAttribute('aria-checked')).toBe('true');
    });
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'agentFeatures.taskGraph', value: false },
      ]);
    });
    expect(mockToast.error).not.toHaveBeenCalled();
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
  });

  it('renders a feature off when the daemon reports value false', async () => {
    mocks.mockSettingsList.mockResolvedValue(
      FEATURE_PATHS.map((path) => ({
        path,
        value: path !== 'agentFeatures.hostExec',
      })),
    );

    await renderReady();

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

    await renderReady();

    const toggle = await screen.findByRole('switch', { name: 'Browser automation' });
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'agentFeatures.browserAutomation', value: false },
      ]);
    });
    expect(mockToast.error).not.toHaveBeenCalled();
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
  });

  it('toggling attention requests off sends the exact settings.update request', async () => {
    mocks.mockSettingsUpdate.mockResolvedValueOnce([
      { path: 'agentFeatures.attentionRequests', value: false },
    ]);

    await renderReady();

    const toggle = await screen.findByRole('switch', { name: 'Attention requests' });
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'agentFeatures.attentionRequests', value: false },
      ]);
    });
    expect(mockToast.error).not.toHaveBeenCalled();
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
  });

  it('toggling the state snapshot off sends the exact settings.update request', async () => {
    mocks.mockSettingsUpdate.mockResolvedValueOnce([
      { path: 'agentFeatures.stateSnapshot', value: false },
    ]);

    await renderReady();

    const toggle = await screen.findByRole('switch', { name: 'State snapshot' });
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'agentFeatures.stateSnapshot', value: false },
      ]);
    });
    expect(mockToast.error).not.toHaveBeenCalled();
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
  });

  it('renders the state snapshot off when the daemon reports value false', async () => {
    mocks.mockSettingsList.mockResolvedValue(
      FEATURE_PATHS.map((path) => ({
        path,
        value: path !== 'agentFeatures.stateSnapshot',
      })),
    );

    await renderReady();

    const toggle = await screen.findByRole('switch', { name: 'State snapshot' });
    await waitFor(() => {
      expect(toggle.getAttribute('aria-checked')).toBe('false');
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

    await renderReady();

    await waitFor(() => {
      expect(screen.getAllByText('~620 tokens/session')).toHaveLength(12);
    });
    expect(screen.getByText('~50 tokens/turn')).toBeTruthy();
  });

  it('renders no token-impact line when the daemon omits the field (older daemon)', async () => {
    await renderReady();

    await waitFor(() => {
      expect(screen.getAllByRole('switch')).toHaveLength(13);
    });
    expect(screen.queryByText(/tokens\/(session|turn)/)).toBeNull();
  });

  it('shows toast.error and reverts when the daemon returns a rolled-back value', async () => {
    // Daemon rolled back to true when toggling off
    mocks.mockSettingsUpdate.mockResolvedValueOnce([
      { path: 'agentFeatures.scripts', value: true },
    ]);

    await renderReady();

    const toggle = await screen.findByRole('switch', { name: 'Saved scripts' });
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
      expect(toggle.getAttribute('aria-checked')).toBe('true');
    });
  });

  it('shows toast.error and reverts when settings.update rejects', async () => {
    mocks.mockSettingsUpdate.mockRejectedValueOnce(new Error('daemon unavailable'));

    await renderReady();

    const toggle = await screen.findByRole('switch', { name: 'Background hooks' });
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('daemon unavailable'));
      expect(toggle.getAttribute('aria-checked')).toBe('true');
    });
  });

  it('restores a fast failed optimistic switch and retries the same intent through the configured Store', async () => {
    mocks.mockSettingsUpdate
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce([{ path: 'agentFeatures.backgroundHooks', value: false }]);
    await renderReady();
    const toggle = screen.getByRole('switch', { name: 'Background hooks' });
    await fireEvent.click(toggle);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
      expect(toggle.getAttribute('aria-checked')).toBe('true');
      expect((toggle as HTMLButtonElement).disabled).toBe(false);
    });
    await fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
    expect(mocks.mockSettingsUpdate.mock.calls).toEqual([
      [[{ path: 'agentFeatures.backgroundHooks', value: false }]],
      [[{ path: 'agentFeatures.backgroundHooks', value: false }]],
    ]);
  });

  describe('peer agents', () => {
    const maxAgentsInputName = 'Maximum top-level agents per workspace';

    it('keeps peer agents and the cap unavailable when an older daemon does not register them', async () => {
      mocks.mockSettingsList.mockResolvedValue(
        FEATURE_PATHS.filter((path) => path !== 'agentFeatures.peerAgents').map((path) => ({
          path,
          value: true,
        })),
      );

      await renderReady();

      await waitFor(() => {
        expect(
          (screen.getByRole('switch', { name: 'Background hooks' }) as HTMLButtonElement).disabled,
        ).toBe(false);
      });
      const toggle = screen.getByRole('switch', {
        name: 'Top-level agent spawning & retirement',
      });
      const input = screen.getByRole('spinbutton', { name: maxAgentsInputName });
      expect(toggle.getAttribute('aria-checked')).toBe('false');
      expect((toggle as HTMLButtonElement).disabled).toBe(true);
      expect((input as HTMLInputElement).disabled).toBe(true);
      expect(mocks.mockSettingsUpdate).not.toHaveBeenCalled();
    });

    it('enables peer agents and the cap for registered defaults without a stored preference', async () => {
      mocks.mockSettingsList.mockResolvedValue([
        { path: 'agentFeatures.peerAgents', value: true, defaultValue: true, origin: 'default' },
        { path: 'agents.maxTopLevelAgents', value: 20, defaultValue: 20, origin: 'default' },
      ]);

      await renderReady();

      const input = await screen.findByRole('spinbutton', { name: maxAgentsInputName });
      await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
      expect(
        screen
          .getByRole('switch', { name: 'Top-level agent spawning & retirement' })
          .getAttribute('aria-checked'),
      ).toBe('true');
    });

    it('renders peer agents on when the daemon reports value true', async () => {
      await renderReady();

      const toggle = await screen.findByRole('switch', {
        name: 'Top-level agent spawning & retirement',
      });
      await waitFor(() => {
        expect(toggle.getAttribute('aria-checked')).toBe('true');
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

      await renderReady();

      const toggle = await screen.findByRole('switch', {
        name: 'Top-level agent spawning & retirement',
      });
      await waitFor(() => {
        expect(toggle.getAttribute('aria-checked')).toBe('false');
      });
      await fireEvent.click(toggle);

      await waitFor(() => {
        expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
          { path: 'agentFeatures.peerAgents', value: true },
        ]);
      });
      expect(mockToast.error).not.toHaveBeenCalled();
      await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    });

    it.each([false, true])(
      'restores peer agents to %s when the daemon rolls back',
      async (value) => {
        mocks.mockSettingsList.mockResolvedValue([{ path: 'agentFeatures.peerAgents', value }]);
        mocks.mockSettingsUpdate.mockResolvedValueOnce([
          { path: 'agentFeatures.peerAgents', value },
        ]);

        await renderReady();

        const toggle = await screen.findByRole('switch', {
          name: 'Top-level agent spawning & retirement',
        });
        await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
        await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe(String(value)));
        await fireEvent.click(toggle);

        await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
        expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
          { path: 'agentFeatures.peerAgents', value: !value },
        ]);
        await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe(String(value)));
      },
    );

    it('restores default-enabled peer agents when settings.update rejects', async () => {
      mocks.mockSettingsList.mockResolvedValue([
        { path: 'agentFeatures.peerAgents', value: true, defaultValue: true, origin: 'default' },
      ]);

      await renderReady();

      const toggle = await screen.findByRole('switch', {
        name: 'Top-level agent spawning & retirement',
      });
      await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
      expect(toggle.getAttribute('aria-checked')).toBe('true');
      mocks.mockSettingsUpdate.mockRejectedValueOnce(new Error('daemon unavailable'));
      await fireEvent.click(toggle);

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('daemon unavailable'));
      });
      expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
        { path: 'agentFeatures.peerAgents', value: false },
      ]);
      await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    });

    it('seeds the max agents input from agents.maxTopLevelAgents in settings.list', async () => {
      mocks.mockSettingsList.mockResolvedValue([
        ...FEATURE_PATHS.map((path) => ({ path, value: true })),
        { path: 'agents.maxTopLevelAgents', value: 8 },
      ]);

      await renderReady();

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

      await renderReady();

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
      await renderReady();

      const input = await screen.findByRole('spinbutton', { name: maxAgentsInputName });
      await fireEvent.input(input, { target: { value: '0' } });

      const save = await screen.findByRole('button', { name: 'Save' });
      expect((save as HTMLButtonElement).disabled).toBe(true);
      expect(mocks.mockSettingsUpdate).not.toHaveBeenCalled();
    });

    it('rejects a non-integer max agents value without calling settings.update', async () => {
      await renderReady();

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

      await renderReady();

      const toggle = await screen.findByRole('switch', {
        name: 'Top-level agent spawning & retirement',
      });
      await waitFor(() => {
        expect(toggle.getAttribute('aria-checked')).toBe('false');
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

      await renderReady();

      const input = await screen.findByRole('spinbutton', { name: maxAgentsInputName });
      await waitFor(() => expect((input as HTMLInputElement).value).toBe('20'));
      await fireEvent.input(input, { target: { value: '50' } });
      const save = await screen.findByRole('button', { name: 'Save' });
      await fireEvent.click(save);

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalled();
        expect((input as HTMLInputElement).value).toBe('20');
      });
    });
  });

  describe('PR monitoring (§6.9)', () => {
    const debounceInputName = 'PR monitor change debounce in seconds';

    it('toggling PR monitoring off sends the exact settings.update request', async () => {
      mocks.mockSettingsUpdate.mockResolvedValueOnce([
        { path: 'agentFeatures.prMonitor', value: false },
      ]);

      await renderReady();

      const toggle = await screen.findByRole('switch', { name: 'PR monitoring' });
      await fireEvent.click(toggle);

      await waitFor(() => {
        expect(mocks.mockSettingsUpdate).toHaveBeenCalledWith([
          { path: 'agentFeatures.prMonitor', value: false },
        ]);
      });
      await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
    });

    it('seeds the debounce input from prMonitor.debounceSeconds in settings.list', async () => {
      mocks.mockSettingsList.mockResolvedValue([
        ...FEATURE_PATHS.map((path) => ({ path, value: true })),
        { path: 'prMonitor.debounceSeconds', value: 120 },
      ]);

      await renderReady();

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

      await renderReady();

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

      await renderReady();

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
      await renderReady();

      const input = await screen.findByRole('spinbutton', { name: debounceInputName });
      await fireEvent.input(input, { target: { value: '5' } });

      const save = await screen.findByRole('button', { name: 'Save' });
      expect((save as HTMLButtonElement).disabled).toBe(true);
      expect(mocks.mockSettingsUpdate).not.toHaveBeenCalled();
    });

    it('rejects an above-maximum debounce (daemon cap 86400) without calling settings.update', async () => {
      await renderReady();

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

      await renderReady();

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

      await renderReady();

      const input = await screen.findByRole('spinbutton', { name: debounceInputName });
      await waitFor(() => expect((input as HTMLInputElement).value).toBe('60'));
      await fireEvent.input(input, { target: { value: '90' } });
      const save = await screen.findByRole('button', { name: 'Save' });
      await fireEvent.click(save);

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalled();
        expect((input as HTMLInputElement).value).toBe('60');
      });
    });
  });
});
