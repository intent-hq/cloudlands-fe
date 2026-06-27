import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('$lib/electron-bridge', () => ({
  invoke,
}));

vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => logger,
}));

import {
  getCodexModels,
  getCodexModelsWithMetadata,
} from './codex-models.client';

describe('codex-models.client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (typeof window === 'undefined') {
      vi.stubGlobal('window', {});
    }
    // Default to the mock-routed bridge (no real Electron bridge) so these
    // tests exercise the fallback path; the routing suite below sets its own.
    (window as any).electronAPI = undefined;
  });

  it('returns IPC fallback warnings to metadata callers', async () => {
    invoke.mockResolvedValue({
      success: true,
      data: [{ value: 'gpt-5-codex', label: 'GPT-5 Codex' }],
      warning: 'Codex not installed; using static model list',
    });

    await expect(getCodexModelsWithMetadata()).resolves.toEqual({
      models: [{ value: 'gpt-5-codex', label: 'GPT-5 Codex' }],
      warning: 'Codex not installed; using static model list',
    });
  });

  it('omits warnings when IPC does not provide one', async () => {
    invoke.mockResolvedValue({
      success: true,
      data: [{ value: 'gpt-5-codex', label: 'GPT-5 Codex' }],
    });

    await expect(getCodexModelsWithMetadata()).resolves.toEqual({
      models: [{ value: 'gpt-5-codex', label: 'GPT-5 Codex' }],
    });
  });

  it('keeps the legacy model-list API returning only models', async () => {
    invoke.mockResolvedValue({
      success: true,
      data: [{ value: 'gpt-5-codex', label: 'GPT-5 Codex' }],
      warning: 'Codex not installed; using static model list',
    });

    await expect(getCodexModels()).resolves.toEqual([
      { value: 'gpt-5-codex', label: 'GPT-5 Codex' },
    ]);
  });

  describe('invokeModelChannel routing', () => {
    const originalElectronAPI = (window as any).electronAPI;

    afterEach(() => {
      (window as any).electronAPI = originalElectronAPI;
    });

    it('reaches the real Electron bridge for codex:get-models (live path)', async () => {
      const realInvoke = vi.fn(async () => ({
        success: true,
        data: [{ value: 'gpt-5-codex', label: 'GPT-5 Codex' }],
      }));
      (window as any).electronAPI = { invoke: realInvoke };

      const models = await getCodexModels();

      expect(realInvoke).toHaveBeenCalledWith('codex:get-models');
      expect(invoke).not.toHaveBeenCalled();
      expect(models).toEqual([{ value: 'gpt-5-codex', label: 'GPT-5 Codex' }]);
    });

    it('falls back to the mock-routed invoke when no real bridge is present', async () => {
      (window as any).electronAPI = undefined;
      invoke.mockResolvedValueOnce({
        success: true,
        data: [{ value: 'gpt-5-codex', label: 'GPT-5 Codex' }],
      });

      const models = await getCodexModels();

      expect(invoke).toHaveBeenCalledWith('codex:get-models');
      expect(models).toEqual([{ value: 'gpt-5-codex', label: 'GPT-5 Codex' }]);
    });
  });
});