/**
 * Tests for auggie-models client
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getModelIcon, type AuggieModel } from '../auggie-models.client';

// Mock the electron-bridge
vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn(),
}));

// Mock the logger
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('auggie-models', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  // Regression: opus4.6 is the Auggie default and must have display metadata
  describe('opus4.6 default model regression', () => {
    it('opus4.6 has a dedicated icon (not the fallback)', () => {
      const icon = getModelIcon('opus4.6');
      expect(icon).toBe('🎭');
      // Ensure it's NOT the generic fallback
      expect(icon).not.toBe(getModelIcon('unknown-model'));
    });
  });
});
