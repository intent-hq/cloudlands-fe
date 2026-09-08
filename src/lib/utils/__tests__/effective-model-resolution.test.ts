import { describe, expect, it } from 'vitest';

import { resolveSubmitModelAndProvider } from '../effective-model-resolution';

// Default-model resolution is daemon-owned (PROTOCOL §5.11); the former
// client-side resolution helpers were removed. Only the submit-triple
// normalization (explicit user picks only) remains client-side.
describe('resolveSubmitModelAndProvider', () => {
  it('splits a legacy compound id into its own provider and a bare model', () => {
    expect(resolveSubmitModelAndProvider('claude-code:sonnet', 'grok')).toEqual({
      model: 'sonnet',
      provider: 'claude-code',
    });
  });

  it('pairs a bare model id with the selected provider', () => {
    expect(resolveSubmitModelAndProvider('fable-5', 'grok')).toEqual({
      model: 'fable-5',
      provider: 'grok',
    });
  });

  it('keeps the selected provider when no model resolved', () => {
    expect(resolveSubmitModelAndProvider(undefined, 'grok')).toEqual({
      model: undefined,
      provider: 'grok',
    });
  });

  it('keeps the selected provider for an empty compound prefix (mirrors the daemon filter)', () => {
    expect(resolveSubmitModelAndProvider(':sonnet', 'grok')).toEqual({
      model: 'sonnet',
      provider: 'grok',
    });
  });
});
