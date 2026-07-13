/**
 * Tests for pi-models client invoke routing (Wave 2.B7 regression).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/electron-bridge', async () => await import('$store/renderer/utils/test-helpers/electron-bridge-mock'));
vi.mock('$lib/utils/client-logger', async () => await import('$store/renderer/utils/test-helpers/client-logger-mock'));

import { invoke } from '$lib/electron-bridge';
import { getPiModels } from './pi-models.client';

describe('pi-models invoke routing', () => {
  const originalElectronAPI = (window as any).electronAPI;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    (window as any).electronAPI = originalElectronAPI;
  });

  it('reaches the real Electron bridge for pi:get-models (live path)', async () => {
    const realInvoke = vi.fn(async () => ({
      success: true,
      data: [{ value: 'pi-default', label: 'Pi Default' }],
    }));
    (window as any).electronAPI = { invoke: realInvoke };

    const models = await getPiModels();

    expect(realInvoke).toHaveBeenCalledWith('pi:get-models');
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
    expect(models).toEqual([{ value: 'pi-default', label: 'Pi Default' }]);
  });

  it('falls back to the mock-routed invoke when no real bridge is present', async () => {
    (window as any).electronAPI = undefined;
    vi.mocked(invoke).mockResolvedValueOnce({
      success: true,
      data: [{ value: 'pi-default', label: 'Pi Default' }],
    });

    const models = await getPiModels();

    expect(vi.mocked(invoke)).toHaveBeenCalledWith('pi:get-models');
    expect(models).toEqual([{ value: 'pi-default', label: 'Pi Default' }]);
  });
});
