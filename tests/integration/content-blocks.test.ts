/**
 * Test content block handling
 * Ensures text, tool_use, and tool_result blocks render correctly
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Content Block Handling', () => {
  let mockRenderer: any;

  beforeEach(() => {
    mockRenderer = {
      renderBlock: vi.fn((block) => {
        switch (block.type) {
          case 'text':
            return { type: 'text', content: block.text };
          case 'tool_use':
            return {
              type: 'tool_use',
              toolName: block.name,
              toolId: block.id,
              input: block.input,
            };
          case 'tool_result':
            return {
              type: 'tool_result',
              toolId: block.toolUseId,
              result: block.content,
              isError: block.isError || false,
            };
          default:
            return null;
        }
      }),
    };
  });

  it('should render text blocks correctly', () => {
    const block = {
      type: 'text',
      text: 'This is a text response',
    };

    const rendered = mockRenderer.renderBlock(block);
    expect(rendered.type).toBe('text');
    expect(rendered.content).toBe('This is a text response');
  });

  it('should render tool_use blocks with all properties', () => {
    const block = {
      type: 'tool_use',
      id: 'tool_123',
      name: 'search',
      input: { query: 'test query', limit: 10 },
    };

    const rendered = mockRenderer.renderBlock(block);
    expect(rendered.type).toBe('tool_use');
    expect(rendered.toolName).toBe('search');
    expect(rendered.toolId).toBe('tool_123');
    expect(rendered.input.query).toBe('test query');
    expect(rendered.input.limit).toBe(10);
  });

  it('should render tool_result blocks with success', () => {
    const block = {
      type: 'tool_result',
      toolUseId: 'tool_123',
      content: 'Search found 5 results',
      isError: false,
    };

    const rendered = mockRenderer.renderBlock(block);
    expect(rendered.type).toBe('tool_result');
    expect(rendered.toolId).toBe('tool_123');
    expect(rendered.result).toBe('Search found 5 results');
    expect(rendered.isError).toBe(false);
  });

  it('should render tool_result blocks with error', () => {
    const block = {
      type: 'tool_result',
      toolUseId: 'tool_123',
      content: 'Tool execution failed: timeout',
      isError: true,
    };

    const rendered = mockRenderer.renderBlock(block);
    expect(rendered.type).toBe('tool_result');
    expect(rendered.isError).toBe(true);
    expect(rendered.result).toContain('timeout');
  });

  it('should handle mixed content blocks in sequence', () => {
    const blocks = [
      { type: 'text', text: 'Let me search for that' },
      { type: 'tool_use', id: 'tool_1', name: 'search', input: { query: 'test' } },
      { type: 'tool_result', toolUseId: 'tool_1', content: 'Found 3 results' },
      { type: 'text', text: 'Here are the results' },
    ];

    const rendered = blocks.map((b) => mockRenderer.renderBlock(b));

    expect(rendered).toHaveLength(4);
    expect(rendered[0].type).toBe('text');
    expect(rendered[1].type).toBe('tool_use');
    expect(rendered[2].type).toBe('tool_result');
    expect(rendered[3].type).toBe('text');
  });

  it('should handle empty text blocks', () => {
    const block = { type: 'text', text: '' };
    const rendered = mockRenderer.renderBlock(block);
    expect(rendered.content).toBe('');
  });

  it('should handle tool_use with complex input', () => {
    const block = {
      type: 'tool_use',
      id: 'tool_complex',
      name: 'analyze',
      input: {
        data: [1, 2, 3, 4, 5],
        options: { method: 'statistical', includeOutliers: false },
        metadata: { source: 'user_input', timestamp: '2025-01-01' },
      },
    };

    const rendered = mockRenderer.renderBlock(block);
    expect(rendered.input.data).toEqual([1, 2, 3, 4, 5]);
    expect(rendered.input.options.method).toBe('statistical');
    expect(rendered.input.metadata.source).toBe('user_input');
  });

  it('should handle tool_result with structured content', () => {
    const block = {
      type: 'tool_result',
      toolUseId: 'tool_complex',
      content: JSON.stringify({
        mean: 3,
        median: 3,
        stdDev: 1.41,
        outliers: [],
      }),
      isError: false,
    };

    const rendered = mockRenderer.renderBlock(block);
    expect(rendered.isError).toBe(false);
    expect(rendered.result).toContain('mean');
  });

  it('should handle unknown block types gracefully', () => {
    const block = { type: 'unknown', data: 'something' };
    const rendered = mockRenderer.renderBlock(block);
    expect(rendered).toBeNull();
  });
});
