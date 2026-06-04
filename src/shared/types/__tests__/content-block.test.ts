/**
 * Tests for ContentBlock type and utilities
 */

import { describe, it, expect } from 'vitest';
import {
  isContentBlock,
  normalizeContentBlock,
  normalizeContentBlocks,
  type ContentBlock,
} from '../content-block';
import {
  isTextBlock,
  isCodeBlock,
  isToolUseBlock,
  isToolResultBlock,
  isThinkingBlock,
  isImageBlock,
  isAudioBlock,
  hasTextContent,
  getTextContent,
  isErrorBlock,
  isToolBlock,
  isMediaBlock,
} from '../content-block.guards';
import {
  migrateFromLegacy,
  convertFromACP,
  convertToACP,
  migrateContentBlocks,
} from '../content-block.migration';

describe('ContentBlock Type', () => {
  describe('isContentBlock', () => {
    it('should identify valid text blocks', () => {
      const block: ContentBlock = { type: 'text', text: 'hello' };
      expect(isContentBlock(block)).toBe(true);
    });

    it('should identify valid tool_use blocks', () => {
      const block: ContentBlock = {
        type: 'tool_use',
        name: 'test',
        input: {},
      };
      expect(isContentBlock(block)).toBe(true);
    });

    it('should reject invalid blocks', () => {
      expect(isContentBlock({ type: 'invalid' })).toBe(false);
      expect(isContentBlock(null)).toBe(false);
      expect(isContentBlock('not a block')).toBe(false);
    });

    it('should identify proposal blocks', () => {
      expect(
        isContentBlock({
          kind: 'settings-change',
          payload: { theme: 'dark' },
          preview: { title: 'Change theme' },
        }),
      ).toBe(true);
    });
  });

  describe('normalizeContentBlock', () => {
    it('should normalize text field', () => {
      const block = { type: 'text', content: 'hello' };
      const normalized = normalizeContentBlock(block);
      expect(normalized.text).toBe('hello');
    });

    it('should normalize toolName to name', () => {
      const block = { type: 'tool_use', toolName: 'test', input: {} };
      const normalized = normalizeContentBlock(block);
      expect(normalized.name).toBe('test');
    });

    it('should normalize isError to is_error', () => {
      const block = { type: 'tool_result', isError: true };
      const normalized = normalizeContentBlock(block);
      expect(normalized.is_error).toBe(true);
    });

    it('should throw on invalid block', () => {
      expect(() => normalizeContentBlock({ type: 'invalid' })).toThrow();
    });

    it('should normalize proposal kind blocks to proposal type', () => {
      const normalized = normalizeContentBlock({
        kind: 'workspace-create',
        payload: { name: 'Docs' },
        preview: { title: 'Create workspace' },
      });
      expect(normalized.type).toBe('proposal');
      expect(normalized.kind).toBe('workspace-create');
    });
  });

  describe('normalizeContentBlocks', () => {
    it('should return null/undefined as-is', () => {
      expect(normalizeContentBlocks(null as any)).toBe(null);
      expect(normalizeContentBlocks(undefined as any)).toBe(undefined);
    });

    it('should return empty array as-is', () => {
      const blocks: ContentBlock[] = [];
      expect(normalizeContentBlocks(blocks)).toBe(blocks);
    });

    it('should return single-element array as-is', () => {
      const blocks: ContentBlock[] = [{ type: 'text', text: 'hello' }];
      expect(normalizeContentBlocks(blocks)).toBe(blocks);
    });

    it('should merge adjacent text blocks', () => {
      const blocks: ContentBlock[] = [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world' },
        { type: 'text', text: '!' },
      ];
      const result = normalizeContentBlocks(blocks);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('text');
      expect(result[0].text).toBe('Hello world!');
    });

    it('should not merge text blocks separated by non-text blocks', () => {
      const blocks: ContentBlock[] = [
        { type: 'text', text: 'Before tool' },
        { type: 'tool_use', name: 'read_file', input: { path: 'foo.ts' } },
        { type: 'text', text: 'After tool' },
      ];
      const result = normalizeContentBlocks(blocks);
      expect(result).toHaveLength(3);
      expect(result[0].text).toBe('Before tool');
      expect(result[1].type).toBe('tool_use');
      expect(result[2].text).toBe('After tool');
    });

    it('should merge multiple groups of adjacent text blocks around tool calls', () => {
      const blocks: ContentBlock[] = [
        { type: 'text', text: 'Part 1a ' },
        { type: 'text', text: 'Part 1b' },
        { type: 'tool_use', name: 'tool1', input: {} },
        { type: 'tool_result', tool_use_id: '1', content: 'result' },
        { type: 'text', text: 'Part 2a ' },
        { type: 'text', text: 'Part 2b ' },
        { type: 'text', text: 'Part 2c' },
        { type: 'tool_use', name: 'tool2', input: {} },
        { type: 'text', text: 'Part 3' },
      ];
      const result = normalizeContentBlocks(blocks);
      expect(result).toHaveLength(6);
      expect(result[0]).toEqual({ type: 'text', text: 'Part 1a Part 1b' });
      expect(result[1].type).toBe('tool_use');
      expect(result[2].type).toBe('tool_result');
      expect(result[3]).toEqual({ type: 'text', text: 'Part 2a Part 2b Part 2c' });
      expect(result[4].type).toBe('tool_use');
      expect(result[5]).toEqual({ type: 'text', text: 'Part 3' });
    });

    it('should handle text blocks with legacy content field', () => {
      const blocks: ContentBlock[] = [
        { type: 'text', content: 'Hello ' },
        { type: 'text', content: 'world' },
      ];
      const result = normalizeContentBlocks(blocks);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('Hello world');
    });

    it('should handle mixed text and content fields', () => {
      const blocks: ContentBlock[] = [
        { type: 'text', text: 'Hello ' },
        { type: 'text', content: 'world' },
      ];
      const result = normalizeContentBlocks(blocks);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('Hello world');
    });

    it('should handle text blocks with empty text', () => {
      const blocks: ContentBlock[] = [
        { type: 'text', text: '' },
        { type: 'text', text: 'hello' },
        { type: 'text', text: '' },
      ];
      const result = normalizeContentBlocks(blocks);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('hello');
    });

    it('should not mutate the input array or blocks', () => {
      const blocks: ContentBlock[] = [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world' },
      ];
      const originalBlocks = blocks.map((b) => ({ ...b }));
      normalizeContentBlocks(blocks);
      expect(blocks).toEqual(originalBlocks);
    });

    it('should pass through non-text blocks unchanged', () => {
      const blocks: ContentBlock[] = [
        { type: 'tool_use', name: 'tool1', input: { a: 1 } },
        { type: 'tool_result', tool_use_id: '1', content: 'result' },
        { type: 'thinking', text: 'hmm' },
      ];
      const result = normalizeContentBlocks(blocks);
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ type: 'tool_use', name: 'tool1', input: { a: 1 } });
      expect(result[1]).toEqual({ type: 'tool_result', tool_use_id: '1', content: 'result' });
      expect(result[2]).toEqual({ type: 'thinking', text: 'hmm' });
    });

    it('should reproduce the exact bug scenario from logs (28 fragmented backend blocks)', () => {
      // Simulates the backend producing many small text blocks between tool calls
      const blocks: ContentBlock[] = [
        { type: 'text', text: 'Perfect' },
        { type: 'text', text: ', let me ' },
        { type: 'text', text: 'read the spec.' },
        { type: 'tool_use', name: 'read_note', id: 't1', input: { name: 'Spec' } },
        { type: 'tool_result', tool_use_id: 't1', content: 'spec content...' },
        { type: 'text', text: 'Now' },
        { type: 'text', text: ' I' },
        { type: 'text', text: "'ll implement this." },
        { type: 'tool_use', name: 'delegate_task', id: 't2', input: { task: 'build' } },
        { type: 'tool_result', tool_use_id: 't2', content: 'done' },
        { type: 'text', text: 'I' },
        { type: 'text', text: "'ve delegated the task." },
      ];
      const result = normalizeContentBlocks(blocks);
      // 12 blocks → 7: three text groups merge into 3 single text blocks
      expect(result).toHaveLength(7);
      expect(result[0]).toEqual({ type: 'text', text: 'Perfect, let me read the spec.' });
      expect(result[1].type).toBe('tool_use');
      expect(result[2].type).toBe('tool_result');
      expect(result[3]).toEqual({ type: 'text', text: "Now I'll implement this." });
      expect(result[4].type).toBe('tool_use');
      expect(result[5].type).toBe('tool_result');
      expect(result[6]).toEqual({ type: 'text', text: "I've delegated the task." });
    });
  });
});

describe('Type Guards', () => {
  it('isTextBlock should identify text blocks', () => {
    expect(isTextBlock({ type: 'text', text: 'hello' })).toBe(true);
    expect(isTextBlock({ type: 'code', text: 'hello' })).toBe(false);
  });

  it('isCodeBlock should identify code blocks', () => {
    expect(isCodeBlock({ type: 'code', language: 'ts' })).toBe(true);
    expect(isCodeBlock({ type: 'text' })).toBe(false);
  });

  it('isToolUseBlock should identify tool_use blocks', () => {
    expect(isToolUseBlock({ type: 'tool_use', name: 'test', input: {} })).toBe(true);
    expect(isToolUseBlock({ type: 'tool_result' })).toBe(false);
  });

  it('isToolResultBlock should identify tool_result blocks', () => {
    expect(isToolResultBlock({ type: 'tool_result', tool_use_id: '123' })).toBe(true);
    expect(isToolResultBlock({ type: 'tool_use' })).toBe(false);
  });

  it('isThinkingBlock should identify thinking blocks', () => {
    expect(isThinkingBlock({ type: 'thinking' })).toBe(true);
    expect(isThinkingBlock({ type: 'text' })).toBe(false);
  });

  it('isImageBlock should identify image blocks', () => {
    expect(isImageBlock({ type: 'image', data: 'base64', mimeType: 'image/png' })).toBe(true);
    expect(isImageBlock({ type: 'image' })).toBe(false);
  });

  it('isAudioBlock should identify audio blocks', () => {
    expect(isAudioBlock({ type: 'audio', data: 'base64', mimeType: 'audio/mp3' })).toBe(true);
    expect(isAudioBlock({ type: 'audio' })).toBe(false);
  });

  it('hasTextContent should check for text', () => {
    expect(hasTextContent({ type: 'text', text: 'hello' })).toBe(true);
    expect(hasTextContent({ type: 'text', content: 'hello' })).toBe(true);
    expect(hasTextContent({ type: 'code' })).toBe(false);
  });

  it('getTextContent should extract text', () => {
    expect(getTextContent({ type: 'text', text: 'hello' })).toBe('hello');
    expect(getTextContent({ type: 'text', content: 'world' })).toBe('world');
    expect(getTextContent({ type: 'code' })).toBeUndefined();
  });

  it('isErrorBlock should identify error blocks', () => {
    expect(isErrorBlock({ type: 'tool_result', is_error: true })).toBe(true);
    expect(isErrorBlock({ type: 'tool_result', isError: true })).toBe(true);
    expect(isErrorBlock({ type: 'tool_result' })).toBe(false);
  });

  it('isToolBlock should identify tool blocks', () => {
    expect(isToolBlock({ type: 'tool_use', name: 'test', input: {} })).toBe(true);
    expect(isToolBlock({ type: 'tool_result', tool_use_id: '123' })).toBe(true);
    expect(isToolBlock({ type: 'text' })).toBe(false);
  });

  it('isMediaBlock should identify media blocks', () => {
    expect(isMediaBlock({ type: 'image', data: 'base64', mimeType: 'image/png' })).toBe(true);
    expect(isMediaBlock({ type: 'audio', data: 'base64', mimeType: 'audio/mp3' })).toBe(true);
    expect(isMediaBlock({ type: 'image' })).toBe(false);
  });
});

describe('Migration Utilities', () => {
  it('migrateFromLegacy should handle legacy format', () => {
    const legacy = { type: 'text', content: 'hello' };
    const migrated = migrateFromLegacy(legacy);
    expect(migrated.text).toBe('hello');
  });

  it('convertFromACP should convert ACP format', () => {
    const acp = { type: 'text', text: 'hello' };
    const converted = convertFromACP(acp);
    expect(converted.text).toBe('hello');
  });

  it('convertFromACP should convert proposal resources to proposal blocks', () => {
    const converted = convertFromACP({
      type: 'resource',
      resource: {
        uri: 'intent-proposal://settings-change/test',
        mimeType: 'application/vnd.intent.proposal+json',
        text: JSON.stringify({
          kind: 'settings-change',
          payload: { changes: [] },
          preview: { title: 'Change settings' },
        }),
      },
    });

    expect(converted.type).toBe('proposal');
    expect(converted.kind).toBe('settings-change');
  });

  it('convertToACP should convert to ACP format', () => {
    const block: ContentBlock = { type: 'text', text: 'hello' };
    const acp = convertToACP(block);
    expect(acp.type).toBe('text');
    expect(acp.text).toBe('hello');
  });

  it('migrateContentBlocks should batch migrate', () => {
    const blocks = [
      { type: 'text', content: 'hello' },
      { type: 'tool_use', toolName: 'test', input: {} },
    ];
    const migrated = migrateContentBlocks(blocks);
    expect(migrated).toHaveLength(2);
    expect(migrated[0].text).toBe('hello');
    expect(migrated[1].name).toBe('test');
  });

  it('migrateFromLegacy should preserve proposal fields', () => {
    const migrated = migrateFromLegacy({
      kind: 'bulk-op',
      payload: { action: 'archive' },
      preview: { title: 'Archive workspaces', bulkItems: [{ id: '1', title: 'One' }] },
      applyToolCallId: 'tool-1',
    });

    expect(migrated.type).toBe('proposal');
    expect(migrated.kind).toBe('bulk-op');
    expect(migrated.applyToolCallId).toBe('tool-1');
  });
});
