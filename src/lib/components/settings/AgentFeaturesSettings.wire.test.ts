/**
 * @vitest-environment jsdom
 *
 * Wire contract test for AgentFeaturesSettings — asserts PROTOCOL §5.12 request
 * shapes at the transport boundary (backendRequest). Mocks backendRequest, not the
 * appClient facade, and uses the real LiveSettingsClient to verify the exact wire
 * payloads for the agentFeatures.* settings.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';

// Mock backend transport (the wire seam)
const mocks = vi.hoisted(() => ({
  mockBackendRequest: vi.fn(),
}));

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.mockBackendRequest,
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
  BackendError: class BackendError extends Error {
    constructor(payload: { code: string; message: string }) {
      super(payload.message);
      this.code = payload.code;
    }
    code: string;
  },
}));

import AgentFeaturesSettings from './AgentFeaturesSettings.svelte';
import { __resetSettingsReadCacheForTests } from '$lib/client/live/live-settings-client';

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

// PROTOCOL §5.12 settings.list response with all thirteen agentFeatures.* entries
// plus the prMonitor.debounceSeconds (§6.9) and agents.maxTopLevelAgents numbers.
// Entries are FLAT SettingDefinitionWithValue objects — the daemon merges `value`
// into the definition itself (no nested `definition` key; that shape is settings.get's).
function listResponse() {
  return {
    revision: 0,
    settings: [
      ...FEATURE_PATHS.map((path) => ({
        path,
        label: path,
        description: '',
        category: 'agentFeatures',
        type: 'boolean',
        defaultValue: true,
        value: true,
        origin: 'default',
      })),
      {
        path: 'prMonitor.debounceSeconds',
        label: 'PR monitor debounce',
        description: '',
        category: 'prMonitor',
        type: 'number',
        min: 10,
        defaultValue: 60,
        value: 60,
      },
      {
        path: 'agents.maxTopLevelAgents',
        label: 'Maximum top-level agents',
        description: '',
        category: 'agents',
        type: 'number',
        min: 1,
        defaultValue: 20,
        value: 20,
        origin: 'default',
      },
    ],
  };
}

describe('AgentFeaturesSettings wire contract (PROTOCOL §5.12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    __resetSettingsReadCacheForTests();
    cleanup();
  });

  it('issues settings.list on mount', async () => {
    mocks.mockBackendRequest.mockImplementation(async (method: string) => {
      if (method === 'settings.list') return listResponse();
      throw new Error(`Unexpected method: ${method}`);
    });

    render(AgentFeaturesSettings);

    await waitFor(() => {
      expect(mocks.mockBackendRequest).toHaveBeenCalledWith('settings.list');
    });
  });

  it('issues settings.update with PROTOCOL-shaped { changes: [...] } when a toggle changes', async () => {
    mocks.mockBackendRequest.mockImplementation(async (method: string, params: unknown) => {
      if (method === 'settings.list') return listResponse();
      if (method === 'settings.update') {
        // Assert PROTOCOL §5.12 settings.update shape: { changes: [ { path, value }, ... ] }
        expect(params).toEqual({
          changes: [{ path: 'agentFeatures.backgroundHooks', value: false }],
        });
        // Return complete PROTOCOL §5.12 settings.update response
        return { applied: [{ path: 'agentFeatures.backgroundHooks', value: false }] };
      }
      throw new Error(`Unexpected method: ${method}`);
    });

    render(AgentFeaturesSettings);

    const toggle = await screen.findByRole('switch', { name: 'Background hooks' });
    await fireEvent.click(toggle);

    await waitFor(() => {
      const updateCall = vi
        .mocked(mocks.mockBackendRequest)
        .mock.calls.find((call) => call[0] === 'settings.update');
      expect(updateCall).toBeDefined();
      expect(updateCall![1]).toEqual({
        changes: [{ path: 'agentFeatures.backgroundHooks', value: false }],
      });
    });
  });

  it('issues settings.update for agentFeatures.stateSnapshot when its toggle changes', async () => {
    mocks.mockBackendRequest.mockImplementation(async (method: string) => {
      if (method === 'settings.list') return listResponse();
      if (method === 'settings.update') {
        return { applied: [{ path: 'agentFeatures.stateSnapshot', value: false }] };
      }
      throw new Error(`Unexpected method: ${method}`);
    });

    render(AgentFeaturesSettings);

    const toggle = await screen.findByRole('switch', { name: 'State snapshot' });
    await fireEvent.click(toggle);

    await waitFor(() => {
      const updateCall = vi
        .mocked(mocks.mockBackendRequest)
        .mock.calls.find((call) => call[0] === 'settings.update');
      expect(updateCall).toBeDefined();
      expect(updateCall![1]).toEqual({
        changes: [{ path: 'agentFeatures.stateSnapshot', value: false }],
      });
    });
  });

  it('renders taskGraph on when settings.list omits it and sends the exact toggle-off payload', async () => {
    mocks.mockBackendRequest.mockImplementation(async (method: string) => {
      if (method === 'settings.list') {
        // Older daemon: agentFeatures.taskGraph is not registered
        const response = listResponse();
        return {
          settings: response.settings.filter((s) => s.path !== 'agentFeatures.taskGraph'),
        };
      }
      if (method === 'settings.update') {
        return { applied: [{ path: 'agentFeatures.taskGraph', value: false }] };
      }
      throw new Error(`Unexpected method: ${method}`);
    });

    render(AgentFeaturesSettings);

    const toggle = await screen.findByRole('switch', { name: 'Task graph coordination' });
    await waitFor(() => {
      expect(toggle.getAttribute('aria-checked')).toBe('true');
    });
    await fireEvent.click(toggle);

    await waitFor(() => {
      const updateCall = vi
        .mocked(mocks.mockBackendRequest)
        .mock.calls.find((call) => call[0] === 'settings.update');
      expect(updateCall).toBeDefined();
      expect(updateCall![1]).toEqual({
        changes: [{ path: 'agentFeatures.taskGraph', value: false }],
      });
    });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('reverts taskGraph to off when the daemon rolls back a toggle-on', async () => {
    mocks.mockBackendRequest.mockImplementation(async (method: string) => {
      if (method === 'settings.list') {
        const response = listResponse();
        return {
          settings: response.settings.map((s) =>
            s.path === 'agentFeatures.taskGraph' ? { ...s, value: false } : s,
          ),
        };
      }
      if (method === 'settings.update') {
        // Daemon rejected the change and rolled back to the explicit off value
        return { applied: [{ path: 'agentFeatures.taskGraph', value: false }] };
      }
      throw new Error(`Unexpected method: ${method}`);
    });

    render(AgentFeaturesSettings);

    const toggle = await screen.findByRole('switch', { name: 'Task graph coordination' });
    await waitFor(() => {
      expect(toggle.getAttribute('aria-checked')).toBe('false');
    });
    await fireEvent.click(toggle);

    await waitFor(() => {
      const updateCall = vi
        .mocked(mocks.mockBackendRequest)
        .mock.calls.find((call) => call[0] === 'settings.update');
      expect(updateCall).toBeDefined();
    });
    await waitFor(() => {
      expect(toggle.getAttribute('aria-checked')).toBe('false');
    });
  });

  it('renders the daemon-provided tokenImpact annotation from settings.list (§5.12)', async () => {
    mocks.mockBackendRequest.mockImplementation(async (method: string) => {
      if (method === 'settings.list') {
        const response = listResponse();
        return {
          settings: response.settings.map((s) =>
            s.path === 'agentFeatures.backgroundHooks'
              ? { ...s, tokenImpact: '~620 tokens/session' }
              : s,
          ),
        };
      }
      throw new Error(`Unexpected method: ${method}`);
    });

    render(AgentFeaturesSettings);

    const impact = await screen.findByText('~620 tokens/session');
    expect(impact.className).toContain('text-ghost');
    // Entries without the optional field render no annotation.
    expect(screen.queryAllByText(/tokens\/(session|turn)/)).toHaveLength(1);
  });

  it('issues settings.update for agentFeatures.peerAgents when its toggle changes', async () => {
    mocks.mockBackendRequest.mockImplementation(async (method: string) => {
      if (method === 'settings.list') {
        const response = listResponse();
        return {
          settings: response.settings.map((s) =>
            s.path === 'agentFeatures.peerAgents' ? { ...s, value: false } : s,
          ),
        };
      }
      if (method === 'settings.update') {
        return { applied: [{ path: 'agentFeatures.peerAgents', value: true }] };
      }
      throw new Error(`Unexpected method: ${method}`);
    });

    render(AgentFeaturesSettings);

    const toggle = await screen.findByRole('switch', {
      name: 'Top-level agent spawning & retirement',
    });
    await waitFor(() => {
      expect(toggle.getAttribute('aria-checked')).toBe('false');
    });
    await fireEvent.click(toggle);

    await waitFor(() => {
      const updateCall = vi
        .mocked(mocks.mockBackendRequest)
        .mock.calls.find((call) => call[0] === 'settings.update');
      expect(updateCall).toBeDefined();
      expect(updateCall![1]).toEqual({
        changes: [{ path: 'agentFeatures.peerAgents', value: true }],
      });
    });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it.each(['toggle', 'cap'])(
    'does not send a peer %s update when an older daemon does not register peer agents',
    async (control) => {
      mocks.mockBackendRequest.mockImplementation(async (method: string) => {
        if (method === 'settings.list') {
          return {
            settings: listResponse().settings.filter(
              (s) => s.path !== 'agentFeatures.peerAgents' && s.path !== 'agents.maxTopLevelAgents',
            ),
          };
        }
        throw new Error(`Unsupported method: ${method}`);
      });

      render(AgentFeaturesSettings);

      await waitFor(() => {
        expect(
          (screen.getByRole('switch', { name: 'Background hooks' }) as HTMLButtonElement).disabled,
        ).toBe(false);
      });
      const toggle = screen.getByRole('switch', {
        name: 'Top-level agent spawning & retirement',
      });
      const input = screen.getByRole('spinbutton', {
        name: 'Maximum top-level agents per workspace',
      });
      if (control === 'toggle') {
        await fireEvent.click(toggle);
      } else {
        await fireEvent.input(input, { target: { value: '5' } });
        const save = screen.getByRole('button', { name: 'Save' });
        await fireEvent.click(save);
        expect.soft((save as HTMLButtonElement).disabled).toBe(true);
      }

      expect.soft(mocks.mockBackendRequest.mock.calls).toEqual([['settings.list']]);
      expect.soft(toggle.getAttribute('aria-checked')).toBe('false');
      expect.soft((toggle as HTMLButtonElement).disabled).toBe(true);
      expect.soft((input as HTMLInputElement).disabled).toBe(true);
    },
  );

  it('renders the registered peerAgents default on and sends the exact toggle-off payload', async () => {
    mocks.mockBackendRequest.mockImplementation(async (method: string) => {
      if (method === 'settings.list') return listResponse();
      if (method === 'settings.update') {
        return { applied: [{ path: 'agentFeatures.peerAgents', value: false }], revision: 1 };
      }
      throw new Error(`Unexpected method: ${method}`);
    });

    render(AgentFeaturesSettings);

    const toggle = await screen.findByRole('switch', {
      name: 'Top-level agent spawning & retirement',
    });
    await waitFor(() => {
      expect((toggle as HTMLButtonElement).disabled).toBe(false);
    });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(mocks.mockBackendRequest).toHaveBeenCalledWith('settings.update', {
        changes: [{ path: 'agentFeatures.peerAgents', value: false }],
      });
    });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it.each([false, true])('restores peerAgents to %s after a wire rollback', async (value) => {
    mocks.mockBackendRequest.mockImplementation(async (method: string) => {
      if (method === 'settings.list') {
        const response = listResponse();
        return {
          ...response,
          settings: response.settings.map((s) =>
            s.path === 'agentFeatures.peerAgents' ? { ...s, value } : s,
          ),
        };
      }
      if (method === 'settings.update') {
        return { applied: [{ path: 'agentFeatures.peerAgents', value }], revision: 0 };
      }
      throw new Error(`Unexpected method: ${method}`);
    });

    render(AgentFeaturesSettings);

    const toggle = await screen.findByRole('switch', {
      name: 'Top-level agent spawning & retirement',
    });
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
    expect(toggle.getAttribute('aria-checked')).toBe(String(value));
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(mocks.mockBackendRequest).toHaveBeenCalledWith('settings.update', {
        changes: [{ path: 'agentFeatures.peerAgents', value: !value }],
      });
      expect(toggle.getAttribute('aria-checked')).toBe(String(value));
    });
  });

  it('issues settings.update for agents.maxTopLevelAgents when the cap is saved', async () => {
    mocks.mockBackendRequest.mockImplementation(async (method: string) => {
      if (method === 'settings.list') return listResponse();
      if (method === 'settings.update') {
        return { applied: [{ path: 'agents.maxTopLevelAgents', value: 5 }] };
      }
      throw new Error(`Unexpected method: ${method}`);
    });

    render(AgentFeaturesSettings);

    const input = await screen.findByRole('spinbutton', {
      name: 'Maximum top-level agents per workspace',
    });
    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe('20');
    });
    await fireEvent.input(input, { target: { value: '5' } });
    const save = await screen.findByRole('button', { name: 'Save' });
    await fireEvent.click(save);

    await waitFor(() => {
      const updateCall = vi
        .mocked(mocks.mockBackendRequest)
        .mock.calls.find((call) => call[0] === 'settings.update');
      expect(updateCall).toBeDefined();
      expect(updateCall![1]).toEqual({
        changes: [{ path: 'agents.maxTopLevelAgents', value: 5 }],
      });
    });
  });

  it('issues settings.update for prMonitor.debounceSeconds when the debounce is saved (§6.9)', async () => {
    mocks.mockBackendRequest.mockImplementation(async (method: string) => {
      if (method === 'settings.list') return listResponse();
      if (method === 'settings.update') {
        return { applied: [{ path: 'prMonitor.debounceSeconds', value: 90 }] };
      }
      throw new Error(`Unexpected method: ${method}`);
    });

    render(AgentFeaturesSettings);

    const input = await screen.findByRole('spinbutton', {
      name: 'PR monitor change debounce in seconds',
    });
    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe('60');
    });
    await fireEvent.input(input, { target: { value: '90' } });
    const save = await screen.findByRole('button', { name: 'Save' });
    await fireEvent.click(save);

    await waitFor(() => {
      const updateCall = vi
        .mocked(mocks.mockBackendRequest)
        .mock.calls.find((call) => call[0] === 'settings.update');
      expect(updateCall).toBeDefined();
      expect(updateCall![1]).toEqual({
        changes: [{ path: 'prMonitor.debounceSeconds', value: 90 }],
      });
    });
  });
});
