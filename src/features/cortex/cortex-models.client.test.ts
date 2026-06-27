/**
 * Tests for cortex-models client invoke routing (Wave 2.B7 regression).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/electron-bridge', async () => await import('$store/renderer/utils/test-helpers/electron-bridge-mock'));
vi.mock('$lib/utils/client-logger', async () => await import('$store/renderer/utils/test-helpers/client-logger-mock'));

import { invoke } from '$lib/electron-bridge';
import { getCortexModels } from './cortex-models.client';

describe('cortex-models invoke routing', () => {
  const originalElectronAPI = (window as any).electronAPI;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    (window as any).electronAPI = originalElectronAPI;
  });

  it('reaches the real Electron bridge for cortex:get-models (live path)', async () => {
    const realInvoke = vi.fn(async () => ({
      success: true,
      data: [{ value: 'cortex-default', label: 'Cortex Default' }],
    }));
    (window as any).electronAPI = { invoke: realInvoke };

    const models = await getCortexModels();

    expect(realInvoke).toHaveBeenCalledWith('cortex:get-models');
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
    expect(models).toEqual([{ value: 'cortex-default', label: 'Cortex Default' }]);
  });

  it('falls back to the mock-routed invoke when no real bridge is present', async () => {
    (window as any).electronAPI = undefined;
    vi.mocked(invoke).mockResolvedValueOnce({
      success: true,
      data: [{ value: 'cortex-default', label: 'Cortex Default' }],
    });

    const models = await getCortexModels();

    expect(vi.mocked(invoke)).toHaveBeenCalledWith('cortex:get-models');
    expect(models).toEqual([{ value: 'cortex-default', label: 'Cortex Default' }]);
  });
});
