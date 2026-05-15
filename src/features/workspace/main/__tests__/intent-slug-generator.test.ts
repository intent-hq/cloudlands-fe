/**
 * Tests for Intent Slug Generator
 *
 * Note: These tests focus on the parseSlugResponse logic since
 * the actual LLM call requires a running model.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
} from 'vitest';

// We need to test the internal parseSlugResponse function
// Since it's not exported, we'll test through generateCompleteIntentSlug
// by mocking the background request

// Mock the background-request service
vi.mock('$features/agent/main/background-request.service', () => ({
  makeBackgroundRequest: vi.fn(),
}));

import { generateCompleteIntentSlug } from '../intent-slug-generator';
import { makeBackgroundRequest } from '$features/agent/main/background-request.service';

const mockMakeBackgroundRequest = vi.mocked(makeBackgroundRequest);

describe('IntentSlugGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateCompleteIntentSlug', () => {
    it('returns null for empty intent', async () => {
      const result = await generateCompleteIntentSlug('');
      expect(result).toBeNull();
      expect(mockMakeBackgroundRequest).not.toHaveBeenCalled();
    });

    it('returns null for short intent', async () => {
      const result = await generateCompleteIntentSlug('hi');
      expect(result).toBeNull();
      expect(mockMakeBackgroundRequest).not.toHaveBeenCalled();
    });

    it('returns null when LLM call fails', async () => {
      mockMakeBackgroundRequest.mockResolvedValue({
        success: false,
        error: 'Model not available',
      });

      const result = await generateCompleteIntentSlug('add dark mode to the app');
      expect(result).toBeNull();
    });

    it('returns null when LLM returns empty content', async () => {
      mockMakeBackgroundRequest.mockResolvedValue({
        success: true,
        content: '',
      });

      const result = await generateCompleteIntentSlug('add dark mode to the app');
      expect(result).toBeNull();
    });

    it('generates valid slug from good LLM response', async () => {
      mockMakeBackgroundRequest.mockResolvedValue({
        success: true,
        content: 'dark-mode',
      });

      const result = await generateCompleteIntentSlug('add dark mode to the app');
      expect(result).not.toBeNull();
      // Now returns base slug without suffix
      expect(result).toBe('dark-mode');
    });

    it('handles LLM response with extra whitespace', async () => {
      mockMakeBackgroundRequest.mockResolvedValue({
        success: true,
        content: '  auth-refactor  ',
      });

      const result = await generateCompleteIntentSlug('refactor authentication');
      expect(result).toBe('auth-refactor');
    });

    it('handles LLM response with spaces instead of hyphens', async () => {
      mockMakeBackgroundRequest.mockResolvedValue({
        success: true,
        content: 'bug fix',
      });

      const result = await generateCompleteIntentSlug('fix the login bug');
      expect(result).toBe('bug-fix');
    });

    it('strips numbers from words and produces valid slug', async () => {
      // Numbers are stripped during sanitization, so "api2-test" becomes "api-test"
      mockMakeBackgroundRequest.mockResolvedValue({
        success: true,
        content: 'api2-test3',
      });

      const result = await generateCompleteIntentSlug('test api v2');
      // Numbers are stripped, leaving "api-test"
      expect(result).toBe('api-test');
    });

    it('rejects response that becomes invalid after stripping numbers', async () => {
      // If stripping numbers makes a word too short, it should be rejected
      mockMakeBackgroundRequest.mockResolvedValue({
        success: true,
        content: 'a2-test',
      });

      const result = await generateCompleteIntentSlug('test api');
      // "a2" becomes "a" which is too short
      expect(result).toBeNull();
    });

    it('rejects LLM response with error keywords', async () => {
      mockMakeBackgroundRequest.mockResolvedValue({
        success: true,
        content: 'error-response',
      });

      const result = await generateCompleteIntentSlug('handle errors');
      expect(result).toBeNull();
    });

    it('rejects LLM response with model names', async () => {
      mockMakeBackgroundRequest.mockResolvedValue({
        success: true,
        content: 'model-gemini',
      });

      const result = await generateCompleteIntentSlug('some task');
      expect(result).toBeNull();
    });

    it('rejects response containing "Error" in content', async () => {
      mockMakeBackgroundRequest.mockResolvedValue({
        success: true,
        content: 'Internal Error occurred',
      });

      const result = await generateCompleteIntentSlug('some task');
      expect(result).toBeNull();
    });

    it('rejects response with single word', async () => {
      mockMakeBackgroundRequest.mockResolvedValue({
        success: true,
        content: 'authentication',
      });

      const result = await generateCompleteIntentSlug('fix auth');
      expect(result).toBeNull();
    });

    it('takes only first two words from longer response', async () => {
      mockMakeBackgroundRequest.mockResolvedValue({
        success: true,
        content: 'dark-mode-feature-implementation',
      });

      const result = await generateCompleteIntentSlug('add dark mode');
      expect(result).toBe('dark-mode');
    });

    it('rejects words that are too short', async () => {
      mockMakeBackgroundRequest.mockResolvedValue({
        success: true,
        content: 'a-fix',
      });

      const result = await generateCompleteIntentSlug('quick fix');
      expect(result).toBeNull();
    });
  });
});
