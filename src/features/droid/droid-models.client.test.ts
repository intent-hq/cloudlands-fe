/**
 * Tests for droid-models client invoke routing (Wave 2.B7 regression).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/electron-bridge', async () => await import('$store/renderer/utils/test-helpers/electron-bridge-mock'));
vi.mock('$lib/utils/client-logger', async () => await import('$store/renderer/utils/test-helpers/client-logger-mock'));

import { invoke } from '$lib/electron-bridge';
import { getDroidModels } from './droid-models.client';

describe('droid-models invoke routing', () => {
  const originalElectronAPI = (window as any).electronAPI;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    (window as any).electronAPI = originalElectronAPI;
  });

  it('reaches the real Electron bridge for droid:get-models (live path)', async () => {
    const realInvoke = vi.fn(async () => ({
      success: true,
      data: [{ value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' }],
    }));
    (window as any).electronAPI = { invoke: realInvoke };

    const models = await getDroidModels();

    expect(realInvoke).toHaveBeenCalledWith('droid:get-models');
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
    expect(models).toEqual([{ value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' }]);
  });

  it('falls back to the mock-routed invoke when no real bridge is present', async () => {
    (window as any).electronAPI = undefined;
    vi.mocked(invoke).mockResolvedValueOnce({
      success: true,
      data: [{ value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' }],
    });

    const models = await getDroidModels();

    expect(vi.mocked(invoke)).toHaveBeenCalledWith('droid:get-models');
    expect(models).toEqual([{ value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' }]);
  });
});
