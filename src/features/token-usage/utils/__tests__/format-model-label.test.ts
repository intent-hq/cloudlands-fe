// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { formatModelLabel } from '../format-model-label';

describe('formatModelLabel', () => {
  describe('known mappings (raw names observed in real session files)', () => {
    it.each([
      ['claude-fable-5-high-c4-p2-agent', 'Claude Fable 5 (High)'],
      ['claude-haiku-4-5-200k-v13-c4-p2-agent', 'Claude Haiku 4.5'],
      ['claude-sonnet-4-5-200k-v13-c4-p2-agent', 'Claude Sonnet 4.5'],
      ['claude-fruitcake-eap-high-c4-p2-agent', 'Claude Fruitcake EAP (High)'],
      ['gpt5-5-400k-v1-c4-p2-agent', 'GPT-5.5'],
    ])('maps %s to %s', (raw, expected) => {
      expect(formatModelLabel(raw)).toBe(expected);
    });
  });

  describe('unknown bucket', () => {
    it('renders the "unknown" bucket as "Unknown"', () => {
      expect(formatModelLabel('unknown')).toBe('Unknown');
    });

    it('treats empty and whitespace-only input as Unknown', () => {
      expect(formatModelLabel('')).toBe('Unknown');
      expect(formatModelLabel('   ')).toBe('Unknown');
    });
  });

  describe('fallback heuristic for unmapped names', () => {
    it('strips date-stamp suffixes and joins version numbers', () => {
      expect(formatModelLabel('claude-sonnet-4-5-20250929')).toBe('Claude Sonnet 4.5');
    });

    it('strips plumbing suffixes (context size, version, c/p tags, agent)', () => {
      expect(formatModelLabel('claude-opus-4-6-1m-v2-c4-p2-agent')).toBe('Claude Opus 4.6');
    });

    it('renders trailing effort tokens as a parenthetical', () => {
      expect(formatModelLabel('claude-fable-6-low-c4-p2-agent')).toBe('Claude Fable 6 (Low)');
    });

    it('uppercases known acronyms and hyphenates trailing digits', () => {
      expect(formatModelLabel('gpt5-6-400k-v1-c4-p2-agent')).toBe('GPT-5.6');
      expect(formatModelLabel('glm4-6-agent')).toBe('GLM-4.6');
    });

    it('title-cases arbitrary unmapped names without mangling them', () => {
      expect(formatModelLabel('model-big')).toBe('Model Big');
      expect(formatModelLabel('some-new-model')).toBe('Some New Model');
    });

    it('does not collapse a name made entirely of plumbing tokens', () => {
      expect(formatModelLabel('v13-c4-p2-agent')).toBe('v13-c4-p2-agent');
    });

    it('keeps standalone numbers that do not follow a digit', () => {
      expect(formatModelLabel('claude-3-opus')).toBe('Claude 3 Opus');
    });
  });
});

