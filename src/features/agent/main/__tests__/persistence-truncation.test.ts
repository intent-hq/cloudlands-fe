/**
 * Tests for persistence truncation utility
 */

import { describe, it, expect } from 'vitest';
import { truncateLargeFields } from '../persistence-truncation';
import type { AgentMessage } from '$shared/types/agent-message';

function makeMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/** Generate a string of approximately `bytes` length */
function bigString(bytes: number): string {
  return 'x'.repeat(bytes);
}

describe('truncateLargeFields', () => {
  it('should return messages unchanged when all fields are small', () => {
    const messages: AgentMessage[] = [
      makeMessage({
        toolCalls: [{ id: 'tc1', name: 'view', arguments: { path: 'foo.ts' }, result: 'small result' }],
        toolResults: [{ toolCallId: 'tc1', content: 'small content' }],
      }),
    ];

    const result = truncateLargeFields(messages);
    expect(result[0].toolCalls![0].result).toBe('small result');
    expect(result[0].toolCalls![0].arguments).toEqual({ path: 'foo.ts' });
    expect(result[0].toolResults![0].content).toBe('small content');
  });

  it('should truncate large toolCall.result strings', () => {
    const largeResult = bigString(100 * 1024); // 100KB
    const messages: AgentMessage[] = [
      makeMessage({
        toolCalls: [{ id: 'tc1', name: 'view', arguments: {}, result: largeResult }],
      }),
    ];

    const result = truncateLargeFields(messages);
    const truncated = result[0].toolCalls![0].result;

    expect(typeof truncated).toBe('string');
    expect(truncated.length).toBeLessThan(largeResult.length);
    expect(truncated).toContain('[truncated:');
    expect(truncated).toContain('KB original]');
    // Should preserve a prefix
    expect(truncated.startsWith('x')).toBe(true);
  });

  it('should preserve toolCall.arguments without truncation', () => {
    // Arguments (tool inputs) should never be truncated — only results (tool outputs) are truncated.
    const largeArgs: Record<string, string> = {};
    for (let i = 0; i < 1000; i++) {
      largeArgs[`key_${i}`] = bigString(100);
    }
    const messages: AgentMessage[] = [
      makeMessage({
        toolCalls: [{ id: 'tc1', name: 'save-file', arguments: largeArgs, result: 'ok' }],
      }),
    ];

    const result = truncateLargeFields(messages);
    const args = result[0].toolCalls![0].arguments;

    // Arguments should be preserved as-is (still an object, not truncated to string)
    expect(typeof args).toBe('object');
    expect(args).toEqual(largeArgs);
  });

  it('should truncate large toolResult.content', () => {
    const largeContent = bigString(80 * 1024);
    const messages: AgentMessage[] = [
      makeMessage({
        toolResults: [{ toolCallId: 'tc1', content: largeContent }],
      }),
    ];

    const result = truncateLargeFields(messages);
    const truncated = result[0].toolResults![0].content;

    expect(typeof truncated).toBe('string');
    expect(truncated).toContain('[truncated:');
  });

  it('should truncate large tool_result content blocks', () => {
    const largeOutput = bigString(60 * 1024);
    const messages: AgentMessage[] = [
      makeMessage({
        contentBlocks: [
          { type: 'text', text: 'Hello' },
          { type: 'tool_result', output: largeOutput, tool_use_id: 'tc1' },
        ],
      }),
    ];

    const result = truncateLargeFields(messages);
    expect(result[0].contentBlocks![0].text).toBe('Hello'); // text block unchanged
    const truncatedOutput = result[0].contentBlocks![1].output;
    expect(truncatedOutput).toContain('[truncated:');
  });

  it('should not mutate the original messages', () => {
    const largeResult = bigString(100 * 1024);
    const original: AgentMessage[] = [
      makeMessage({
        toolCalls: [{ id: 'tc1', name: 'view', arguments: {}, result: largeResult }],
      }),
    ];

    const originalResultRef = original[0].toolCalls![0].result;
    truncateLargeFields(original);

    // Original should be unchanged
    expect(original[0].toolCalls![0].result).toBe(originalResultRef);
    expect(original[0].toolCalls![0].result.length).toBe(100 * 1024);
  });

  it('should handle messages with no tool data', () => {
    const messages: AgentMessage[] = [
      makeMessage({ contentBlocks: [{ type: 'text', text: 'Just text' }] }),
    ];

    const result = truncateLargeFields(messages);
    expect(result[0]).toBe(messages[0]); // Same reference, no change needed
  });

  it('should preserve the first 2KB of truncated content', () => {
    const prefix = 'PREFIX_DATA_';
    const largeResult = prefix + bigString(100 * 1024);
    const messages: AgentMessage[] = [
      makeMessage({
        toolCalls: [{ id: 'tc1', name: 'view', arguments: {}, result: largeResult }],
      }),
    ];

    const result = truncateLargeFields(messages);
    const truncated = result[0].toolCalls![0].result;

    expect(truncated.startsWith(prefix)).toBe(true);
  });

  it('should handle null and undefined fields gracefully', () => {
    const messages: AgentMessage[] = [
      makeMessage({
        toolCalls: [{ id: 'tc1', name: 'view', arguments: {}, result: undefined }],
        toolResults: [{ toolCallId: 'tc1', content: null }],
      }),
    ];

    const result = truncateLargeFields(messages);
    expect(result[0].toolCalls![0].arguments).toEqual({});
    expect(result[0].toolCalls![0].result).toBeUndefined();
    expect(result[0].toolResults![0].content).toBeNull();
  });
});

