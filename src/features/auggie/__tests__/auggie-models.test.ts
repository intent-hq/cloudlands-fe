/**
 * Tests for auggie-models client (model type + display helpers; model
 * listing itself lives in the shared provider-models client).
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  getModelIcon,
  type AuggieModel,
} from '../auggie-models.client';

describe('auggie-models', () => {
  describe('getModelIcon', () => {
    it('should return correct icon for Claude models', () => {
      expect(getModelIcon('haiku4.5')).toBe('🌸');
      expect(getModelIcon('opus4.1')).toBe('🎭');
      expect(getModelIcon('sonnet4')).toBe('🎵');
      expect(getModelIcon('sonnet4.5')).toBe('🎭');
      expect(getModelIcon('sonnet4.5_1m')).toBe('📖');
      expect(getModelIcon('sonnet4.5_direct')).toBe('⚡');
    });

    it('should return correct icon for Gemini models', () => {
      expect(getModelIcon('gemini25-pro')).toBe('💎');
      expect(getModelIcon('gemini3-eap')).toBe('🔥');
    });

    it('should return correct icon for GPT models', () => {
      expect(getModelIcon('gpt5-codex')).toBe('🤖');
      expect(getModelIcon('gpt5-r-high-grep')).toBe('📊');
      expect(getModelIcon('gpt5-r-low-grep')).toBe('📉');
      expect(getModelIcon('gpt5-r-medium-grep')).toBe('📈');
    });

    it('should return correct icon for other models', () => {
      expect(getModelIcon('glm4.6')).toBe('🌟');
      expect(getModelIcon('kimi-k2')).toBe('🎋');
      expect(getModelIcon('willow-alpha')).toBe('🌳');
      expect(getModelIcon('willow-alpha-apply-patch')).toBe('🌲');
    });

    it('should return default icon for unknown models', () => {
      expect(getModelIcon('unknown-model')).toBe('🤖');
      expect(getModelIcon('')).toBe('🤖');
    });
  });

  describe('AuggieModel type', () => {
    it('should create valid model objects', () => {
      const model: AuggieModel = {
        value: 'sonnet4.5',
        label: 'Claude Sonnet 4.5',
        description: 'A powerful AI model',
      };

      expect(model.value).toBe('sonnet4.5');
      expect(model.label).toBe('Claude Sonnet 4.5');
      expect(model.description).toBe('A powerful AI model');
    });

    it('should allow optional description', () => {
      const model: AuggieModel = {
        value: 'haiku4.5',
        label: 'Claude Haiku 4.5',
      };

      expect(model.value).toBe('haiku4.5');
      expect(model.description).toBeUndefined();
    });
  });

  // Regression: opus4.7 must have display metadata (it is NOT a hardcoded
  // default — defaults come from the provider CLI's catalog).
  describe('opus4.7 icon regression', () => {
    it('opus4.7 has a dedicated icon (not the fallback)', () => {
      const icon = getModelIcon('opus4.7');
      expect(icon).toBe('🎭');
      // Ensure it's NOT the generic fallback
      expect(icon).not.toBe(getModelIcon('unknown-model'));
    });
  });
});
