import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  findBestAvailableModel,
  isModelAvailable,
  getModelLabel,
} from '../model-fallback';
import type { AuggieModel } from '$features/auggie/auggie-models.client';

describe('model-fallback', () => {
  const mockModels: AuggieModel[] = [
    { value: 'haiku4.5', label: 'Claude Haiku 4.5' },
    { value: 'sonnet4.5', label: 'Claude Sonnet 4.5' },
    { value: 'gemini25-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini3-eap', label: 'Gemini 3 Orionfire (EAP)' },
  ];

  describe('findBestAvailableModel', () => {
    it('should return requested model if available', () => {
      const result = findBestAvailableModel('haiku4.5', mockModels);
      expect(result.model).toBe('haiku4.5');
      expect(result.usedFallback).toBe(false);
    });

    it('should fallback to first available model if requested model not available', () => {
      const result = findBestAvailableModel('opus4.1', mockModels);
      expect(result.model).toBe('haiku4.5');
      expect(result.usedFallback).toBe(true);
      expect(result.fallbackReason).toContain('not available');
    });

    it('should use first available model when requested is unavailable', () => {
      const limitedModels: AuggieModel[] = [{ value: 'sonnet4.5', label: 'Claude Sonnet 4.5' }];
      const result = findBestAvailableModel('opus4.1', limitedModels);
      expect(result.model).toBe('sonnet4.5');
      expect(result.usedFallback).toBe(true);
    });

    it('should return null when no models available', () => {
      // When no models are available, the function returns null
      // so the UI can show an empty state with retry
      const result = findBestAvailableModel('opus4.1', []);
      expect(result.model).toBeNull();
      expect(result.usedFallback).toBe(true);
      expect(result.fallbackReason).toContain('No models available');
    });
  });

  describe('isModelAvailable', () => {
    it('should return true if model is available', () => {
      expect(isModelAvailable('haiku4.5', mockModels)).toBe(true);
    });

    it('should return false if model is not available', () => {
      expect(isModelAvailable('opus4.1', mockModels)).toBe(false);
    });
  });

  describe('getModelLabel', () => {
    it('should return label if model is found', () => {
      expect(getModelLabel('haiku4.5', mockModels)).toBe('Claude Haiku 4.5');
    });

    it('should return model value if not found', () => {
      expect(getModelLabel('unknown-model', mockModels)).toBe('unknown-model');
    });
  });
});
