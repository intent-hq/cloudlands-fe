import { describe, expect, it } from 'vitest';
import { buildLegacyReasoningEffortModelId } from './legacy-reasoning-effort';

describe('buildLegacyReasoningEffortModelId', () => {
  it('appends an effort to a legacy codex base model', () => {
    expect(buildLegacyReasoningEffortModelId('gpt-5.3-codex', 'high', ['low', 'high'])).toBe(
      'gpt-5.3-codex/high',
    );
  });

  it('replaces an existing legacy effort suffix', () => {
    expect(
      buildLegacyReasoningEffortModelId('codex:gpt-5.3-codex/low', 'xhigh', ['low', 'xhigh']),
    ).toBe('codex:gpt-5.3-codex/xhigh');
  });

  it('clears an existing effort back to the base model', () => {
    expect(buildLegacyReasoningEffortModelId('gpt-5.3-codex/high', null, ['high'])).toBe(
      'gpt-5.3-codex',
    );
  });

  it('supports catalog-advertised effort levels for non-codex providers', () => {
    expect(
      buildLegacyReasoningEffortModelId('gpt5.6-sol', 'max', [
        'none',
        'low',
        'medium',
        'high',
        'xhigh',
        'max',
      ]),
    ).toBe('gpt5.6-sol/max');
  });

  it('rejects effort names or models not backed by catalog metadata', () => {
    expect(buildLegacyReasoningEffortModelId('gpt5.6-sol', 'ultra', ['low', 'high'])).toBeNull();
    expect(buildLegacyReasoningEffortModelId('gpt5.6-sol', 'high', undefined)).toBeNull();
  });
});
