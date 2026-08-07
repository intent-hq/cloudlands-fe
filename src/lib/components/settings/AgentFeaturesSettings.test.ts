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
];

describe('AgentFeaturesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default daemon state (PROTOCOL §5.12 settings.list entries): all nine on
    mocks.mockSettingsList.mockResolvedValue(FEATURE_PATHS.map((path) => ({ path, value: true })));
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nine toggles, all on by default', async () => {
    render(AgentFeaturesSettings);

    await waitFor(() => {
      expect(screen.getAllByRole('switch')).toHaveLength(9);
    });
    for (const toggle of screen.getAllByRole('switch')) {
      expect(toggle.getAttribute('aria-checked')).toBe('true');
    }
  });

  it('shows the new-sessions-only note', async () => {
    render(AgentFeaturesSettings);

    expect(screen.getByText(/newly created agent sessions only/i)).toBeTruthy();
  });

  it('defaults a feature to on when the daemon has no entry for its path', async () => {
    // Daemon predates agentFeatures.* — settings.list returns unrelated entries only
    mocks.mockSettingsList.mockResolvedValue([{ path: 'rtk.enabled', value: true }]);

    render(AgentFeaturesSettings);

    await waitFor(() => {
      expect(screen.getAllByRole('switch')).toHaveLength(9);
    });
    for (const toggle of screen.getAllByRole('switch')) {
      expect(toggle.getAttribute('aria-checked')).toBe('true');
    }
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
});
