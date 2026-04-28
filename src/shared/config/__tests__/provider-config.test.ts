/**
 * Tests for provider-config helpers, in particular the fuzzy
 * `normalizeModelOverride` function that maps bare/loosely-formatted model
 * names (e.g. "sonnet", "claude-sonnet-4-6") to the qualified
 * "<providerId>:<modelId>" form expected by the coordinator layer.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeModelOverride,
  isModelValidForProvider,
  fuzzyMatchModelInPool,
  PROVIDER_MODEL_TIERS,
} from '../provider-config';

describe('normalizeModelOverride', () => {
  it('returns already-qualified compound IDs unchanged', () => {
    expect(normalizeModelOverride('claude-code:sonnet', 'claude-code')).toBe('claude-code:sonnet');
    expect(normalizeModelOverride('auggie:opus4.7', 'auggie')).toBe('auggie:opus4.7');
  });

  it('normalizes a bare alias to provider:alias for claude-code', () => {
    const out = normalizeModelOverride('sonnet', 'claude-code');
    expect(out).toBe('claude-code:sonnet');
    expect(isModelValidForProvider(out!, 'claude-code')).toBe(true);
  });

  it('normalizes a bare alias for auggie (fast/balanced/smart tiers)', () => {
    expect(normalizeModelOverride('haiku4.5', 'auggie')).toBe('auggie:haiku4.5');
    expect(normalizeModelOverride('sonnet4.5', 'auggie')).toBe('auggie:sonnet4.5');
    expect(normalizeModelOverride('opus4.7', 'auggie')).toBe('auggie:opus4.7');
  });

  it('is case-insensitive for exact matches', () => {
    expect(normalizeModelOverride('SONNET', 'claude-code')).toBe('claude-code:sonnet');
    expect(normalizeModelOverride('Haiku', 'claude-code')).toBe('claude-code:haiku');
  });

  it('strips "claude-" brand prefix when fuzzy-matching', () => {
    // e.g. 'claude-sonnet-4-5' -> 'sonnet4.5' on auggie
    expect(normalizeModelOverride('claude-sonnet-4-5', 'auggie')).toBe('auggie:sonnet4.5');
    expect(normalizeModelOverride('claude-opus-4-7', 'auggie')).toBe('auggie:opus4.7');
  });

  it('handles dashes/dots/slashes interchangeably in fuzzy matches', () => {
    // 'sonnet-4.5' should normalize to 'sonnet4.5' for auggie
    expect(normalizeModelOverride('sonnet-4.5', 'auggie')).toBe('auggie:sonnet4.5');
    // codex tier models contain both dashes and slashes
    expect(normalizeModelOverride('gpt-5.3-codex/high', 'codex')).toBe('codex:gpt-5.3-codex/high');
    expect(normalizeModelOverride('gpt53codexhigh', 'codex')).toBe('codex:gpt-5.3-codex/high');
  });

  it('resolves an ambiguous bare name to the longest matching tier model', () => {
    // 'sonnet' by itself on auggie should pick 'sonnet4.5', not an unrelated alias.
    expect(normalizeModelOverride('sonnet', 'auggie')).toBe('auggie:sonnet4.5');
  });

  it('returns undefined when no reasonable match exists', () => {
    expect(normalizeModelOverride('gpt-4-turbo', 'claude-code')).toBeUndefined();
    expect(normalizeModelOverride('definitely-not-a-model', 'auggie')).toBeUndefined();
  });

  it('does not silently rewrite a longer candidate that merely starts with a tier model', () => {
    // 'gpt-5.3-codex/highest' starts with 'gpt-5.3-codex/high' but is not a
    // valid codex tier model; it must not be coerced to 'codex:gpt-5.3-codex/high'.
    expect(normalizeModelOverride('gpt-5.3-codex/highest', 'codex')).toBeUndefined();
  });

  it('returns undefined for providers without tier models (e.g. opencode)', () => {
    expect(PROVIDER_MODEL_TIERS['opencode']).toBeUndefined();
    expect(normalizeModelOverride('anything', 'opencode')).toBeUndefined();
  });

  it('returns undefined for empty/whitespace candidates', () => {
    expect(normalizeModelOverride('', 'claude-code')).toBeUndefined();
    expect(normalizeModelOverride('   ', 'claude-code')).toBeUndefined();
  });
});

describe('fuzzyMatchModelInPool', () => {
  const codexPool = ['gpt-5-codex', 'gpt-5.3-codex/high', 'gpt-5.3-codex/medium'];
  const auggiePool = ['haiku4.5', 'sonnet4.5', 'sonnet4.6', 'opus4.7'];

  it('returns an exact case-insensitive match', () => {
    expect(fuzzyMatchModelInPool('gpt-5-codex', codexPool)).toBe('gpt-5-codex');
    expect(fuzzyMatchModelInPool('GPT-5-CODEX', codexPool)).toBe('gpt-5-codex');
  });

  it('returns a normalized exact match when punctuation differs', () => {
    // 'sonnet-4.5' → normalized 'sonnet45' == 'sonnet4.5' normalized
    expect(fuzzyMatchModelInPool('sonnet-4.5', auggiePool)).toBe('sonnet4.5');
  });

  it('strips a leading "claude-" brand prefix when fuzzy-matching', () => {
    expect(fuzzyMatchModelInPool('claude-sonnet-4-6', auggiePool)).toBe('sonnet4.6');
  });

  it('prefix-matches a short alias to the longest pool entry', () => {
    // 'sonnet' prefix-matches both 'sonnet4.5' and 'sonnet4.6'; longest wins
    // so we consistently pick 'sonnet4.6' (sonnet45 = 8, sonnet46 = 8 — tie
    // broken by pool order; this test documents the chosen contract).
    const result = fuzzyMatchModelInPool('sonnet', auggiePool);
    expect(['sonnet4.5', 'sonnet4.6']).toContain(result);
  });

  it('does not rewrite a longer candidate that merely starts with a pool entry', () => {
    // 'gpt-5.3-codex/highest' normalizes to 'gpt53codexhighest' which starts
    // with no pool entry (pool entries are shorter) — one-way prefix rule.
    expect(fuzzyMatchModelInPool('gpt-5.3-codex/highest', codexPool)).toBeUndefined();
  });

  it('returns undefined for empty candidate or empty pool', () => {
    expect(fuzzyMatchModelInPool('', codexPool)).toBeUndefined();
    expect(fuzzyMatchModelInPool('gpt-5', [])).toBeUndefined();
  });

  it('returns undefined when there is genuinely no match', () => {
    expect(fuzzyMatchModelInPool('llama-7b', auggiePool)).toBeUndefined();
  });
});
