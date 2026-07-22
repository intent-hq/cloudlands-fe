import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

vi.mock('$features/providers/provider-models.client', () => ({
  getProviderModels: vi.fn(),
}));

import { getProviderModels } from '$features/providers/provider-models.client';
import {
  fetchModelsForProvider,
  getModelsForProvider,
  getModelsForProviderForLoadingState,
} from './model-utils';

describe('model-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('propagates provider client errors instead of returning an empty list', async () => {
    vi.mocked(getProviderModels).mockRejectedValue(new Error('Auggie: CLI not found'));

    await expect(fetchModelsForProvider('auggie')).rejects.toThrow('Auggie: CLI not found');
    await expect(getModelsForProvider('auggie')).rejects.toThrow('Auggie: CLI not found');
  });

  it('prefixes non-default provider models after a successful fetch', async () => {
    vi.mocked(getProviderModels).mockResolvedValue({
      models: [{ value: 'gpt-5-codex', label: 'GPT-5 Codex' }],
    });

    await expect(getModelsForProvider('codex')).resolves.toEqual([
      { value: 'codex:gpt-5-codex', label: 'GPT-5 Codex' },
    ]);
    expect(vi.mocked(getProviderModels)).toHaveBeenCalledWith('codex', {});
  });

  it('preserves daemon fallback warnings and stale flags for loading-state callers', async () => {
    vi.mocked(getProviderModels).mockResolvedValue({
      models: [{ value: 'gpt-5-codex', label: 'GPT-5 Codex' }],
      warning: 'Codex not installed; using static model list',
      stale: true,
    });

    await expect(getModelsForProviderForLoadingState('codex')).resolves.toEqual({
      models: [{ value: 'codex:gpt-5-codex', label: 'GPT-5 Codex' }],
      warning: 'Codex not installed; using static model list',
      stale: true,
    });
  });

  it('forwards forceRefresh to the provider models client (picker ↻ path)', async () => {
    vi.mocked(getProviderModels).mockResolvedValue({
      models: [{ value: 'sonnet4.6', label: 'Claude Sonnet 4.6' }],
    });

    await getModelsForProviderForLoadingState('auggie', { forceRefresh: true });

    expect(vi.mocked(getProviderModels)).toHaveBeenCalledWith('auggie', { forceRefresh: true });
  });

  it('returns an empty model list for the mock provider without throwing', async () => {
    await expect(fetchModelsForProvider('mock')).resolves.toEqual([]);
    expect(vi.mocked(getProviderModels)).not.toHaveBeenCalled();
  });

  it('routes grok through the daemon-backed provider models client with prefixing', async () => {
    vi.mocked(getProviderModels).mockResolvedValue({
      models: [{ value: 'grok-4-1-fast', label: 'Grok 4.1 Fast' }],
    });

    await expect(getModelsForProviderForLoadingState('grok')).resolves.toEqual({
      models: [{ value: 'grok:grok-4-1-fast', label: 'Grok 4.1 Fast' }],
      warning: undefined,
      stale: undefined,
    });
    expect(vi.mocked(getProviderModels)).toHaveBeenCalledWith('grok', {});
  });

  it('surfaces the daemon warning on grok degradation instead of a hard-coded stub', async () => {
    vi.mocked(getProviderModels).mockResolvedValue({
      models: [],
      warning: 'Grok not installed; no model source available',
    });

    await expect(getModelsForProviderForLoadingState('grok')).resolves.toEqual({
      models: [],
      warning: 'Grok not installed; no model source available',
      stale: undefined,
    });
    expect(vi.mocked(getProviderModels)).toHaveBeenCalledWith('grok', {});
  });
});
