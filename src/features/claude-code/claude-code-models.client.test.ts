/**
 * Tests for claude-code-models client invoke routing (Wave 2.B7 regression).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/electron-bridge', async () => await import('$store/renderer/utils/test-helpers/electron-bridge-mock'));
vi.mock('$lib/utils/client-logger', async () => await import('$store/renderer/utils/test-helpers/client-logger-mock'));

import { invoke } from '$lib/electron-bridge';
import { getClaudeCodeModels } from './claude-code-models.client';

describe('claude-code-models invoke routing', () => {
  const originalElectronAPI = (window as any).electronAPI;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    (window as any).electronAPI = originalElectronAPI;
  });

  it('reaches the real Electron bridge for claude-code:get-models (live path)', async () => {
    const realInvoke = vi.fn(async () => ({
      success: true,
      data: [{ value: 'sonnet', label: 'Claude Sonnet' }],
    }));
    (window as any).electronAPI = { invoke: realInvoke };

    const models = await getClaudeCodeModels();

    expect(realInvoke).toHaveBeenCalledWith('claude-code:get-models');
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
    expect(models).toEqual([{ value: 'sonnet', label: 'Claude Sonnet' }]);
  });

  it('falls back to the mock-routed invoke when no real bridge is present', async () => {
    (window as any).electronAPI = undefined;
    vi.mocked(invoke).mockResolvedValueOnce({
      success: true,
      data: [{ value: 'sonnet', label: 'Claude Sonnet' }],
    });

    const models = await getClaudeCodeModels();

    expect(vi.mocked(invoke)).toHaveBeenCalledWith('claude-code:get-models');
    expect(models).toEqual([{ value: 'sonnet', label: 'Claude Sonnet' }]);
  });
});
