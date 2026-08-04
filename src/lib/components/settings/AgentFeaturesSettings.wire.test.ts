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
  BackendError: class BackendError extends Error {
    constructor(payload: { code: string; message: string }) {
      super(payload.message);
      this.code = payload.code;
    }
    code: string;
  },
}));

import AgentFeaturesSettings from './AgentFeaturesSettings.svelte';

const FEATURE_PATHS = [
  'agentFeatures.backgroundHooks',
  'agentFeatures.hostExec',
  'agentFeatures.scripts',
  'agentFeatures.terminalAccess',
  'agentFeatures.browserAutomation',
  'agentFeatures.richChatBlocks',
  'agentFeatures.structuredQuestions',
  'agentFeatures.attentionRequests',
];

// PROTOCOL §5.12 settings.list response with all eight agentFeatures.* entries
function listResponse() {
  return {
    settings: FEATURE_PATHS.map((path) => ({
      path,
      value: true,
      definition: { path, type: 'boolean', scope: 'user' },
    })),
  };
}

describe('AgentFeaturesSettings wire contract (PROTOCOL §5.12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
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
});
