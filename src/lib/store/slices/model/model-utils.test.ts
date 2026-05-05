import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$features/auggie/auggie-models.client', () => ({
  getAuggieModels: vi.fn(),
}));

vi.mock('$features/claude-code/claude-code-models.client', () => ({
  getClaudeCodeModels: vi.fn(),
}));

vi.mock('$features/codex/codex-models.client', () => ({
  getCodexModels: vi.fn(),
  getCodexModelsWithMetadata: vi.fn(),
}));

vi.mock('$features/cortex/cortex-models.client', () => ({
  getCortexModels: vi.fn(),
}));

vi.mock('$features/opencode/opencode-models.client', () => ({
  getOpencodeModels: vi.fn(),
}));

import { getAuggieModels } from '$features/auggie/auggie-models.client';
import { getCodexModelsWithMetadata } from '$features/codex/codex-models.client';
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
    vi.mocked(getAuggieModels).mockRejectedValue(new Error('Auggie: CLI not found'));

    await expect(fetchModelsForProvider('auggie')).rejects.toThrow('Auggie: CLI not found');
    await expect(getModelsForProvider('auggie')).rejects.toThrow('Auggie: CLI not found');
  });

  it('prefixes non-default provider models after a successful fetch', async () => {
    vi.mocked(getCodexModelsWithMetadata).mockResolvedValue({
      models: [{ value: 'gpt-5-codex', label: 'GPT-5 Codex' }],
    });

    await expect(getModelsForProvider('codex')).resolves.toEqual([
      { value: 'codex:gpt-5-codex', label: 'GPT-5 Codex' },
    ]);
  });

  it('preserves Codex fallback warnings for loading-state callers', async () => {
    vi.mocked(getCodexModelsWithMetadata).mockResolvedValue({
      models: [{ value: 'gpt-5-codex', label: 'GPT-5 Codex' }],
      warning: 'Codex not installed; using static model list',
    });

    await expect(getModelsForProviderForLoadingState('codex')).resolves.toEqual({
      models: [{ value: 'codex:gpt-5-codex', label: 'GPT-5 Codex' }],
      warning: 'Codex not installed; using static model list',
    });
  });

  it('returns an empty model list for the mock provider without throwing', async () => {
    await expect(fetchModelsForProvider('mock')).resolves.toEqual([]);
  });
});
