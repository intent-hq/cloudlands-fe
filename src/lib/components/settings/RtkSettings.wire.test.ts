/**
 * @vitest-environment jsdom
 *
 * Wire contract test for RtkSettings — asserts PROTOCOL §5.12 request shapes at the
 * transport boundary (backendRequest). Mocks backendRequest, not the appClient facade,
 * and uses the real LiveSettingsClient to verify the exact wire payloads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { SYSTEM_CHANNELS } from '$shared/ipc/channels';

// Mock backend transport (the wire seam)
const mocks = vi.hoisted(() => ({
  mockBackendRequest: vi.fn(),
  mockInvoke: vi.fn(),
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

vi.mock('$shared/generated/ipc-client', () => ({
  invoke: mocks.mockInvoke,
}));

// Mock store
vi.mock('$store/renderer/store', () => ({
  store: {
    dispatch: vi.fn(),
    createSelector: vi.fn((fn) => fn),
    state: {},
  },
}));

import RtkSettings from './RtkSettings.svelte';

describe('RtkSettings wire contract (PROTOCOL §5.12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('issues settings.get with PROTOCOL-shaped { path: "rtk.enabled" } on mount', async () => {
    mocks.mockBackendRequest.mockImplementation(async (method: string, params: unknown) => {
      if (method === 'settings.get') {
        // Assert PROTOCOL §5.12 settings.get shape: { path: string }
        expect(params).toEqual({ path: 'rtk.enabled' });
        return { path: 'rtk.enabled', value: true };
      }
      throw new Error(`Unexpected method: ${method}`);
    });
    mocks.mockInvoke.mockResolvedValue({ data: { available: true } });

    render(RtkSettings);

    await waitFor(() => {
      expect(mocks.mockBackendRequest).toHaveBeenCalledWith('settings.get', { path: 'rtk.enabled' });
    });
  });

  it('issues settings.update with PROTOCOL-shaped { changes: [...] } when toggle changes', async () => {
    mocks.mockBackendRequest.mockImplementation(async (method: string, params: unknown) => {
      if (method === 'settings.get') {
        return { path: 'rtk.enabled', value: false };
      }
      if (method === 'settings.update') {
        // Assert PROTOCOL §5.12 settings.update shape: { changes: [ { path, value }, ... ] }
        expect(params).toEqual({
          changes: [{ path: 'rtk.enabled', value: true }],
        });
        return {};
      }
      throw new Error(`Unexpected method: ${method}`);
    });
    mocks.mockInvoke.mockResolvedValue({ data: { available: true } });

    render(RtkSettings);

    await waitFor(() => screen.getByRole('switch'));
    const toggle = screen.getByRole('switch');
    
    await fireEvent.click(toggle);

    await waitFor(() => {
      const updateCall = vi.mocked(mocks.mockBackendRequest).mock.calls.find(
        (call) => call[0] === 'settings.update'
      );
      expect(updateCall).toBeDefined();
      expect(updateCall![1]).toEqual({
        changes: [{ path: 'rtk.enabled', value: true }],
      });
    });
  });
});
