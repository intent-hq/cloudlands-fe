/**
 * Tests for text-utils
 */

import { describe, it, expect } from 'vitest';
import {
  getLastMeaningfulLine,
  getLastSentence,
  extractTextFromBlocks,
  getAgentSummaryText,
} from '../text-utils';

describe('text-utils', () => {
  describe('getLastMeaningfulLine', () => {
    it('should return empty string for empty input', () => {
      expect(getLastMeaningfulLine('')).toBe('');
      expect(getLastMeaningfulLine(null as any)).toBe('');
    });

    it('should return last non-empty line', () => {
      expect(getLastMeaningfulLine('line1\nline2\nline3')).toBe('line3');
    });

    it('should skip trailing empty lines', () => {
      expect(getLastMeaningfulLine('line1\nline2\n\n\n')).toBe('line2');
    });

    it('should skip whitespace-only lines', () => {
      expect(getLastMeaningfulLine('line1\n   \n\t\n')).toBe('line1');
    });

    it('should trim the result', () => {
      expect(getLastMeaningfulLine('  line1  ')).toBe('line1');
    });
  });

  describe('getLastSentence', () => {
    it('should return empty string for empty input', () => {
      expect(getLastSentence('')).toBe('');
    });

    it('should return last sentence from line ending with punctuation', () => {
      expect(getLastSentence('First sentence. Second sentence.')).toBe('Second sentence.');
    });

    it('should return whole line if no sentence punctuation', () => {
      expect(getLastSentence('This is a partial thought')).toBe('This is a partial thought');
    });

    it('should handle question marks', () => {
      expect(getLastSentence('What is this? How does it work?')).toBe('How does it work?');
    });

    it('should handle exclamation marks', () => {
      expect(getLastSentence('Hello! World!')).toBe('World!');
    });
  });

  describe('extractTextFromBlocks', () => {
    it('should return empty string for empty input', () => {
      expect(extractTextFromBlocks([])).toBe('');
      expect(extractTextFromBlocks(null as any)).toBe('');
    });

    it('should extract text from text blocks', () => {
      const blocks = [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: 'World' },
      ];
      expect(extractTextFromBlocks(blocks)).toBe('Hello World');
    });

    it('should ignore non-text blocks', () => {
      const blocks = [
        { type: 'text', text: 'Hello' },
        { type: 'tool_use', name: 'test' },
        { type: 'text', text: 'World' },
      ];
      expect(extractTextFromBlocks(blocks)).toBe('Hello World');
    });

    it('should handle content property', () => {
      const blocks = [{ type: 'text', content: 'Content text' }];
      expect(extractTextFromBlocks(blocks)).toBe('Content text');
    });
  });

  describe('getAgentSummaryText', () => {
    it('should return null for empty messages', () => {
      expect(getAgentSummaryText([])).toBeNull();
      expect(getAgentSummaryText(null as any)).toBeNull();
    });

    it('should extract text from last assistant message', () => {
      const messages = [
        { role: 'user', contentBlocks: [{ type: 'text', text: 'User message' }] },
        { role: 'assistant', contentBlocks: [{ type: 'text', text: 'Assistant response' }] },
      ];
      expect(getAgentSummaryText(messages)).toBe('Assistant response');
    });

    it('should skip user messages', () => {
      const messages = [
        { role: 'assistant', contentBlocks: [{ type: 'text', text: 'First' }] },
        { role: 'user', contentBlocks: [{ type: 'text', text: 'User' }] },
      ];
      expect(getAgentSummaryText(messages)).toBe('First');
    });

    it('should show tool usage', () => {
      const messages = [
        { role: 'assistant', contentBlocks: [{ type: 'tool_use', name: 'read_file' }] },
      ];
      expect(getAgentSummaryText(messages)).toBe('Using read_file...');
    });
  });
});
